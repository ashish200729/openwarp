import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon } from "@/components/icons";
import { panelStyle, primaryButton, textButton } from "@/components/ui";
import { ActionButtons, ActionForm, Checkbox, Field } from "@/components/workspace/action-form";
import { BackLink, Callout, Empty, Notice, PageHeader, Section } from "@/components/workspace/presentation";
import { EmploymentTypes } from "@/components/workspace/record-fields";
import { RecordText } from "@/components/workspace/record-text";
import { SignatoryFields } from "@/components/workspace/signature-fields";
import { mergeFields } from "@/lib/domains/records";
import { documentCategories, documentLabels } from "@/lib/operations";
import { employmentLabels, type EmploymentType } from "@/lib/people";
import { requireAdmin } from "@/lib/server/member";
import { listNewHireDocuments, listSignatories, listSignatureTemplates, type Signatory, type SignatureTemplate } from "@/lib/server/templates";
import { addNewHireDocumentAction, archiveTemplateAction, removeNewHireDocumentAction, saveTemplateAction } from "./actions";

export const metadata: Metadata = { title: "Document templates" };

const typeNames = (types: EmploymentType[]) => types.map((type) => employmentLabels[type].toLowerCase()).join(", ");

function TemplateForm({ template, signatories }: { template?: SignatureTemplate; signatories: Signatory[] }) {
  return <section className={`${panelStyle} mb-8 max-w-3xl p-5`}>
    <h2 className="mb-4 text-[15px] font-semibold">{template ? `Edit ${template.name}` : "Write a template"}</h2>
    {template?.starter && <Callout>This text is a starting point, not legal advice. Have it reviewed by counsel before anyone signs it.</Callout>}
    <ActionForm action={saveTemplateAction} submit="Save template" secondary={<Link href="/workspace/settings/templates" className={textButton}>Close</Link>} hidden={template ? { id: template.id, version: template.version } : {}}>
      <Field name="name" label="Name" required maxLength={120} defaultValue={template?.name} />
      <Field name="body" label="Text" required multiline maxLength={20_000} defaultValue={template?.body} className="min-h-96 font-mono text-[13px]!" hint="Start a line with # for a heading, - or 1. for a list, and put **two asterisks** around bold text." />
      <div className="text-[13px]"><p className="font-medium">Merge fields</p><ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-muted">{Object.entries(mergeFields).map(([field, label]) => <li key={field}><code className="text-foreground">{`{{${field}}}`}</code> {label.toLowerCase()}</li>)}</ul></div>
      <SignatoryFields signatories={signatories} signatoryId={template?.signatoryId} order={template?.signerOrder} />
      {template?.starter && <Checkbox name="reviewed" label="Counsel has reviewed this text" hint="Takes away the starting point label." />}
      <Checkbox name="includeNewHires" label="Include for new hires" hint="Sent when onboarding starts. If a merge field has no value yet, it waits as a draft." defaultChecked={template?.includeNewHires} />
      <EmploymentTypes legend="New hires it applies to" chosen={template?.employmentTypes ?? []} />
    </ActionForm>
  </section>;
}

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ new?: string; edit?: string; view?: string; saved?: string }> }) {
  await requireAdmin();
  const query = await searchParams;
  const [templates, documents, signatories] = await Promise.all([listSignatureTemplates(), listNewHireDocuments(), listSignatories()]);
  const editing = templates.find((template) => template.id === query.edit);
  const viewing = editing ? undefined : templates.find((template) => template.id === query.view);
  return <>
    <BackLink href="/workspace/settings">Settings</BackLink>
    <PageHeader title="Document templates" description="Text to send for signature, and the documents asked of every new hire." actions={query.new !== "1" && <Link href="/workspace/settings/templates?new=1" className={primaryButton}><PlusIcon aria-hidden="true" size={15} weight="bold" /> Write a template</Link>} />
    {query.saved === "template" && <Notice>Template saved.</Notice>}
    {query.new === "1" ? <TemplateForm signatories={signatories} /> : editing && <TemplateForm key={`${editing.id}-${editing.version}`} template={editing} signatories={signatories} />}
    {viewing && <section className={`${panelStyle} mb-8 max-w-3xl p-5`}><div className="mb-4 flex items-center justify-between gap-4"><h2 className="text-[15px] font-semibold">{viewing.name}</h2><Link href="/workspace/settings/templates" className={textButton}>Close</Link></div><RecordText source={viewing.body} /></section>}
    <div className="grid max-w-3xl gap-9">
      <Section title="Signature templates">{templates.length ? <ul className="divide-y divide-line">{templates.map((template) => <li key={template.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3 text-sm">
        <div className="min-w-0"><p className="font-medium wrap-anywhere">{template.name}</p>{template.starter && <p className="text-[13px] text-amber">Starting point. Have it reviewed by counsel before use.</p>}<p className="text-[13px] text-muted">{template.signatoryName ? `Signed by the employee and ${template.signatoryName}` : "Signed by the employee"}{template.includeNewHires && `. Sent to new hires: ${typeNames(template.employmentTypes)}`}</p></div>
        <div className="flex items-center gap-1.5"><Link href={`/workspace/settings/templates?view=${template.id}`} className={`${textButton} min-h-10! text-[13px] pointer-fine:min-h-8!`}>Preview<span className="sr-only"> {template.name}</span></Link><Link href={`/workspace/settings/templates?edit=${template.id}`} className={`${textButton} min-h-10! text-[13px] pointer-fine:min-h-8!`}>Edit<span className="sr-only"> {template.name}</span></Link>
          <ActionButtons action={archiveTemplateAction} hidden={{ id: template.id }} name="operation" buttons={[{ value: "archive", label: "Archive", describe: `Archive ${template.name}`, variant: "text", confirm: { title: `Archive ${template.name}?`, body: "It can’t be used for new documents. Documents already prepared or signed keep their text.", action: "Archive template", danger: true } }]} /></div>
      </li>)}</ul> : <Empty>No templates. Write one to send documents for signature.</Empty>}</Section>
      <Section title="Documents new hires upload">
        {documents.length ? <ul className="divide-y divide-line">{documents.map((document) => <li key={document.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3 text-sm"><div className="min-w-0"><p className="font-medium wrap-anywhere">{document.title}</p><p className="text-[13px] wrap-anywhere text-muted">{documentLabels[document.category]}, {typeNames(document.employmentTypes)}{document.instructions && `. ${document.instructions}`}</p></div><ActionButtons action={removeNewHireDocumentAction} hidden={{ id: document.id }} name="operation" buttons={[{ value: "remove", label: "Remove", describe: `Remove ${document.title}`, variant: "text", confirm: { title: `Remove ${document.title}?`, body: "New hires won’t be asked for it. Requests already sent stay open.", action: "Remove document", danger: true } }]} /></li>)}</ul> : <Empty>New hires aren’t asked to upload anything.</Empty>}
        <div className="border-t border-line pt-4"><ActionForm action={addNewHireDocumentAction} submit="Add document" variant="secondary">
          <div className="grid gap-4 sm:grid-cols-2"><Field name="title" label="Document to ask for" required maxLength={120} /><Field name="category" label="Category" required options={documentCategories.map((value) => ({ value, label: documentLabels[value] }))} /></div>
          <Field name="instructions" label="Instructions" multiline maxLength={500} />
          <EmploymentTypes legend="Ask these new hires" chosen={["full_time", "part_time"]} />
        </ActionForm></div>
      </Section>
    </div>
  </>;
}
