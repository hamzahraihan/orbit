import type { Machine } from "../../shared/machines.ts";

/** Agents waiting on user input (`blocked`) across every connected machine snapshot. */
export function waitingCount(machines: readonly Machine[]): number {
  return machines.reduce((sum, machine) => sum + (machine.snapshot?.panes.filter((pane) => pane.agent_status === "blocked").length ?? 0), 0);
}

/** Adds the waiting count to the document title so background tabs still surface pending input. */
export function attentionTitle(baseTitle: string, waiting: number): string {
  return waiting > 0 ? `(${waiting}) ${baseTitle}` : baseTitle;
}

/**
 * Sets the installed app badge to the waiting count when the browser supports the Badging API.
 * Unsupported browsers keep the app working without throwing.
 */
export function setWaitingBadge(waiting: number): void {
  if (typeof navigator === "undefined") return;
  const badging = navigator as Navigator & {
    setAppBadge?: (count?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  if (waiting > 0) {
    void badging.setAppBadge?.(waiting).catch(() => {});
    return;
  }
  void badging.clearAppBadge?.().catch(() => {});
}
