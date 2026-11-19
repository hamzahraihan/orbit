"use client";

import type * as React from "react";

import { Button as BaseButton } from "@ui-sdk/react/button";
import { Check, Minus, Plus } from "lucide-react";
import { Input as BaseInput } from "@ui-sdk/react/input";
import { Textarea as BaseTextarea } from "@ui-sdk/react/textarea";
import { Switch as BaseSwitch, SwitchThumb } from "@ui-sdk/react/switch";
import {
  Select as BaseSelect,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectItemIndicator,
  SelectTrigger,
  SelectValue,
} from "@ui-sdk/react/select";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@ui-sdk/react/segmented-control";
import {
  NumberInput,
  NumberInputControl,
  NumberInputDecrement,
  NumberInputGroup,
  NumberInputIncrement,
} from "@ui-sdk/react/number-input";

export { Checkbox, CheckboxIndicator } from "@ui-sdk/react/checkbox";


export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "outline"
  | "tertiary";

export type ButtonSize = "sm" | "md" | "lg" | "icon";

export type ButtonProps = Omit<React.ComponentProps<typeof BaseButton>, "variant" | "size"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({ variant = "ghost", size = "md", className, ...props }: ButtonProps) {
  return (
    <BaseButton
      {...props}
      className={
        typeof className === "function"
          ? (state) => `button orbit-button orbit-button-${variant} orbit-button-${size} ${className(state) ?? ""}`
          : `button orbit-button orbit-button-${variant} orbit-button-${size}${className === undefined ? "" : ` ${className}`}`
      }
    />
  );
}

export type InputProps = React.ComponentProps<typeof BaseInput>;

export function Input({ className, ...props }: InputProps) {
  return <BaseInput {...props} className={className === undefined ? "orbit-input" : `orbit-input ${className}`} />;
}

export type TextareaProps = React.ComponentProps<typeof BaseTextarea>;

export function Textarea({ className, ...props }: TextareaProps) {
  return <BaseTextarea {...props} className={className === undefined ? "orbit-textarea" : `orbit-textarea ${className}`} />;
}

export type SelectOption<T extends string = string> = {
  value: T;
  label: string;
  disabled?: boolean;
};

export type SelectGroupData<T extends string = string> = {
  label: string;
  options: readonly SelectOption<T>[];
};

export type OrbitSelectProps<T extends string = string> = {
  value: T | null;
  onChange: (value: T) => void;
  options?: readonly SelectOption<T>[];
  groups?: readonly SelectGroupData<T>[];
  id?: string;
  label?: string;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
};

// A native select's job, drawn by ui-sdk.
export function Select<T extends string>({
  value,
  onChange,
  options = [],
  groups,
  id,
  label,
  className,
  placeholder,
  disabled,
}: OrbitSelectProps<T>) {
  const allOptions = groups?.flatMap((group) => group.options) ?? options;
  const items = groups
    ? groups.map((group) => ({
        type: "group" as const,
        label: group.label,
        items: group.options.map((option) => ({ value: option.value, label: option.label, disabled: option.disabled })),
      }))
    : allOptions.map((option) => ({ value: option.value, label: option.label, disabled: option.disabled }));
  const rendered = groups
    ? groups.map((group) => (
        <SelectGroup key={group.label} className="orbit-select-group">
          <SelectGroupLabel>{group.label}</SelectGroupLabel>
          {group.options.map((option) => (
            <SelectItem key={option.value} value={option.value} disabled={option.disabled} className="orbit-menu-item">
              {option.label}
              <SelectItemIndicator>
                <Check aria-hidden="true" />
              </SelectItemIndicator>
            </SelectItem>
          ))}
        </SelectGroup>
      ))
    : allOptions.map((option) => (
        <SelectItem key={option.value} value={option.value} disabled={option.disabled} className="orbit-menu-item">
          {option.label}
          <SelectItemIndicator>
            <Check aria-hidden="true" />
          </SelectItemIndicator>
        </SelectItem>
      ));

  return (
    <BaseSelect
      items={items}
      value={value}
      onValueChange={(next) => {
        if (typeof next === "string") onChange(next as T);
      }}
      disabled={disabled}
      placeholder={placeholder}
    >
      <SelectTrigger id={id} className={className === undefined ? "orbit-select" : `orbit-select ${className}`} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="orbit-select-popup">{rendered}</SelectContent>
    </BaseSelect>
  );
}

export type OrbitSwitchProps = {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
};

// An on/off setting; the native checkbox stays in the form.
export function Switch({ checked, label, onChange, disabled, className }: OrbitSwitchProps) {
  return (
    <BaseSwitch
      checked={checked}
      onCheckedChange={(next) => onChange(next === true)}
      disabled={disabled}
      aria-label={label}
      className={className === undefined ? "orbit-switch" : `orbit-switch ${className}`}
    >
      <SwitchThumb />
    </BaseSwitch>
  );
}

export type SegmentedOption<T extends string = string> = { value: T; label: string };

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
}) {
  if (options.length > 4) console.warn(`Segmented "${label}" has ${options.length} options; five or more go in a select instead.`);
  return (
    <SegmentedControl
      aria-label={label}
      value={value}
      onValueChange={(next) => {
        if (next !== null) onChange(next as T);
      }}
      className="segmented settings-segmented"
    >
      {options.map((option) => (
        <SegmentedControlItem key={option.value} value={option.value} className="segmented-option">
          {option.label}
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  );
}

export function Stepper({
  label,
  value,
  text,
  min,
  max,
  decreaseLabel,
  increaseLabel,
  onChange,
}: {
  label: string;
  value: number;
  text: string;
  min: number;
  max: number;
  decreaseLabel: string;
  increaseLabel: string;
  onChange: (value: number) => void;
}) {
  return (
    <NumberInput
      value={value}
      min={min}
      max={max}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
      aria-label={label}
      className="settings-stepper"
    >
      <NumberInputGroup>
        <NumberInputDecrement aria-label={decreaseLabel} disabled={value <= min}>
          <Minus />
        </NumberInputDecrement>
        <NumberInputControl aria-label={text} render={(props) => <input {...props} readOnly />} />
        <NumberInputIncrement aria-label={increaseLabel} disabled={value >= max}>
          <Plus />
        </NumberInputIncrement>
      </NumberInputGroup>
    </NumberInput>
  );
}
