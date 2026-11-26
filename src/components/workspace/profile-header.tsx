import Link from "next/link";
import type { ReactNode } from "react";
import { Avatar, BackLink, Status } from "@/components/workspace/presentation";
import type { EmployeeStatus } from "@/lib/people";
import { cn } from "@/lib/utils";

type Tab = "overview" | "personal" | "job" | "time-off" | "documents" | "benefits" | "training";
const tabs: { id: Tab; label: string }[] = [{ id: "overview", label: "Overview" }, { id: "personal", label: "Personal" }, { id: "job", label: "Job and pay" }, { id: "time-off", label: "Time off" }, { id: "benefits", label: "Benefits" }, { id: "training", label: "Training" }, { id: "documents", label: "Documents" }];

export function ProfileHeader({ employee, current, canSeePrivate, actions }: { employee: { id: string; firstName: string; lastName: string; title: string; teamName: string | null; status: EmployeeStatus }; current: Tab; canSeePrivate: boolean; actions?: ReactNode }) {
  const name = `${employee.firstName} ${employee.lastName}`;
  const base = `/workspace/people/${employee.id}`;
  return <>
    <BackLink href="/workspace/people">People directory</BackLink>
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
      <div className="flex min-w-0 items-center gap-4"><Avatar name={name} size="large" />
        <div className="min-w-0"><h1 className="text-[22px] leading-tight font-semibold tracking-[-0.015em] wrap-anywhere">{name}</h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted"><span className="wrap-anywhere">{employee.title}{employee.teamName ? `, ${employee.teamName}` : ""}</span><Status status={employee.status} /></p></div></div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
    {canSeePrivate ? <nav aria-label="Profile" className="mt-5 mb-7 flex gap-x-5 overflow-x-auto border-b border-line">
      {tabs.map((tab) => <Link key={tab.id} href={tab.id === "overview" ? base : `${base}/${tab.id}`} aria-current={tab.id === current ? "page" : undefined} className={cn("-mb-px flex min-h-11 items-center border-b-2 text-sm whitespace-nowrap focus-visible:outline-offset-[-2px]", tab.id === current ? "border-foreground font-medium" : "border-transparent text-muted hover:text-foreground")}>{tab.label}</Link>)}
    </nav> : <div className="mt-5 mb-7 border-b border-line" />}
  </>;
}
