import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon } from "@/components/icons";
import { panelStyle, primaryButton, textButton } from "@/components/ui";
import { EmptyState, Notice, PageHeader } from "@/components/workspace/presentation";
import { ObligationForm } from "@/components/workspace/workplace-compliance";
import { DataTable, StatusText } from "@/components/workspace/workplace-parts";
import { obligationLabels, recurrenceLabels } from "@/lib/domains/workplace";
import { formatDate } from "@/lib/people";
import { listAdmins, listJurisdictions, listObligations } from "@/lib/server/compliance";
import { requireAdmin } from "@/lib/server/member";
import { complianceDescription, ComplianceNav } from "../nav";

export const metadata: Metadata = { title: "Compliance register" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ new?: string; saved?: string; jurisdiction?: string }> }) {
  await requireAdmin();
  const query = await searchParams;
  const adding = query.new === "1";
  const [obligations, admins, places] = await Promise.all([listObligations(), adding ? listAdmins() : [], adding ? listJurisdictions() : []]);
  return <>
    <PageHeader title="Compliance register" description={complianceDescription} actions={!adding && <Link href="/workspace/compliance/register?new=1" className={primaryButton}><PlusIcon aria-hidden="true" size={15} weight="bold" /> Add obligation</Link>} />
    <ComplianceNav current="/register" />
    {query.saved === "archived" && <Notice>Obligation archived.</Notice>}
    {adding && <section className={`${panelStyle} mb-8 max-w-3xl p-5`}><h2 className="mb-4 text-[15px] font-semibold">Add an obligation</h2><ObligationForm admins={admins} jurisdictions={[...new Set(places.map((place) => place.jurisdiction))]} cancel={<Link href="/workspace/compliance/register" className={textButton}>Close</Link>} /></section>}
    {obligations.length ? <DataTable caption="Obligations" columns={["Obligation", "Category", "Jurisdiction", "Repeats", "Owner", "Next date"]} rows={obligations.map((entry) => [
      <Link key="name" href={`/workspace/compliance/obligations/${entry.id}`} className="font-medium hover:underline">{entry.name}{entry.authority && <span className="block text-[13px] font-normal text-muted">{entry.authority}</span>}</Link>, obligationLabels[entry.category],
      entry.jurisdiction || <span key="place" className="text-muted">Not set</span>, recurrenceLabels[entry.recurrence], entry.owner ?? <span key="owner" className="text-muted">All administrators</span>,
      entry.dueOn ? <StatusText key="due" tone={entry.overdue ? "danger" : "muted"}>{entry.overdue ? "Overdue, " : ""}{formatDate(entry.dueOn)}</StatusText> : <StatusText key="done" tone="positive">Complete</StatusText>,
    ])} /> : <EmptyState title="Nothing in the register" description="Add registrations, filings, licences, insurance and policy reviews with their due dates." />}
  </>;
}
