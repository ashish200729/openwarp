import type { Metadata } from "next";
import Link from "next/link";
import { secondaryButton } from "@/components/ui";
import { Avatar, Callout, Empty, Notice, PageHeader, Section } from "@/components/workspace/presentation";
import { TimeClock } from "@/components/workspace/time-clock";
import { SheetView } from "@/components/workspace/time-sheet";
import { entryNotices, formatMinutes, formatWeekday, parseWeek, timesheetUrl } from "@/lib/domains/time";
import { requireMember } from "@/lib/server/member";
import { companyToday, pendingSheets, readRunning, readSheet, readTimeSettings } from "@/lib/server/timesheets";
import { clockAction, removeEntryAction, saveEntryAction, sheetAction } from "./actions";

export const metadata: Metadata = { title: "Timesheets" };

export default async function TimesheetsPage({ searchParams }: { searchParams: Promise<{ week?: string; new?: string; edit?: string; saved?: string }> }) {
  const member = await requireMember();
  const query = await searchParams;
  const decides = member.role === "admin" || member.managesPeople;
  const week = parseWeek(query.week, await companyToday());
  const [settings, running, sheet, pending] = await Promise.all([readTimeSettings(), readRunning(member), member.employeeId ? readSheet(member, member.employeeId, week) : null, decides ? pendingSheets(member) : []]);
  const time = (value: Date) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: settings.timeZone }).format(value);
  return <>
    <PageHeader title="Timesheets" description={`Times are in the company time zone, ${settings.timeZone.replaceAll("_", " ")}.`} actions={decides && <Link href="/workspace/timesheets/team" className={secondaryButton}>Team timesheets</Link>} />
    {query.saved && entryNotices[query.saved] && <Notice>{entryNotices[query.saved]}</Notice>}
    {!member.employeeId && <Callout>Your account isn’t linked to an employee record, so you can’t track time. {member.role === "admin" ? <Link href="/workspace/settings/access" className="text-accent underline underline-offset-3">Link it in Access</Link> : "Ask an administrator to link it."}</Callout>}
    {!settings.tracking && <Callout>Time tracking is turned off. {member.role === "admin" ? <Link href="/workspace/settings/time" className="text-accent underline underline-offset-3">Turn it on in settings</Link> : "Earlier timesheets stay readable."}</Callout>}
    {member.employeeId && (settings.tracking || running) && <Section title="Time clock" className="mb-8">
      <TimeClock action={clockAction} running={running && { startedAt: running.startedAt.toISOString(), breakStartedAt: running.breakStartedAt?.toISOString() ?? null, breakMinutes: running.breakMinutes, now: running.now.toISOString() }}
        since={running ? running.breakStartedAt ? `On a break since ${time(running.breakStartedAt)}. Clocked in ${formatWeekday(running.day)} at ${time(running.startedAt)}.` : `Clocked in ${formatWeekday(running.day)} at ${time(running.startedAt)}.` : ""} />
    </Section>}
    {decides && <Section title="Waiting for approval" className="mb-8">{pending.length ? <ul className="divide-y divide-line">
      {pending.map((row) => <li key={`${row.employeeId}-${row.week}`}><Link href={timesheetUrl(row.employeeId, row.week)} className="group flex min-h-12 items-center gap-3 py-2 text-sm"><Avatar name={row.name} /><span className="min-w-0 flex-1"><span className="block font-medium wrap-anywhere group-hover:underline">{row.name}</span><span className="block text-[13px] text-muted">Week of {formatWeekday(row.week)}</span></span>
        <span className="text-right tabular-nums">{formatMinutes(row.regular + row.overtime)}{row.overtime > 0 && <span className="block text-[13px] text-amber">{formatMinutes(row.overtime)} overtime</span>}</span></Link></li>)}
    </ul> : <Empty>No timesheets are waiting.</Empty>}</Section>}
    {sheet && <SheetView sheet={sheet} own canEdit canDecide={member.role === "admin"} canReopen={member.role === "admin"} path="/workspace/timesheets" query={query} actions={{ save: saveEntryAction, remove: removeEntryAction, command: sheetAction }} />}
  </>;
}
