import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "tBook",
  description: "Multi-tenant event booking platform",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
