import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { PwaRegister } from "@/components/pwa-register";
import { ThemeInitScript } from "@/components/theme-init-script";

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

export const viewport = { themeColor: "#18181b" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeInitScript />
      </head>
      <body className={`${sans.variable} ${mono.variable}`}>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
