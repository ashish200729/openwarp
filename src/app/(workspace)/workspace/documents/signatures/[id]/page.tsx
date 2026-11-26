import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CaretDownIcon, DownloadSimpleIcon } from "@/components/icons";
import { secondaryButton, textLink } from "@/components/ui";
import { ActionButtons, ActionForm, Checkbox, Field } from "@/components/workspace/action-form";
import { ConfirmIdentity } from "@/components/workspace/confirm-identity";
import { BackLink, Callout, Notice, PageHeader, Section } from "@/components/workspace/presentation";
import { SignatureStatus } from "@/components/workspace/record-fields";
import { PrintButton } from "@/components/workspace/record-print";
import { RecordText } from "@/components/workspace/record-text";
import { consentText, mergeFields, signatureEventLabels } from "@/lib/domains/records";
import { formatTime } from "@/lib/people";
import { requireMember, workspaceName } from "@/lib/server/member";
import { confirmationOptions } from "@/lib/server/reauth";
import { readSignature, type SignatureDetail } from "@/lib/server/signatures";
import { declineAction, saveDraftAction, sendSignatureAction, signAction, voidAction } from "../../actions";
import "./print.css";

export const metadata: Metadata = { title: "Document to sign" };

const notices: Record<string, string> = { sent: "Sent for signature.", signed: "Signed. Your signature is recorded.", declined: "You declined to sign.", voided: "Document voided." };

function Events({ document }: { document: SignatureDetail }) {
  return <ol className="divide-y divide-line">
    {document.events.map((event) => <li key={event.id} className="grid gap-x-5 gap-y-0.5 py-3 text-sm sm:grid-cols-[12rem_minmax(0,1fr)]">
      <time dateTime={event.happenedAt.toISOString()} className="text-[13px] text-muted tabular-nums">{formatTime(event.happenedAt)} UTC</time>
      <div className="min-w-0"><p className="font-medium wrap-anywhere">{signatureEventLabels[event.event]} by {event.userName}</p>
        {event.typedName && <p className="wrap-anywhere">Typed name: {event.typedName}</p>}
        {event.consentText && <p className="text-[13px] text-muted">{event.consentText}</p>}
        {event.reason && <p className="wrap-anywhere whitespace-pre-line">{event.reason}</p>}
        {event.event === "signed" && <dl className="mt-1 grid gap-0.5 text-[13px] text-muted [&_dd]:wrap-anywhere [&_dt]:inline [&_div>dd]:inline">
          <div><dt>Identity confirmed with: </dt><dd>{event.confirmedBy === "sso" ? "single sign-on" : "password"}</dd></div>
          <div><dt>Account: </dt><dd>{event.userId}</dd></div>
          <div><dt>Network address (keyed hash): </dt><dd className="font-mono text-xs">{event.ipHash ?? "Not available"}</dd></div>
          <div><dt>Browser: </dt><dd>{event.userAgent || "Not available"}</dd></div>
        </dl>}</div>
    </li>)}
  </ol>;
}

export default async function SignaturePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const member = await requireMember();
  const [{ id }, { saved }] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(id).success) notFound();
  const document = await readSignature(member, id);
  if (!document) notFound();
  const canManage = member.role === "admin";
  const options = document.myTurn ? await confirmationOptions(member) : null;
  const draft = document.state === "draft";
  const noAccount = document.signers.filter((signer) => !signer.hasAccount);
  const order = document.signers.map((signer) => signer.name).join(", then ");
  return <>
    <div data-screen><BackLink href="/workspace/documents/signatures">Signatures</BackLink></div>
    <PageHeader title={document.title} description={`${draft ? "For" : "Sent to"} ${order}.`} actions={<span data-screen className="flex flex-wrap items-center gap-2">
      {document.hasFile && <a href={`/workspace/documents/signatures/${id}/file`} className={secondaryButton}><DownloadSimpleIcon aria-hidden="true" size={15} /> Download the PDF</a>}
      {!draft && <PrintButton />}
      {draft && canManage && document.missing.length === 0 && <ActionButtons action={sendSignatureAction} hidden={{ id, version: document.version }} name="operation" buttons={[{ value: "send", label: "Send for signature", describe: "Send for signature", variant: "primary", confirm: { title: `Send ${document.title}?`, body: `It goes to ${order}. The text can’t be changed after that.`, action: "Send document" } }]} />}
    </span>} />
    <div data-screen>
      {typeof saved === "string" && Object.hasOwn(notices, saved) && <Notice>{notices[saved]}</Notice>}
      {draft && document.starter && <Callout>This text is a starting point, not legal advice. Have it reviewed by counsel before you send it.</Callout>}
      {draft && document.missing.length > 0 && <Callout>No value yet for {document.missing.map((field) => mergeFields[field].toLowerCase()).join(", ")}. {document.missing.includes("salary") ? <Link href={`/workspace/people/${document.employeeId}/job`} className={textLink}>Record pay</Link> : <Link href={`/workspace/people/${document.employeeId}/edit`} className={textLink}>Edit the profile</Link>}, or take the field out of the text below.</Callout>}
      {canManage && (draft || document.state === "pending") && noAccount.length > 0 && <Callout>{noAccount.map((signer) => signer.name).join(" and ")} can’t sign without an account. <Link href="/workspace/settings/access" className={textLink}>Create one in Access</Link></Callout>}
    </div>
    <div data-certificate className="grid max-w-3xl gap-9">
      <Section title={draft ? "Preview" : "Document"} action={<SignatureStatus state={document.state} />}>
        {document.body !== null ? <RecordText source={document.body} className="py-4" /> : <p className="py-4 text-sm">This document is a PDF. Download it to read it. {!draft && "The fingerprint below identifies the exact file."}</p>}
      </Section>
      {document.myTurn && <Section title="Sign" className="print:hidden"><div className="pt-3">
        {document.hasFile && !document.openedFile ? <p className="text-sm">Download and read the PDF before you sign. <a href={`/workspace/documents/signatures/${id}/file`} className={textLink}>Open it now</a>, then reload this page.</p>
          : <ActionForm action={signAction} submit="Sign document" pending="Signing…" hidden={{ id, sha256: document.sha256 ?? "" }} className="max-w-xl">
            <Field name="typedName" label="Your full name" required autoComplete="off" maxLength={200} hint={`Type it as ${document.signAs}.`} />
            {options && <ConfirmIdentity options={options} label="Your password" />}
            <Checkbox name="consent" label={consentText} />
          </ActionForm>}
        <details className="group mt-5"><summary className="inline-flex min-h-10 items-center gap-1.5 rounded text-sm text-muted hover:text-foreground">Decline to sign<CaretDownIcon aria-hidden="true" size={12} className="group-open:rotate-180" /></summary>
          <ActionForm action={declineAction} submit="Decline" variant="danger" hidden={{ id }} className="mt-2 max-w-xl" confirm={{ title: "Decline to sign?", body: "Administrators see your reason. The document closes and can’t be signed later.", action: "Decline to sign", danger: true }}><Field name="reason" label="Reason" required multiline maxLength={500} /></ActionForm>
        </details>
      </div></Section>}
      {document.state === "pending" && document.mySigner && !document.myTurn && <p className="text-sm text-muted print:hidden">{document.mySigner.signedAt ? "You’ve signed. Someone else still has to." : "Someone else signs before you. You’ll be told when it’s your turn."}</p>}
      {draft && canManage && document.draftBody !== null && <Section title="Edit this draft"><div className="pt-3"><ActionForm key={document.version} action={saveDraftAction} submit="Save draft" variant="secondary" hidden={{ id, version: document.version }}>
        <Field name="title" label="Document name" required maxLength={120} defaultValue={document.title} />
        <Field name="body" label="Text" required multiline maxLength={20_000} defaultValue={document.draftBody} className="min-h-80 font-mono text-[13px]!" hint="Changes apply to this document only. The template stays as it is." />
      </ActionForm></div></Section>}
      {!draft && <Section title="Certificate">
        <p className={`pt-3 text-sm font-medium ${document.intact ? "text-positive" : "text-danger"}`}>{document.intact ? "The content and the signing record match what was recorded." : "The content or the signing record doesn’t match what was recorded. Don’t rely on this document."}</p>
        <dl className="mt-3 grid gap-3 text-sm"><div><dt className="text-[13px] text-muted">Issued by</dt><dd className="wrap-anywhere">{workspaceName()}</dd></div><div><dt className="text-[13px] text-muted">Document ID</dt><dd className="font-mono text-xs wrap-anywhere">{document.id}</dd></div><div><dt className="text-[13px] text-muted">SHA-256 fingerprint of the content</dt><dd className="font-mono text-xs wrap-anywhere">{document.sha256}</dd></div></dl>
        <h3 className="mt-5 text-sm font-semibold">Signers</h3>
        <ol className="mt-1 divide-y divide-line">{document.signers.map((signer) => <li key={signer.id} className="flex flex-wrap justify-between gap-x-6 gap-y-0.5 py-2 text-sm"><span className="wrap-anywhere">{signer.name} <span className="text-muted">· {signer.kind === "employee" ? "Employee" : "For the company"}</span></span><span className={signer.signedAt ? "text-positive" : "text-muted"}>{signer.signedAt ? `Signed ${formatTime(signer.signedAt)} UTC` : "Not signed"}</span></li>)}</ol>
        <h3 className="mt-5 text-sm font-semibold">Events</h3>
        <Events document={document} />
      </Section>}
      {canManage && (draft || document.state === "pending" || document.state === "declined") && <details className="group print:hidden"><summary className="inline-flex min-h-10 items-center gap-1.5 rounded text-sm text-muted hover:text-foreground">Void this document<CaretDownIcon aria-hidden="true" size={12} className="group-open:rotate-180" /></summary>
        <ActionForm action={voidAction} submit="Void" variant="danger" hidden={{ id }} className="mt-2 max-w-xl" confirm={{ title: "Void this document?", body: "Nobody can sign it after this. The record of what happened stays.", action: "Void document", danger: true }}><Field name="reason" label="Reason for voiding" required multiline maxLength={500} /></ActionForm>
      </details>}
    </div>
  </>;
}
