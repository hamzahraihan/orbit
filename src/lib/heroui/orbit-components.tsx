/*
 * Orbit's adapter over HeroUI's component layer.
 *
 * HeroUI owns the component: anatomy, sizing, states, focus and motion. These
 * wrappers only map Orbit's semantic names onto HeroUI's variants and keep the
 * call sites' existing DOM props working. No visual styling lives here — the
 * palette comes from lib/heroui-theme.css and the interface scale from
 * tailwind-orbit.css.
 */

import { Button as HeroUIButton, Input as HeroUIInput, type ButtonProps as HeroUIButtonProps } from "@heroui/react";
import * as React from "react";

/* ---------- button ---------- */

/** Orbit's semantic action names. Each is one of HeroUI's own variants. */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline" | "tertiary";

/** `icon` is Orbit's name for a square icon-only action. */
export type ButtonSize = "sm" | "md" | "lg" | "icon";

export type ButtonProps = Omit<HeroUIButtonProps, "variant" | "size"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Call sites still say disabled; React Aria calls it isDisabled. */
  disabled?: boolean;
  /** HeroUI's public Button type omits the plain DOM tooltip attribute. */
  title?: string;
};

const VARIANT: Record<ButtonVariant, "primary" | "secondary" | "ghost" | "danger" | "outline" | "tertiary"> = {
  primary: "primary",
  secondary: "secondary",
  ghost: "ghost",
  danger: "danger",
  outline: "outline",
  tertiary: "tertiary",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "ghost", size = "md", disabled, type = "button", ...props },
  ref,
) {
  return (
    <HeroUIButton
      ref={ref}
      type={type}
      variant={VARIANT[variant]}
      size={size === "icon" ? "md" : size}
      isIconOnly={size === "icon"}
      isDisabled={disabled}
      className={className}
      {...props}
    />
  );
});
Button.displayName = "Button";

/* ---------- input ---------- */

export type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> & {
  fullWidth?: boolean;
};

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, fullWidth = true, ...props },
  ref,
) {
  return <HeroUIInput ref={ref} fullWidth={fullWidth} className={className} {...props} />;
});
Input.displayName = "Input";
