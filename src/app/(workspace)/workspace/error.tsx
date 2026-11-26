"use client";

import Link from "next/link";
import { panelStyle, primaryButton, secondaryButton } from "@/components/ui";

export default function WorkspaceError({ reset }: { error: Error; reset: () => void }) {
  return <section className={`${panelStyle} p-6 sm:p-8`}>
    <h1 className="text-[22px] font-semibold tracking-[-0.015em]">The workspace couldn’t load</h1>
    <p className="mt-2 max-w-[44ch] text-sm leading-relaxed text-muted">Try again in a moment. If the problem continues, ask your workspace administrator to check the database connection.</p>
    <div className="mt-4 flex flex-wrap gap-2">
      <button type="button" onClick={reset} className={primaryButton}>Try again</button>
      <Link href="/" className={secondaryButton}>Home</Link>
    </div>
  </section>;
}
