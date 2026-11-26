import type { ReactNode } from "react";
import Link from "next/link";
import { ArchiveIcon, ArrowLeftIcon, CaretLeftIcon, CaretRightIcon, CheckCircleIcon, CircleHalfIcon, CircleIcon, SignOutIcon, WarningCircleIcon, XCircleIcon, type Icon } from "@/components/icons";
import { requestLabels, type RequestState } from "@/lib/operations";
import { initials, statusLabels, type EmployeeStatus } from "@/lib/people";
import { secondaryButton } from "@/components/ui";
import { cn } from "@/lib/utils";

const statusStyles: Record<EmployeeStatus, { icon: Icon; color: string }> = {
  active: { icon: CheckCircleIcon, color: "text-positive" }, onboarding: { icon: CircleHalfIcon, color: "text-accent" },
  offboarding: { icon: SignOutIcon, color: "text-amber" }, archived: { icon: ArchiveIcon, color: "text-muted" },
};
const requestStyles: Record<RequestState, { icon: Icon; color: string }> = {
  pending: { icon: CircleIcon, color: "text-amber" }, approved: { icon: CheckCircleIcon, color: "text-positive" }, reimbursed: { icon: CheckCircleIcon, color: "text-positive" },
  declined: { icon: XCircleIcon, color: "text-danger" }, cancelled: { icon: XCircleIcon, color: "text-muted" },
};
// Solid fills with white text. Each clears 4.5:1 in both themes.
const avatarColors = ["#2f5d8c", "#7a4a2b", "#2f6b57", "#8a3b45", "#565a1f", "#3f4a5a", "#8a5a00", "#1f6a73"];

function Mark({ icon: Icon, color, children, weight = "fill" }: { icon: Icon; color: string; children: ReactNode; weight?: "fill" | "bold" }) {
  return <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-[13px] font-medium whitespace-nowrap", color)}><Icon aria-hidden="true" size={14} weight={weight} />{children}</span>;
}

export function Status({ status }: { status: EmployeeStatus }) {
  return <Mark {...statusStyles[status]} weight={status === "offboarding" ? "bold" : "fill"}>{statusLabels[status]}</Mark>;
}

export function RequestStatus({ state }: { state: RequestState }) {
  return <Mark {...requestStyles[state]} weight={state === "pending" ? "bold" : "fill"}>{requestLabels[state]}</Mark>;
}

export function Avatar({ name, size = "normal" }: { name: string; size?: "small" | "normal" | "large" }) {
  const color = avatarColors[Array.from(name).reduce((sum, letter) => sum * 31 + (letter.codePointAt(0) ?? 0) >>> 0, 7) % avatarColors.length];
  return <span aria-hidden="true" style={{ backgroundColor: color }} className={cn("grid shrink-0 place-items-center rounded-full font-semibold text-white select-none",
    size === "large" ? "size-14 text-lg" : size === "small" ? "size-6 text-[10px]" : "size-8 text-xs")}>{initials(name)}</span>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return <header className="mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
    <div className="min-w-0 grow basis-80">
      <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.015em] wrap-anywhere">{title}</h1>
      {description && <p className="mt-1 max-w-[70ch] text-sm leading-relaxed text-pretty text-muted">{description}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </header>;
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="-mt-3 mb-2 inline-flex min-h-10 items-center gap-1.5 rounded text-sm text-muted hover:text-foreground"><ArrowLeftIcon aria-hidden="true" size={14} />{children}</Link>;
}

export function Section({ title, action, children, id, className, level = 2 }: { title: string; action?: ReactNode; children: ReactNode; id?: string; className?: string; level?: 2 | 3 }) {
  const Heading = level === 2 ? "h2" : "h3";
  return <section id={id} className={cn("min-w-0 scroll-mt-20", className)}>
    <div className="mb-1 flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line pb-1.5">
      <Heading className="text-[15px] font-semibold">{title}</Heading>{action}
    </div>
    {children}
  </section>;
}

export function Figure({ label, value, detail, href }: { label: string; value: ReactNode; detail?: ReactNode; href?: string }) {
  const content = <>
    <span className="block text-[13px] text-muted">{label}</span>
    <span className="mt-0.5 block text-2xl leading-tight font-semibold tracking-[-0.02em] tabular-nums">{value}</span>
    {detail && <span className="mt-0.5 block text-[13px] text-muted">{detail}</span>}
  </>;
  return href ? <Link href={href} className="block min-w-0 bg-surface px-4 py-3 hover:bg-raised focus-visible:outline-offset-[-2px]">{content}</Link> : <div className="min-w-0 bg-surface px-4 py-3">{content}</div>;
}

// Hairlines come from the gap over a line-colored background, so they stay even at any column count.
export function FigureRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-line bg-line max-sm:[&>:last-child:nth-child(odd)]:col-span-2 sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]", className)}>{children}</div>;
}

export function EmptyState({ title, description, action, level = 2 }: { title: string; description: string; action?: ReactNode; level?: 1 | 2 }) {
  const Heading = level === 1 ? "h1" : "h2";
  return <div className="rounded-[10px] border border-dashed border-line-strong px-5 py-10 text-center">
    <Heading className="text-[15px] font-semibold">{title}</Heading>
    <p className="mx-auto mt-1 max-w-[46ch] text-sm leading-relaxed text-pretty text-muted">{description}</p>
    {action && <div className="mt-4 flex justify-center">{action}</div>}
  </div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-3 text-sm text-muted">{children}</p>;
}

export function Notice({ children }: { children: ReactNode }) {
  return <p role="status" className="mb-5 flex items-start gap-2 text-sm font-medium text-positive"><CheckCircleIcon aria-hidden="true" size={17} weight="fill" className="mt-px shrink-0" />{children}</p>;
}

export function Callout({ children }: { children: ReactNode }) {
  return <div className="mb-6 flex items-start gap-2.5 rounded-[10px] border border-line bg-background px-4 py-3 text-sm leading-relaxed"><WarningCircleIcon aria-hidden="true" size={17} className="mt-0.5 shrink-0 text-amber" /><div className="min-w-0">{children}</div></div>;
}

export function Pagination({ page, pages, url }: { page: number; pages: number; url: (page: number) => string }) {
  if (pages < 2) return null;
  return <nav aria-label="Pagination" className="mt-4 flex flex-wrap items-center justify-end gap-2 text-sm text-muted">
    <span className="mr-auto text-[13px] tabular-nums">Page {page} of {pages}</span>
    {page > 1 && <Link href={url(page - 1)} className={secondaryButton}><CaretLeftIcon size={14} aria-hidden="true" /> Previous</Link>}
    {page < pages && <Link href={url(page + 1)} className={secondaryButton}>Next <CaretRightIcon size={14} aria-hidden="true" /></Link>}
  </nav>;
}
