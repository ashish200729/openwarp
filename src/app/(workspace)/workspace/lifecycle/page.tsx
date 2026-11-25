import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { ButtonPixels, panelStyle, PixelMeter, primaryButton } from "@/components/ui";
import { Avatar, EmptyState, PageHeader, Pagination } from "@/components/workspace/presentation";
import { formatDate, pageNumber, statusLabels, workflowKinds } from "@/lib/people";
import { listOpenWorkflows } from "@/lib/server/directory";
import { requireAdmin } from "@/lib/server/member";

export const metadata: Metadata = { title: "Lifecycle" };

export default async function LifecyclePage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireAdmin();
  const { workflows, page, pages, total } = await listOpenWorkflows(pageNumber((await searchParams).page));
  return <>
    <PageHeader title="Employee lifecycle" description="Follow each open checklist from first day through departure." actions={<Link href="/workspace/people/new" className={primaryButton}><ButtonPixels /> Add employee <Plus aria-hidden="true" size={17} /></Link>} />
    {total ? <>
      <p className="mb-3 font-mono text-xs text-muted">{total} open {total === 1 ? "checklist" : "checklists"}</p>
      <div className="grid gap-5 xl:grid-cols-2">
        {workflowKinds.map((kind) => {
          const matching = workflows.filter((workflow) => workflow.kind === kind);
          return <section key={kind}>
            <h2 className="mb-3 flex items-center gap-2.5 text-base font-medium"><span aria-hidden="true" className={`size-2 ${kind === "onboarding" ? "bg-accent" : "bg-peach"}`} /> {statusLabels[kind]}</h2>
            {matching.length ? <ul className={`${panelStyle} divide-y divide-line`}>
              {matching.map((workflow) => <li key={workflow.id} className="p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <Avatar name={workflow.employeeName} />
                  <div className="min-w-0 flex-1"><Link href={`/workspace/people/${workflow.employeeId}#checklist`} className="inline-flex min-h-8 items-center gap-2 rounded text-sm font-medium hover:text-accent hover:underline"><span className="wrap-anywhere">{workflow.employeeName}</span><ArrowRight aria-hidden="true" size={14} className="shrink-0" /></Link><p className="text-xs wrap-anywhere text-muted">{workflow.title}</p></div>
                </div>
                <div className="mt-4 mb-2 flex flex-wrap justify-between gap-2 font-mono text-[11px] text-muted"><span>{kind === "onboarding" ? "Starts" : "Last day"} <time dateTime={workflow.targetDate}>{formatDate(workflow.targetDate)}</time></span><span>{workflow.completed} / {workflow.total} complete</span></div>
                <PixelMeter value={(workflow.completed / workflow.total) * 100} label={`${workflow.employeeName} checklist completion`} color={kind === "onboarding" ? "var(--accent)" : "var(--peach)"} />
              </li>)}
            </ul> : <p className={`${panelStyle} p-5 text-sm text-muted`}>No {kind} checklists on this page.</p>}
          </section>;
        })}
      </div>
      <Pagination page={page} pages={pages} url={(next) => `/workspace/lifecycle?page=${next}`} />
    </> : <EmptyState title="No open checklists" description="Start onboarding when you add an employee, or start offboarding from an active profile." />}
  </>;
}
