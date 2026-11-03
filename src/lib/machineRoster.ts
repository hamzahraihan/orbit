import type { Machine } from "../../shared/machines.ts";

export const SELECTION_KEY = "herdr-web-ui:selection";
export type StoredSelection = { machine_id?: string; pane_id?: string | null };

/** A stored JSON value as a selection, or null for anything that is not an object. */
export function asStoredSelection(value: unknown): StoredSelection | null {
  return value !== null && typeof value === "object" ? (value as StoredSelection) : null;
}

/** The selection one storage holds, or null when it holds none or unreadable JSON. */
export function readStoredSelection(storage: Pick<Storage, "getItem">): StoredSelection | null {
  try {
    return asStoredSelection(JSON.parse(storage.getItem(SELECTION_KEY) ?? "null"));
  } catch {
    return null;
  }
}

/**
 * The pane to open: this window's own (sessionStorage is per window and survives
 * its reloads), else the last one any window showed, for a newly opened window.
 */
export function storedSelection(): StoredSelection | null {
  for (const storage of ["sessionStorage", "localStorage"] as const) {
    try {
      const found = readStoredSelection(window[storage]);
      if (found !== null) return found;
    } catch {
      /* private mode */
    }
  }
  return null;
}

export function storeSelection(machineId: string, paneId: string | null): void {
  for (const storage of ["sessionStorage", "localStorage"] as const) {
    try { window[storage].setItem(SELECTION_KEY, JSON.stringify({ machine_id: machineId, pane_id: paneId })); } catch {}
  }
}

/**
 * Polls and the event stream hand over fresh roster objects every few seconds even when
 * nothing changed; storing them re-rendered the whole app (the chat transcript included).
 */
export function sameRoster(a: readonly Machine[], b: readonly Machine[]): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/** The pane to fall back to on a PC: herdr's focused one, else the first, else none. */
export function fallbackPane(snapshot: { panes: readonly { pane_id: string }[]; focused_pane_id?: string | null }): string | null {
  return snapshot.panes.find((pane) => pane.pane_id === snapshot.focused_pane_id)?.pane_id ?? snapshot.panes[0]?.pane_id ?? null;
}
