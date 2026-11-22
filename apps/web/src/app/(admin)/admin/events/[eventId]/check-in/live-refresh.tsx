"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-reads the page every few seconds so counts from parallel scanners stay current. */
export function LiveRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);
  return null;
}
