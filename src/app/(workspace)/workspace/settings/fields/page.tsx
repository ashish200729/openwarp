import type { Metadata } from "next";
import Link from "next/link";
import { DownloadSimpleIcon, PlusIcon } from "@/components/icons";
import { inputStyle, panelStyle, primaryButton, secondaryButton, textButton } from "@/components/ui";
import { ActionButtons, ActionForm, Checkbox, Field } from "@/components/workspace/action-form";
import { BackLink, Empty, Notice, PageHeader, Section } from "@/components/workspace/presentation";
import { customFieldKinds, customFieldLabels, fieldVisibilities, visibilityLabels } from "@/lib/domains/records";
import { listCustomFields, type CustomField } from "@/lib/server/custom-fields";
import { requireAdmin } from "@/lib/server/member";
import { customFieldCommandAction, saveCustomFieldAction } from "./actions";

export const metadata: Metadata = { title: "Custom fields" };

function FieldForm({ field }: { field?: CustomField }) {
  return <section className={`${panelStyle} mb-8 max-w-2xl p-5`}>
    <h2 className="mb-4 text-[15px] font-semibold">{field ? `Edit ${field.label}` : "Add a field"}</h2>
    <ActionForm action={saveCustomFieldAction} submit="Save field" secondary={<Link href="/workspace/settings/fields" className={textButton}>Close</Link>} hidden={field ? { id: field.id, version: field.version, kind: field.kind } : {}}>
      <div className="grid gap-4 sm:grid-cols-2"><Field name="label" label="Label" required maxLength={80} defaultValue={field?.label} />
        {!field && <Field name="kind" label="Type" required options={customFieldKinds.map((value) => ({ value, label: customFieldLabels[value] }))} hint="The type can’t be changed later." />}
        <Field name="visibility" label="Who can see it" required defaultValue={field?.visibility ?? "private"} options={fieldVisibilities.map((value) => ({ value, label: visibilityLabels[value] }))} /></div>
      {(!field || field.kind === "choice") && <Field name="options" label="Choices" required={Boolean(field)} multiline maxLength={6_000} defaultValue={field?.options.join("\n")} hint={field ? "One on each line. People keep a choice you take off the list." : "Only for the choice type. One on each line."} />}
      <Checkbox name="employeeEditable" label="People can fill it in themselves" defaultChecked={field?.employeeEditable} />
      <Checkbox name="requiredForOnboarding" label="Ask for it during onboarding" defaultChecked={field?.requiredForOnboarding} />
    </ActionForm>
  </section>;
}

export default async function CustomFieldsPage({ searchParams }: { searchParams: Promise<{ new?: string; edit?: string; saved?: string }> }) {
  await requireAdmin();
  const [fields, query] = await Promise.all([listCustomFields(), searchParams]);
  const active = fields.filter((field) => !field.archived);
  const archived = fields.filter((field) => field.archived);
  const editing = active.find((field) => field.id === query.edit);
  return <>
    <BackLink href="/workspace/settings">Settings</BackLink>
    <PageHeader title="Custom fields" description="Extra details to keep about each person. They appear on the Personal tab." actions={<>
      {query.new !== "1" && <Link href="/workspace/settings/fields?new=1" className={primaryButton}><PlusIcon aria-hidden="true" size={15} weight="bold" /> Add field</Link>}
    </>} />
    {query.saved === "field" && <Notice>Field saved.</Notice>}
    {query.new === "1" ? <FieldForm /> : editing && <FieldForm key={`${editing.id}-${editing.version}`} field={editing} />}
    <div className="grid max-w-3xl gap-9">
      {active.length > 0 && <Section title="Export field values"><form action="/workspace/settings/fields/export" className="flex flex-wrap items-end gap-3 pt-3">
        <label className="grid gap-1.5 text-sm font-medium">Name or work email<input className={inputStyle} type="search" name="q" maxLength={120} placeholder="All current employees" /></label>
        <button className={secondaryButton}><DownloadSimpleIcon aria-hidden="true" size={15} /> Export CSV</button>
      </form></Section>}
      <Section title="Fields">{active.length ? <ul className="divide-y divide-line">{active.map((field) => <li key={field.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3 text-sm">
        <div className="min-w-0"><p className="font-medium wrap-anywhere">{field.label}</p><p className="text-[13px] text-muted">{customFieldLabels[field.kind]}{field.kind === "choice" && ` (${field.options.length})`}, visible to {visibilityLabels[field.visibility].toLowerCase()}{field.employeeEditable && ", people can fill it in"}{field.requiredForOnboarding && ", asked during onboarding"}</p></div>
        <div className="flex items-center gap-1.5"><Link href={`/workspace/settings/fields?edit=${field.id}`} className={`${textButton} min-h-10! text-[13px] pointer-fine:min-h-8!`}>Edit<span className="sr-only"> {field.label}</span></Link>
          <ActionButtons action={customFieldCommandAction} hidden={{ id: field.id }} name="operation" buttons={[{ value: "archive", label: "Archive", describe: `Archive ${field.label}`, variant: "text", confirm: { title: `Archive ${field.label}?`, body: field.used ? `It disappears from profiles and exports. The ${field.used} recorded ${field.used === 1 ? "value is" : "values are"} kept and come back if you restore it.` : "It disappears from profiles and exports.", action: "Archive field", danger: true } }]} /></div>
      </li>)}</ul> : <Empty>No custom fields yet.</Empty>}</Section>
      {archived.length > 0 && <Section title="Archived"><ul className="divide-y divide-line">{archived.map((field) => <li key={field.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-2 text-sm"><span className="min-w-0 wrap-anywhere">{field.label} <span className="text-muted">· {customFieldLabels[field.kind]}</span></span><ActionButtons action={customFieldCommandAction} hidden={{ id: field.id }} name="operation" buttons={[{ value: "restore", label: "Restore", describe: `Restore ${field.label}`, variant: "text" }]} /></li>)}</ul></Section>}
    </div>
  </>;
}
