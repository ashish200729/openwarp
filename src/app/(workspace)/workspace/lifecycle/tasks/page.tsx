import type { Metadata } from "next";
import { ActionButtons } from "@/components/workspace/action-form";
import { Empty, PageHeader, Section } from "@/components/workspace/presentation";
import { StatusText } from "@/components/workspace/workplace-parts";
import { formatDate, statusLabels } from "@/lib/people";
import { ownTasks } from "@/lib/server/checklists";
import { requireMember } from "@/lib/server/member";
import { ownTaskAction } from "../actions";

export const metadata: Metadata = { title: "My tasks" };

export default async function MyTasksPage() {
  const member = await requireMember();
  const tasks = await ownTasks(member);
  return <>
    <PageHeader title="My tasks" description="Onboarding and offboarding tasks assigned to you." />
    <Section title="Assigned to you" className="max-w-3xl">{tasks.length ? <ul className="divide-y divide-line">{tasks.map((task) => <li key={task.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3 text-sm">
      <div className="min-w-0"><p className="font-medium wrap-anywhere">{task.title}</p><p className="text-[13px] text-muted">{statusLabels[task.kind]} {task.employeeName}</p></div>
      <div className="flex flex-wrap items-center gap-3">{task.completedAt ? <StatusText tone="positive">Complete</StatusText> : task.dueOn && <StatusText tone={task.overdue ? "danger" : "muted"}>{task.overdue ? "Overdue, " : "Due "}{formatDate(task.dueOn)}</StatusText>}
        <ActionButtons action={ownTaskAction} hidden={{ taskId: task.id }} name="completed" buttons={[task.completedAt ? { value: "false", label: "Reopen", describe: `Reopen ${task.title}`, variant: "text" } : { value: "true", label: "Complete", describe: `Complete ${task.title}`, variant: "primary" }]} /></div>
    </li>)}</ul> : <Empty>No tasks are assigned to you.</Empty>}</Section>
  </>;
}
