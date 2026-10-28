/** Tailwind v4 config: exposes Orbit's CSS token names as theme keys so HeroUI
 *  components can read Orbit colors/radii/spacing directly, while keeping
 *  src/styles.css as the single source of truth for color values. */
import type { Config } from "tailwindcss";

const config: Config = {
  theme: {
    extend: {
      colors: {
        orbit: {
          bg: "var(--bg)",
          panel: "var(--bg-panel)",
          elevated: "var(--bg-elevated)",
          hover: "var(--bg-hover)",
          input: "var(--bg-input)",
          border: "var(--border)",
          "border-strong": "var(--border-strong)",
          text: "var(--text)",
          "text-dim": "var(--text-dim)",
          "text-strong": "var(--text-strong)",
          accent: "var(--accent)",
          "accent-tint": "var(--accent-tint)",
          primary: "var(--primary)",
          "primary-hover": "var(--primary-hover)",
          "primary-text": "var(--primary-text)",
          "primary-tint": "var(--primary-tint)",
          "status-idle": "var(--status-idle)",
          "status-working": "var(--status-working)",
          "status-blocked": "var(--status-blocked)",
          "status-done": "var(--status-done)",
          "status-working-tint": "var(--status-working-tint)",
          "status-blocked-tint": "var(--status-blocked-tint)",
          "status-done-tint": "var(--status-done-tint)",
          danger: {
            tint: "var(--danger-tint)",
            text: "var(--danger-text)",
          },
          notice: "var(--notice)",
          indicator: {
            working: "var(--indicator-working)",
            blocked: "var(--indicator-blocked)",
            done: "var(--indicator-done)",
            idle: "var(--indicator-idle)",
            unknown: "var(--indicator-unknown)",
          },
        },
      },
      borderRadius: {
        orbit: {
          sm: "var(--radius-sm)",
          md: "var(--radius-md)",
          lg: "var(--radius-lg)",
          xl: "var(--radius-xl)",
          "2xl": "var(--radius-2xl)",
          pill: "var(--radius-pill)",
        },
      },
      spacing: {
        "1": "var(--space-1)",
        "2": "var(--space-2)",
        "3": "var(--space-3)",
        "4": "var(--space-4)",
        "5": "var(--space-5)",
        "6": "var(--space-6)",
        "8": "var(--space-8)",
      },
      fontSize: {
        "orbit-2xs": "var(--fs-2xs)",
        "orbit-xs": "var(--fs-xs)",
        "orbit-sm": "var(--fs-sm)",
        "orbit-md": "var(--fs-md)",
        "orbit-chat": "var(--fs-chat)",
        "orbit-lg": "var(--fs-lg)",
        "orbit-xl": "var(--fs-xl)",
        "orbit-display": "var(--fs-display)",
      },
      lineHeight: {
        orbit: {
          tight: "var(--lh-tight)",
          base: "var(--lh-base)",
          code: "var(--lh-code)",
          prose: "var(--lh-prose)",
        },
      },
    },
  },
};

export default config;
