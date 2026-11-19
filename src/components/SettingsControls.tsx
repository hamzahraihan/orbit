import type { ReactNode } from "react";

import "./SettingsControls.css";

/**
 * The parts every Settings page is built from: a group is a caption over one card, a card holds
 * rows parted by hairlines, and a row is a label with its one control at the end of the line.
 */
/** `section`: the group's name in a link to it (`?settings=<page>&section=<name>`, lib/deepLink.ts) */
export function SettingsGroup({ title, note, className, section, children }: { title?: string; note?: ReactNode; className?: string; section?: string; children: ReactNode }) {
  return (
    <section className={className ? `settings-section ${className}` : "settings-section"} data-section={section} tabIndex={section ? -1 : undefined}>
      {title !== undefined && <h3>{title}</h3>}
      {note !== undefined && <p className="settings-description settings-note">{note}</p>}
      <div className="settings-card">{children}</div>
    </section>
  );
}

/**
 * One setting. `wide` marks a control that needs the whole line on a phone (three or more
 * segments, a text field): the row stacks there, and stays one line everywhere else.
 */
export function SettingsRow({ label, description, htmlFor, wide = false, children }: { label: string; description?: ReactNode; htmlFor?: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={wide ? "settings-row is-wide" : "settings-row"}>
      <div className="settings-row-text">
        {htmlFor !== undefined ? <label className="settings-label" htmlFor={htmlFor}>{label}</label> : <span className="settings-label">{label}</span>}
        {description !== undefined && <span className="settings-description">{description}</span>}
      </div>
      {children}
    </div>
  );
}

export { Segmented, Stepper, Switch as Toggle } from "../lib/ui.tsx";
export type { SegmentedOption } from "../lib/ui.tsx";
