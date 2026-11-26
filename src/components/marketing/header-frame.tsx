"use client";

import { useEffect, useState, type ReactNode } from "react";

// The header sits on the hero until the page scrolls, then takes a surface and a rule.
export function HeaderFrame({ children }: { children: ReactNode }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 4);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  return (
    <header data-scrolled={scrolled ? "" : undefined}
      className="sticky top-0 z-30 h-14 border-b border-transparent transition-[background-color,border-color] duration-200 motion-reduce:transition-none data-scrolled:border-line data-scrolled:bg-surface/88 data-scrolled:backdrop-blur-md data-scrolled:backdrop-saturate-150 supports-[not_(backdrop-filter:blur(1px))]:data-scrolled:bg-surface">
      {children}
    </header>
  );
}
