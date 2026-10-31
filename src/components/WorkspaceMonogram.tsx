import { useId } from "react";

const OTHER_CONTROL = /\p{C}/gu;

/**
 * Derives a clean 2-letter monogram for a workspace or repository label.
 * E.g.: "orbit" -> "OR", "herdr-plugins" -> "HP", "auth_service" -> "AS".
 */
export function workspaceMonogram(label: string): string {
  const clean = label.normalize("NFKC").replace(OTHER_CONTROL, "").trim();
  if (!clean) return "WS";

  // Split by hyphens, underscores, dots, or spaces
  const parts = clean.split(/[-_. \t/]+/).filter(Boolean);
  if (parts.length >= 2) {
    const first = [...parts[0]!][0] ?? "";
    const second = [...parts[1]!][0] ?? "";
    const combined = (first + second).toUpperCase();
    if (combined.length === 2) return combined;
  }

  // Fallback: take first two characters of the clean name
  const chars = [...clean];
  if (chars.length >= 2) {
    return (chars[0]! + chars[1]!).toUpperCase();
  }
  return (chars[0] ?? "W").toUpperCase();
}

interface WorkspaceMonogramProps {
  label: string;
  size?: number;
}

/**
 * A crisp, high-density monogram tile for workspaces in the minimized rail.
 * Grounded in Quiet Slate typography: porcelain text on elevated ground with hairline border.
 */
export function WorkspaceMonogram({ label, size = 20 }: WorkspaceMonogramProps) {
  const letters = workspaceMonogram(label);
  const clipId = useId().replace(/[^\w-]/g, "");

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className="workspace-monogram"
      role="img"
      aria-label={label}
    >
      <clipPath id={clipId}>
        <rect x="2" y="2" width="20" height="20" rx="4" />
      </clipPath>
      <rect
        x="2"
        y="2"
        width="20"
        height="20"
        rx="4"
        fill="var(--bg-elevated)"
        stroke="var(--border-strong)"
        strokeWidth="1"
      />
      <text
        x="12"
        y="15.5"
        textAnchor="middle"
        fontFamily="var(--font-mono, monospace)"
        fontSize="10"
        fontWeight="600"
        letterSpacing="-0.02em"
        fill="var(--text-strong)"
        clipPath={`url(#${clipId})`}
      >
        {letters}
      </text>
    </svg>
  );
}
