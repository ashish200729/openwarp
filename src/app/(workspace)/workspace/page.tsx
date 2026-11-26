import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { CaretRightIcon, PlusIcon } from "@/components/icons";
import { primaryButton, secondaryButton, textLink } from "@/components/ui";
import { HeadcountColumns } from "@/components/workspace/charts";
import { Avatar, Empty, EmptyState, Figure, FigureRow, PageHeader, Section } from "@/components/workspace/presentation";
import { PeopleList } from "@/components/workspace/people-list";
import { dateRange } from "@/components/workspace/requests";
import { addDays, formatDays, formatMoney, today } from "@/lib/operations";
import { formatDate } from "@/lib/people";
import { latestAnnouncements } from "@/lib/server/announcements";
import { listDocuments } from "@/lib/server/documents";
import { listOpenWorkflows, readOverview } from "@/lib/server/directory";
import { pendingExpenses } from "@/lib/server/expenses";
import { headcountByMonth, upcomingMoves } from "@/lib/server/insights";
import { requireMember } from "@/lib/server/member";
import { moduleTodos } from "@/lib/server/modules";
import { listAbsences, pendingTimeOff, timeOffBalances } from "@/lib/server/time-off";

export const metadata: Metadata = { title: "Home" };

function TodoList({ items }: { items: { key: string; href: string; title: string; detail: string; meta: string }[] }) {
  return <ul className="divide-y divide-line">
    {items.map((item) => <li key={item.key}><Link href={item.href} className="group flex min-h-12 items-center gap-3 py-2 text-sm">
      <span className="min-w-0 flex-1"><span className="block font-medium wrap-anywhere group-hover:underline">{item.title}</span><span className="block text-[13px] text-muted">{item.detail}</span></span>
      <span className="shrink-0 text-[13px] text-muted tabular-nums">{item.meta}</span><CaretRightIcon aria-hidden="true" size={13} className="shrink-0 text-hint" />
    </Link></li>)}
  </ul>;
}

export default async function HomePage() {
  const member = await requireMember();
  const canManage = member.role === "admin";
  const decides = canManage || member.managesPeople;
  const day = today();
  const [{ counts, people }, absences, timeOff, expenses, workflows, headcount, moves, balances, documents, modules, announcements] = await Promise.all([
    readOverview(member), listAbsences(day, addDays(day, 13)), decides ? pendingTimeOff(member) : [], decides ? pendingExpenses(member) : [],
    canManage ? listOpenWorkflows(1) : null, canManage ? headcountByMonth(12) : null, canManage ? upcomingMoves() : [],
    member.employeeId ? timeOffBalances(member.employeeId, Number(day.slice(0, 4))) : [], member.employeeId ? listDocuments(member) : [], moduleTodos(member), latestAnnouncements(member),
  ]);
  const count = (status: string) => counts.find((entry) => entry.status === status)?.count ?? 0;
  const outToday = absences.filter((absence) => absence.startsOn <= day && absence.endsOn >= day).length;
  const unread = documents.filter((document) => document.needsAcknowledgement && !document.acknowledged && (document.employeeId === null || document.employeeId === member.employeeId));
  const todos = [
    ...unread.map((document) => ({ key: document.id, href: "/workspace/documents", title: `Read ${document.name}`, detail: "Needs your acknowledgement", meta: "" })),
    ...timeOff.map((request) => ({ key: request.id, href: "/workspace/time-off", title: `${request.employeeName} requested ${request.typeName.toLowerCase()}`, detail: dateRange(request.startsOn, request.endsOn), meta: request.halfDay ? "Half day" : formatDays(request.days) })),
    ...expenses.map((expense) => ({ key: expense.id, href: "/workspace/expenses", title: `${expense.employeeName} submitted ${expense.merchant}`, detail: formatDate(expense.spentOn), meta: formatMoney(expense.amountCents, expense.currency) })),
    ...(workflows?.workflows ?? []).map((workflow) => ({ key: workflow.id, href: `/workspace/people/${workflow.employeeId}#checklist`, title: `${workflow.kind === "onboarding" ? "Onboard" : "Offboard"} ${workflow.employeeName}`, detail: `${workflow.kind === "onboarding" ? "Starts" : "Last day"} ${formatDate(workflow.targetDate)}`, meta: `${workflow.completed} of ${workflow.total}` })),
    ...modules,
  ].slice(0, 12);

  const figures: ReactNode = canManage ? <>
    <Figure label="People" value={count("active") + count("onboarding") + count("offboarding")} href="/workspace/people" />
    <Figure label="Onboarding" value={count("onboarding")} href="/workspace/people?status=onboarding" />
    <Figure label="Offboarding" value={count("offboarding")} href="/workspace/people?status=offboarding" />
    <Figure label="Out today" value={outToday} href="/workspace/time-off" />
  </> : <>
    {balances.filter((balance) => balance.allowance !== null).map((balance) => <Figure key={balance.typeId} label={`${balance.name} left`} value={formatDays(balance.allowance! - balance.used - balance.pending)} href="/workspace/time-off" />)}
    <Figure label="Active colleagues" value={count("active")} href="/workspace/people" />
    <Figure label="Out today" value={outToday} href="/workspace/time-off" />
  </>;

  return <>
    <PageHeader title="People overview" actions={canManage
      ? <Link href="/workspace/people/new" className={primaryButton}><PlusIcon aria-hidden="true" size={15} weight="bold" /> Add employee</Link>
      : member.employeeId && <Link href="/workspace/time-off?new=1" className={primaryButton}>Request time off</Link>} />
    <FigureRow>{figures}</FigureRow>
    {announcements.length > 0 && <Section title="Announcements" className="mb-9" action={<Link href="/workspace/announcements" className={`${textLink} text-[13px]`}>All announcements</Link>}><ul className="divide-y divide-line">{announcements.map((entry) => <li key={entry.id}><Link href="/workspace/announcements" className="group flex items-baseline justify-between gap-4 py-2.5 text-sm"><span className="font-medium wrap-anywhere group-hover:underline">{entry.title}</span><span className="shrink-0 text-[13px] text-muted">{entry.needsAcknowledgement && !entry.acknowledged ? "Needs your acknowledgement" : formatDate(entry.publishOn)}</span></Link></li>)}</ul></Section>}
    <div className="grid gap-x-12 gap-y-9 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      {(decides || member.employeeId) && <Section title="To do">{todos.length ? <TodoList items={todos} /> : <Empty>Nothing is waiting on you.</Empty>}</Section>}
      <div className="grid content-start gap-9">
        {headcount && <Section title="Headcount, last 12 months" action={<Link href="/workspace/reports" className={`${textLink} text-[13px]`}>Reports</Link>}><div className="pt-4"><HeadcountColumns data={headcount} label="Headcount at the end of each month." /></div></Section>}
        <Section title="Away in the next two weeks" action={<Link href="/workspace/time-off" className={`${textLink} text-[13px]`}>Calendar</Link>}>
          {absences.length ? <ul className="divide-y divide-line">{absences.slice(0, 6).map((absence) => <li key={`${absence.employeeId}-${absence.startsOn}`} className="flex items-center gap-3 py-2 text-sm"><Avatar name={absence.name} size="small" /><span className="min-w-0 flex-1 wrap-anywhere">{absence.name}</span><span className="text-right text-[13px] text-muted">{dateRange(absence.startsOn, absence.endsOn)}</span></li>)}</ul> : <Empty>No approved time off.</Empty>}
        </Section>
        {moves.length > 0 && <Section title="Joining and leaving"><ul className="divide-y divide-line">{moves.map((move) => <li key={move.id}><Link href={`/workspace/people/${move.id}`} className="flex items-center gap-3 py-2 text-sm hover:underline"><Avatar name={move.name} size="small" /><span className="min-w-0 flex-1 wrap-anywhere">{move.name}</span><span className="text-[13px] text-muted">{move.kind === "start" ? "Starts" : "Leaves"} {formatDate(move.date)}</span></Link></li>)}</ul></Section>}
      </div>
    </div>
    <Section title="People directory" className="mt-10" action={<Link href="/workspace/people" className={`${textLink} text-[13px]`}>View all people</Link>}>
      {people.length ? <PeopleList people={people} /> : <div className="pt-4"><EmptyState title="No employees yet" description={canManage ? "Add people one at a time, or import a CSV file." : "Active employees will appear here when an administrator adds them."} action={canManage && <Link href="/workspace/people/import" className={secondaryButton}>Import CSV</Link>} /></div>}
    </Section>
  </>;
}
