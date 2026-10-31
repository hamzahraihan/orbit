import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import "./RailFlyout.css";

interface RailFlyoutProps {
  anchor: HTMLElement | null;
  open: boolean;
  title: string;
  subtitle?: string | null;
  detail?: string | null;
  statusBadge?: ReactNode;
  children?: ReactNode;
  onClose?: () => void;
}

const EDGE_GAP = 8;

/**
 * An instant, theme-aware floating flyout for minimized rail items.
 * Renders on hover and keyboard focus without OS tooltip delay.
 */
export function RailFlyout({
  anchor,
  open,
  title,
  subtitle,
  detail,
  statusBadge,
  children,
  onClose,
}: RailFlyoutProps) {
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !anchor || !anchor.isConnected) {
      setCoords(null);
      return;
    }

    const rect = anchor.getBoundingClientRect();
    const left = rect.right + EDGE_GAP;
    // Align vertically with the anchor row, clamped to viewport bounds
    const top = Math.max(EDGE_GAP, Math.min(rect.top, window.innerHeight - 80));
    setCoords({ top, left });
  }, [open, anchor]);

  useEffect(() => {
    if (!open) return;
    const handleScroll = () => {
      if (onClose) onClose();
    };
    window.addEventListener("scroll", handleScroll, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", handleScroll, { capture: true });
  }, [open, onClose]);

  if (!open || !coords) return null;

  return createPortal(
    <div
      ref={flyoutRef}
      className="rail-flyout"
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
