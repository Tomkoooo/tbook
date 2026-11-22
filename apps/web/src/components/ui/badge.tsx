import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary:
          "bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive:
          "bg-destructive text-white focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40 [a&]:hover:bg-destructive/90",
        outline:
          "border-border text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        ghost: "[a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        link: "text-primary underline-offset-4 [a&]:hover:underline",
        // Semantic status tones (see lib/status-tones.ts) — tinted, not solid,
        // so a table full of statuses stays calm.
        neutral: "border-neutral-border bg-neutral-soft text-neutral-soft-foreground",
        info: "border-info-border bg-info-soft text-info-soft-foreground",
        success: "border-success-border bg-success-soft text-success-soft-foreground",
        warning: "border-warning-border bg-warning-soft text-warning-soft-foreground",
        danger: "border-danger-border bg-danger-soft text-danger-soft-foreground",
        note: "border-note-border bg-note-soft text-note-soft-foreground",
        // Solid fills: counters and "live" markers, used sparingly.
        "solid-success": "bg-success text-success-foreground",
        "solid-warning": "bg-warning text-warning-foreground",
        "solid-danger": "bg-danger text-danger-foreground",
        "solid-info": "bg-info text-info-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
