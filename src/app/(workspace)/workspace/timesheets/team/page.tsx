import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DownloadSimpleIcon } from "@/components/icons";
import { inputStyle, secondaryButton, tableBody, tableHead } from "@/components/ui";
import { BackLink, Empty, PageHeader, Section } from "@/components/workspace/presentation";
import { dateRange } from "@/components/workspace/requests";
import { SheetStatus, WeekNavigation } from "@/components/workspace/time-sheet";
import { formatMinutes, formatWeekday, parseWeek, sheetLabels, sheetStates, timesheetUrl, type SheetState } from "@/lib/domains/time";
import { addDays } from "@/lib/operations";
import { listTeams } from "@/lib/server/directory";
import { requireMember } from "@/lib/server/member";
import { companyToday, listWeek } from "@/lib/server/timesheets";

export const metadata: Metadata = { title: "Team timesheets" };

export default async function TeamTimesheetsPage({ searchParams }: { searchParams: Promise<{ week?: string; state?: string; team?: string; q?: string }> }) {
  const member = await requireMember();
  const admin = member.role === "admin";
  if (!admin && !member.managesPeople) notFound();
  const query = await searchParams;
  const week = parseWeek(query.week, await companyToday());
  const state = sheetStates.includes(query.state as SheetState) ? query.state as SheetState : "all";
  const teamId = typeof query.team === "string" ? query.team.slice(0, 36) : "";
  const search = typeof query.q === "string" ? query.q.trim().slice(0, 120) : "";
  const [rows, teams] = await Promise.all([listWeek(member, week, { state, teamId, query: search }), admin ? listTeams(member) : []]);
  const filtered = state !== "all" || teamId || search;
  const params = new URLSearchParams();
  if (state !== "all") params.set("state", state);
  if (teamId) params.set("team", teamId);
  if (search) params.set("q", search);
  const days = Array.from({ length: 7 }, (_, index) => addDays(week, index));
  return <>
    <BackLink href="/workspace/timesheets">Timesheets</BackLink>
    <PageHeader title="Team timesheets" description={admin ? "Everyone who tracks time." : "Your direct reports who track time."} actions={admin && <a href={`/workspace/timesheets/export?week=${week}`} className={secondaryButton}><DownloadSimpleIcon aria-hidden="true" size={15} /> Export CSV</a>} />
    <form key={`${week}-${params}`} method="get" action="/workspace/timesheets/team" role="search" className="mb-5 flex flex-wrap items-end gap-3">
      <input type="hidden" name="week" value={week} />
      <div className="w-full min-w-0 sm:w-56"><label htmlFor="sheet-search" className="mb-2 block text-[13px] font-medium text-muted">Search people</label><input id="sheet-search" type="search" name="q" maxLength={120} defaultValue={search} className={inputStyle} placeholder="Name or email" /></div>
      <div className="min-w-0 grow sm:max-w-52"><label htmlFor="sheet-state" className="mb-2 block text-[13px] font-medium text-muted">Status</label><select id="sheet-state" name="state" defaultValue={state} className={inputStyle}><option value="all">All statuses</option>{sheetStates.map((value) => <option key={value} value={value}>{sheetLabels[value]}</option>)}</select></div>
      {admin && <div className="min-w-0 grow sm:max-w-48"><label htmlFor="sheet-team" className="mb-2 block text-[13px] font-medium text-muted">Team</label><select id="sheet-team" name="team" defaultValue={teamId} className={inputStyle}><option value="">All teams</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></div>}
      <button type="submit" className={secondaryButton}>Apply filters</button>
      {filtered && <Link href={`/workspace/timesheets/team?week=${week}`} className="inline-flex min-h-11 items-center rounded text-sm text-accent underline-offset-4 hover:underline">Clear filters</Link>}
    </form>
    <Section title={dateRange(week, addDays(week, 6))} action={<WeekNavigation path="/workspace/timesheets/team" week={week} query={params.size ? `&${params}` : ""} />}>
      {rows.length ? <>
        <div className="hidden overflow-x-auto md:block" tabIndex={0} role="region" aria-label="Team timesheets for the week"><table className="w-full">
          <caption className="sr-only">Hours by person and day, week of {formatWeekday(week)}</caption>
          <thead className={tableHead}><tr><th scope="col">Person</th>{days.map((day) => <th key={day} scope="col" className="text-right whitespace-nowrap">{formatWeekday(day).split(",")[0]}</th>)}<th scope="col" className="text-right">Overtime</th><th scope="col" className="text-right">Total</th><th scope="col">Status</th></tr></thead>
          <tbody className={tableBody}>{rows.map((row) => <tr key={row.employeeId}><th scope="row"><Link href={timesheetUrl(row.employeeId, week)} className="font-medium hover:underline">{row.name}</Link>{row.running && <span className="block text-[13px] text-positive">Clocked in</span>}</th>
            {row.days.map((day) => <td key={day.day} className="text-right tabular-nums">{day.regular + day.overtime ? formatMinutes(day.regular + day.overtime) : <span className="text-hint">0h</span>}</td>)}
            <td className={row.overtime ? "text-right text-amber tabular-nums" : "text-right text-hint tabular-nums"}>{formatMinutes(row.overtime)}</td><td className="text-right font-medium tabular-nums">{formatMinutes(row.regular + row.overtime)}</td><td><SheetStatus state={row.state} /></td></tr>)}</tbody>
        </table></div>
        <ul className="divide-y divide-line md:hidden">{rows.map((row) => <li key={row.employeeId}><Link href={timesheetUrl(row.employeeId, week)} className="flex min-h-12 items-center justify-between gap-4 py-2 text-sm"><span className="min-w-0"><span className="block font-medium wrap-anywhere">{row.name}</span><SheetStatus state={row.state} /></span><span className="text-right tabular-nums">{formatMinutes(row.regular + row.overtime)}{row.overtime > 0 && <span className="block text-[13px] text-amber">{formatMinutes(row.overtime)} overtime</span>}</span></Link></li>)}</ul>
      </> : <Empty>{filtered ? "No timesheets match these filters." : "No one tracks time this week. Hourly people are listed once their pay is recorded."}</Empty>}
    </Section>
  </>;
}
