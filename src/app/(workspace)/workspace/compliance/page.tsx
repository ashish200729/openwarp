import type { Metadata } from "next";
import Link from "next/link";
import { DownloadSimpleIcon, PlusIcon } from "@/components/icons";
import { primaryButton, secondaryButton } from "@/components/ui";
import { Empty, EmptyState, Figure, FigureRow, PageHeader, Section } from "@/components/workspace/presentation";
import { Filters, StatusText } from "@/components/workspace/workplace-parts";
import { obligationCategories, obligationLabels, recurrenceLabels } from "@/lib/domains/workplace";
import { addDays, today } from "@/lib/operations";
import { formatDate } from "@/lib/people";
import { dueItems, employeeDates, listNotices, type DueItem } from "@/lib/server/compliance";
import { requireAdmin } from "@/lib/server/member";
import { complianceDescription, ComplianceNav } from "./nav";

export const metadata: Metadata = { title: "Compliance" };

const month = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" });

function Items({ items }: { items: DueItem[] }) {
  return <ul className="divide-y divide-line">{items.map((item) => <li key={item.id}><Link href={`/workspace/compliance/obligations/${item.obligationId}`} className="group flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-3 text-sm">
    <span className="min-w-0"><span className="block font-medium wrap-anywhere group-hover:underline">{item.name}</span><span className="block text-[13px] wrap-anywhere text-muted">{[obligationLabels[item.category], item.authority, item.jurisdiction, recurrenceLabels[item.recurrence].toLowerCase(), item.owner].filter(Boolean).join(", ")}</span></span>
    <StatusText tone={item.overdue ? "danger" : "muted"}>{item.overdue ? "Overdue, " : ""}{formatDate(item.dueOn)}</StatusText>
  </Link></li>)}</ul>;
}

export default async function CompliancePage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  await requireAdmin();
  const { category: requested } = await searchParams;
  const category = obligationCategories.find((value) => value === requested) ?? "";
  const [all, notices, dates] = await Promise.all([dueItems(), listNotices(false), employeeDates()]);
  const items = all.filter((item) => !category || item.category === category);
  const soon = addDays(today(), 30);
  const overdue = items.filter((item) => item.overdue);
  const upcoming = items.filter((item) => !item.overdue);
  const months = [...new Set(upcoming.map((item) => item.dueOn.slice(0, 7)))];
  return <>
    <PageHeader title="Compliance" description={complianceDescription} actions={<>
      <a href="/workspace/compliance/calendar.ics" className={secondaryButton}><DownloadSimpleIcon aria-hidden="true" size={15} /> Export calendar</a>
      <Link href="/workspace/compliance/register?new=1" className={primaryButton}><PlusIcon aria-hidden="true" size={15} weight="bold" /> Add obligation</Link>
    </>} />
    <ComplianceNav current="" />
    <FigureRow><Figure label="Overdue" value={overdue.length} /><Figure label="Due in 30 days" value={upcoming.filter((item) => item.dueOn <= soon).length} /><Figure label="Open notices" value={notices.length} href="/workspace/compliance/notices" /></FigureRow>
    {all.length > 0 && <Filters label="Filter obligations" action="/workspace/compliance" clear={category && "/workspace/compliance"} fields={[{ name: "category", label: "Category", value: category, options: [{ value: "", label: "Every category" }, ...obligationCategories.map((value) => ({ value, label: obligationLabels[value] }))] }]} />}
    {!all.length && <div className="mb-9"><EmptyState title="No dates yet" description="Add the filings, registrations and renewals your company keeps." /></div>}
    {all.length > 0 && !items.length && <Empty>Nothing in this category.</Empty>}
    <div className="grid gap-9">
      {overdue.length > 0 && <Section title="Overdue"><Items items={overdue} /></Section>}
      {months.map((key) => <Section key={key} title={month.format(new Date(`${key}-01T00:00:00Z`))}><Items items={upcoming.filter((item) => item.dueOn.startsWith(key))} /></Section>)}
      <Section title="Employee dates, next 60 days">{dates.length ? <ul className="divide-y divide-line">{dates.map((entry) => <li key={`${entry.label}-${entry.id}`}><Link href={entry.href} className="group flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-2.5 text-sm"><span className="min-w-0"><span className="block font-medium wrap-anywhere group-hover:underline">{entry.name}</span><span className="block text-[13px] wrap-anywhere text-muted">{entry.label}</span></span><span className="text-[13px] text-muted">{formatDate(entry.on)}</span></Link></li>)}</ul> : <Empty>No last days or training expiries.</Empty>}</Section>
    </div>
  </>;
}
