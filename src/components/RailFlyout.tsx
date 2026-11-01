import { createPortal } from "react-dom";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import "./RailFlyout.css";

interface RailFlyoutProps {
  anchor: HTMLElement | null;
  open: boolean;
  /** which side of the anchor it stands on; the sidebar's rows stand at the window's left */
  side?: "left" | "right";
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
 * An instant, theme-aware floating flyout for minimized rail items.
 * Renders on hover and keyboard focus without OS tooltip delay.
 */
export function RailFlyout({
  anchor,
  open,
  side = "right",
  title,
  subtitle,
  detail,
  statusBadge,
  children,
  onClose,
}: RailFlyoutProps) {
  const [coords, setCoords] = useState<{ top: number; left: number; maxWidth?: number } | null>(null);
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
    // a row at the window's edge has no room outside it: its card stands over the list's left,
    // never wider than the row, so it stays inside the column it describes
    const left = side === "left" ? Math.max(EDGE_GAP, rect.left) : rect.right + EDGE_GAP;
    const maxWidth = side === "left" ? Math.max(0, rect.right - left) : undefined;
    // Align vertically with the anchor row, clamped to viewport bounds
    const top = Math.max(EDGE_GAP, Math.min(rect.top, window.innerHeight - 80));
    setCoords((current) => current !== null && current.top === top && current.left === left && current.maxWidth === maxWidth ? current : { top, left, maxWidth });
  }, [open, anchor, side, onClose]);

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
      style={{ top: `${coords.top}px`, left: `${coords.left}px`, ...(coords.maxWidth ? { maxWidth: `${coords.maxWidth}px` } : {}) }}
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
