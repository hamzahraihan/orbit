import { useCallback, useEffect, useRef, useState } from "react";

import "./TerminalQuickReplies.css";

import { useT } from "../lib/i18n.ts";
import { QUICK_REPLY_ARM_MS, quickReplyButtons, useSettings, type QuickReply } from "../lib/settings.ts";
import { readTerminalDraft, writeTerminalDraft } from "../lib/terminalDraft.ts";

export interface TerminalQuickRepliesProps {
  /** the pane's terminal input line record the insert mode writes to (terminalDraft.ts) */
  owner: string;
  connected: boolean;
  /** the words and Enter into the pane, as the input line's Send does */
  onSend: (text: string) => false | Promise<true | string>;
  /** the reply was put in the input line: a pane that types straight into the grid opens it */
  onRevealInput: () => void;
}

/**
 * Settings → Quick replies above the terminal, the same list the composer draws. Sending is the
 * input line's Send (text, then Enter after the server's gap); the insert mode leaves the words in
 * the input line instead, and says so, so a reply that composes a command can be edited first.
 */
export function TerminalQuickReplies({ owner, connected, onSend, onRevealInput }: TerminalQuickRepliesProps) {
  const t = useT();
  const { settings } = useSettings();
  const replies = quickReplyButtons(settings);
  const [armed, setArmed] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<{ id: number; text: string } | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const announce = useCallback((text: string) => setAnnouncement((previous) => ({ id: (previous?.id ?? 0) + 1, text })), []);

  // an arm that is not taken lapses, so a later tap is never the one that acts by accident
  useEffect(() => {
    if (armed === null) return;
    const timer = window.setTimeout(() => setArmed(null), QUICK_REPLY_ARM_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);

  const send = useCallback((reply: string) => {
    setNote(null);
    const sent = onSend(reply);
    if (sent === false) { setNote(t("Not sent: the terminal is disconnected.")); return; }
    setSending(true);
    void sent
      .then((result) => { if (mounted.current && result !== true) setNote(result); })
      .catch(() => { if (mounted.current) setNote(t("Not confirmed. Check the terminal before sending again.")); })
      .finally(() => { if (mounted.current) setSending(false); });
  }, [onSend, t]);

  /** The insert mode's tap: the words go where the keyboard would type, and stay editable. */
  const insert = useCallback((reply: string) => {
    setArmed(null);
    setNote(null);
    writeTerminalDraft(owner, readTerminalDraft(owner) + reply);
    onRevealInput();
  }, [onRevealInput, owner]);

  /** One tap acts, unless the reply carries a confirm step: then the first tap arms it and says so. */
  const useReply = useCallback((reply: QuickReply, index: number) => {
    if (settings.quickReplyMode === "insert") { insert(reply.text); return; }
    if (reply.confirm && armed !== index) {
      setArmed(index);
      announce(t("Tap again to send “{reply}”", { reply: reply.text }));
      return;
    }
    setArmed(null);
    send(reply.text);
  }, [announce, armed, insert, send, settings.quickReplyMode, t]);

  if (!settings.showQuickReplies || replies.length === 0) return null;
  return (
    <div className="terminal-quick">
      <div className="terminal-quick-row" role="group" aria-label={t("Quick replies")}>
        {replies.map((reply, index) => {
          const isArmed = armed === index;
          const label = settings.quickReplyMode === "insert"
            ? t("Put “{reply}” in the input line", { reply: reply.text })
            : isArmed ? t("Tap again to send “{reply}”", { reply: reply.text }) : t("Send “{reply}”", { reply: reply.text });
          return (
            <button
              key={index}
              type="button"
              className={`terminal-quick-reply${isArmed ? " is-armed" : ""}`}
              title={label}
              aria-label={label}
              disabled={!connected || sending}
              onClick={() => useReply(reply, index)}
            >
              {reply.text}
            </button>
          );
        })}
      </div>
      {note !== null && <p className="terminal-quick-note" role="alert">{note}</p>}
      <p className="visually-hidden" aria-live="polite">{announcement && <span key={announcement.id}>{announcement.text}</span>}</p>
    </div>
  );
}
