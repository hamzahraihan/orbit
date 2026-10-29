import type { ReactNode } from "react";
import { Minus, Plus } from "lucide-react";

import {
  NumberFieldDecrementButton,
  NumberFieldGroup,
  NumberFieldIncrementButton,
  NumberFieldInput,
  NumberFieldRoot,
  SwitchContent,
  SwitchControl,
  SwitchRoot,
  SwitchThumb,
  ToggleButtonGroupRoot,
  ToggleButtonRoot,
} from "@heroui/react";

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

/** An on/off switch, Hero UI's Switch under the hood. */
export function Toggle({ checked, label, onChange, disabled }: { checked: boolean; label: string; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <SwitchRoot isSelected={checked} isDisabled={disabled} onChange={(isSelected) => onChange(isSelected)} aria-label={label}>
      <SwitchContent>
        {/* the thumb rides inside the track: outside it the track cannot place the knob */}
        <SwitchControl>
          <SwitchThumb />
        </SwitchControl>
      </SwitchContent>
    </SwitchRoot>
  );
}

export interface SegmentedOption<T extends string> { value: T; label: string }

/** One of a few short choices, all in sight. Five or more go in a select instead. Hero UI's
 *  ToggleButtonGroup under the hood. */
export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly SegmentedOption<T>[]; onChange: (value: T) => void }) {
  if (options.length > 4) console.warn(`Segmented "${label}" has ${options.length} options; five or more go in a select instead.`);
  const selectedKeys = new Set([value]);
  return (
    <ToggleButtonGroupRoot selectionMode="single" disallowEmptySelection selectedKeys={selectedKeys} onSelectionChange={(keys) => onChange(Array.from(keys)[0] as T)} aria-label={label} className="settings-segmented">
      {options.map((option) => (
        <ToggleButtonRoot key={option.value} id={option.value}>
          {option.label}
        </ToggleButtonRoot>
      ))}
    </ToggleButtonGroupRoot>
  );
}

/** A number moved one step at a time between its limits, shown as `text`. Hero UI's NumberField
 *  under the hood. */
export function Stepper({ label, value, text, min, max, decreaseLabel, increaseLabel, onChange }: { label: string; value: number; text: string; min: number; max: number; decreaseLabel: string; increaseLabel: string; onChange: (value: number) => void }) {
  return (
    <NumberFieldRoot value={value} minValue={min} maxValue={max} onChange={(next) => onChange(next)} aria-label={label} className="settings-stepper">
      <NumberFieldGroup>
        <NumberFieldDecrementButton aria-label={decreaseLabel} isDisabled={value <= min}><Minus aria-hidden="true" /></NumberFieldDecrementButton>
        <NumberFieldInput readOnly />
        <NumberFieldIncrementButton aria-label={increaseLabel} isDisabled={value >= max}><Plus aria-hidden="true" /></NumberFieldIncrementButton>
      </NumberFieldGroup>
    </NumberFieldRoot>
  );
}
