"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, CircleDot, LayoutGrid, Network, UsersRound } from "lucide-react";
import { cn } from "@/lib/utils";

const links = [
  { label: "Overview", href: "/workspace", icon: LayoutGrid },
  { label: "People", href: "/workspace/people", icon: UsersRound },
  { label: "Teams", href: "/workspace/teams", icon: Network },
  { label: "Lifecycle", href: "/workspace/lifecycle", icon: CircleDot, admin: true },
  { label: "Activity", href: "/workspace/activity", icon: Activity, admin: true },
];

export function WorkspaceNavigation({ canManage }: { canManage: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Workspace" className="flex flex-wrap gap-1.5 lg:grid lg:gap-1">
      {links.filter((link) => !link.admin || canManage).map(({ label, href, icon: Icon }) => {
        const active = href === "/workspace" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
        return <Link href={href} key={href} aria-current={active ? "page" : undefined} className={cn(
          "group flex min-h-11 min-w-0 items-center gap-2 rounded-md border px-2.5 text-sm transition-colors motion-reduce:transition-none lg:gap-3 lg:px-3",
          active ? "border-accent/20 bg-accent/9 text-accent" : "border-transparent text-muted hover:bg-raised hover:text-foreground",
        )}>
          <Icon aria-hidden="true" size={17} className="shrink-0" /> {label}
          {active && <span aria-hidden="true" className="pixel-fill ml-auto hidden size-2.5 [--pixel-size:6px] [--pixel:currentColor] lg:block" />}
        </Link>;
      })}
    </nav>
  );
}
