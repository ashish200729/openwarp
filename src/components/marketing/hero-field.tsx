"use client";

import { useState } from "react";
import { PauseIcon, PlayIcon } from "@/components/icons";
import { Readout } from "#openwarp-readout";
import { cn } from "@/lib/utils";

export function HeroField({ className, controlClassName, level = 0.3 }: { className?: string; controlClassName?: string; level?: number }) {
  const [playing, setPlaying] = useState(true);
  const Icon = playing ? PauseIcon : PlayIcon;
  return <>
    <div aria-hidden="true" className={cn("pointer-events-none absolute inset-x-0 top-0 -z-10", className)}>
      <Readout color="var(--signal)" accentColor="var(--crest)" level={level} fps={30} smoke={0.3} speed={playing ? 0.5 : 0} className="block h-full w-full" />
    </div>
    <button type="button" onClick={() => setPlaying(!playing)} aria-label={playing ? "Pause background animation" : "Play background animation"}
      className={cn("absolute top-4 right-4 z-10 hidden size-9 place-items-center rounded-[7px] text-muted transition-colors hover:bg-raised hover:text-foreground motion-safe:grid sm:right-6", controlClassName)}>
      <Icon aria-hidden="true" size={15} weight="fill" />
    </button>
  </>;
}
