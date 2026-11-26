import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon } from "@/components/icons";
import { panelStyle, primaryButton, textButton } from "@/components/ui";
import { Empty, PageHeader, Section } from "@/components/workspace/presentation";
import { NoticeForm, NoticeStatus } from "@/components/workspace/workplace-compliance";
import { StatusText } from "@/components/workspace/workplace-parts";
import { formatDate } from "@/lib/people";
import { listAdmins, listNotices, listObligations, type NoticeRow } from "@/lib/server/compliance";
import { requireAdmin } from "@/lib/server/member";
import { complianceDescription, ComplianceNav } from "../nav";

export const metadata: Metadata = { title: "Compliance notices" };

function Notices({ notices }: { notices: NoticeRow[] }) {
  return <ul className="divide-y divide-line">{notices.map((notice) => <li key={notice.id}><Link href={`/workspace/compliance/notices/${notice.id}`} className="group flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-3 text-sm">
    <span className="min-w-0"><span className="block font-medium wrap-anywhere group-hover:underline">{notice.title}</span><span className="block text-[13px] wrap-anywhere text-muted">{[notice.authority, `received ${formatDate(notice.receivedOn)}`, notice.assignee ?? "", notice.files ? `${notice.files} ${notice.files === 1 ? "file" : "files"}` : ""].filter(Boolean).join(", ")}</span></span>
    <span className="flex flex-wrap items-center gap-x-4">{notice.deadlineOn && <StatusText tone={notice.overdue ? "danger" : "muted"}>{notice.overdue ? "Overdue, " : "Deadline "}{formatDate(notice.deadlineOn)}</StatusText>}<NoticeStatus state={notice.state} /></span>
  </Link></li>)}</ul>;
}

export default async function NoticesPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  await requireAdmin();
  const adding = (await searchParams).new === "1";
  const [open, closed, admins, obligations] = await Promise.all([listNotices(false), listNotices(true), adding ? listAdmins() : [], adding ? listObligations() : []]);
  return <>
    <PageHeader title="Compliance notices" description={complianceDescription} actions={!adding && <Link href="/workspace/compliance/notices?new=1" className={primaryButton}><PlusIcon aria-hidden="true" size={15} weight="bold" /> Record notice</Link>} />
    <ComplianceNav current="/notices" />
    {adding && <section className={`${panelStyle} mb-8 max-w-3xl p-5`}><h2 className="mb-4 text-[15px] font-semibold">Record a notice</h2><NoticeForm admins={admins} obligations={obligations} cancel={<Link href="/workspace/compliance/notices" className={textButton}>Close</Link>} /></section>}
    <Section title="Open" className="mb-9">{open.length ? <Notices notices={open} /> : <Empty>No notices are open.</Empty>}</Section>
    {closed.length > 0 && <Section title="Closed"><Notices notices={closed} /></Section>}
  </>;
}
