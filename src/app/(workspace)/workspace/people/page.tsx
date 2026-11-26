import type { Metadata } from "next";
import Link from "next/link";
import { DownloadSimpleIcon, UploadSimpleIcon, MagnifyingGlassIcon, PlusIcon } from "@/components/icons";
import { inputStyle, primaryButton, secondaryButton } from "@/components/ui";
import { PeopleList } from "@/components/workspace/people-list";
import { EmptyState, Notice, PageHeader, Pagination } from "@/components/workspace/presentation";
import { directoryUrl, employeeFilters, statusLabels, statuses } from "@/lib/people";
import { listEmployees, listTeams } from "@/lib/server/directory";
import { requireMember } from "@/lib/server/member";

export const metadata: Metadata = { title: "People" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function PeoplePage({ searchParams }: Props) {
  const member = await requireMember();
  const canManage = member.role === "admin";
  const params = await searchParams;
  const filters = employeeFilters(params, canManage);
  const imported = canManage && typeof params.imported === "string" && /^\d{1,4}$/.test(params.imported) ? Number(params.imported) : 0;
  const [{ employees, total, page, pages }, teams] = await Promise.all([listEmployees(member, filters), listTeams(member)]);
  const hasFilters = Boolean(filters.query || filters.teamId || filters.status !== "current");

  return <>
    <PageHeader title="People directory" description={canManage ? "Find employees, update work details, and manage reporting lines." : "Find active employees and their work details."} actions={canManage && <>
      <a href={directoryUrl(filters, "/workspace/people/export")} className={secondaryButton}><DownloadSimpleIcon aria-hidden="true" size={15} /> Export CSV</a>
      <Link href="/workspace/people/import" className={secondaryButton}><UploadSimpleIcon aria-hidden="true" size={15} /> Import CSV</Link>
      <Link href="/workspace/people/new" className={primaryButton}><PlusIcon aria-hidden="true" size={15} weight="bold" /> Add employee</Link>
    </>} />
    {imported > 0 && <Notice>{imported} {imported === 1 ? "person" : "people"} imported.</Notice>}
    <form key={directoryUrl({ ...filters, page: 1 })} method="get" action="/workspace/people" role="search" className="mb-5 flex flex-wrap items-end gap-3">
      <div className="w-full min-w-0 sm:w-auto sm:min-w-48 sm:flex-1">
        <label htmlFor="people-search" className="mb-2 block text-[13px] font-medium text-muted">Search people</label>
        <div className="relative">
          <MagnifyingGlassIcon aria-hidden="true" size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-hint" />
          <input id="people-search" type="search" name="q" maxLength={120} className={`${inputStyle} pl-9`} defaultValue={filters.query} placeholder="Name, email, title…" />
        </div>
      </div>
      <div className="min-w-0 grow sm:max-w-48">
        <label htmlFor="people-team" className="mb-2 block text-[13px] font-medium text-muted">Team</label>
        <select id="people-team" name="team" className={inputStyle} defaultValue={filters.teamId}><option value="">All teams</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select>
      </div>
      {canManage && <div className="min-w-0 grow sm:max-w-44">
        <label htmlFor="people-status" className="mb-2 block text-[13px] font-medium text-muted">Status</label>
        <select id="people-status" name="status" className={inputStyle} defaultValue={filters.status}><option value="current">Current</option>{statuses.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select>
      </div>}
      <button className={secondaryButton} type="submit">Apply filters</button>
      {hasFilters && <Link className="inline-flex min-h-11 items-center rounded text-sm text-accent underline-offset-4 hover:underline" href="/workspace/people">Clear filters</Link>}
    </form>
    <p className="mb-2.5 text-[13px] text-muted tabular-nums">{new Intl.NumberFormat("en").format(total)} {total === 1 ? "employee" : "employees"}</p>
    {employees.length ? <>
      <PeopleList people={employees} />
      <Pagination page={page} pages={pages} url={(nextPage) => directoryUrl({ ...filters, page: nextPage })} />
    </> : <EmptyState title={hasFilters ? "No matching employees" : "Your directory is empty"} description={hasFilters ? "Try a different name, team, or status." : canManage ? "Add your first employee to start using the directory." : "Active employees will appear here when an administrator adds them."} action={hasFilters
      ? <Link className={secondaryButton} href="/workspace/people">Clear filters</Link>
      : canManage && <Link className={primaryButton} href="/workspace/people/new"><PlusIcon aria-hidden="true" size={16} /> Add employee</Link>} />}
  </>;
}
