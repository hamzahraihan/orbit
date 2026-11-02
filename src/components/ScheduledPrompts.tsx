import { useCallback, useEffect, useState } from "react";
import { Clock, X } from "lucide-react";
import { cancelScheduled, failureNote, loadScheduled, scheduledWhen, type ScheduledPrompt } from "../lib/scheduled.ts";
import { useT, useLocale } from "../lib/i18n.ts";
import "./ScheduledPrompts.css";

/** How often a row is re-read while the page is visible: a send at its moment leaves this list too. */
const REFRESH_MS = 60_000;

interface Props {
  machineId: string;
  paneId: string;
  /** bumped by the composer after it lines one up, so the new chip shows at once */
  refreshKey: number;
  connected: boolean;
  /** told once when this pane's PC keeps no schedules, so the composer stops offering one */
  onUnsupported: () => void;
}

/**
 * The messages this pane has lined up, one chip each: its time, the first words, and the X that
 * takes it back. They are the server's rows, not this tab's, so a chip shows the same on every
 * device and outlives a reload. A row whose moment came and failed says why and stays until the
 * user clears it: text they wrote is never dropped silently.
 */
export function ScheduledPrompts({ machineId, paneId, refreshKey, connected, onUnsupported }: Props) {
  const t = useT();
  const locale = useLocale();
  const [prompts, setPrompts] = useState<ScheduledPrompt[]>([]);
  const [cancelling, setCancelling] = useState<string | null>(null);
  // a PC that keeps none is asked once: there is nothing to read there, and no clock to offer
  const [supported, setSupported] = useState(true);

  const load = useCallback((alive: () => boolean) => {
    void loadScheduled(machineId, paneId).then((read) => {
      if (!alive()) return;
      if (read.kind === "unsupported") { setPrompts([]); setSupported(false); onUnsupported(); return; }
      // a failure is not an answer: the next tick asks again
      if (read.kind === "rows") setPrompts(read.prompts);
    });
  }, [machineId, paneId, onUnsupported]);

  useEffect(() => {
    if (!supported) return;
    let live = true;
    const alive = () => live;
    load(alive);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load(alive);
    }, REFRESH_MS);
    return () => { live = false; clearInterval(timer); };
  }, [load, refreshKey, supported]);

  if (prompts.length === 0) return null;

  const cancel = async (id: string): Promise<void> => {
    setCancelling(id);
    try {
      await cancelScheduled(machineId, id);
      setPrompts((rows) => rows.filter((row) => row.id !== id));
    } catch { /* the row stays as it is: nothing was cancelled, and the next tick reads it again */ }
    finally { setCancelling(null); }
  };

  return <ol className="scheduled-prompts" aria-label={t("Scheduled messages")}>
    {prompts.map((prompt) => {
      const failure = failureNote(prompt, t);
      const when = scheduledWhen(prompt.send_at, locale);
      // a row whose moment came into an occupied input box keeps its time and says what it waits
      // on in place of the words: the message itself is a hover away, in its title
      const held = prompt.held === null ? null : prompt.held.reason;
      return <li key={prompt.id} className={`scheduled-prompt${failure === null ? "" : " is-failed"}${held === null ? "" : " is-held"}`}>
        <Clock className="scheduled-prompt-mark" aria-hidden="true" />
        <span className="scheduled-prompt-when" title={when.full}>{failure ?? when.label}</span>
        <span className="scheduled-prompt-text" title={prompt.text}>{held ?? prompt.text}</span>
        <button type="button" className="scheduled-prompt-cancel" disabled={!connected || cancelling === prompt.id}
          aria-label={`${t("Cancel scheduled message")}: ${prompt.text}`} title={t("Cancel scheduled message")}
          onClick={() => { void cancel(prompt.id); }}>
          <X aria-hidden="true" />
        </button>
      </li>;
    })}
  </ol>;
}
