import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CaretDownIcon } from "@/components/icons";
import { secondaryButton } from "@/components/ui";
import { ActionForm, Field } from "@/components/workspace/action-form";
import { BackLink, PageHeader, Section } from "@/components/workspace/presentation";
import { StatusText } from "@/components/workspace/workplace-parts";
import { formatDate, statusLabels } from "@/lib/people";
import { listAccounts, readChecklist } from "@/lib/server/checklists";
import { requireAdmin } from "@/lib/server/member";
import { addTaskAction, planTaskAction } from "../actions";

export const metadata: Metadata = { title: "Plan checklist" };

export default async function ChecklistPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [result, accounts] = await Promise.all([readChecklist(id), listAccounts()]);
  if (!result) notFound();
  const { checklist, tasks } = result;
  const people = (current?: { id: string | null; name: string | null }) => [{ value: "", label: "Nobody" }, ...accounts.map((account) => ({ value: account.id, label: account.name })), ...(current?.id && !accounts.some((account) => account.id === current.id) ? [{ value: current.id, label: current.name ?? "Current" }] : [])];
  return <>
    <BackLink href="/workspace/lifecycle">Lifecycle</BackLink>
    <PageHeader title={`${statusLabels[checklist.kind]} ${checklist.employeeName}`} description={`${checklist.kind === "onboarding" ? "Starts" : "Last day"} ${formatDate(checklist.targetDate)}. Set dates and who does each task.`} actions={<Link href={`/workspace/people/${checklist.employeeId}#checklist`} className={secondaryButton}>Open checklist</Link>} />
    <div className="grid max-w-3xl gap-9">
      <Section title="Tasks"><ul className="divide-y divide-line">{tasks.map((task) => {
        const line = <><span className="min-w-0 flex-1"><span className="block font-medium wrap-anywhere">{task.title}</span><span className="block text-[13px] text-muted">{task.completedAt ? `Completed by ${task.completedBy}` : [task.assignee ?? "Nobody assigned", task.dueOn ? "" : "no date"].filter(Boolean).join(", ")}</span></span>{task.completedAt ? <StatusText tone="positive">Complete</StatusText> : task.dueOn && <StatusText tone={task.overdue ? "danger" : "muted"}>{task.overdue ? "Overdue, " : "Due "}{formatDate(task.dueOn)}</StatusText>}</>;
        return <li key={task.id}>{task.completedAt ? <div className="flex flex-wrap items-center gap-x-6 gap-y-1 py-2.5 text-sm">{line}</div> : <details className="group">
          <summary className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded py-2.5 text-sm focus-visible:outline-offset-[-2px]">{line}<CaretDownIcon aria-hidden="true" size={13} className="shrink-0 text-hint group-open:rotate-180" /></summary>
          <ActionForm key={`${task.dueOn}-${task.assigneeId}`} action={planTaskAction} submit="Save task" variant="secondary" hidden={{ taskId: task.id }} inline className="pb-5"><Field name="assigneeId" label="Assigned to" defaultValue={task.assigneeId ?? ""} options={people({ id: task.assigneeId, name: task.assignee })} wrapperClass="w-full sm:w-56" /><Field name="dueOn" label="Due date" type="date" defaultValue={task.dueOn ?? ""} wrapperClass="w-full sm:w-44" /></ActionForm>
        </details>}</li>;
      })}</ul></Section>
      <Section title="Add a task"><div className="pt-3"><ActionForm action={addTaskAction} submit="Add task" hidden={{ workflowId: id }}><Field name="title" label="Task" required maxLength={180} /><div className="grid gap-4 sm:grid-cols-2"><Field name="assigneeId" label="Who does it" options={people()} /><Field name="dueOn" label="Due by" type="date" /></div><p className="text-[13px] text-muted">This task is added to this checklist only.</p></ActionForm></div></Section>
    </div>
  </>;
}
