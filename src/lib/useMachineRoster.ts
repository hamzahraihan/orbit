import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { Machine } from "../../shared/machines.ts";
import { sameRoster, storedSelection, storeSelection } from "./machineRoster.ts";
import { markSelection, type SelectionMark } from "./selectionMark.ts";

/** The place a page opens on: a link's PC and pane, when it names them. */
export interface RosterSelection {
  machineId: string;
  paneId: string | null;
}

/**
 * The roster of PCs and the pane open on one of them. The sidebar, the header, the address
 * and the pane region all read the same two values, so they have one owner: this hook.
 * `initial` is what a link named; without one the browser's remembered selection opens.
 *
 * The selection's marks (lib/selectionMark.ts) are kept here with it: a call that answers
 * after the user opened another pane or PC may act on the app only while the mark stands,
 * and the roster count when the pick was made decides whether a removed PC still holds it
 * (lib/notificationTarget.ts machineGone).
 */
export function useMachineRoster(initial: RosterSelection | null) {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [rosterLoaded, setRosterLoaded] = useState(false);
  const machinesRef = useRef(machines); machinesRef.current = machines;
  const rosterSeq = useRef(0);
  /** A roster in: counted for what waits on one (a link, a split half), and stored when it differs. */
  const applyRoster = useCallback((next: Machine[]): number => {
    setMachines((previous) => (sameRoster(previous, next) ? previous : next));
    rosterSeq.current += 1;
    setRosterLoaded(true);
    return rosterSeq.current;
  }, []);

  const [machineId, setMachineId] = useState(() => initial?.machineId ?? storedSelection()?.machine_id ?? "local");
  const [paneId, setPaneId] = useState<string | null>(() => (initial !== null ? initial.paneId : storedSelection()?.pane_id ?? null));
  // App picked the selected pane itself because the one selected closed: it must not raise a
  // phone's keyboard (over the drawer the close was tapped in) until the user picks a pane or lens
  const [autoSelected, setAutoSelected] = useState(false);
  const machineIdRef = useRef(machineId); machineIdRef.current = machineId;
  const machine = machines.find((candidate) => candidate.id === machineId);
  const snapshot = machine?.snapshot ?? null;
  const pane = snapshot?.panes.find((candidate) => candidate.pane_id === paneId) ?? null;

  // marked at commit, not in render: a render React throws away (Strict Mode, a replay) must
  // not move the generation on, and every reader runs from an event or a reply, after the commit
  const selectionRef = useRef<SelectionMark>({ machineId, paneId, generation: 0 });
  useLayoutEffect(() => {
    selectionRef.current = markSelection(selectionRef.current, machineId, paneId);
  }, [machineId, paneId]);
  const selectionSince = useRef(0);

  /** A pick of a PC and pane by the user: the selection that answers to their name is checked from this roster. */
  const select = useCallback((nextMachineId: string, nextPaneId: string | null) => {
    setMachineId(nextMachineId); setPaneId(nextPaneId); setAutoSelected(false);
    storeSelection(nextMachineId, nextPaneId);
    selectionSince.current = rosterSeq.current;
  }, []);

  // this browser's choice only: herdr's focus, its TUI and every other device stay where they are
  useEffect(() => { storeSelection(machineId, paneId); }, [machineId, paneId]);

  return {
    machines, setMachines, machinesRef, rosterLoaded, rosterSeq, applyRoster,
    machineId, paneId, machine, snapshot, pane,
    setMachineId, setPaneId, autoSelected, setAutoSelected, select,
    machineIdRef, selectionRef, selectionSince,
  };
}
