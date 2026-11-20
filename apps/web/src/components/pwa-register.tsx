"use client";

import { useEffect } from "react";

/** Registers the service worker in production only (in dev it would cache stale builds). */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error) => console.warn("[pwa] service worker not registered", error));
  }, []);
  return null;
}
