import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon, PlusIcon } from "@/components/icons";
import { Meter, primaryButton, secondaryButton, textLink } from "@/components/ui";
import { ActionForm, Field } from "@/components/workspace/action-form";
import { Avatar, Empty, EmptyState, PageHeader, Pagination } from "@/components/workspace/presentation";
import { Filters, StatusText, SubNav } from "@/components/workspace/workplace-parts";
import { formatDate, statusLabels, workflowKinds } from "@/lib/people";
import { checklistFilters, listAccounts, listChecklists, listOpenTasks, type ChecklistFilters, type Progress } from "@/lib/server/checklists";
import { requireAdmin } from "@/lib/server/member";
import { bulkTasksAction } from "./actions";

export const metadata: Metadata = { title: "Lifecycle" };

function listUrl(filters: ChecklistFilters) {
  const params = new URLSearchParams();
  if (filters.query) params.set("q", filters.query);
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.overdue) params.set("overdue", "1");
  if (filters.view !== "people") params.set("view", filters.view);
  if (filters.page > 1) params.set("page", String(filters.page));
  const query = params.toString();
  return query ? `/workspace/lifecycle?${query}` : "/workspace/lifecycle";
}

const part = (label: string, { done, total }: Progress) => total ? [`${label} ${done} of ${total}`] : [];

async function People({ filters }: { filters: ChecklistFilters }) {
  const { checklists, page, pages, total } = await listChecklists(filters);
  const filtered = Boolean(filters.query || filters.kind || filters.overdue);
  if (!total) return filtered ? <EmptyState title="No matching checklists" description="Try a different name or clear the filters." /> : <EmptyState title="No open checklists" description="Start onboarding when you add an employee, or start offboarding from an active profile." />;
  return <>
    <p className="mb-3 text-[13px] text-muted tabular-nums">{total} open {total === 1 ? "checklist" : "checklists"}</p>
    <div className="grid gap-x-12 gap-y-9 lg:grid-cols-2">
      {workflowKinds.filter((kind) => !filters.kind || kind === filters.kind).map((kind) => {
        const matching = checklists.filter((checklist) => checklist.kind === kind);
        return <section key={kind}>
          <h2 className="border-b border-line pb-2 text-[15px] font-semibold">{statusLabels[kind]}</h2>
          {matching.length ? <ul className="divide-y divide-line">{matching.map((checklist) => {
            const details = [...part("Devices", checklist.devices), ...part("Apps", checklist.apps), ...part("Training", checklist.training)].join(", ");
            return <li key={checklist.id} className="py-4">
              <div className="flex items-start gap-3">
                <Avatar name={checklist.employeeName} />
                <div className="min-w-0 flex-1"><Link href={`/workspace/people/${checklist.employeeId}#checklist`} className="inline-flex min-h-8 items-center gap-2 rounded text-sm font-medium hover:text-accent underline-offset-4 hover:underline"><span className="wrap-anywhere">{checklist.employeeName}</span><ArrowRightIcon aria-hidden="true" size={14} className="shrink-0" /></Link><p className="text-xs wrap-anywhere text-muted">{checklist.title}</p></div>
                <Link href={`/workspace/lifecycle/${checklist.id}`} aria-label={`Plan tasks for ${checklist.firstName}`} className={`${textLink} inline-flex min-h-8 items-center text-[13px]`}>Plan tasks</Link>
              </div>
              <div className="mt-4 mb-2 flex flex-wrap justify-between gap-2 text-[13px] text-muted tabular-nums"><span>{kind === "onboarding" ? "Starts" : "Last day"} <time dateTime={checklist.targetDate}>{formatDate(checklist.targetDate)}</time></span><span className="flex gap-3">{checklist.overdue > 0 && <StatusText tone="danger">{checklist.overdue} overdue</StatusText>}<span>{checklist.completed} / {checklist.total} complete</span></span></div>
              <Meter value={checklist.total ? (checklist.completed / checklist.total) * 100 : 0} label={`${checklist.employeeName} checklist completion`} color={kind === "onboarding" ? "var(--signal)" : "var(--amber)"} />
              {details && <p className="mt-2 text-[13px] text-muted tabular-nums">{details}</p>}
            </li>;
          })}</ul> : <p className="py-3 text-sm text-muted">No {kind} checklists on this page.</p>}
        </section>;
      })}
    </div>
    <Pagination page={page} pages={pages} url={(next) => listUrl({ ...filters, page: next })} />
  </>;
}

async function Tasks({ filters }: { filters: ChecklistFilters }) {
  const [tasks, accounts] = await Promise.all([listOpenTasks(filters), listAccounts()]);
  if (!tasks.length) return <Empty>No open tasks match.</Empty>;
  return <ActionForm key={JSON.stringify(filters)} action={bulkTasksAction} submit="Change selected" pending="Changing…" confirm={{ title: "Change the selected tasks?", body: "Every task you ticked is changed at once. Completed tasks can be reopened from a profile.", action: "Change tasks" }}>
    <ul className="divide-y divide-line border-y border-line">{tasks.map((task) => <li key={task.id} className="flex items-start gap-3 py-2.5 text-sm">
      <input id={`task-${task.id}`} type="checkbox" name="task" value={task.id} className="mt-0.5 size-[18px] shrink-0 accent-(--primary)" />
      <label htmlFor={`task-${task.id}`} className="min-w-0 flex-1 wrap-anywhere"><span className="font-medium">{task.title}</span> <span className="block text-[13px] text-muted">{task.employeeName}, {statusLabels[task.kind].toLowerCase()}{task.assignee && `, ${task.assignee}`}</span></label>
      <StatusText tone={task.overdue ? "danger" : "muted"}>{task.dueOn ? `${task.overdue ? "Overdue, " : ""}${formatDate(task.dueOn)}` : "No date"}</StatusText>
    </li>)}</ul>
    {tasks.length === 200 && <p className="text-[13px] text-muted">Showing the first 200 tasks. Narrow the filters to see the rest.</p>}
    <div className="grid gap-4 sm:grid-cols-3"><Field name="operation" label="Change" required options={[{ value: "complete", label: "Mark as complete" }, { value: "assign", label: "Set who does it" }, { value: "due", label: "Set the due date" }]} /><Field name="assigneeId" label="Who does it" options={[{ value: "", label: "Nobody" }, ...accounts.map((account) => ({ value: account.id, label: account.name }))]} /><Field name="dueOn" label="Due date" type="date" /></div>
  </ActionForm>;
}

export default async function LifecyclePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const filters = checklistFilters(await searchParams);
  const first = { ...filters, page: 1 };
  const clear = listUrl({ query: "", kind: "", overdue: false, view: filters.view, page: 1 });
  return <>
    <PageHeader title="Employee lifecycle" description="Follow each open checklist from first day through departure." actions={<><Link href="/workspace/lifecycle/tasks" className={secondaryButton}>My tasks</Link><Link href="/workspace/people/new" className={primaryButton}><PlusIcon aria-hidden="true" size={15} weight="bold" /> Add employee</Link></>} />
    <SubNav label="Lifecycle" current={listUrl(first)} links={[{ href: listUrl({ ...first, view: "people" }), label: "By person" }, { href: listUrl({ ...first, view: "tasks" }), label: "All open tasks" }]} />
    <Filters label="Filter checklists" action="/workspace/lifecycle" hidden={{ view: filters.view === "tasks" ? "tasks" : "" }} clear={Boolean(filters.query || filters.kind || filters.overdue) && clear} fields={[
      { name: "q", label: "Search by person", value: filters.query, type: "search" },
      { name: "kind", label: "Checklist", value: filters.kind, options: [{ value: "", label: "Every checklist" }, ...workflowKinds.map((value) => ({ value, label: statusLabels[value] }))] },
      { name: "overdue", label: "Timing", value: filters.overdue ? "1" : "", options: [{ value: "", label: "Any time" }, { value: "1", label: "Overdue" }] },
    ]} />
    {filters.view === "tasks" ? <Tasks filters={first} /> : <People filters={filters} />}
  </>;
}
