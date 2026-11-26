"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Module = { id: string; title: string; description: string; screen: ReactNode };

export function ModuleTabs({ modules, label }: { modules: Module[]; label: string }) {
  const [current, setCurrent] = useState(0);
  const prefix = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: KeyboardEvent) {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
    const next = event.key === "Home" ? 0 : event.key === "End" ? modules.length - 1 : step ? (current + step + modules.length) % modules.length : null;
    if (next === null) return;
    event.preventDefault();
    setCurrent(next);
    buttons.current[next]?.focus();
  }

  return <div className="grid gap-x-12 gap-y-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="flex gap-x-5 overflow-x-auto border-b border-line lg:block lg:overflow-visible lg:border-b-0">
      {modules.map((module, index) => <button key={module.id} ref={(element) => { buttons.current[index] = element; }} type="button" role="tab" id={`${prefix}-tab-${module.id}`} aria-selected={index === current} aria-controls={`${prefix}-panel-${module.id}`} tabIndex={index === current ? 0 : -1} onClick={() => setCurrent(index)}
        className={cn("-mb-px flex min-h-11 items-center border-b-2 text-[15px] whitespace-nowrap focus-visible:outline-offset-[-2px] lg:mb-0 lg:min-h-12 lg:w-full lg:border-b lg:border-line lg:text-[17px]", index === current ? "border-foreground font-semibold lg:border-line" : "border-transparent text-muted hover:text-foreground lg:border-line")}>{module.title}</button>)}
    </div>
    {modules.map((module, index) => <div key={module.id} role="tabpanel" id={`${prefix}-panel-${module.id}`} aria-labelledby={`${prefix}-tab-${module.id}`} hidden={index !== current} tabIndex={0}>
      <p className="mb-5 max-w-[62ch] text-base leading-relaxed text-pretty text-muted lg:min-h-12">{module.description}</p>
      {module.screen}
    </div>)}
  </div>;
}
