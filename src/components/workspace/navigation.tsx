"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  ArrowsClockwiseIcon, CalendarCheckIcon, CalendarDotsIcon, ChartBarIcon, ClockIcon, ClockCounterClockwiseIcon, DotsThreeIcon, FilesIcon, GearSixIcon, GraduationCapIcon, HeartbeatIcon, HouseIcon, InvoiceIcon, LaptopIcon, MegaphoneIcon, ShieldCheckIcon, ListChecksIcon, MoneyIcon, ReceiptIcon, TreeStructureIcon,
  UserCircleIcon, UsersFourIcon, UsersThreeIcon, XIcon, type Icon,
} from "@/components/icons";
import { cn } from "@/lib/utils";

type NavLink = { label: string; href: string; icon: Icon; exact?: boolean; count?: number };
export type NavCounts = { timeOff: number; expenses: number; timesheets: number };

function groups(canManage: boolean, employeeId: string | null, counts: NavCounts): { title?: string; links: NavLink[] }[] {
  return [
    { links: [
      { label: "Home", href: "/workspace", icon: HouseIcon, exact: true },
      ...(employeeId ? [{ label: "My profile", href: `/workspace/people/${employeeId}`, icon: UserCircleIcon }] : []),
      { label: "Announcements", href: "/workspace/announcements", icon: MegaphoneIcon },
    ] },
    { title: "People", links: [
      { label: "People", href: "/workspace/people", icon: UsersThreeIcon },
      { label: "Org chart", href: "/workspace/org", icon: TreeStructureIcon },
      { label: "Teams", href: "/workspace/teams", icon: UsersFourIcon },
      ...(canManage ? [{ label: "Lifecycle", href: "/workspace/lifecycle", icon: ListChecksIcon }] : []),
    ] },
    { title: "Time", links: [
      { label: "Timesheets", href: "/workspace/timesheets", icon: ClockIcon, count: counts.timesheets },
      { label: "Schedule", href: "/workspace/schedule", icon: CalendarCheckIcon },
      { label: "Time off", href: "/workspace/time-off", icon: CalendarDotsIcon, count: counts.timeOff },
    ] },
    { title: "Pay", links: [
      ...(canManage ? [{ label: "Pay runs", href: "/workspace/pay-runs", icon: MoneyIcon }] : []),
      ...(employeeId ? [{ label: "Payslips", href: "/workspace/payslips", icon: InvoiceIcon }] : []),
      { label: "Expenses", href: "/workspace/expenses", icon: ReceiptIcon, count: counts.expenses },
      { label: "Benefits", href: "/workspace/benefits", icon: HeartbeatIcon },
    ] },
    { title: "Workplace", links: [
      { label: "Documents", href: "/workspace/documents", icon: FilesIcon },
      { label: "Training", href: "/workspace/training", icon: GraduationCapIcon },
      ...(canManage || employeeId ? [{ label: "Devices and apps", href: "/workspace/devices", icon: LaptopIcon }] : []),
      ...(canManage ? [{ label: "Compliance", href: "/workspace/compliance", icon: ShieldCheckIcon }] : []),
    ] },
    ...(canManage ? [{ title: "Company", links: [
      { label: "Reports", href: "/workspace/reports", icon: ChartBarIcon },
      { label: "Routines", href: "/workspace/routines", icon: ArrowsClockwiseIcon },
      { label: "Activity", href: "/workspace/activity", icon: ClockCounterClockwiseIcon },
      { label: "Settings", href: "/workspace/settings", icon: GearSixIcon },
    ] }] : []),
  ];
}

export function WorkspaceNavigation({ canManage, employeeId, counts }: { canManage: boolean; employeeId: string | null; counts: NavCounts }) {
  const pathname = usePathname();
  const menu = useRef<HTMLDialogElement>(null);
  const sections = groups(canManage, employeeId, counts);
  const all = sections.flatMap((section) => section.links);
  const pinned = ["/workspace", "/workspace/people", "/workspace/time-off", "/workspace/expenses"].map((href) => all.find((link) => link.href === href)!);
  const ownProfile = employeeId ? `/workspace/people/${employeeId}` : null;

  useEffect(() => menu.current?.close(), [pathname]);

  function isActive({ href, exact }: NavLink) {
    if (exact) return pathname === href;
    const within = pathname === href || pathname.startsWith(`${href}/`);
    return within && !(href === "/workspace/people" && ownProfile && (pathname === ownProfile || pathname.startsWith(`${ownProfile}/`)));
  }

  function renderLink(link: NavLink, large = false) {
    const active = isActive(link);
    const { icon: Icon } = link;
    return <Link key={link.href} href={link.href} aria-current={active ? "page" : undefined} className={cn(
      "flex items-center gap-2.5 rounded-[7px] px-2.5 focus-visible:outline-offset-[-2px]", large ? "min-h-11 text-[15px]" : "min-h-[30px] text-sm",
      active ? "bg-line/70 font-medium text-foreground" : "text-muted hover:bg-line/40 hover:text-foreground",
    )}>
      <Icon aria-hidden="true" size={17} weight={active ? "fill" : "regular"} className="shrink-0" />
      {link.label}
      {link.count ? <span className="ml-auto text-[13px] font-medium text-foreground tabular-nums">{link.count}<span className="sr-only"> waiting</span></span> : null}
    </Link>;
  }

  return <>
    <nav aria-label="Workspace" className="hidden gap-4 lg:grid">
      {sections.map((section, index) => <div key={section.title ?? index} className="grid gap-px">
        {section.title && <p className="px-2.5 pb-1 text-xs text-hint">{section.title}</p>}
        {section.links.map((link) => renderLink(link))}
      </div>)}
    </nav>
    <nav aria-label="Quick links" className="fixed inset-x-0 bottom-0 z-20 grid auto-cols-fr grid-flow-col border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
      {pinned.map((link) => {
        const active = isActive(link);
        const { icon: Icon } = link;
        return <Link key={link.href} href={link.href} aria-current={active ? "page" : undefined} className={cn("flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 text-[11px] font-medium focus-visible:outline-offset-[-3px]", active ? "text-foreground" : "text-muted")}>
          <Icon aria-hidden="true" size={20} weight={active ? "fill" : "regular"} />{link.label}
        </Link>;
      })}
      <button type="button" onClick={() => menu.current?.showModal()} className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted focus-visible:outline-offset-[-3px]"><DotsThreeIcon aria-hidden="true" size={20} weight="bold" />More</button>
    </nav>
    <dialog ref={menu} aria-label="All pages" onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }} className="m-0 mt-auto max-h-[85dvh] w-full max-w-none rounded-t-2xl border-t border-line bg-surface text-foreground backdrop:bg-black/40 lg:hidden">
      <div className="p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="mb-2 flex items-center justify-between"><p className="px-2.5 text-[15px] font-semibold">All pages</p><button type="button" onClick={() => menu.current?.close()} aria-label="Close" className="grid size-11 place-items-center rounded-[7px] text-muted"><XIcon aria-hidden="true" size={18} /></button></div>
        <div className="grid gap-4" onClick={event => { if (event.target instanceof Element && event.target.closest("a[href]")) menu.current?.close(); }}>{sections.map((section, index) => <div key={section.title ?? index}>{section.title && <p className="px-2.5 pb-1 text-xs text-hint">{section.title}</p>}{section.links.map((link) => renderLink(link, true))}</div>)}</div>
      </div>
    </dialog>
  </>;
}
