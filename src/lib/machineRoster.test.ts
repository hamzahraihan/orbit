import { describe, expect, it } from "bun:test";
import type { Machine } from "../../shared/machines.ts";
import { asStoredSelection, fallbackPane, readStoredSelection, SELECTION_KEY, sameRoster, storeSelection, storedSelection } from "./machineRoster.ts";

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const items = new Map<string, string>();
  return { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => { items.set(key, value); } };
}

function withWindow(session: Pick<Storage, "getItem" | "setItem">, local: Pick<Storage, "getItem" | "setItem">, run: () => void): void {
  const saved = globalThis.window;
  try {
    globalThis.window = { sessionStorage: session, localStorage: local } as unknown as Window & typeof globalThis;
    run();
  } finally {
    globalThis.window = saved;
  }
}

describe("selection storage", () => {
  it("reads a stored object and nothing else", () => {
    const storage = (value: string | null) => ({ getItem: () => value });
    expect(readStoredSelection(storage(JSON.stringify({ machine_id: "office", pane_id: "w1:p1" })))).toEqual({ machine_id: "office", pane_id: "w1:p1" });
    expect(readStoredSelection(storage(null))).toBeNull();
    expect(readStoredSelection(storage("{not json"))).toBeNull();
    expect(readStoredSelection(storage(JSON.stringify("office")))).toBeNull();
    expect(asStoredSelection(3)).toBeNull();
  });

  it("writes the PC and pane to this window and to the last one any window showed", () => {
    const session = memoryStorage();
    const local = memoryStorage();
    withWindow(session, local, () => {
      storeSelection("office", null);
      expect(session.getItem(SELECTION_KEY)).toBe('{"machine_id":"office","pane_id":null}');
      expect(local.getItem(SELECTION_KEY)).toBe('{"machine_id":"office","pane_id":null}');
    });
  });

  it("opens this window's own pane first, else the last one another window showed", () => {
    const session = memoryStorage();
    const local = memoryStorage();
    local.setItem(SELECTION_KEY, JSON.stringify({ machine_id: "office", pane_id: "w1:p1" }));
    withWindow(session, local, () => {
      expect(storedSelection()).toEqual({ machine_id: "office", pane_id: "w1:p1" });
      session.setItem(SELECTION_KEY, JSON.stringify({ machine_id: "local", pane_id: "w2:p2" }));
      expect(storedSelection()).toEqual({ machine_id: "local", pane_id: "w2:p2" });
    });
  });
});

describe("sameRoster", () => {
  const machine = (name: string): Machine => ({ id: "local", name } as Machine);

  it("keeps the stored list while a poll hands over equal contents", () => {
    const current = [machine("Laptop"), { ...machine("Build PC"), id: "remote" }];
    expect(sameRoster(current, current)).toBe(true);
    expect(sameRoster(current, [machine("Laptop"), { ...machine("Build PC"), id: "remote" }])).toBe(true);
    expect(sameRoster(current, [machine("Laptop")])).toBe(false);
    expect(sameRoster(current, [{ ...machine("Laptop"), state: "disconnected" } as Machine, current[1]!])).toBe(false);
    // the order is the sidebar's: a reorder is a change
    expect(sameRoster(current, [...current].reverse())).toBe(false);
  });
});

describe("fallbackPane", () => {
  const panes = [{ pane_id: "w1:p1" }, { pane_id: "w1:p2" }];

  it("opens the pane herdr has in front, else the first, else none", () => {
    expect(fallbackPane({ panes, focused_pane_id: "w1:p2" })).toBe("w1:p2");
    expect(fallbackPane({ panes, focused_pane_id: null })).toBe("w1:p1");
    expect(fallbackPane({ panes })).toBe("w1:p1");
    expect(fallbackPane({ panes: [] })).toBeNull();
  });
});
