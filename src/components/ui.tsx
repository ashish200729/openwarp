import { cn } from "@/lib/utils";

export const buttonStyle = "inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-[7px] border px-3.5 text-sm font-medium transition-colors duration-100 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50 pointer-fine:min-h-9";
export const primaryButton = cn(buttonStyle, "border-transparent bg-primary text-primary-ink hover:bg-primary-hover");
export const secondaryButton = cn(buttonStyle, "border-line-strong bg-panel text-foreground hover:border-control hover:bg-raised");
export const textButton = cn(buttonStyle, "border-transparent px-2.5 text-muted hover:bg-raised hover:text-foreground");
export const largeButton = "min-h-12! px-5 text-[15px] rounded-lg";
export const textLink = "rounded-sm text-accent underline decoration-accent/35 underline-offset-3 hover:decoration-current";
export const inputStyle = "min-h-11 w-full min-w-0 rounded-[7px] border border-control bg-surface px-3 py-1.5 text-base text-foreground placeholder:text-hint hover:border-muted focus-visible:border-accent focus-visible:outline-1 focus-visible:outline-offset-0 aria-invalid:border-danger sm:text-sm pointer-fine:min-h-9";
export const panelStyle = "rounded-[10px] border border-line bg-panel";
export const sectionTitle = "text-[15px] font-semibold";
export const tableHead = "border-b border-line text-left text-[13px] text-muted [&_th]:py-2 [&_th]:pr-4 [&_th]:font-medium [&_th:last-child]:pr-0";
export const tableBody = "divide-y divide-line text-sm [&_td]:py-2.5 [&_td]:pr-4 [&_td:last-child]:pr-0 [&_th]:py-2.5 [&_th]:pr-4 [&_th]:text-left [&_th]:font-normal";

export function Meter({ value, label, color = "var(--signal)" }: { value: number; label: string; color?: string }) {
  const percent = Math.min(Math.max(value, 0), 100);
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1.5 overflow-hidden rounded-full bg-raised">
      <div aria-hidden="true" className="h-full rounded-full forced-colors:bg-[CanvasText]!" style={{ width: `${percent}%`, backgroundColor: color }} />
    </div>
  );
}
