import { useId } from "react";
import type { KnownStatus } from "../lib/status.ts";

const OTHER_CONTROL = /\p{C}/gu;

/** The color each agent status reads as on the rail monogram: idle quiet, working alive,
 * blocked asking, done finished, waiting background, unknown soft grey. */
const STATUS_COLOR: Readonly<Record<KnownStatus, string>> = {
  idle: "var(--indicator-idle)",
  working: "var(--indicator-working)",
  blocked: "var(--indicator-blocked)",
  done: "var(--indicator-done)",
  waiting: "var(--indicator-working)",
  unknown: "var(--indicator-unknown)",
};

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
  /** agent status this row rolls up to, so the monogram is the state mark too */
  status?: KnownStatus;
}

/**
 * The rail's primary workspace mark: a 2-letter monogram tile, colored by status so a running,
 * blocked or finished agent reads at a glance without hovering.
 */
export function WorkspaceMonogram({ label, size = 20, status }: WorkspaceMonogramProps) {
  const letters = workspaceMonogram(label);
  const clipId = useId().replace(/[^\w-]/g, "");
  const color = status ? STATUS_COLOR[status] : "var(--text-strong)";

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={`workspace-monogram${status ? ` workspace-monogram--${status}` : ""}`}
      role="img"
      aria-label={label}
      aria-busy={status === "working" || status === "waiting"}
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
        stroke={color}
        strokeWidth="1.5"
      />
      <text
        x="12"
        y="15.5"
        textAnchor="middle"
        fontFamily="var(--font-mono, monospace)"
        fontSize="10"
        fontWeight="600"
        letterSpacing="-0.02em"
        fill={color}
        clipPath={`url(#${clipId})`}
      >
        {letters}
      </text>
    </svg>
  );
}
