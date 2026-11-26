import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { BackLink, Notice, PageHeader } from "@/components/workspace/presentation";
import { SheetView } from "@/components/workspace/time-sheet";
import { entryNotices, parseWeek } from "@/lib/domains/time";
import { requireMember } from "@/lib/server/member";
import { companyToday, readSheet } from "@/lib/server/timesheets";
import { removeEntryAction, saveEntryAction, sheetAction } from "../actions";

export const metadata: Metadata = { title: "Timesheet" };

export default async function TimesheetPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ week?: string; new?: string; edit?: string; saved?: string }> }) {
  const member = await requireMember();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(id).success) notFound();
  const week = parseWeek(query.week, await companyToday());
  if (member.employeeId === id) redirect(`/workspace/timesheets?week=${week}`);
  const sheet = await readSheet(member, id, week);
  if (!sheet) notFound();
  const admin = member.role === "admin";
  return <>
    <BackLink href={`/workspace/timesheets/team?week=${week}`}>Team timesheets</BackLink>
    <PageHeader title={sheet.employeeName} description={sheet.title} />
    {query.saved && entryNotices[query.saved] && <Notice>{entryNotices[query.saved]}</Notice>}
    <SheetView sheet={sheet} own={false} canEdit={admin} canDecide canReopen={admin} path={`/workspace/timesheets/${id}`} query={query} actions={{ save: saveEntryAction, remove: removeEntryAction, command: sheetAction }} />
  </>;
}
