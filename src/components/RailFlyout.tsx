import { createPortal } from "react-dom";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import "./RailFlyout.css";

interface RailFlyoutProps {
  anchor: HTMLElement | null;
  open: boolean;
  /** stable id so the anchoring row can point at the open card with aria-describedby */
  id?: string;
  title: string;
  subtitle?: string | null;
  detail?: string | null;
  statusBadge?: ReactNode;
  children?: ReactNode;
  onClose?: () => void;
}

const EDGE_GAP = 8;

/** the scrolling column that holds the row, whose box is the room the card follows it in */
function scrollBox(anchor: HTMLElement): DOMRect | null {
  for (let node = anchor.parentElement; node !== null; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    // a wrapper can say auto without a height to scroll in: only a clipped column is a scroll box
    if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight + 1) return node.getBoundingClientRect();
  }
  return null;
}

/**
 * An instant, theme-aware floating flyout for sidebar rows.
 * Renders on hover (after a short dwell) and keyboard focus without OS tooltip delay.
 */
export function RailFlyout({
  anchor,
  open,
  id,
  title,
  subtitle,
  detail,
  statusBadge,
  children,
  onClose,
}: RailFlyoutProps) {
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);

  /** places the card beside the anchor's current box, or hides it while the row is out of its list */
  const place = useCallback((): void => {
    if (!open) return;
    if (anchor === null || !anchor.isConnected) {
      setCoords(null);
      onClose?.();
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const clip = scrollBox(anchor);
    // the row has left the list (or the window): there is nothing for the card to stand beside
    if (rect.bottom <= 0 || rect.top >= window.innerHeight || (clip !== null && (rect.bottom <= clip.top || rect.top >= clip.bottom))) {
      setCoords(null);
      return;
    }
    // the card stands at the anchor's right edge, level with the row
    const left = rect.right + EDGE_GAP;
    // Align vertically with the anchor row, clamped to viewport bounds
    const top = Math.max(EDGE_GAP, Math.min(rect.top, window.innerHeight - 80));
    setCoords((current) => current !== null && current.top === top && current.left === left ? current : { top, left });
  }, [open, anchor, onClose]);

  useLayoutEffect(() => { place(); }, [place]);

  useEffect(() => {
    if (!open || anchor === null) return;
    // A scroll elsewhere (a streaming chat under its own pane) leaves the row where it is, so the
    // card stays put. A scroll of the column that holds the row moves it, so the card follows it.
    let frame = 0;
    const handleScroll = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof Node && target.contains(anchor)) || frame !== 0) return;
      frame = requestAnimationFrame(() => { frame = 0; place(); });
    };
    window.addEventListener("scroll", handleScroll, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", handleScroll, { capture: true });
    };
  }, [open, anchor, place]);

  if (!open || !coords) return null;

  return createPortal(
    <div
      ref={flyoutRef}
      className="rail-flyout"
      id={id}
      style={{ top: `${coords.top}px`, left: `${coords.left}px` }}
      role="tooltip"
      aria-hidden="false"
      onPointerEnter={(e) => e.stopPropagation()}
    >
      <div className="rail-flyout-header">
        <span className="rail-flyout-title">{title}</span>
        {statusBadge && <span className="rail-flyout-status">{statusBadge}</span>}
      </div>
      {subtitle && <div className="rail-flyout-subtitle">{subtitle}</div>}
      {detail && <div className="rail-flyout-detail">{detail}</div>}
      {children && <div className="rail-flyout-content">{children}</div>}
    </div>,
    document.body
  );
}

/** Milliseconds a pointer must rest on a row before its card opens; keyboard focus opens at once. */
export const FLYOUT_DWELL_MS = 180;

/**
 * Pointer-entered flyouts open only after a short dwell, so sweeping down a list does not strobe
 * cards. Keyboard focus sites open directly instead. The timer clears on unmount and on
 * re-schedule; call `cancel` on pointer leave.
 */
export function useFlyoutDwell(): { schedule: (open: () => void) => void; cancel: () => void } {
  const timer = useRef<number | null>(null);
  const cancel = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);
  useEffect(() => cancel, [cancel]);
  const schedule = useCallback((open: () => void) => {
    cancel();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      open();
    }, FLYOUT_DWELL_MS);
  }, [cancel]);
  return { schedule, cancel };
}
