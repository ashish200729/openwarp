import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PencilSimpleIcon } from "@/components/icons";
import { panelStyle, secondaryButton, textButton, textLink } from "@/components/ui";
import { ActionButtons, ActionForm, Field } from "@/components/workspace/action-form";
import { BackLink, Empty, Notice, PageHeader, Section } from "@/components/workspace/presentation";
import { ObligationForm } from "@/components/workspace/workplace-compliance";
import { Details, StatusText } from "@/components/workspace/workplace-parts";
import { Reference } from "@/components/workspace/workplace-reference";
import { obligationLabels, recurrenceLabels } from "@/lib/domains/workplace";
import { today } from "@/lib/operations";
import { formatDate } from "@/lib/people";
import { listAdmins, listJurisdictions, readObligation } from "@/lib/server/compliance";
import { listDocuments } from "@/lib/server/documents";
import { requireAdmin } from "@/lib/server/member";
import { archiveObligationAction, closeOccurrenceAction } from "../../actions";

export const metadata: Metadata = { title: "Obligation" };

export default async function ObligationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string; saved?: string }> }) {
  const member = await requireAdmin();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(id).success) notFound();
  const result = await readObligation(id);
  if (!result) notFound();
  const { obligation, occurrences } = result;
  const editing = query.edit === "1";
  const [admins, places, documents] = await Promise.all([editing ? listAdmins() : [], editing ? listJurisdictions() : [], obligation.occurrenceId ? listDocuments(member) : []]);
  const company = documents.filter((document) => !document.employeeId);
  return <>
    <BackLink href="/workspace/compliance/register">Compliance register</BackLink>
    <PageHeader title={obligation.name} description={[obligation.authority, obligation.jurisdiction].filter(Boolean).join(", ") || undefined} actions={<>
      {!editing && <Link href={`/workspace/compliance/obligations/${id}?edit=1`} className={secondaryButton}><PencilSimpleIcon aria-hidden="true" size={15} /> Edit obligation</Link>}
      <ActionButtons action={archiveObligationAction} hidden={{ id }} name="operation" buttons={[{ value: "archive", label: "Archive", describe: "Archive this obligation", variant: "text", confirm: { title: `Archive ${obligation.name}?`, body: "It leaves the calendar and the register, and reminders stop.", action: "Archive obligation", danger: true } }]} />
    </>} />
    {query.saved === "added" && <Notice>Obligation added.</Notice>}
    {query.saved === "changed" && <Notice>Obligation saved.</Notice>}
    {editing ? <section className={`${panelStyle} mb-8 max-w-3xl p-5`}><h2 className="mb-4 text-[15px] font-semibold">Edit obligation</h2><ObligationForm key={obligation.version} obligation={obligation} admins={admins} jurisdictions={[...new Set(places.map((place) => place.jurisdiction))]} cancel={<Link href={`/workspace/compliance/obligations/${id}`} className={textButton}>Close</Link>} /></section>
      : <Section title="Details" className="mb-9"><Details items={[["Category", obligationLabels[obligation.category]], ["Repeats", recurrenceLabels[obligation.recurrence]], ["Owner", obligation.owner ?? "All administrators"], ["Account or reference number", obligation.hasReference ? <Reference key={`${id}-${obligation.version}`} id={id} /> : "Not recorded"], ...(obligation.notes ? [["Notes", obligation.notes] as [string, string]] : [])]} /></Section>}
    <div className="grid gap-x-12 gap-y-9 lg:grid-cols-2">
      <Section title={obligation.dueOn ? `Due ${formatDate(obligation.dueOn)}` : "Next date"} action={obligation.overdue && <StatusText tone="danger">Overdue</StatusText>}>
        {obligation.occurrenceId ? <div className="pt-3"><ActionForm key={obligation.occurrenceId} action={closeOccurrenceAction} submit="Save result" hidden={{ id: obligation.occurrenceId }}>
          <div className="grid gap-4 sm:grid-cols-2"><Field name="operation" label="Result" required options={[{ value: "completed", label: "Completed" }, { value: "skipped", label: "Skipped, not needed" }]} /><Field name="closedOn" label="Date" type="date" required defaultValue={today()} /></div>
          <Field name="note" label="Result note" maxLength={500} />
          <Field name="file" label="Evidence" type="file" accept="application/pdf,image/png,image/jpeg" hint="PDF, PNG or JPEG, up to 5 MB." />
          <Field name="visibility" label="Who can open the evidence" required options={[{ value: "admins", label: "Administrators only" }, { value: "everyone", label: "Everyone, as a company document" }]} />
          <Field name="documentId" label="Or link a company document" defaultValue="" options={[{ value: "", label: "None" }, ...company.map((document) => ({ value: document.id, label: document.name }))]} />
          <p className="text-[13px] text-muted">{obligation.recurrence === "none" ? "This happens once, so no new date is added." : "Saving adds the next date."} Nothing is sent to the authority.</p>
        </ActionForm></div> : <Empty>Complete. Edit the obligation to set another date.</Empty>}
      </Section>
      <Section title="History">{occurrences.length ? <ol className="divide-y divide-line">{occurrences.map((entry) => <li key={entry.id} className="flex flex-wrap items-start justify-between gap-x-6 gap-y-1 py-3 text-sm"><div className="min-w-0"><p className="font-medium">Due {formatDate(entry.dueOn)}</p><p className="text-[13px] wrap-anywhere text-muted">{entry.closedOn && formatDate(entry.closedOn)}{entry.closedBy && ` by ${entry.closedBy}`}{entry.note && `. ${entry.note}`}</p>{entry.documentId && <a href={`/workspace/documents/${entry.documentId}`} className={`${textLink} text-[13px] wrap-anywhere underline`}>{entry.documentName}</a>}{entry.fileId && <a href={`/workspace/compliance/files/${entry.fileId}`} className={`${textLink} text-[13px] underline`}>Evidence for {formatDate(entry.dueOn)}</a>}</div><StatusText tone={entry.state === "completed" ? "positive" : "muted"}>{entry.state === "completed" ? "Completed" : "Skipped"}</StatusText></li>)}</ol> : <Empty>No dates closed yet.</Empty>}</Section>
    </div>
  </>;
}
