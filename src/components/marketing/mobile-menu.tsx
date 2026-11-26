"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { ListIcon, XIcon } from "@/components/icons";
import { primaryButton } from "@/components/ui";
import { cn } from "@/lib/utils";

export function MobileMenu({ links }: { links: { label: string; href: string }[] }) {
  const menu = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      if (menu.current?.open && !menu.current.contains(event.target as Node)) menu.current.open = false;
    }
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);

  function close() {
    if (menu.current) menu.current.open = false;
  }

  return (
    <details ref={menu} className="group md:hidden" onKeyDown={(event) => {
      if (event.key !== "Escape" || !menu.current?.open) return;
      close();
      menu.current.querySelector("summary")?.focus();
    }}>
      <summary aria-label="Menu" className="grid size-11 place-items-center rounded-[7px] text-foreground hover:bg-raised">
        <ListIcon aria-hidden="true" size={19} className="group-open:hidden" />
        <XIcon aria-hidden="true" size={19} className="hidden group-open:block" />
      </summary>
      <nav aria-label="Mobile navigation" className="absolute inset-x-3 top-full mt-2 grid max-h-[calc(100dvh-5.5rem)] gap-1 overflow-y-auto rounded-[10px] border border-line-strong bg-panel p-1.5 shadow-float">
        {links.map(({ label, href }) => <a key={href} href={href} onClick={close} className="flex min-h-12 items-center rounded-[7px] px-3 text-[15px] hover:bg-raised">{label}</a>)}
        <Link href="/login" className={cn(primaryButton, "mt-1 min-h-12! sm:hidden")}>Open workspace</Link>
      </nav>
    </details>
  );
}
