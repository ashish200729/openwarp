import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, UsersRound } from "lucide-react";
import { initials, statusLabels, type EmployeeStatus } from "@/lib/people";
import { panelStyle, secondaryButton } from "@/components/ui";
import { cn } from "@/lib/utils";

const statusColors: Record<EmployeeStatus, string> = {
  active: "bg-positive/10 text-positive", onboarding: "bg-accent/12 text-accent", offboarding: "bg-peach/12 text-peach", archived: "bg-raised text-muted",
};
const avatarColors = ["bg-accent/12 text-accent", "bg-rose/12 text-rose", "bg-peach/12 text-peach", "bg-positive/12 text-positive"];

export function Status({ status }: { status: EmployeeStatus }) {
  return <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded px-2 py-1 text-xs font-medium whitespace-nowrap", statusColors[status])}>
    <span aria-hidden="true" className="size-1.5 bg-current" />{statusLabels[status]}
  </span>;
}

export function Avatar({ name, large = false }: { name: string; large?: boolean }) {
  const color = avatarColors[Array.from(name).reduce((sum, letter) => sum + (letter.codePointAt(0) ?? 0), 0) % avatarColors.length];
  return <span aria-hidden="true" className={cn("grid shrink-0 place-items-center rounded-lg border border-current/12 font-mono font-medium", large ? "size-14 text-lg sm:size-16" : "size-9 text-[11px]", color)}>{initials(name)}</span>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return <header className="mb-6 flex flex-wrap items-end justify-between gap-4 sm:mb-7">
    <div className="min-w-0">
      <h1 className="text-[clamp(1.9rem,5vw,2.7rem)] font-medium leading-[1.06] tracking-[-0.065em] wrap-anywhere">{title}</h1>
      {description && <p className="mt-2 max-w-[68ch] text-sm leading-relaxed text-muted">{description}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </header>;
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="-mt-2 mb-3 inline-flex min-h-11 items-center gap-2 rounded text-sm text-muted hover:text-foreground"><ArrowLeft aria-hidden="true" size={15} />{children}</Link>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className={`${panelStyle} grid justify-items-center gap-2 px-5 py-10 text-center sm:py-12`}>
    <span className="relative mb-1 grid size-11 place-items-center rounded-lg border border-line bg-background text-accent"><UsersRound aria-hidden="true" size={20} /><span aria-hidden="true" className="absolute -top-px -right-px size-2 bg-accent" /></span>
    <h2 className="text-base font-medium">{title}</h2><p className="max-w-[42ch] text-sm leading-relaxed text-muted">{description}</p>
    {action && <div className="mt-3">{action}</div>}
  </div>;
}

export function Notice({ children }: { children: ReactNode }) {
  return <p role="status" className="mb-5 flex items-start gap-2 rounded-md border border-positive/25 bg-positive/8 p-3 text-sm text-positive"><Check aria-hidden="true" size={16} className="mt-0.5 shrink-0" />{children}</p>;
}

export function Pagination({ page, pages, url }: { page: number; pages: number; url: (page: number) => string }) {
  if (pages < 2) return null;
  return <nav aria-label="Pagination" className="mt-4 flex flex-wrap items-center justify-end gap-2.5 text-sm text-muted">
    <span className="mr-auto font-mono text-xs">Page {page} of {pages}</span>
    {page > 1 && <Link href={url(page - 1)} className={secondaryButton}><ChevronLeft size={15} aria-hidden="true" /> Previous</Link>}
    {page < pages && <Link href={url(page + 1)} className={secondaryButton}>Next <ChevronRight size={15} aria-hidden="true" /></Link>}
  </nav>;
}
