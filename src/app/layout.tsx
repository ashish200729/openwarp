import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/geist/wght.css";
import "@fontsource-variable/geist-mono/wght.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "OpenWarp | Open-source people operations", template: "%s | OpenWarp" },
  description: "Self-host your employee directory, reporting lines, onboarding, and offboarding with OpenWarp.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className="bg-background text-foreground">
      <body className="min-h-dvh font-sans antialiased">
        <a href="#main" className="sr-only z-50 rounded-md bg-accent px-4 py-2 text-accent-ink focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
