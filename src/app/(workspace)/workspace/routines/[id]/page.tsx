import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { panelStyle, secondaryButton } from "@/components/ui";
import { ActionButtons, ActionForm, Field } from "@/components/workspace/action-form";
import { RoutineForm } from "@/components/workspace/platform-routine-form";
import { BackLink, Empty, Notice, PageHeader, Section } from "@/components/workspace/presentation";
import { activityLabels } from "@/lib/activity";
import { describeAction, describeTrigger } from "@/lib/domains/platform";
import { employmentLabels, formatTime, statusLabels } from "@/lib/people";
import { listTeams } from "@/lib/server/directory";
import { requireAdmin } from "@/lib/server/member";
import { listRoutinePeople, needsPerson, readRoutine } from "@/lib/server/routines";
import { listWebhooks } from "@/lib/server/webhooks";
import { commandRoutineAction, runRoutineAction } from "../actions";
import { eventChoices } from "../events";

export const metadata: Metadata = { title: "Routine" };

const outcomes = { done: ["Done", "text-positive"], skipped: ["Skipped", "text-muted"], failed: ["Failed", "text-danger"] } as const;

export default async function RoutinePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string; saved?: string }> }) {
  const member = await requireAdmin();
  const { id } = await params;
  const query = await searchParams;
  const found = z.uuid().safeParse(id).success ? await readRoutine(member, id) : null;
  if (!found) notFound();
  const { routine, runs } = found;
  const { trigger, conditions, action } = routine;
  const [teams, webhooks, people] = await Promise.all([listTeams(member), listWebhooks(member), needsPerson(trigger) ? listRoutinePeople(member) : []]);
  const label = (event: string) => event in activityLabels ? activityLabels[event as keyof typeof activityLabels] : event;
  const only = [conditions.teamId && (teams.find((team) => team.id === conditions.teamId)?.name ?? "an archived team"), conditions.employmentType && employmentLabels[conditions.employmentType], conditions.status && statusLabels[conditions.status]].filter(Boolean).join(", ");
  const active = routine.state === "active";
  return <>
    <BackLink href="/workspace/routines">Routines</BackLink>
    <PageHeader title={routine.name} actions={query.edit !== "1" && <Link href={`/workspace/routines/${id}?edit=1`} className={secondaryButton}>Edit</Link>} />
    {query.saved === "1" && <Notice>Routine saved.</Notice>}
    <div className="grid max-w-3xl gap-10">
      {query.edit === "1" && <section className={`${panelStyle} p-5`}><h2 className="mb-4 text-[15px] font-semibold">Edit routine</h2><RoutineForm key={routine.version} routine={routine} events={eventChoices()} teams={teams.map(({ id: teamId, name }) => ({ id: teamId, name }))} webhooks={webhooks.map(({ id: webhookId, name }) => ({ id: webhookId, name }))} /></section>}
      <Section title="What it does"><dl className="grid gap-x-6 gap-y-2 pt-3 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]">
        <dt className="text-muted">When</dt><dd>{describeTrigger(trigger, label)}</dd>
        <dt className="text-muted">For</dt><dd>{only || "Everyone who isn’t archived"}</dd>
        <dt className="text-muted">Then</dt><dd className="wrap-anywhere">{describeAction(action)}{action.kind === "webhook" && ` (${webhooks.find((webhook) => webhook.id === action.endpointId)?.name ?? "deleted"})`}{action.kind !== "task" && <span className="block text-muted">{action.title}{action.kind === "notify" && action.body && `. ${action.body}`}</span>}</dd>
        <dt className="text-muted">State</dt><dd className={active ? "text-positive" : "text-muted"}>{active ? `Active since ${formatTime(routine.activeFrom!)} UTC` : "Draft"}</dd>
      </dl>
        <div className="mt-4"><ActionButtons action={commandRoutineAction} hidden={{ id }} name="operation" buttons={[
          active ? { value: "pause", label: "Pause", describe: `Pause ${routine.name}` } : { value: "activate", label: "Activate", describe: `Activate ${routine.name}`, variant: "primary" as const },
          { value: "delete", label: "Delete", describe: `Delete ${routine.name}`, variant: "text" as const, confirm: { title: `Delete ${routine.name}?`, body: "Its run history is deleted too.", action: "Delete routine", danger: true } },
        ]} /></div>
      </Section>
      <Section title="Run now"><div className="grid gap-3 pt-3"><p className="text-sm text-muted">{needsPerson(trigger) ? "Runs once for one person who matches." : "Runs once, as if the schedule were due."}</p>
        <ActionForm action={runRoutineAction} submit="Run now" pending="Running…" variant="secondary" hidden={{ id }} inline confirm={{ title: "Run this routine now?", body: "It acts straight away, even while it’s a draft.", action: "Run it" }}>
          {needsPerson(trigger) && <Field name="employeeId" label="Person" required options={[{ value: "", label: "Choose a person" }, ...people.map((person) => ({ value: person.id, label: person.name }))]} wrapperClass="w-full sm:w-72" />}
        </ActionForm></div>
      </Section>
      <Section title="History">{runs.length ? <ul className="divide-y divide-line">{runs.map((run) => {
        const [name, color] = outcomes[run.outcome];
        return <li key={run.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-3 text-sm"><div className="min-w-0"><p className="wrap-anywhere">{run.employeeId ? <Link href={`/workspace/people/${run.employeeId}`} className="font-medium hover:underline">{run.employeeName}</Link> : <span className="font-medium">Workspace</span>} <span className="text-muted">{run.detail}</span></p><p className="text-[13px] text-muted">{formatTime(run.at)} UTC</p></div><span className={`text-[13px] font-medium ${color}`}>{name}</span></li>;
      })}</ul> : <Empty>It hasn’t run yet.</Empty>}</Section>
    </div>
  </>;
}
