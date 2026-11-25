import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

export const buttonStyle = "inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-md border px-3.5 text-sm font-medium transition-colors duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50";
export const primaryButton = cn(buttonStyle, "border-accent bg-accent text-accent-ink hover:border-[#ccc5ff] hover:bg-[#ccc5ff]");
export const secondaryButton = cn(buttonStyle, "border-control bg-panel text-foreground hover:border-muted hover:bg-raised");
export const textButton = cn(buttonStyle, "border-transparent text-muted hover:bg-raised hover:text-foreground");
export const inputStyle = "min-h-11 w-full min-w-0 rounded-md border border-control bg-background px-3 py-2 text-sm text-foreground placeholder:text-hint focus-visible:outline-offset-1";
export const panelStyle = "rounded-xl border border-line bg-panel";

export function ButtonPixels() {
  return <span aria-hidden="true" className="pixel-fill mr-0.5 size-3 shrink-0 opacity-65 [--pixel-size:6px] [--pixel:currentColor]" />;
}

export function PixelMeter({ value, label, color = "var(--accent)" }: { value: number; label: string; color?: string }) {
  const percent = Math.min(Math.max(value, 0), 100);
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="relative h-2.5 overflow-hidden rounded-[2px] bg-raised">
      <div aria-hidden="true" className="pixel-fill h-full [--pixel-base:color-mix(in_srgb,var(--pixel)_18%,transparent)] [--pixel-size:6px]" style={{ width: `${percent}%`, "--pixel": color } as CSSProperties} />
    </div>
  );
}
