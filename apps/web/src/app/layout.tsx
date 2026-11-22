import type { ReactNode } from "react";
import type { Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { PwaRegister } from "@/components/pwa-register";
import { ThemeProvider } from "next-themes";

/* Self-hosted by next/font (no runtime Google request, no layout shift).
 * latin-ext carries the Hungarian ő/ű. globals.css maps these variables
 * onto Tailwind's font-sans / font-mono. */
const sans = Geist({ subsets: ["latin", "latin-ext"], variable: "--font-geist", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin", "latin-ext"], variable: "--font-geist-mono", display: "swap" });

export const metadata = {
  title: "tBook",
  description: "Multi-tenant event booking platform",
  appleWebApp: { capable: true, title: "tBook", statusBarStyle: "default" as const },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};

/* Matches --background in globals.css (white / zinc-950). */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${sans.variable} ${mono.variable}`}>
        {/* `.dark` class on <html>; storageKey keeps the choice saved by the first toggle. */}
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange storageKey="tbook-theme">
          {children}
        </ThemeProvider>
        <PwaRegister />
      </body>
    </html>
  );
}
