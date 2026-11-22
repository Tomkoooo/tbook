import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const WIDTHS = {
  /** Forms and pickers: about 40rem. */
  narrow: "max-w-2xl",
  /** Detail pages: about 56rem. */
  default: "max-w-5xl",
  /** Lists and dashboards: fills the console (the shell already caps at 1440px). */
  wide: "max-w-none",
} as const;

/**
 * Container — the page wrapper rhythm: children are stacked with `gap-4` on
 * phones and `gap-6` from md up, centred, and optionally width-limited.
 *
 *   <Container width="narrow"> <PageTitle … /> <SectionCard …/> </Container>
 *
 * Props:
 *   width      "wide" (default, no extra limit) | "default" (max-w-5xl) | "narrow" (max-w-2xl)
 *   className  extra classes
 *
 * The console layout already pads and caps `<main>`; use Container only when a
 * page needs a narrower column, or to get the same vertical rhythm inside a
 * panel or a sub-section.
 */
export function Container({
  width = "wide",
  className,
  children,
}: {
  width?: keyof typeof WIDTHS;
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn("mx-auto flex w-full flex-col gap-4 md:gap-6", WIDTHS[width], className)}>{children}</div>;
}
