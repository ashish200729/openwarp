import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import "@fontsource-variable/hanken-grotesk/wght.css";
import "./globals.css";
import { parseTheme, themeCookie } from "@/lib/theme";

async function savedTheme() {
  return parseTheme((await cookies()).get(themeCookie)?.value);
}

const description = "Self-host your directory, time off, timesheets, pay runs, benefits, documents and devices with OpenWarp.";

export function generateMetadata(): Metadata {
  const origin = process.env.BETTER_AUTH_URL;
  return {
    metadataBase: new URL(origin && URL.canParse(origin) ? origin : "http://127.0.0.1:3000"),
    title: { default: "OpenWarp | Open-source people operations", template: "%s | OpenWarp" },
    description,
    applicationName: "OpenWarp",
    openGraph: { type: "website", siteName: "OpenWarp", title: "The people system you own.", description },
    twitter: { card: "summary_large_image" },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const theme = await savedTheme();
  const light = "#ffffff";
  const dark = "#151514";
  return {
    viewportFit: "cover",
    themeColor: theme ? (theme === "dark" ? dark : light) : [
      { media: "(prefers-color-scheme: light)", color: light },
      { media: "(prefers-color-scheme: dark)", color: dark },
    ],
  };
}

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" data-theme={await savedTheme()} className="bg-background text-foreground">
      <body className="min-h-dvh font-sans antialiased">
        <a href="#main" className="sr-only z-50 rounded-lg bg-primary px-4 py-2 text-primary-ink focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
