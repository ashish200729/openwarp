import type { Metadata } from "next";
import Link from "next/link";
import { ActionButtons } from "@/components/workspace/action-form";
import { EmptyState, PageHeader } from "@/components/workspace/presentation";
import { formatTime } from "@/lib/people";
import { requireMember } from "@/lib/server/member";
import { listNotifications } from "@/lib/server/notify";
import { markReadAction } from "./actions";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const member = await requireMember();
  const notifications = await listNotifications(member);
  return <>
    <PageHeader title="Notifications" actions={notifications.some((entry) => entry.unread) && <ActionButtons action={markReadAction} hidden={{}} name="operation" buttons={[{ value: "read", label: "Mark all as read", describe: "Mark all as read" }]} />} />
    {notifications.length ? <ul className="max-w-3xl divide-y divide-line border-y border-line">{notifications.map((entry) => <li key={entry.id}><Link href={entry.href} className="group flex gap-3 py-3 text-sm">
      <span aria-hidden="true" className={`mt-1.5 size-2 shrink-0 rounded-full ${entry.unread ? "bg-signal" : "bg-transparent"}`} />
      <span className="min-w-0 flex-1"><span className={`block wrap-anywhere group-hover:underline ${entry.unread ? "font-semibold" : ""}`}>{entry.unread && <span className="sr-only">Unread: </span>}{entry.title}</span>{entry.body && <span className="block wrap-anywhere text-muted">{entry.body}</span>}</span>
      <time dateTime={entry.at.toISOString()} className="shrink-0 text-right text-[13px] text-muted">{formatTime(entry.at)} UTC</time>
    </Link></li>)}</ul> : <EmptyState title="Nothing yet" description="Approvals, requests and reminders for you will appear here." />}
  </>;
}
