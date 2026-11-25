"use client";

import Link from "next/link";
import { Brand } from "@/components/brand";
import { panelStyle, primaryButton, secondaryButton } from "@/components/ui";

export default function WorkspaceUnavailable() {
  return <main id="main" tabIndex={-1} className="mx-auto grid min-h-dvh max-w-lg content-center gap-5 px-5 py-12">
    <Brand />
    <section className={`${panelStyle} p-5 sm:p-7`}>
      <h1 className="text-2xl font-medium tracking-tight">The workspace is unavailable</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">Try reloading in a moment. If the problem continues, ask your workspace administrator to check the service.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className={primaryButton} onClick={() => window.location.reload()}>Reload</button>
        <Link href="/" className={secondaryButton}>Home</Link>
      </div>
    </section>
  </main>;
}
