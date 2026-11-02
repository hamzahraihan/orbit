import type { Translate } from "./i18n.ts";
import { ApiError, machineRequest } from "./api.ts";

/**
 * A message lined up for later on the PC that owns the pane (server/scheduled-prompts.ts). It is
 * kept there, not in this browser, so it fires with the app closed; the chip here only reads it.
 */
export interface ScheduledPrompt {
  id: string;
  pane_id: string;
  text: string;
  /** epoch milliseconds, the moment it is typed into the pane */
  send_at: number;
  created_at: number;
  /** the moment came and the send failed: the row stays, with the reason, until it is dismissed */
  failure: string | null;
  /** the moment came while the agent's input box held a draft: nothing was typed, and the row
   *  keeps trying for a few minutes before it turns into a failure that says why */
  held: { reason: string; since: number } | null;
}

/** How far ahead the server takes a schedule, and how many a pane may hold (its own refusals say the same). */
export const SCHEDULE_PRESETS_MS = [15 * 60_000, 60 * 60_000] as const;

export async function fetchScheduled(machineId: string, paneId: string): Promise<ScheduledPrompt[]> {
  const answered = await machineRequest<{ prompts: ScheduledPrompt[] }>(`/${encodeURIComponent(machineId)}/pane/schedule?pane_id=${encodeURIComponent(paneId)}`);
  return answered.prompts;
}

export async function schedulePrompt(machineId: string, paneId: string, text: string, sendAt: number): Promise<ScheduledPrompt> {
  const answered = await machineRequest<{ prompt: ScheduledPrompt }>(`/${encodeURIComponent(machineId)}/pane/schedule`, "POST", { pane_id: paneId, text, send_at: sendAt });
  return answered.prompt;
}

/**
 * What a read of a pane's rows found. A PC whose bridge predates schedules — a remote bundle
 * older than this app — answers 404, and a PC with nothing to answer for answers nothing: the
 * clock is not offered there, rather than a control whose only outcome is a refusal.
 */
export type ScheduledRead =
  | { kind: "rows"; prompts: ScheduledPrompt[] }
  | { kind: "unsupported" }
  | { kind: "failed" };

export async function loadScheduled(machineId: string, paneId: string,
  read: (machineId: string, paneId: string) => Promise<ScheduledPrompt[]> = fetchScheduled): Promise<ScheduledRead> {
  try {
    return { kind: "rows", prompts: await read(machineId, paneId) };
  } catch (error) {
    // 404 is this PC keeping no schedules: `not_supported` from a server without the store, or
    // `unknown endpoint` from a remote bridge that predates the feature
    if (error instanceof ApiError && error.status === 404) return { kind: "unsupported" };
    return { kind: "failed" };
  }
}

/** What the popover says when lining one up failed; a PC that keeps no schedules is told so. */
export function scheduleRefusal(error: unknown, t: Translate): string {
  if (error instanceof ApiError && error.status === 404) return t("Update this PC to schedule a message.");
  // the server's own words, without the URL and status its message starts with
  return error instanceof ApiError ? error.detail : t("Couldn't schedule that message");
}

export async function cancelScheduled(machineId: string, id: string): Promise<void> {
  await machineRequest<{ ok: true }>(`/${encodeURIComponent(machineId)}/pane/schedule?id=${encodeURIComponent(id)}`, "DELETE");
}

/** The clock a chip shows, and the whole moment for its tooltip: the time alone is what a schedule is. */
export function scheduledWhen(sendAt: number, locale: string): { label: string; full: string } {
  const date = new Date(sendAt);
  return {
    label: date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
    full: date.toLocaleString(locale, { dateStyle: "full", timeStyle: "short" }),
  };
}

/** The moment a preset asks for, from `now`: its delay, or 9:00 tomorrow for `tomorrow`. */
export function presetSendAt(preset: number | "tomorrow", now: number): number {
  if (preset !== "tomorrow") return now + preset;
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  next.setHours(9, 0, 0, 0);
  return next.getTime();
}

/** The moment a time typed into the picker means: today at that time, or tomorrow once today's has passed. */
export function pickedSendAt(clock: string, now: number): number | null {
  const [hours, minutes] = clock.split(":").map((part) => Number.parseInt(part, 10));
  if (hours === undefined || minutes === undefined || !Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  const at = new Date(now);
  at.setHours(hours, minutes, 0, 0);
  if (at.getTime() <= now) at.setDate(at.getDate() + 1);
  return at.getTime();
}

/** What a chip says when its moment came and the text could not be typed. */
export function failureNote(prompt: Pick<ScheduledPrompt, "failure">, t: Translate): string | null {
  return prompt.failure === null ? null : t("Couldn't send: {reason}", { reason: prompt.failure });
}
