import type { Metadata } from "next";
import Link from "next/link";
import { CaretDownIcon, PlusIcon } from "@/components/icons";
import { panelStyle, primaryButton, textButton, textLink } from "@/components/ui";
import { ActionButtons, ActionForm, Checkbox, Field } from "@/components/workspace/action-form";
import { BackLink, Callout, Empty, Notice, PageHeader, Section } from "@/components/workspace/presentation";
import { DocumentRequestStatus } from "@/components/workspace/record-fields";
import { documentCategories, documentLabels, today } from "@/lib/operations";
import { formatDate } from "@/lib/people";
import { listTeams } from "@/lib/server/directory";
import { listDocumentRequests, ownDocumentRequests, type DocumentRequest } from "@/lib/server/documents";
import { readOrg } from "@/lib/server/insights";
import { requireMember } from "@/lib/server/member";
import { requestDocumentsAction, reviewRequestAction, uploadRequestedAction } from "../actions";

export const metadata: Metadata = { title: "Document requests" };

function Due({ request }: { request: DocumentRequest }) {
  if (!request.dueOn) return null;
  const late = request.dueOn < today() && (request.state === "open" || request.state === "returned");
  return <>, <span className={late ? "text-danger" : undefined}>{late ? "was due" : "due"} {formatDate(request.dueOn)}</span></>;
}

const cancel = (request: DocumentRequest) => ({ value: "cancelled", label: "Cancel", describe: `Cancel ${request.title} from ${request.employeeName}`, variant: "text" as const, confirm: { title: "Cancel this request?", body: `${request.employeeName} no longer needs to upload ${request.title}. A file they already sent stays in their documents.`, action: "Cancel request", danger: true } });

export default async function DocumentRequestsPage({ searchParams }: { searchParams: Promise<{ new?: string; asked?: string; saved?: string }> }) {
  const member = await requireMember();
  const query = await searchParams;
  const canManage = member.role === "admin";
  const asking = canManage && query.new === "1";
  const [own, submitted, waiting, people, teams] = await Promise.all([ownDocumentRequests(member), listDocumentRequests(member, ["submitted"]), listDocumentRequests(member, ["open", "returned"]), asking ? readOrg(member) : [], asking ? listTeams(member) : []]);
  return <>
    <BackLink href="/workspace/documents">Documents</BackLink>
    <PageHeader title="Document requests" description="Files people are asked to upload. Each one is added to their personal documents." actions={canManage && !asking && <Link href="/workspace/documents/requests?new=1" className={primaryButton}><PlusIcon aria-hidden="true" size={15} weight="bold" /> Ask for a document</Link>} />
    {query.asked && /^\d{1,4}$/.test(query.asked) && <Notice>{query.asked === "1" ? "One person was asked." : `${query.asked} people were asked.`}</Notice>}
    {query.saved === "uploaded" && <Notice>File uploaded. An administrator will check it.</Notice>}
    {!canManage && !member.employeeId && <Callout>Your account isn’t linked to an employee record, so nothing can be asked of you. Ask an administrator to link it.</Callout>}
    {asking && <section className={`${panelStyle} mb-8 max-w-2xl p-5`}>
      <h2 className="mb-4 text-[15px] font-semibold">Ask for a document</h2>
      <ActionForm action={requestDocumentsAction} submit="Send request" pending="Sending…" secondary={<Link href="/workspace/documents/requests" className={textButton}>Close</Link>}>
        <div className="grid gap-4 sm:grid-cols-2"><Field name="title" label="What you need" required maxLength={120} placeholder="Proof of address" /><Field name="category" label="Category" required options={documentCategories.map((value) => ({ value, label: documentLabels[value] }))} /></div>
        <Field name="instructions" label="Instructions" multiline maxLength={500} />
        <div className="grid gap-4 sm:grid-cols-2"><Field name="dueOn" label="Due date" type="date" /><Field name="audience" label="Ask" required options={[{ value: "", label: "People chosen below" }, { value: "all", label: "Everyone" }, ...teams.map((team) => ({ value: team.id, label: `${team.name} team` }))]} /></div>
        <fieldset><legend className="mb-2 text-sm font-medium">People</legend>
          <div className="grid max-h-64 gap-x-6 gap-y-2.5 overflow-y-auto rounded-[7px] border border-line p-3 sm:grid-cols-2">{people.map((person) => <Checkbox key={person.id} name={`person_${person.id}`} label={person.name} hint={person.title} />)}</div>
        </fieldset>
        <p className="text-[13px] text-muted">Anyone who already has this request open is skipped.</p>
      </ActionForm>
    </section>}
    {canManage && <Section title="To review" className="mb-9">{submitted.length ? <ul className="divide-y divide-line">{submitted.map((request) => <li key={request.id} className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm">
        <div className="min-w-0"><p className="font-medium wrap-anywhere">{request.title}</p><p className="text-[13px] text-muted"><Link href={`/workspace/people/${request.employeeId}/documents`} className="hover:underline">{request.employeeName}</Link>, {documentLabels[request.category]} · <a href={`/workspace/documents/${request.documentId}`} aria-label={`Open the file from ${request.employeeName}`} className={textLink}>Open the file</a></p></div>
        <ActionButtons action={reviewRequestAction} hidden={{ id: request.id }} name="decision" buttons={[{ value: "accepted", label: "Accept", describe: `Accept ${request.title} from ${request.employeeName}`, variant: "primary" }, cancel(request)]} />
      </div>
      {!request.employeeArchived && <details className="group mt-1"><summary className="inline-flex min-h-10 items-center gap-1.5 rounded text-[13px] text-muted hover:text-foreground">Return it with a note<CaretDownIcon aria-hidden="true" size={12} className="group-open:rotate-180" /></summary>
        <ActionForm action={reviewRequestAction} submit="Return" variant="secondary" hidden={{ id: request.id, decision: "returned" }} inline className="pb-2"><Field name="note" label="What needs to change" required maxLength={300} wrapperClass="w-full sm:w-96" /></ActionForm>
      </details>}
    </li>)}</ul> : <Empty>No uploads are waiting for review.</Empty>}</Section>}
    {canManage && <Section title="Waiting for upload" className="mb-9">{waiting.length ? <ul className="divide-y divide-line">{waiting.map((request) => <li key={request.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3 text-sm">
      <div className="min-w-0"><p className="font-medium wrap-anywhere">{request.title}</p><p className="text-[13px] text-muted"><Link href={`/workspace/people/${request.employeeId}/documents`} className="hover:underline">{request.employeeName}</Link>, asked {formatDate(request.createdAt)}<Due request={request} /></p>{request.returnNote && <p className="mt-0.5 text-[13px] wrap-anywhere">{request.returnNote}</p>}</div>
      <div className="flex items-center gap-3"><DocumentRequestStatus state={request.state} /><ActionButtons action={reviewRequestAction} hidden={{ id: request.id }} name="decision" buttons={[cancel(request)]} /></div>
    </li>)}</ul> : <Empty>Nobody has an upload outstanding.</Empty>}</Section>}
    {member.employeeId && <Section title="Asked of you">{own.length ? <ul className="divide-y divide-line">{own.map((request) => <li key={request.id} className="py-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-1"><div className="min-w-0"><p className="font-medium wrap-anywhere">{request.title}</p><p className="text-[13px] text-muted">{documentLabels[request.category]}, asked {formatDate(request.createdAt)}<Due request={request} /></p>{request.instructions && <p className="mt-1 max-w-[70ch] wrap-anywhere whitespace-pre-line">{request.instructions}</p>}</div><DocumentRequestStatus state={request.state} /></div>
      {request.returnNote && <p className="mt-2 max-w-[70ch] wrap-anywhere text-danger">{request.returnNote}</p>}
      {(request.state === "open" || request.state === "returned") && <ActionForm action={uploadRequestedAction} submit="Upload" pending="Uploading…" hidden={{ id: request.id }} inline className="mt-3">
        <Field name="file" label={`Your file for ${request.title}`} type="file" required accept="application/pdf,image/png,image/jpeg" hint="PDF, PNG or JPEG, up to 5 MB." wrapperClass="w-full sm:w-80" /><Field name="expiresOn" label="Expires on" type="date" wrapperClass="w-full sm:w-44" />
      </ActionForm>}
    </li>)}</ul> : <Empty>Nothing has been asked of you.</Empty>}</Section>}
  </>;
}
