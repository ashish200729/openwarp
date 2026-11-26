import type { Metadata } from "next";
import { ActionButtons, ActionForm, Checkbox, Field } from "@/components/workspace/action-form";
import { BackLink, Empty, PageHeader, Section } from "@/components/workspace/presentation";
import { employmentLabels, employmentTypes } from "@/lib/people";
import { appChoices, listAppDefaults, readWorkplaceSettings } from "@/lib/server/devices";
import { listTeams } from "@/lib/server/directory";
import { requireAdmin } from "@/lib/server/member";
import { addAppDefaultAction, removeAppDefaultAction, saveWorkplaceSettingsAction } from "../../devices/actions";

export const metadata: Metadata = { title: "Devices and apps settings" };

export default async function WorkplaceSettingsPage() {
  const member = await requireAdmin();
  const [settings, defaults, apps, teams] = await Promise.all([readWorkplaceSettings(), listAppDefaults(), appChoices(), listTeams(member)]);
  return <>
    <BackLink href="/workspace/settings">Settings</BackLink>
    <PageHeader title="Devices and apps settings" />
    <div className="grid max-w-3xl gap-10">
      <Section title="Devices"><div className="pt-3"><ActionForm key={settings.version} action={saveWorkplaceSettingsAction} submit="Save" hidden={{ version: settings.version }}>
        <Field name="attestDays" label="Days between security checks" type="number" min={7} max={730} required defaultValue={settings.attestDays} wrapperClass="max-w-60" />
        <fieldset className="grid gap-2.5"><legend className="mb-2 text-sm font-medium">Request a laptop for new hires who are</legend>{employmentTypes.map((type) => <Checkbox key={type} name={type} label={employmentLabels[type]} defaultChecked={settings.deviceFor.includes(type)} />)}</fieldset>
      </ActionForm></div></Section>
      <Section title="Default apps for new hires">
        <p className="pt-2 text-[13px] text-muted">Starting onboarding adds an approved access record and a checklist task for each match. The most specific match sets the role.</p>
        {defaults.length ? <ul className="divide-y divide-line">{defaults.map((entry) => <li key={entry.id} className="flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-1 text-sm"><span className="min-w-0"><span className="font-medium wrap-anywhere">{entry.appName}</span> <span className="text-muted">· {entry.role}, {entry.teamName ?? "every team"}{entry.title && `, titles with “${entry.title}”`}</span></span>
          <ActionButtons action={removeAppDefaultAction} hidden={{ id: entry.id }} name="operation" buttons={[{ value: "remove", label: "Remove", describe: `Remove ${entry.appName} default for ${entry.teamName ?? "every team"}`, variant: "text", confirm: { title: "Remove this default?", body: "New hires won’t get it. Existing access records stay.", action: "Remove default", danger: true } }]} /></li>)}</ul> : <Empty>No default apps.</Empty>}
        <div className="border-t border-line pt-4">{apps.length ? <ActionForm action={addAppDefaultAction} submit="Add default" variant="secondary">
          <div className="grid gap-4 sm:grid-cols-2"><Field name="appId" label="App" required options={apps.map((app) => ({ value: app.id, label: app.name }))} /><Field name="role" label="Role" required maxLength={60} defaultValue="Member" /><Field name="teamId" label="Team" required options={[{ value: "", label: "Every team" }, ...teams.map((team) => ({ value: team.id, label: team.name }))]} /><Field name="title" label="Job title contains" maxLength={120} /></div>
        </ActionForm> : <p className="text-sm text-muted">Add apps to the register first.</p>}</div>
      </Section>
    </div>
  </>;
}
