import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

/**
 * First primitive of the shared design system (packages/ui). Phase 5 grows
 * this into the full shadcn/Radix + Tailwind kit (input, select, dialog,
 * tabs, table, form, data table) that both the storefront and admin route
 * groups consume — replacing the legacy plugin's parallel
 * t-book-admin-ui.tsx styling constants.
 */
export function Button({ variant = "primary", className, ...rest }: ButtonProps) {
  const variantClass =
    variant === "primary" ? "tbook-btn-primary" : variant === "secondary" ? "tbook-btn-secondary" : "tbook-btn-ghost";
  const classes = ["tbook-btn", variantClass, className].filter(Boolean).join(" ");
  return <button className={classes} {...rest} />;
}
