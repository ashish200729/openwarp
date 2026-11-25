import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { secondaryButton } from "@/components/ui";
import { ActivityList } from "@/components/workspace/activity-list";
import { EmptyState, PageHeader } from "@/components/workspace/presentation";
import { activityCursor, listActivity } from "@/lib/server/directory";
import { requireAdmin } from "@/lib/server/member";

export const metadata: Metadata = { title: "Activity" };

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  await requireAdmin();
  const before = activityCursor((await searchParams).before);
  const { entries, next } = await listActivity({ before });
  return <>
    <PageHeader title="Activity" description="Review changes to employees, teams, checklists, directory exports, and operator-managed accounts." />
    {entries.length ? <ActivityList entries={entries} /> : <EmptyState title="No more activity" description="Changes recorded for this workspace will appear here." />}
    {(before || next) && <nav aria-label="Activity history" className="mt-4 flex flex-wrap justify-end gap-2">
      {before && <Link className={secondaryButton} href="/workspace/activity">Latest activity</Link>}
      {next && <Link className={secondaryButton} href={`/workspace/activity?before=${next}`}>Older activity <ChevronRight aria-hidden="true" size={15} /></Link>}
    </nav>}
  </>;
}
