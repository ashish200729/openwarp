import type { Metadata } from "next";
import Link from "next/link";
import { CaretRightIcon, DownloadSimpleIcon } from "@/components/icons";
import { secondaryButton } from "@/components/ui";
import { ActivityList } from "@/components/workspace/activity-list";
import { EmptyState, PageHeader } from "@/components/workspace/presentation";
import { Filters } from "@/components/workspace/workplace-parts";
import { activityCursor } from "@/lib/server/directory";
import { activityActors, activityGroups, searchActivity } from "@/lib/server/insights";
import { requireAdmin } from "@/lib/server/member";
import { activityFilters, activityUrl } from "./filters";

export const metadata: Metadata = { title: "Activity" };

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const params = await searchParams;
  const before = activityCursor(params.before);
  const filters = activityFilters(params);
  const filtered = Object.values(filters).some(Boolean);
  const [{ entries, next }, actors] = await Promise.all([searchActivity(filters, before), activityActors()]);
  return <>
    <PageHeader title="Activity" description="Review changes to employees, requests, records, exports and accounts." actions={<a href={activityUrl(filters, "/workspace/activity/export")} className={secondaryButton}><DownloadSimpleIcon aria-hidden="true" size={15} /> Export CSV</a>} />
    <Filters label="Filter activity" action="/workspace/activity" clear={filtered && "/workspace/activity"} fields={[
      { name: "person", label: "About", value: filters.person, type: "search", className: "sm:min-w-40" },
      { name: "actor", label: "Done by", value: filters.actor, options: [{ value: "", label: "Anyone" }, ...actors.map((actor) => ({ value: actor.id, label: actor.name }))] },
      { name: "group", label: "Kind", value: filters.group, options: [{ value: "", label: "Every kind" }, ...activityGroups] },
      { name: "from", label: "From", value: filters.from, type: "date" }, { name: "to", label: "To", value: filters.to, type: "date" },
    ]} />
    {entries.length ? <ActivityList entries={entries} /> : <EmptyState title={filtered ? "No matching activity" : "No more activity"} description={filtered ? "Try a different person, kind or date range." : "Changes recorded for this workspace will appear here."} />}
    {(before || next) && <nav aria-label="Activity history" className="mt-4 flex flex-wrap justify-end gap-2">
      {before && <Link className={secondaryButton} href={activityUrl(filters)}>Latest activity</Link>}
      {next && <Link className={secondaryButton} href={activityUrl(filters, "/workspace/activity", next)}>Older activity <CaretRightIcon aria-hidden="true" size={15} /></Link>}
    </nav>}
  </>;
}
