import type { Metadata } from "next";
import Link from "next/link";
import { panelStyle, primaryButton } from "@/components/ui";
import { RoutineForm } from "@/components/workspace/platform-routine-form";
import { Empty, Notice, PageHeader, Section } from "@/components/workspace/presentation";
import { activityLabels } from "@/lib/activity";
import { describeAction, describeTrigger } from "@/lib/domains/platform";
import { formatTime } from "@/lib/people";
import { listTeams } from "@/lib/server/directory";
import { requireAdmin } from "@/lib/server/member";
import { listRoutines } from "@/lib/server/routines";
import { listWebhooks } from "@/lib/server/webhooks";
import { eventChoices } from "./events";

export const metadata: Metadata = { title: "Routines" };

const outcomes: Record<string, string> = { done: "done", skipped: "skipped", failed: "failed" };

export default async function RoutinesPage({ searchParams }: { searchParams: Promise<{ new?: string; saved?: string }> }) {
  const member = await requireAdmin();
  const query = await searchParams;
  const [routines, teams, webhooks] = await Promise.all([listRoutines(member), listTeams(member), listWebhooks(member)]);
  const label = (event: string) => event in activityLabels ? activityLabels[event as keyof typeof activityLabels] : event;
  return <>
    <PageHeader title="Routines" description="Reminders and small steps that happen on a schedule, on a date, or after something changes." actions={query.new !== "1" && <Link href="/workspace/routines?new=1" className={primaryButton}>New routine</Link>} />
    {query.saved === "deleted" && <Notice>Routine deleted.</Notice>}
    {query.new === "1" && <section className={`${panelStyle} mb-8 max-w-3xl p-5`}><h2 className="mb-4 text-[15px] font-semibold">New routine</h2><RoutineForm events={eventChoices()} teams={teams.map(({ id, name }) => ({ id, name }))} webhooks={webhooks.map(({ id, name }) => ({ id, name }))} /></section>}
    <Section title="All routines" className="max-w-4xl">{routines.length ? <ul className="divide-y divide-line">{routines.map((routine) => <li key={routine.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-3 text-sm">
      <div className="min-w-0"><Link href={`/workspace/routines/${routine.id}`} className="font-medium wrap-anywhere hover:underline">{routine.name}</Link>
        <p className="wrap-anywhere text-muted">{describeTrigger(routine.trigger, label)}. {describeAction(routine.action)}.</p>
        {routine.lastRun && <p className="text-[13px] text-muted">Last run {formatTime(routine.lastRun)} UTC, {outcomes[routine.lastOutcome ?? ""]}</p>}</div>
      <span className={`text-[13px] font-medium ${routine.state === "active" ? "text-positive" : "text-muted"}`}>{routine.state === "active" ? "Active" : "Draft"}</span>
    </li>)}</ul> : <Empty>No routines yet. A routine stays a draft until you activate it.</Empty>}</Section>
  </>;
}
