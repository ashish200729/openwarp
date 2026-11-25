import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, ClipboardCheck, Pencil } from "lucide-react";
import { z } from "zod";
import { ButtonPixels, panelStyle, PixelMeter, primaryButton, secondaryButton } from "@/components/ui";
import { ActivityList } from "@/components/workspace/activity-list";
import { Avatar, BackLink, Notice, Status } from "@/components/workspace/presentation";
import { FinishWorkflow, TaskControl } from "@/components/workspace/record-forms";
import { employmentLabels, formatDate, statusLabels } from "@/lib/people";
import { employeeProfile, listActivity } from "@/lib/server/directory";
import { requireMember } from "@/lib/server/member";
import { taskAction, workflowAction } from "../../actions";

export const metadata: Metadata = { title: "Employee profile" };

const notices: Record<string, string> = {
  create: "Employee added.", edit: "Profile saved.", offboarding: "Offboarding checklist opened.",
  complete: "Checklist completed.", cancel: "Checklist cancelled.", rehired: "A new onboarding checklist is open.",
};

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0"><dt className="font-mono text-[10px] font-medium tracking-[0.12em] text-muted uppercase">{label}</dt><dd className="mt-1.5 text-sm wrap-anywhere">{children}</dd></div>;
}

export default async function EmployeePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const member = await requireMember();
  const [{ id }, { saved }] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(id).success) notFound();
  const profile = await employeeProfile(member, id);
  if (!profile) notFound();
  const { employee, managers, open, reports, tasks, workflows } = profile;
  const canManage = member.role === "admin";
  const name = `${employee.firstName} ${employee.lastName}`;
  const recent = canManage ? await listActivity({ employeeId: id, size: 6 }) : null;
  const completed = tasks.filter((task) => task.completedAt).length;
  const history = workflows.filter((workflow) => workflow.state !== "open");
  const notice = canManage && typeof saved === "string" && Object.hasOwn(notices, saved) ? notices[saved] : undefined;

  return <>
    <BackLink href="/workspace/people">People directory</BackLink>
    {notice && <Notice>{notice}</Notice>}
    <div className={`${panelStyle} mb-5 flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6`}>
      <div className="flex min-w-0 items-center gap-3.5 sm:gap-4">
        <Avatar name={name} large />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="text-[clamp(1.55rem,4.8vw,2.5rem)] font-medium leading-[1.08] tracking-[-0.06em] wrap-anywhere">{name}</h1>
            <Status status={employee.status} />
          </div>
          <p className="mt-1.5 text-sm wrap-anywhere text-muted">{employee.title}{employee.teamName ? ` · ${employee.teamName}` : ""}</p>
        </div>
      </div>
      {canManage && <div className="flex flex-wrap gap-2">
        {employee.status !== "archived" && <Link href={`/workspace/people/${id}/edit`} className={secondaryButton}><Pencil aria-hidden="true" size={15} /> Edit profile</Link>}
        {employee.status === "active" && <Link href={`/workspace/people/${id}/offboard`} className={secondaryButton}>Start offboarding <ChevronRight aria-hidden="true" size={16} /></Link>}
        {employee.status === "archived" && <Link href={`/workspace/people/${id}/rehire`} className={primaryButton}><ButtonPixels /> Restart onboarding</Link>}
      </div>}
    </div>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.16fr)_minmax(0,1fr)]">
      <section className={`${panelStyle} min-w-0 p-5 sm:p-6`}>
        <h2 className="text-lg font-medium tracking-tight">Work details</h2>
        <dl className="mt-5 grid gap-x-5 gap-y-5 sm:grid-cols-2">
          <Detail label="Work email"><a href={`mailto:${employee.email}`} className="text-accent hover:underline">{employee.email}</a></Detail>
          <Detail label="Employment type">{employmentLabels[employee.employmentType]}</Detail>
          <Detail label="Start date"><time dateTime={employee.hireDate}>{formatDate(employee.hireDate)}</time></Detail>
          <Detail label="Location">{employee.location || "Unspecified"}</Detail>
          <Detail label="Team">{employee.teamName ? <Link className="text-accent hover:underline" href={`/workspace/people?team=${employee.teamId}`}>{employee.teamName}</Link> : "No team"}</Detail>
          {employee.lastDay && <Detail label="Last day"><time dateTime={employee.lastDay}>{formatDate(employee.lastDay)}</time></Detail>}
        </dl>
      </section>
      <section className={`${panelStyle} min-w-0 p-5 sm:p-6`}>
        <h2 className="text-lg font-medium tracking-tight">Reporting lines</h2>
        {managers.length ? <ol className="mt-3 space-y-1 text-sm">
          {managers.map((manager) => <li key={manager.id} className="flex min-h-8 items-center gap-2 text-muted"><ChevronDown aria-hidden="true" size={14} className="shrink-0 text-hint" /><Link href={`/workspace/people/${manager.id}`} className="wrap-anywhere hover:text-accent hover:underline">{manager.name}</Link></li>)}
          <li className="flex items-center gap-2 font-medium"><ChevronDown aria-hidden="true" size={14} className="shrink-0 text-accent" /><span className="wrap-anywhere">{name}</span></li>
        </ol> : <p className="mt-3 text-sm text-muted">No manager listed.</p>}
        <p className="mt-5 border-t border-line pt-4 font-mono text-[10px] tracking-[0.12em] text-muted uppercase">Direct reports · {reports.length}</p>
        {reports.length ? <ul className="mt-2 divide-y divide-line">
          {reports.map((report) => <li key={report.id}><Link href={`/workspace/people/${report.id}`} className="flex min-h-12 items-center gap-2.5 rounded py-2 text-sm hover:text-accent"><Avatar name={report.name} /><span className="min-w-0 flex-1 wrap-anywhere">{report.name}<span className="block text-xs text-muted">{report.title}</span></span><ChevronRight aria-hidden="true" size={15} className="shrink-0 text-hint" /></Link></li>)}
        </ul> : <p className="mt-2 text-sm text-muted">No direct reports.</p>}
      </section>
    </div>
    {open && <section id="checklist" className={`${panelStyle} mt-5 scroll-mt-4 p-5 sm:p-6`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2.5 text-lg font-medium tracking-tight"><ClipboardCheck aria-hidden="true" size={18} className="text-accent" />{statusLabels[open.kind]} checklist</h2>
        <p className="font-mono text-xs text-muted">{completed} / {tasks.length} complete</p>
      </div>
      <div className="mt-3"><PixelMeter value={tasks.length ? (completed / tasks.length) * 100 : 0} label={`${statusLabels[open.kind]} checklist completion`} /></div>
      <ul className="mt-3 divide-y divide-line">
        {tasks.map((task) => <li key={task.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <div className="min-w-0"><p className="text-sm wrap-anywhere">{task.title}</p>
            {task.completedAt && <p className="mt-1 text-xs text-positive">Completed by {task.completedBy}</p>}
          </div>
          <TaskControl action={taskAction} employeeId={id} workflowId={open.id} taskId={task.id} title={task.title} completed={Boolean(task.completedAt)} />
        </li>)}
      </ul>
      <FinishWorkflow action={workflowAction} employeeId={id} workflowId={open.id} kind={open.kind} hasOpenTasks={completed < tasks.length} />
    </section>}
    {history.length > 0 && <section className={`${panelStyle} mt-5 p-5 sm:p-6`}>
      <h2 className="text-lg font-medium tracking-tight">Checklist history</h2>
      <ul className="mt-2 divide-y divide-line">
        {history.map((workflow) => <li key={workflow.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm">
          <span>{statusLabels[workflow.kind]} <span className="text-muted">· {workflow.state === "completed" ? "Completed" : "Cancelled"}</span></span>
          {workflow.closedAt && <time dateTime={workflow.closedAt.toISOString()} className="font-mono text-xs text-muted">{formatDate(workflow.closedAt)}</time>}
        </li>)}
      </ul>
    </section>}
    {recent && recent.entries.length > 0 && <section className="mt-6">
      <h2 className="mb-3 text-lg font-medium tracking-tight">Recent profile activity</h2>
      <ActivityList entries={recent.entries} includeSubject={false} />
    </section>}
  </>;
}
