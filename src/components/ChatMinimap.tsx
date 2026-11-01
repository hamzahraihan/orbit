import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from "react";
import { MessageSquare } from "lucide-react";

import { minimapCurrent, minimapFits, minimapSlots, minimapSlotTarget, minimapStep, minimapTop, minimapTurnSlot, MINIMAP_MIN_TURNS, type MinimapTurn } from "../lib/chatMinimap.ts";
import { useT } from "../lib/i18n.ts";
import "./ChatMinimap.css";

export interface ChatMinimapProps {
  turns: readonly MinimapTurn[];
  /** the timeline's row keys in order, to tell which rows are on screen */
  rowKeys: readonly string[];
  scroller: RefObject<HTMLDivElement | null>;
  onJump: (row: number) => void;
}

const SPACING_PX = 24;
/** the room the rail leaves above and below it, as in its height below */
const MARGIN_REM = 12;
/** what the turn card leaves the rail */
const CARD_GAP_PX = 8;

/**
 * A tick per turn the user sent, beside the chat column; the turn in view is marked. A rail too
 * short for every turn gives a tick to each run of turns, so loading older history adds no buttons.
 */
export function ChatMinimap({ turns, rowKeys, scroller, onJump }: ChatMinimapProps) {
  const t = useT();
  const [current, setCurrent] = useState<number | null>(null);
  const [fits, setFits] = useState(false);
  const [railPx, setRailPx] = useState(0);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  /** the turn whose card is open, placed against the frame body */
  const [card, setCard] = useState<{ slot: number; top: number; left: number } | null>(null);
  const ticks = useRef<(HTMLButtonElement | null)[]>([]);

  /** Opens a tick's card beside it, centered on the tick as the reference's message card is. */
  const openCard = (slot: number, tick: HTMLButtonElement): void => {
    const frame = tick.closest<HTMLElement>(".chat-frame-body");
    if (frame === null) return;
    const box = tick.getBoundingClientRect();
    const frameBox = frame.getBoundingClientRect();
    setCard({ slot, left: box.right - frameBox.left + CARD_GAP_PX, top: box.top - frameBox.top + box.height / 2 });
  };

  useEffect(() => {
    const node = scroller.current;
    if (node === null) return;
    const positions = new Map(rowKeys.map((key, index) => [key, index]));
    const turnRows = turns.map((turn) => turn.row);
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      const view = node.getBoundingClientRect();
      let first = Infinity, last = -1;
      for (const row of node.querySelectorAll<HTMLElement>("[data-chat-row]")) {
        const box = row.getBoundingClientRect();
        const index = positions.get(row.dataset.chatRow ?? "");
        if (index === undefined || box.bottom <= view.top || box.top >= view.bottom) continue;
        first = Math.min(first, index); last = Math.max(last, index);
      }
      const next = last < 0 ? null : minimapCurrent(turnRows, first, last);
      setCurrent((previous) => previous === next ? previous : next);
      const column = node.querySelector<HTMLElement>(".chat-transcript");
      const nextFits = column !== null && minimapFits(view.width, column.getBoundingClientRect().width);
      setFits((previous) => previous === nextFits ? previous : nextFits);
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const nextRail = Math.max(0, Math.min((turns.length - 1) * SPACING_PX, view.height - MARGIN_REM * rem));
      setRailPx((previous) => previous === nextRail ? previous : nextRail);
    };
    const schedule = (): void => { if (frame === 0) frame = requestAnimationFrame(measure); };
    schedule();
    node.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(node);
    return () => {
      cancelAnimationFrame(frame);
      node.removeEventListener("scroll", schedule);
      observer.disconnect();
    };
  }, [scroller, rowKeys, turns]);

  // the rail leaves with its cards: a re-shown rail never opens the card of a turn nobody pointed at
  useEffect(() => {
    if (turns.length < MINIMAP_MIN_TURNS || !fits || railPx <= 0) setCard(null);
  }, [turns.length, fits, railPx]);

  // a rail with no height to stand on draws nothing, rather than a button per turn
  if (turns.length < MINIMAP_MIN_TURNS || !fits || railPx <= 0) return null;
  const count = turns.length;
  const slots = minimapSlots(count, railPx);
  const currentSlot = current === null ? null : minimapTurnSlot(current, slots, count);
  const stop = Math.min(focusIndex ?? currentSlot ?? slots - 1, slots - 1);
  const cardTurnIndex = card !== null && card.slot < slots ? minimapSlotTarget(card.slot, slots, count) : null;
  const cardTurn = cardTurnIndex === null ? null : turns[cardTurnIndex] ?? null;
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    const next = minimapStep(stop, slots, event.key);
    if (next === null) return;
    event.preventDefault();
    setFocusIndex(next);
    ticks.current[next]?.focus();
  };
  return <>
    <nav
      className="chat-minimap"
      aria-label={t("Conversation turns")}
      style={{ height: `min(${(count - 1) * SPACING_PX}px, calc(100% - ${MARGIN_REM}rem))`, "--minimap-step": `${railPx / Math.max(1, slots - 1)}px` } as CSSProperties}
      onKeyDown={onKeyDown}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) { setFocusIndex(null); setCard(null); } }}
      onWheel={(event) => scroller.current?.scrollBy({ top: event.deltaY })}
    >
      {Array.from({ length: slots }, (_, index) => {
        const turnIndex = minimapSlotTarget(index, slots, count);
        const turn = turns[turnIndex]!;
        return <button
          key={turn.row}
          ref={(element) => { ticks.current[index] = element; }}
          type="button"
          className="chat-minimap-tick"
          style={{ top: `${minimapTop(index, slots)}%` }}
          tabIndex={index === stop ? 0 : -1}
          aria-label={t("Go to turn {n}", { n: turnIndex + 1 })}
          aria-description={turn.preview || undefined}
          aria-current={index === currentSlot ? "true" : undefined}
          onPointerEnter={(event) => openCard(index, event.currentTarget)}
          onPointerLeave={() => setCard(null)}
          onFocus={(event) => { setFocusIndex(index); openCard(index, event.currentTarget); }}
          onClick={() => { setCard(null); onJump(turn.row); }}
        />;
      })}
    </nav>
    {card !== null && cardTurn !== null && <div className="chat-minimap-card" aria-hidden="true" style={{ left: card.left, top: card.top }}>
      <div className="chat-minimap-card-head"><MessageSquare aria-hidden="true" /><span>{t("Message {n} of {total}", { n: cardTurnIndex! + 1, total: count })}</span></div>
      {cardTurn.preview.length > 0 && <p className="chat-minimap-card-text">{cardTurn.preview}</p>}
    </div>}
  </>;
}
