import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon } from "@/components/icons";
import { panelStyle, primaryButton, textButton, textLink } from "@/components/ui";
import { ActionForm, Field } from "@/components/workspace/action-form";
import { Empty, EmptyState, Figure, FigureRow, Notice, PageHeader, Section } from "@/components/workspace/presentation";
import { AppForm, GrantList } from "@/components/workspace/workplace-devices";
import { DataTable, ExportLink, StatusText } from "@/components/workspace/workplace-parts";
import { billingLabels, criticalityLabels } from "@/lib/domains/workplace";
import { addDays, formatMoney, today } from "@/lib/operations";
import { formatDate } from "@/lib/people";
import { canRequestEquipment, annualCost, appChoices, listApps, ownGrants, pendingGrants, type AppRow } from "@/lib/server/devices";
import { requireMember } from "@/lib/server/member";
import { readCompany } from "@/lib/server/settings";
import { assignTargets } from "@/lib/server/training";
import { requestAppAction } from "../actions";
import { DevicesNav } from "../nav";

export const metadata: Metadata = { title: "App access" };

const notices: Record<string, string> = { requested: "Request sent.", archived: "App archived." };

async function Register({ apps, adding }: { apps: AppRow[]; adding: boolean }) {
  const [company, people] = await Promise.all([readCompany(), adding ? assignTargets() : []]);
  const costs = new Map<string, number>();
  for (const app of apps) costs.set(app.currency, (costs.get(app.currency) ?? 0) + annualCost(app));
  const soon = addDays(today(), 30);
  const renewing = apps.filter((app) => app.renewsOn && app.renewsOn <= soon);
  return <>
    {adding && <section className={`${panelStyle} mb-8 max-w-3xl p-5`}><h2 className="mb-4 text-[15px] font-semibold">Add an app</h2><AppForm currency={company.currency} people={people} cancel={<Link href="/workspace/devices/apps" className={textButton}>Close</Link>} /></section>}
    {apps.length > 0 && <FigureRow><Figure label="Apps" value={apps.length} /><Figure label="Renewing in 30 days" value={renewing.length} />{[...costs].filter(([, cents]) => cents > 0).map(([currency, cents]) => <Figure key={currency} label={`Cost a year in ${currency}`} value={formatMoney(cents, currency)} detail="Seats bought or in use" />)}</FigureRow>}
    <Section title="App register" className="mb-9" action={apps.length > 0 && <span className="flex flex-wrap gap-x-4"><ExportLink href="/workspace/devices/apps/export" label="apps" /><ExportLink href="/workspace/devices/apps/export?list=access" label="people with access" /></span>}>
      {apps.length ? <DataTable caption="Apps" columns={["App", "Owner", "Criticality", "Seats", "Cost", "Renews"]} numeric={[3, 4]} rows={apps.map((app) => [
        <Link key="app" href={`/workspace/devices/apps/${app.id}`} className="font-medium hover:underline">{app.name}</Link>, app.owner ?? <span key="owner" className="text-muted">No owner</span>, app.criticality === "critical" ? <StatusText key="critical" tone="amber">Critical</StatusText> : criticalityLabels[app.criticality],
        app.seats === null ? app.used : `${app.used} of ${app.seats}`, app.seatCostCents ? `${formatMoney(app.seatCostCents, app.currency)} a seat ${billingLabels[app.billing]}` : "Free", app.renewsOn ? <span key="renews" className={app.renewsOn <= soon ? "text-amber" : ""}>{formatDate(app.renewsOn)}</span> : <span key="none" className="text-muted">Not set</span>,
      ])} /> : <div className="pt-4"><EmptyState title="No apps yet" description="Add the apps your company uses to record who has access to each one." /></div>}
    </Section>
  </>;
}

export default async function AppsPage({ searchParams }: { searchParams: Promise<{ new?: string; request?: string; saved?: string }> }) {
  const member = await requireMember();
  const query = await searchParams;
  const admin = member.role === "admin";
  const decides = admin || member.managesPeople;
  const canRequest = await canRequestEquipment(member.employeeId);
  const requesting = query.request === "1" && canRequest;
  const [apps, pending, own, choices] = await Promise.all([listApps(member), pendingGrants(member), ownGrants(member), requesting ? appChoices() : []]);
  const notice = query.saved && Object.hasOwn(notices, query.saved) ? notices[query.saved] : undefined;
  return <>
    <PageHeader title="App access" description="OpenWarp records who has access. Granting or removing it happens in the app itself." actions={admin && query.new !== "1" && <Link href="/workspace/devices/apps?new=1" className={primaryButton}><PlusIcon aria-hidden="true" size={15} weight="bold" /> Add app</Link>} />
    <DevicesNav current="apps" admin={admin} waiting={pending.length} />
    {notice && <Notice>{notice}</Notice>}
    {requesting && <section className={`${panelStyle} mb-8 max-w-2xl p-5`}><h2 className="mb-4 text-[15px] font-semibold">Request app access</h2>{choices.length ? <ActionForm action={requestAppAction} submit="Send request" pending="Sending…" secondary={<Link href="/workspace/devices/apps" className={textButton}>Close</Link>}>
      <div className="grid gap-4 sm:grid-cols-2"><Field name="appId" label="App" required options={choices.map((app) => ({ value: app.id, label: app.name }))} /><Field name="role" label="Role you need" required maxLength={60} defaultValue="Member" /></div><Field name="reason" label="Reason" multiline maxLength={500} />
    </ActionForm> : <Empty>No apps are in the register yet.</Empty>}</section>}
    {decides && <Section title="Waiting" className="mb-9">{pending.length ? <GrantList grants={pending} mode="decide" /> : <Empty>No access requests are waiting.</Empty>}</Section>}
    {admin && <Register apps={apps} adding={query.new === "1"} />}
    {member.employeeId ? <Section title="My access" action={canRequest && !requesting && <Link href="/workspace/devices/apps?request=1" className={`${textLink} text-[13px]`}>Request access</Link>}>{own.length ? <GrantList grants={own} mode="own" /> : <Empty>No app access is recorded for you.</Empty>}</Section>
      : !admin && <Empty>Your account isn’t linked to an employee record, so no access can be recorded for you.</Empty>}
  </>;
}
