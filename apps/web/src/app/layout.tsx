import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

/* Self-hosted by next/font (no runtime Google request, no layout shift).
 * latin-ext carries the Hungarian ő/ű. globals.css maps these variables
 * onto Tailwind's font-sans / font-mono. */
const sans = Geist({ subsets: ["latin", "latin-ext"], variable: "--font-geist", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin", "latin-ext"], variable: "--font-geist-mono", display: "swap" });

export const metadata = {
  title: "tBook",
  description: "Multi-tenant event booking platform",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${mono.variable}`}>{children}</body>
    </html>
  );
}
