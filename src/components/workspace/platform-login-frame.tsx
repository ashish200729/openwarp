import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "@/components/brand";
import { ArrowLeftIcon } from "@/components/icons";
import { HeroField } from "@/components/marketing/hero-field";
import { ThemeToggle } from "@/components/theme-toggle";
import { panelStyle } from "@/components/ui";

export function LoginFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="relative isolate grid min-h-dvh grid-rows-[auto_1fr] overflow-hidden bg-surface">
      <HeroField className="h-full" level={0.34} controlClassName="top-auto bottom-4" />
      <header className="mx-auto flex min-h-16 w-full max-w-[74rem] items-center justify-between gap-3 px-4 sm:px-8">
        <Brand />
        <div className="flex items-center gap-1">
          <Link href="/" className="flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm text-muted hover:text-foreground"><ArrowLeftIcon aria-hidden="true" size={15} /> Home</Link>
          <ThemeToggle />
        </div>
      </header>
      <main id="main" tabIndex={-1} className="grid place-items-center px-5 pt-6 pb-20">
        <section className={`${panelStyle} w-full max-w-[24rem] border-line-strong p-6 shadow-window sm:p-7`}>
          <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.015em]">{title}</h1>
          {children}
        </section>
      </main>
    </div>
  );
}
