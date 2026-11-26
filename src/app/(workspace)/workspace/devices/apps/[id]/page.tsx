import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ActionButtons, ActionForm, Field } from "@/components/workspace/action-form";
import { BackLink, Callout, Empty, Notice, PageHeader, Section } from "@/components/workspace/presentation";
import { AppForm, GrantList } from "@/components/workspace/workplace-devices";
import { formatMoney } from "@/lib/operations";
import { annualCost, readApp } from "@/lib/server/devices";
import { requireAdmin } from "@/lib/server/member";
import { assignTargets } from "@/lib/server/training";
import { archiveAppAction, grantAppAction } from "../../actions";

export const metadata: Metadata = { title: "App" };

export default async function AppPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  await requireAdmin();
  const [{ id }, { saved }] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(id).success) notFound();
  const [result, people] = await Promise.all([readApp(id), assignTargets()]);
  if (!result) notFound();
  const { app, grants } = result;
  const current = grants.filter((grant) => !grant.closedAt);
  const past = grants.filter((grant) => grant.closedAt);
  const cost = annualCost(app);
  return <>
    <BackLink href="/workspace/devices/apps">App access</BackLink>
    <PageHeader title={app.name} description={`${app.used} ${app.used === 1 ? "person has" : "people have"} access${app.seats === null ? "" : `, ${app.seats} seats bought`}${cost ? `, ${formatMoney(cost, app.currency)} a year` : ""}.`} actions={!app.archived && <ActionButtons action={archiveAppAction} hidden={{ id }} name="operation" buttons={[{ value: "archive", label: "Archive app", describe: "Archive app", variant: "text", confirm: { title: `Archive ${app.name}?`, body: "It leaves the register and new hire defaults. Its history stays.", action: "Archive this app", danger: true } }]} />} />
    {saved === "added" && <Notice>App added.</Notice>}
    {saved === "changed" && <Notice>App saved.</Notice>}
    {app.seats !== null && app.used > app.seats && <Callout>More people have access than the seats you bought.</Callout>}
    <div className="grid gap-x-12 gap-y-9 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div className="grid content-start gap-9">
        <Section title="Access">
          {current.length ? <GrantList grants={current} mode="app" /> : <Empty>Nobody has access yet.</Empty>}
          {!app.archived && people.length > 0 && <ActionForm action={grantAppAction} submit="Record access" variant="secondary" hidden={{ appId: id }} inline className="border-t border-line pt-4"><Field name="employeeId" label="Person" required options={[{ value: "", label: "Choose a person" }, ...people.map((person) => ({ value: person.id, label: person.name }))]} wrapperClass="w-full sm:w-56" /><Field name="role" label="Role" required maxLength={60} defaultValue="Member" wrapperClass="w-full sm:w-40" /></ActionForm>}
        </Section>
        {past.length > 0 && <Section title="Past access and requests"><GrantList grants={past} mode="app" /></Section>}
      </div>
      {!app.archived && <Section title="Details"><div className="pt-3"><AppForm app={app} currency={app.currency} people={app.ownerId && !people.some((person) => person.id === app.ownerId) ? [...people, { id: app.ownerId, name: app.owner ?? "Current owner" }] : people} /></div></Section>}
    </div>
  </>;
}
