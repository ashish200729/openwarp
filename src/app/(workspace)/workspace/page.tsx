import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CircleDot, ClipboardCheck, Network, Plus, UsersRound } from "lucide-react";
import { ButtonPixels, panelStyle, PixelMeter, primaryButton, secondaryButton } from "@/components/ui";
import { EmptyState, PageHeader } from "@/components/workspace/presentation";
import { PeopleList } from "@/components/workspace/people-list";
import { readOverview } from "@/lib/server/directory";
import { requireMember } from "@/lib/server/member";

export const metadata: Metadata = { title: "Overview" };

const metrics = [
  { id: "active", label: "Active employees", icon: UsersRound, color: "var(--positive)", href: "/workspace/people?status=active" },
  { id: "onboarding", label: "Onboarding", icon: ClipboardCheck, color: "var(--accent)", href: "/workspace/lifecycle" },
  { id: "offboarding", label: "Offboarding", icon: CircleDot, color: "var(--peach)", href: "/workspace/lifecycle" },
  { id: "teams", label: "Teams", icon: Network, color: "var(--rose)", href: "/workspace/teams" },
] as const;

export default async function OverviewPage() {
  const member = await requireMember();
  const canManage = member.role === "admin";
  const { counts, people, tasks, teams } = await readOverview(member);
  const total = counts.reduce((sum, entry) => sum + entry.count, 0);
  const percent = tasks.total ? Math.round((tasks.completed / tasks.total) * 100) : 0;
  const metricList = canManage ? metrics : [metrics[0], metrics[3]];
  const largestTeams = [...teams].sort((first, second) => second.people - first.people).slice(0, 5);
  const number = new Intl.NumberFormat("en");

  return <>
    <PageHeader title="People overview" description="A current view of your workforce and teams." actions={canManage
      ? <Link href="/workspace/people/new" className={primaryButton}><ButtonPixels /> Add employee <Plus aria-hidden="true" size={17} /></Link>
      : <Link href="/workspace/people" className={secondaryButton}>People directory <ArrowRight aria-hidden="true" size={16} /></Link>} />
    <div className={`grid grid-cols-2 gap-3 sm:gap-4 ${canManage ? "xl:grid-cols-4" : ""}`}>
      {metricList.map(({ id, label, icon: Icon, color, href }) => {
        const value = id === "teams" ? teams.length : counts.find((entry) => entry.status === id)?.count ?? 0;
        return <Link key={id} href={href} className={`${panelStyle} group relative isolate min-w-0 overflow-hidden px-3.5 pt-3.5 pb-4 transition-colors hover:border-control motion-reduce:transition-none sm:px-5 sm:pt-4 sm:pb-5`}>
          <span className="pixel-grid absolute inset-y-0 right-0 -z-10 w-24 opacity-50 [mask-image:linear-gradient(to_right,transparent,#000)] [--pixel:var(--line)]" aria-hidden="true" />
          <div className="flex min-w-0 items-start justify-between gap-1.5 text-xs font-medium text-muted sm:text-sm"><span className="min-w-0 wrap-anywhere">{label}</span><Icon size={16} style={{ color }} className="shrink-0" aria-hidden="true" /></div>
          <div className="mt-2.5 flex items-end justify-between gap-2"><span className="font-mono text-2xl leading-none tracking-[-0.08em] tabular-nums sm:text-3xl">{number.format(value)}</span><ArrowRight aria-hidden="true" size={14} className="shrink-0 text-hint group-hover:text-accent" /></div>
        </Link>;
      })}
    </div>
    <div className={`mt-5 grid gap-4 ${canManage ? "xl:grid-cols-[minmax(0,1.12fr)_minmax(0,1fr)]" : ""}`}>
      {canManage && <section className={`${panelStyle} flex min-w-0 flex-col p-5 sm:p-6`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-medium tracking-tight">Checklist progress</h2>
          <Link href="/workspace/lifecycle" className="inline-flex min-h-8 items-center gap-1.5 rounded text-xs text-accent hover:underline">View lifecycle <ArrowRight aria-hidden="true" size={14} /></Link>
        </div>
        <p className="mt-2 text-sm text-muted">Tasks across open onboarding and offboarding checklists.</p>
        {tasks.total ? <>
          <div className="mt-6 flex flex-wrap items-end justify-between gap-2">
            <span className="font-mono text-[clamp(1.8rem,6vw,2.85rem)] leading-none tracking-[-0.09em] tabular-nums">{percent}%</span>
            <span className="font-mono text-xs text-muted">{number.format(tasks.completed)} / {number.format(tasks.total)} complete</span>
          </div>
          <div className="mt-3"><PixelMeter value={percent} label="Open checklist task completion" /></div>
        </> : <p className="mt-6 rounded-md border border-dashed border-line px-4 py-4 text-sm text-muted">No checklists are open.</p>}
      </section>}
      <section className={`${panelStyle} min-w-0 p-5 sm:p-6`}>
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-medium tracking-tight">Largest teams</h2>
          <Link href="/workspace/teams" className="inline-flex min-h-8 items-center gap-1.5 rounded text-xs text-accent hover:underline">View teams <ArrowRight aria-hidden="true" size={14} /></Link></div>
        {largestTeams.length ? <ul className="mt-3 space-y-3">
          {largestTeams.map((team) => <li key={team.id}>
            <div className="mb-1.5 flex justify-between gap-3 text-sm"><Link href={`/workspace/people?team=${team.id}`} className="wrap-anywhere text-muted hover:text-accent">{team.name}</Link><span className="font-mono text-xs tabular-nums">{team.people}</span></div>
            <PixelMeter value={total ? Math.round((team.people / total) * 100) : 0} label={`${team.name} share of visible employees`} color="var(--orchid)" />
          </li>)}
        </ul> : <p className="mt-4 text-sm text-muted">Teams will appear here when they’re created.</p>}
      </section>
    </div>
    <section className="mt-7">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-medium tracking-tight">People directory</h2>
        <Link href="/workspace/people" className="inline-flex min-h-9 items-center gap-2 rounded text-sm text-accent hover:underline">View all people <ArrowRight aria-hidden="true" size={15} /></Link>
      </div>
      {people.length ? <PeopleList people={people} /> : <EmptyState title="No employees yet" description={canManage ? "Add someone to see their status and team here." : "Active employees will appear here when an administrator adds them."} />}
    </section>
  </>;
}
