import type { CSSProperties } from "react";
import { Readout } from "#openwarp-readout";
import { PixelMeter } from "@/components/ui";

const headcount = [
  [4, 8, 4], [4, 11, 6], [4, 10, 4], [5, 12, 4], [5, 11, 5], [6, 13, 5],
  [4, 11, 5], [5, 13, 5], [6, 12, 6], [6, 15, 5], [8, 14, 6], [7, 18, 6],
  [9, 16, 5], [8, 15, 6], [10, 13, 5], [10, 14, 7], [10, 16, 7], [11, 14, 7],
  [12, 13, 8], [12, 15, 7], [11, 15, 8], [11, 16, 8], [12, 15, 10], [12, 17, 11],
];
const chartColors = ["var(--peach)", "var(--rose)", "var(--orchid)"];

export function WorkforceChart() {
  return (
    <figure className="relative isolate min-w-0 overflow-hidden rounded-2xl border border-line bg-[#111116]" aria-label="Sample workforce overview. The chart illustrates headcount over six months. Nine of twelve onboarding tasks are complete.">
      <Readout aria-hidden="true" color="#494195" accentColor="#c1b7ff" waveHeight={0.4} level={0.24} fps={24} smoke={0.2} className="pointer-events-none absolute inset-0 -z-10 h-full w-full opacity-40" />
      <div className="relative p-5 sm:p-6">
        <div className="flex items-center justify-between gap-4 font-mono text-[11px] font-medium tracking-[0.11em] uppercase">
          <span className="text-muted">Workforce overview</span>
          <span className="flex items-center gap-2 text-hint"><span className="size-1.5 bg-orchid" aria-hidden="true" /> Sample data</span>
        </div>
        <div className="mt-5 flex items-end gap-3">
          <span className="font-mono text-4xl leading-none tracking-[-0.09em] tabular-nums sm:text-[43px]">40</span>
          <span className="pb-0.5 text-sm text-muted">people</span>
        </div>
        <div className="relative mt-5 flex h-27 items-end gap-[3px] border-b border-line px-0.5 sm:h-33 sm:gap-1.5" aria-hidden="true">
          <div className="absolute inset-x-0 top-1/4 border-t border-dashed border-line" />
          <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-line" />
          <div className="absolute inset-x-0 top-3/4 border-t border-dashed border-line" />
          {headcount.map((segments, index) => (
            <div key={index} className="relative flex h-full min-w-0 flex-1 flex-col-reverse gap-[2px]">
              {segments.map((segment, part) => (
                <div key={part} className="pixel-fill border-t border-(--pixel) [--pixel-size:6px] sm:[--pixel-size:8px]" style={{ height: `${segment * 2.35}%`, "--pixel": chartColors[part] } as CSSProperties} />
              ))}
            </div>
          ))}
        </div>
        <div className="mt-1.5 flex h-3.5 gap-[3px] overflow-hidden sm:gap-1.5" aria-hidden="true">
          {headcount.map((_, index) => <div key={index} className="pixel-fill flex-1 [--pixel-size:6px] [--pixel:#44434c] sm:[--pixel-size:8px]" />)}
        </div>
        <div className="mt-2.5 flex justify-between font-mono text-[10px] tracking-wide text-hint uppercase" aria-hidden="true">
          {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'].map((month) => <span key={month}>{month}</span>)}
        </div>
      </div>
      <div className="border-t border-line bg-background/50 px-5 py-4 sm:px-6">
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted">
          <span>Onboarding tasks</span><span className="font-mono text-foreground">9 / 12 complete</span>
        </div>
        <PixelMeter value={75} label="Sample onboarding completion" />
      </div>
    </figure>
  );
}
