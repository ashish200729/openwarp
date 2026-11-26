import type { Metadata } from "next";
import Link from "next/link";
import { CaretLeftIcon, CaretRightIcon } from "@/components/icons";
import { panelStyle, primaryButton, secondaryButton, textButton } from "@/components/ui";
import { ActionForm, Checkbox, Field } from "@/components/workspace/action-form";
import { Avatar, Callout, Empty, Notice, PageHeader, Section } from "@/components/workspace/presentation";
import { dateRange, TimeOffList } from "@/components/workspace/requests";
import { BalanceFigures, LeaveApprovals, RecordTimeOffForm } from "@/components/workspace/time-leave";
import { addDays, isoDate, today } from "@/lib/operations";
import { requireMember } from "@/lib/server/member";
import { listSchedulable } from "@/lib/server/schedule";
import { listHolidays, listTimeOffTypes } from "@/lib/server/settings";
import { listAbsences, ownTimeOff, pendingTimeOff, teamCoverage, timeOffBalances } from "@/lib/server/time-off";
import { cn } from "@/lib/utils";
import { decideTimeOffAction, requestTimeOffAction } from "../operations";
import { recordTimeOffAction } from "./actions";

export const metadata: Metadata = { title: "Time off" };

const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default async function TimeOffPage({ searchParams }: { searchParams: Promise<{ month?: string; new?: string; record?: string; person?: string; saved?: string }> }) {
  const member = await requireMember();
  const query = await searchParams;
  const day = today();
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(query.month ?? "") ? query.month! : day.slice(0, 7);
  const first = new Date(`${month}-01T00:00:00Z`);
  const last = isoDate(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  const gridStart = addDays(`${month}-01`, -((first.getUTCDay() + 6) % 7));
  const cells = Array.from({ length: Math.ceil((Number(last.slice(8)) + (first.getUTCDay() + 6) % 7) / 7) * 7 }, (_, index) => addDays(gridStart, index));
  const shift = (count: number) => isoDate(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + count, 1)).slice(0, 7);
  const decides = member.role === "admin" || member.managesPeople;
  const asking = query.new === "1" && Boolean(member.employeeId);
  const recording = query.record === "1" && member.role === "admin";
  const [absences, holidays, pending, own, balances, types, people] = await Promise.all([
    listAbsences(cells[0], cells.at(-1)!), listHolidays(cells[0]), decides ? pendingTimeOff(member) : [], ownTimeOff(member),
    member.employeeId ? timeOffBalances(member.employeeId, Number(day.slice(0, 4))) : [], asking || recording ? listTimeOffTypes() : [], recording ? listSchedulable(member) : [],
  ]);
  const coverage = await teamCoverage(member, pending);
  const holidayNames = new Map(holidays.map((holiday) => [holiday.day, holiday.name]));
  const monthAbsences = absences.filter((absence) => absence.startsOn <= last && absence.endsOn >= `${month}-01`);
  const title = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(first);

  return <>
    <PageHeader title="Time off" actions={<>
      {member.role === "admin" && !recording && <Link href="/workspace/time-off?record=1" className={secondaryButton}>Enter for someone</Link>}
      {member.employeeId && !asking && <Link href="/workspace/time-off?new=1" className={primaryButton}>Request time off</Link>}
    </>} />
    {query.saved === "requested" && <Notice>Request sent for approval.</Notice>}
    {query.saved === "recorded" && <Notice>Time off entered and approved.</Notice>}
    {!member.employeeId && <Callout>Your account isn’t linked to an employee record, so you can’t request time off. {member.role === "admin" ? <Link href="/workspace/settings/access" className="text-accent underline underline-offset-3">Link it in Access</Link> : "Ask an administrator to link it."}</Callout>}
    {asking && <section className={`${panelStyle} mb-8 max-w-2xl p-5`}>
      <h2 className="mb-4 text-[15px] font-semibold">Request time off</h2>
      <ActionForm action={requestTimeOffAction} submit="Send request" pending="Sending…" secondary={<Link href="/workspace/time-off" className={textButton}>Close</Link>}>
        <Field name="typeId" label="Type" required options={types.map((type) => ({ value: type.id, label: type.name }))} />
        <div className="grid gap-4 sm:grid-cols-2"><Field name="startsOn" label="First day" type="date" required defaultValue={day} /><Field name="endsOn" label="Last day off" type="date" required defaultValue={day} /></div>
        <Checkbox name="halfDay" label="Half day" hint="For a single date." />
        <Field name="note" label="Note" multiline maxLength={500} />
        <p className="text-[13px] text-muted">Weekends and company holidays aren’t counted.</p>
      </ActionForm>
    </section>}
    {recording && <RecordTimeOffForm action={recordTimeOffAction} people={people} types={types} person={query.person} day={day} />}
    {balances.length > 0 && <BalanceFigures balances={balances} />}
    {decides && <Section title="Waiting for approval" className="mb-9">{pending.length ? <LeaveApprovals requests={pending} coverage={coverage} action={decideTimeOffAction} /> : <Empty>No requests are waiting.</Empty>}</Section>}
    <Section title={title} className="mb-9" action={<div className="flex items-center gap-1.5">
      <Link href={`/workspace/time-off?month=${shift(-1)}`} aria-label="Previous month" className={cn(secondaryButton, "px-2.5")}><CaretLeftIcon aria-hidden="true" size={14} /></Link>
      <Link href="/workspace/time-off" className={secondaryButton}>Today</Link>
      <Link href={`/workspace/time-off?month=${shift(1)}`} aria-label="Next month" className={cn(secondaryButton, "px-2.5")}><CaretRightIcon aria-hidden="true" size={14} /></Link>
    </div>}>
      <table className="mt-3 hidden w-full table-fixed border border-line text-[13px] md:table">
        <caption className="sr-only">Approved time off in {title}</caption>
        <thead><tr>{weekdays.map((name) => <th key={name} scope="col" className="border-b border-line px-2 py-1.5 text-left font-medium text-muted">{name}</th>)}</tr></thead>
        <tbody>{Array.from({ length: cells.length / 7 }, (_, week) => <tr key={week}>
          {cells.slice(week * 7, week * 7 + 7).map((date, index) => {
            const away = absences.filter((absence) => absence.startsOn <= date && absence.endsOn >= date);
            const holiday = holidayNames.get(date);
            return <td key={date} className={cn("h-24 border border-line p-1.5 align-top", (index > 4 || holiday) && "bg-background")}>
              <span className={cn("inline-grid size-6 place-items-center rounded-full tabular-nums", date === day ? "bg-primary font-semibold text-primary-ink" : date.startsWith(month) ? "" : "text-hint")}>{Number(date.slice(8))}</span>
              {holiday && <span className="mt-0.5 block text-xs font-medium wrap-anywhere text-amber">{holiday}</span>}
              {index < 5 && !holiday && <>{away.slice(0, 2).map(absence => {
                const style = "mt-0.5 block truncate rounded bg-signal/12 px-1.5 text-xs leading-6 text-foreground";
                return absence.active || member.role === "admin" || absence.employeeId === member.employeeId
                  ? <Link key={absence.employeeId} href={`/workspace/people/${absence.employeeId}`} title={absence.name} className={cn(style, "hover:bg-signal/20")}>{absence.name}</Link>
                  : <span key={absence.employeeId} className={style} title={absence.name}>{absence.name}</span>;
              })}
                {away.length > 2 && <span className="mt-0.5 block px-1.5 text-xs text-muted">{away.length - 2} more</span>}</>}
            </td>;
          })}
        </tr>)}</tbody>
      </table>
      <ul className="divide-y divide-line md:hidden">
        {holidays.filter((holiday) => holiday.day.startsWith(month)).map((holiday) => <li key={holiday.day} className="flex justify-between gap-3 py-2.5 text-sm"><span className="font-medium text-amber">{holiday.name}</span><span className="text-[13px] text-muted">{dateRange(holiday.day, holiday.day)}</span></li>)}
        {monthAbsences.map((absence) => <li key={`${absence.employeeId}-${absence.startsOn}`} className="flex items-center gap-3 py-2.5 text-sm"><Avatar name={absence.name} size="small" /><span className="min-w-0 flex-1 wrap-anywhere">{absence.name}</span><span className="text-right text-[13px] text-muted">{dateRange(absence.startsOn, absence.endsOn)}</span></li>)}
        {!monthAbsences.length && <li><Empty>No approved time off this month.</Empty></li>}
      </ul>
    </Section>
    {member.employeeId && <Section title="Your requests">{own.length ? <TimeOffList requests={own} action={decideTimeOffAction} canCancel /> : <Empty>You haven’t requested time off.</Empty>}</Section>}
  </>;
}
