/*
 * Orbit-styled HeroUI component wrappers.
 *
 * Each wrapper maps HeroUI's variant/props onto Orbit's CSS token names
 * (--color-orbit-*, --radius-orbit-*, --space-orbit-*) declared in
 * src/styles.css's @theme block, so a palette change touches only
 * src/styles.css. Components keep Orbit's appearance: hairline borders,
 * rounded cards, the ONE muted rose for primary actions, and agent-state
 * colors that are never rose.
 */

import { type VariantProps, tv, cn } from "tailwind-variants";
import * as React from "react";


/* ---------- button ---------- */

export const buttonVariants = tv({
  base: "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orbit-accent focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  variants: {
    variant: {
      primary:
        "bg-orbit-accent text-orbit-primary-text hover:bg-orbit-primary-hover",
      secondary:
        "bg-orbit-elevated text-orbit-text hover:bg-orbit-accent-tint",
      ghost:
        "text-orbit-text hover:bg-orbit-accent-tint",
      danger:
        "bg-orbit-status-blocked text-orbit-primary-text hover:bg-orbit-status-blocked",
      outline:
        "border border-orbit-border text-orbit-text hover:bg-orbit-hover",
      tertiary:
        "text-orbit-text-dim hover:text-orbit-text",
    },
    size: {
      sm: "px-2 py-1.5 text-xs",
      md: "px-3 py-2",
      lg: "px-4 py-3 text-base",
      icon: "size-8",
    },
  },
  defaultVariants: {
    variant: "ghost",
    size: "md",
  },
});

export type ButtonProps = VariantProps<typeof buttonVariants> & React.ButtonHTMLAttributes<HTMLButtonElement>;

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps & { className?: string }>(({ className, variant, size, children, ...props }, ref) => {
  return (
    <button type="button" ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props}>
      {children}
    </button>
  );
});
Button.displayName = "Button";

/* ---------- badge ---------- */

export const badgeVariants = tv({
  base: "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium border-orbit-border",
  variants: {
    variant: {
      primary: "bg-orbit-accent-tint text-orbit-accent border-orbit-accent",
      secondary: "bg-orbit-elevated text-orbit-text",
      success: "bg-orbit-status-done-tint text-orbit-status-done border-orbit-status-done",
      working: "bg-orbit-status-working-tint text-orbit-status-working border-orbit-status-working",
      blocked: "bg-orbit-status-blocked-tint text-orbit-status-blocked border-orbit-status-blocked",
      idle: "bg-orbit-bg text-orbit-text-dim",
      outline: "text-orbit-text",
    },
  },
  defaultVariants: {
    variant: "secondary",
  },
});

export type BadgeProps = VariantProps<typeof badgeVariants> & React.HTMLAttributes<HTMLSpanElement>;

export function Badge({ className, variant, ...props }: BadgeProps & { className?: string }) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/* ---------- input ---------- */

export const inputVariants = tv({
  base: "flex h-9 w-full rounded-md border border-orbit-border bg-orbit-input px-3 text-orbit-text text-sm placeholder-orbit-text-dim focus:outline-none focus:ring-2 focus:ring-orbit-accent disabled:cursor-not-allowed disabled:opacity-50",
  variants: {
    size: {
      sm: "h-7 px-2 text-xs",
      md: "h-9 px-3 text-sm",
      lg: "h-10 px-3 text-base",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

export type InputProps = VariantProps<typeof inputVariants> & React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps & { className?: string }>(({ className, size, ...props }, ref) => {
  return <input ref={ref} className={cn(inputVariants({ size }), className)} {...props} />;
});
Input.displayName = "Input";

/* ---------- dialog ---------- */

export const dialogVariants = tv({
  base: "fixed inset-0 z-50 flex items-center justify-center",
  variants: {
    size: {
      sm: "max-w-sm",
      md: "max-w-md",
      lg: "max-w-lg",
      full: "max-w-[90vw] max-h-[90vh]",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

export type DialogProps = VariantProps<typeof dialogVariants> & React.HTMLAttributes<HTMLDivElement>;

export function Dialog({ className, size, children, ...props }: DialogProps & { className?: string }) {
  return (
    <div className={cn(dialogVariants({ size }), className)} {...props}>
      {children}
    </div>
  );
}

export type DialogContentProps = React.HTMLAttributes<HTMLDivElement> & { className?: string };

export function DialogContent({ className, ...props }: DialogContentProps) {
  return (
    <div
      className={cn(
        "relative w-full max-w-lg rounded-xl border border-orbit-border bg-orbit-panel p-6 shadow-lg outline-none ring-1 ring-orbit-border",
        className,
      )}
      {...props}
    />
  );
}

/* ---------- menu item ---------- */

export const menuItemVariants = tv({
  base: "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-orbit-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
  variants: {
    variant: {
      primary: "text-orbit-text",
      danger: "text-orbit-status-blocked",
    },
  },
  defaultVariants: {
    variant: "primary",
  },
});

export type MenuItemProps = VariantProps<typeof menuItemVariants> & React.HTMLAttributes<HTMLDivElement> & {
  onSelect?: () => void;
};

export function MenuItem({ className, variant, onSelect, children, ...props }: MenuItemProps & { className?: string }) {
  return (
    <div
      className={cn(menuItemVariants({ variant }), className)}
      onClick={onSelect}
      {...props}
    >
      {children}
    </div>
  );
}

/* ---------- card ---------- */

export const cardVariants = tv({
  base: "rounded-xl border border-orbit-border bg-orbit-panel text-orbit-text shadow-sm",
  variants: {
    elevated: {
      true: "shadow-card",
    },
  },
  defaultVariants: {
    elevated: false,
  },
});

export type CardProps = VariantProps<typeof cardVariants> & React.HTMLAttributes<HTMLDivElement>;

export function Card({ className, elevated, children, ...props }: CardProps & { className?: string }) {
  return (
    <div className={cn(cardVariants({ elevated }), className)} {...props}>
      {children}
    </div>
  );
}

export type CardHeaderProps = React.HTMLAttributes<HTMLDivElement> & { className?: string };
export function CardHeader({ className, children, ...props }: CardHeaderProps & { className?: string }) {
  return <div className={cn("flex flex-col space-y-1.5 px-6 py-3", className)} {...props}>{children}</div>;
}

export type CardTitleProps = React.HTMLAttributes<HTMLHeadingElement> & { className?: string };
export function CardTitle({ className, children, ...props }: CardTitleProps & { className?: string }) {
  return <h3 className={cn("text-lg font-semibold leading-none tracking-tight", className)} {...props}>{children}</h3>;
}

export type CardDescriptionProps = React.HTMLAttributes<HTMLParagraphElement> & { className?: string };
export function CardDescription({ className, children, ...props }: CardDescriptionProps & { className?: string }) {
  return <p className={cn("text-sm text-orbit-text-dim", className)} {...props}>{children}</p>;
}

export type CardContentProps = React.HTMLAttributes<HTMLDivElement> & { className?: string };
export function CardContent({ className, children, ...props }: CardContentProps & { className?: string }) {
  return <div className={cn("px-6 py-3", className)} {...props}>{children}</div>;
}

export type CardFooterProps = React.HTMLAttributes<HTMLDivElement> & { className?: string };
export function CardFooter({ className, children, ...props }: CardFooterProps & { className?: string }) {
  return <div className={cn("flex items-center px-6 py-3", className)} {...props}>{children}</div>;
}

/* ---------- segmented ---------- */

export type SegmentedItem = { id: string; label?: React.ReactNode; icon?: React.ReactNode; disabled?: boolean };

export interface SegmentedProps {
  items: SegmentedItem[];
  value: string;
  onChange: (id: string) => void;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function Segmented({ items, value, onChange, size = "md", className }: SegmentedProps) {
  const sizeClass = { sm: "text-xs", md: "text-sm", lg: "text-base" }[size];
  return (
    <div
      className={cn("inline-flex items-center justify-center rounded-md border border-orbit-border bg-orbit-input p-0.5", className)}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-pressed={value === item.id}
          onClick={() => onChange(item.id)}
          disabled={item.disabled}
          className={cn(
            "relative flex items-center justify-center rounded-sm px-3 py-1.5 text-sm font-medium transition-colors outline-none",
            sizeClass,
            value === item.id
              ? "bg-orbit-accent text-orbit-primary-text shadow-sm"
              : "text-orbit-text hover:bg-orbit-hover",
            item.disabled ? "pointer-events-none opacity-50" : "",
          )}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );
}
