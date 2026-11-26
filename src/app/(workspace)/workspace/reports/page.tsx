import type { Metadata } from "next";
import Link from "next/link";
import { CaretDownIcon } from "@/components/icons";
import { textLink } from "@/components/ui";
import { ActionButtons, ActionForm, Field } from "@/components/workspace/action-form";
import { Bars, HeadcountColumns } from "@/components/workspace/charts";
import { Empty, Figure, FigureRow, PageHeader, Section } from "@/components/workspace/presentation";
import { DataTable, ExportLink, Filters, SubNav } from "@/components/workspace/workplace-parts";
import { reportViewLabels, reportViews, roleStatuses, roleStatusLabels, type ReportFilters, type ReportView } from "@/lib/domains/workplace";
import { employmentLabels, employmentTypes, formatDate } from "@/lib/people";
import { listTeams } from "@/lib/server/directory";
import { headcountBetween, workforceBreakdown } from "@/lib/server/insights";
import { requireAdmin } from "@/lib/server/member";
import { listLocations, listPlannedRoles, listViews, reportFilters, reportQuery, reportTables, reportView, type Table } from "@/lib/server/reports";
import { removeViewAction, savePlannedRoleAction, saveViewAction } from "./actions";

export const metadata: Metadata = { title: "Reports" };

const url = (query: string) => query ? `/workspace/reports?${query}` : "/workspace/reports";

async function Headcount({ filters }: { filters: ReportFilters }) {
  const [months, { types, locations, teams, tenure }] = await Promise.all([headcountBetween(filters.from, filters.to, filters), workforceBreakdown(filters)]);
  const total = types.reduce((sum, entry) => sum + entry.people, 0);
  const joined = months.reduce((sum, entry) => sum + entry.joined, 0);
  const left = months.reduce((sum, entry) => sum + entry.left, 0);
  const average = months.length ? months.reduce((sum, entry) => sum + entry.people, 0) / months.length : 0;
  return <>
    <FigureRow><Figure label="People" value={total} /><Figure label="Joined" value={joined} /><Figure label="Left" value={left} /><Figure label="Turnover" value={average ? `${Math.round(left / average * 100)}%` : "0%"} /><Figure label="Average tenure" value={tenure === null ? "None" : `${tenure.toFixed(1)} years`} /></FigureRow>
    <Section title="Headcount by month" className="mb-9">{months.length ? <div className="pt-4"><HeadcountColumns data={months} label="Headcount at the end of each month." /></div> : <Empty>The date range hasn’t started yet.</Empty>}</Section>
    <div className="mb-9 grid gap-x-12 gap-y-9 lg:grid-cols-2">
      <Section title="By team"><Bars total={total} rows={teams.slice(0, 8).map((team) => ({ label: team.team, value: team.people }))} /></Section>
      <div className="grid content-start gap-9"><Section title="By employment type"><Bars total={total} rows={types.map((entry) => ({ label: employmentLabels[entry.type], value: entry.people }))} /></Section>
        <Section title="By location"><Bars total={total} rows={locations.map((entry) => ({ label: entry.location, value: entry.people }))} /></Section></div>
    </div>
  </>;
}

async function Roles({ filters, teams }: { filters: ReportFilters; teams: { id: string; name: string }[] }) {
  const roles = await listPlannedRoles(filters);
  const teamOptions = [{ value: "", label: "No team" }, ...teams.map((team) => ({ value: team.id, label: team.name }))];
  const statusOptions = roleStatuses.map((value) => ({ value, label: roleStatusLabels[value] }));
  return <Section title="Edit planned roles" className="mb-9">
    {roles.length > 0 && <ul className="divide-y divide-line">{roles.map((role) => <li key={role.id}><details className="group">
      <summary className="flex min-h-12 flex-wrap items-center justify-between gap-x-6 gap-y-1 rounded py-1 text-sm focus-visible:outline-offset-[-2px]"><span className="min-w-0 font-medium wrap-anywhere">{role.title} <span className="font-normal text-muted">· {role.teamName ?? "No team"}, {formatDate(role.targetStart)}</span></span><span className="flex items-center gap-3 text-muted">{roleStatusLabels[role.status]}<CaretDownIcon aria-hidden="true" size={13} className="text-hint group-open:rotate-180" /></span></summary>
      <ActionForm key={role.version} action={savePlannedRoleAction} submit="Save role" variant="secondary" hidden={{ id: role.id, version: role.version }} className="pt-1 pb-5"><div className="grid gap-4 sm:grid-cols-2"><Field name="title" label="Job title" required maxLength={120} defaultValue={role.title} /><Field name="teamId" label="Team" required defaultValue={role.teamId ?? ""} options={role.teamId && !teams.some((team) => team.id === role.teamId) ? [...teamOptions, { value: role.teamId, label: role.teamName ?? "Archived team" }] : teamOptions} /><Field name="targetStart" label="Target start" type="date" required defaultValue={role.targetStart} /><Field name="status" label="Status" required defaultValue={role.status} options={statusOptions} /></div></ActionForm>
    </details></li>)}</ul>}
    <ActionForm action={savePlannedRoleAction} submit="Add role" variant="secondary" className="border-t border-line pt-4"><h3 className="text-sm font-semibold">New planned role</h3><div className="grid gap-4 sm:grid-cols-2"><Field name="title" label="Job title" required maxLength={120} /><Field name="teamId" label="Role team" required options={teamOptions} /><Field name="targetStart" label="Target start" type="date" required /><Field name="status" label="Role status" required options={statusOptions} /></div></ActionForm>
  </Section>;
}

function ReportTables({ tables, view, query }: { tables: Table[]; view: ReportView; query: string }) {
  return <div className="grid gap-9">{tables.map((table) => {
    const params = new URLSearchParams(query);
    params.set("view", view);
    params.set("table", table.id);
    return <Section key={table.id} title={table.title} action={table.rows.length > 0 && <ExportLink href={`/workspace/reports/export?${params}`} label={table.title} />}>
      <DataTable caption={table.caption} columns={table.columns} rows={table.rows} numeric={table.numeric} empty="Nothing matches these filters." />
      {table.note && <p className="mt-2 max-w-[75ch] text-[13px] text-muted">{table.note}</p>}
    </Section>;
  })}</div>;
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const member = await requireAdmin();
  const params = await searchParams;
  const view = reportView(params.view);
  const filters = reportFilters(params);
  const query = reportQuery(view, filters);
  const [tables, teams, locations, saved] = await Promise.all([reportTables(view, filters), listTeams(member), listLocations(), listViews(member)]);
  const narrowed = query !== reportQuery(view, reportFilters({}));
  return <>
    <PageHeader title="Reports" description="Calculated from what is recorded here: start dates, last days, requests and current profiles." />
    <SubNav label="Reports" current={url(query)} links={reportViews.map((value) => ({ href: url(reportQuery(value, filters)), label: reportViewLabels[value] }))} />
    <Filters label="Filter report" action="/workspace/reports" hidden={{ view: view === "headcount" ? "" : view }} clear={narrowed && url(reportQuery(view, reportFilters({})))} fields={[
      { name: "team", label: "Team", value: filters.teamId, options: [{ value: "", label: "All teams" }, ...teams.map((team) => ({ value: team.id, label: team.name }))] },
      { name: "location", label: "Location", value: filters.location, options: [{ value: "", label: "All locations" }, ...locations.map((value) => ({ value, label: value }))] },
      { name: "type", label: "Employment type", value: filters.type, options: [{ value: "", label: "All types" }, ...employmentTypes.map((value) => ({ value, label: employmentLabels[value] }))] },
      { name: "from", label: "From", value: filters.from, type: "date" }, { name: "to", label: "To", value: filters.to, type: "date" },
    ]} />
    {view === "headcount" && <Headcount filters={filters} />}
    <ReportTables tables={tables} view={view} query={query} />
    {view === "plan" && <div className="mt-9"><Roles filters={filters} teams={teams} /></div>}
    <Section title="Saved views" className="mt-10 max-w-3xl">
      {saved.length ? <ul className="divide-y divide-line">{saved.map((entry) => <li key={entry.id} className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 text-sm"><Link href={url(entry.query)} className={`${textLink} min-w-0 wrap-anywhere`}>{entry.name}</Link><ActionButtons action={removeViewAction} hidden={{ id: entry.id }} name="operation" buttons={[{ value: "remove", label: "Remove", describe: `Remove view ${entry.name}`, variant: "text", confirm: { title: `Remove ${entry.name}?`, body: "Only your saved view is removed.", action: "Remove view", danger: true } }]} /></li>)}</ul> : <Empty>No saved views. Choose filters, then save them here. Only you see your views.</Empty>}
      <ActionForm action={saveViewAction} submit="Save this view" variant="secondary" hidden={{ query }} inline className="border-t border-line pt-4"><Field name="name" label="View name" required maxLength={60} wrapperClass="w-full sm:w-64" /></ActionForm>
    </Section>
  </>;
}
