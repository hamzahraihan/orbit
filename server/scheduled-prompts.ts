/**
 * Messages the user lined up for later: "send this at 21:40", kept on the PC that owns the pane so
 * they fire while every browser is closed (the phone in a pocket, the laptop shut).
 *
 * A schedule is not a draft. A draft waits for the user and is never sent by anything else
 * (`src/lib/messageQueue.ts`); a schedule is the user's own instruction to send at a time, and it
 * is the only text this server sends without a request arriving at that moment. It is typed into
 * the same pane input the chat composer types into, one entry at a time, and it never retries: a
 * send that failed keeps its row with the reason, so nothing is typed twice and nothing disappears.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** A pane holds a handful of future messages, not a calendar. */
export const MAX_SCHEDULED = 20;
export const MAX_SCHEDULED_TEXT = 8000;
/** A month is as far ahead as a schedule is still a plan rather than a note to this app. */
export const MAX_SCHEDULED_AHEAD_MS = 30 * 24 * 60 * 60 * 1000;
/** A time in the past is not a schedule; a few seconds of clock skew are forgiven. */
const PAST_SLACK_MS = 60_000;
/** setTimeout stops at 2^31-1 ms; a later wait is armed again when this one ends. */
const MAX_TIMEOUT_MS = 2_147_483_647;
/** A moment that cannot be used yet (the agent's input box holds a draft) is tried again this often. */
export const HOLD_RETRY_MS = 60_000;
/** How long a held message keeps waiting before its row says why it never went out. */
export const HOLD_LIMIT_MS = 10 * 60_000;

export interface ScheduledPrompt {
  id: string;
  pane_id: string;
  text: string;
  send_at: number;
  created_at: number;
  /** set when its moment came and the text could not be typed: the row stays, so the user sees it */
  failure: string | null;
  /**
   * Its moment came while the agent's own input box held a draft: nothing was typed, the row
   * keeps waiting and is tried again (`HOLD_RETRY_MS`), and after `HOLD_LIMIT_MS` it becomes a
   * failure instead. A held row's `send_at` is still the moment the user chose.
   */
  held: { reason: string; since: number } | null;
}

interface Stored {
  version: 1;
  prompts: ScheduledPrompt[];
}

export interface ScheduledPrompts {
  /** This pane's rows, and any row still waiting to be dealt with from any pane. */
  list(paneId?: string): ScheduledPrompt[];
  add(input: { paneId: string; text: string; sendAt: number }): ScheduledPrompt | { error: string };
  cancel(id: string): boolean;
  /** Sends what is due. Called by the timer, and by tests with a clock of their own. */
  fire(now?: number): Promise<void>;
  close(): void;
}

const id = (): string => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** What a failed send says: herdr's own words, trimmed, never a stack. */
function reasonOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

export function createScheduledPrompts(options: {
  stateDir: string;
  send: (paneId: string, text: string) => Promise<void>;
  /** Why this pane cannot take a message right now (its input box holds a draft, it waits on a
   *  prompt); null when it can. Unset, every moment is used as it comes. */
  hold?: (paneId: string) => Promise<string | null>;
  now?: () => number;
}): ScheduledPrompts {
  const path = join(options.stateDir, "scheduled-prompts.json");
  const now = options.now ?? Date.now;
  let prompts: ScheduledPrompt[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  if (existsSync(path)) {
    try {
      const stored = JSON.parse(readFileSync(path, "utf8")) as Partial<Stored>;
      // a hand-edited or half-written file must not stop the server: only rows it can use survive
      prompts = (Array.isArray(stored.prompts) ? stored.prompts : []).filter((row): row is ScheduledPrompt =>
        typeof row?.id === "string" && typeof row.pane_id === "string" && typeof row.text === "string"
        && Number.isFinite(row.send_at) && row.send_at > 0)
        .map((row) => ({ ...row, held: row.held ?? null }));
    } catch { /* a lost file costs the schedules it held, not the app */ }
  }

  const save = (): void => {
    try {
      writeFileSync(path, `${JSON.stringify({ version: 1, prompts } satisfies Stored, null, 2)}\n`, { mode: 0o600 });
    } catch { /* a schedule that cannot be saved still fires from memory; the next change tries again */ }
  };

  const arm = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (closed) return;
    const waiting = prompts.filter((prompt) => prompt.failure === null);
    if (waiting.length === 0) return;
    // a held row's moment has passed: its next look is one retry away, not now
    const earliest = Math.min(...waiting.map((prompt) => prompt.held === null ? prompt.send_at : now() + HOLD_RETRY_MS));
    timer = setTimeout(() => {
      timer = null;
      void fire().finally(arm);
    }, Math.min(Math.max(earliest - now(), 0), MAX_TIMEOUT_MS));
  };

  const fire = async (at: number = now()): Promise<void> => {
    const due = prompts.filter((prompt) => prompt.failure === null && prompt.send_at <= at);
    if (due.length === 0) return;
    let changed = false;
    for (const prompt of due) {
      if (closed) break;
      // nothing is typed into a box that already holds the user's words: the row waits, and says so
      if (options.hold) {
        let reason: string | null = null;
        try {
          reason = await options.hold(prompt.pane_id);
        } catch { /* a read that failed is no reason to hold: the send below says what happened */ }
        if (reason !== null) {
          const since = prompt.held?.since ?? at;
          prompts = prompts.map((candidate) => candidate.id === prompt.id ? {
            ...candidate,
            held: at - since >= HOLD_LIMIT_MS ? null : { reason, since },
            failure: at - since >= HOLD_LIMIT_MS ? `${Math.round(HOLD_LIMIT_MS / 60_000)} minutes late: ${reason}` : candidate.failure,
          } : candidate);
          changed = true;
          continue;
        }
      }
      try {
        await options.send(prompt.pane_id, prompt.text);
        prompts = prompts.filter((candidate) => candidate.id !== prompt.id);
      } catch (error) {
        // the row stays, marked: the text is the user's, and a silent loss is worse than a late one
        prompts = prompts.map((candidate) => candidate.id === prompt.id ? { ...candidate, failure: reasonOf(error) } : candidate);
      }
      changed = true;
    }
    if (changed) save();
  };

  const store: ScheduledPrompts = {
    list(paneId) {
      const rows = paneId === undefined ? prompts : prompts.filter((prompt) => prompt.pane_id === paneId || prompt.failure !== null);
      return [...rows].sort((left, right) => left.send_at - right.send_at);
    },
    add({ paneId, text, sendAt }) {
      const trimmed = text.trim();
      if (trimmed.length === 0) return { error: "empty_text" };
      if (trimmed.length > MAX_SCHEDULED_TEXT) return { error: "text_too_long" };
      const at = now();
      if (!Number.isFinite(sendAt) || sendAt < at - PAST_SLACK_MS) return { error: "send_at_in_past" };
      if (sendAt > at + MAX_SCHEDULED_AHEAD_MS) return { error: "send_at_too_far" };
      if (prompts.filter((prompt) => prompt.pane_id === paneId).length >= MAX_SCHEDULED) return { error: "too_many" };
      const prompt: ScheduledPrompt = { id: id(), pane_id: paneId, text, send_at: sendAt, created_at: at, failure: null, held: null };
      prompts = [...prompts, prompt];
      save();
      arm();
      return prompt;
    },
    cancel(promptId) {
      const before = prompts.length;
      prompts = prompts.filter((prompt) => prompt.id !== promptId);
      if (prompts.length === before) return false;
      save();
      arm();
      return true;
    },
    fire,
    close() {
      closed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };

  arm();
  return store;
}
