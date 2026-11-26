import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "@/components/brand";
import { ArrowLeftIcon } from "@/components/icons";
import { ThemeToggle } from "@/components/theme-toggle";

export function EntryFrame({ title, description, back, children }: { title: string; description: string; back?: boolean; children: ReactNode }) {
  return <div className="flex min-h-dvh flex-col bg-background">
    <header className="flex min-h-16 items-center justify-between gap-4 border-b border-line px-5 sm:px-10"><Brand /><ThemeToggle /></header>
    <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[39rem] px-5 pt-[clamp(2.5rem,10vh,7rem)] pb-14 sm:px-8">
      {back && <Link href="/get-started" className="mb-5 inline-flex min-h-10 items-center gap-2 rounded text-sm text-muted hover:text-foreground"><ArrowLeftIcon size={15} aria-hidden="true" /> Back</Link>}
      <h1 className="text-[clamp(2rem,5vw,2.75rem)] leading-[1.1] font-semibold tracking-[-0.045em] wrap-anywhere text-balance">{title}</h1>
      <p className="mt-3 text-base leading-relaxed wrap-anywhere text-pretty text-muted">{description}</p>
      <div className="mt-8">{children}</div>
    </main>
  </div>;
}
