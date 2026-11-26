import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { DownloadSimpleIcon } from "@/components/icons";
import { secondaryButton, tableBody, tableHead, textLink } from "@/components/ui";
import { ActionForm, Field } from "@/components/workspace/action-form";
import { Expiry, fileSize } from "@/components/workspace/document-list";
import { BackLink, Callout, Empty, Notice, PageHeader, Section } from "@/components/workspace/presentation";
import { documentLabels } from "@/lib/operations";
import { formatDate } from "@/lib/people";
import { documentDetail, listFolders } from "@/lib/server/documents";
import { requireAdmin } from "@/lib/server/member";
import { addVersionAction, saveDocumentDetailsAction } from "../../actions";

export const metadata: Metadata = { title: "Document details" };

export default async function DocumentDetailsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const member = await requireAdmin();
  const [{ id }, { saved }] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(id).success) notFound();
  const detail = await documentDetail(id);
  if (!detail) notFound();
  const { document, versions, missing } = detail;
  const folders = document.archived ? [] : await listFolders(member);
  return <>
    <BackLink href={document.employeeId ? `/workspace/people/${document.employeeId}/documents` : "/workspace/documents"}>{document.employeeId ? "Personal documents" : "Documents"}</BackLink>
    <PageHeader title={document.name} description={[documentLabels[document.category], document.employeeName || "Everyone in the company", fileSize(document.sizeBytes)].join(", ")} actions={<a href={`/workspace/documents/${document.id}`} className={secondaryButton}><DownloadSimpleIcon aria-hidden="true" size={15} /> Download</a>} />
    {saved === "version" ? <Notice>New version added.</Notice> : saved === "details" && <Notice>Details saved.</Notice>}
    {document.archived && <Callout>This document is archived. It no longer appears in any list.</Callout>}
    <div className="grid gap-x-12 gap-y-9 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="grid content-start gap-9">
        <Section title="Versions">
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Versions of this document"><table className="w-full min-w-96"><caption className="sr-only">Versions, newest first</caption><thead className={tableHead}><tr><th scope="col">Version</th><th scope="col">Added</th><th scope="col">By</th><th scope="col">Size</th></tr></thead>
            <tbody className={tableBody}>{versions.map((version) => <tr key={version.id}><th scope="row"><a href={`/workspace/documents/${version.id}`} className={textLink}>Version {version.version}</a>{version.id === document.id && <span className="ml-2 text-[13px] text-positive">Current</span>}</th><td className="whitespace-nowrap">{formatDate(version.createdAt)}</td><td className="wrap-anywhere">{version.uploadedBy}</td><td className="whitespace-nowrap">{fileSize(version.sizeBytes)}{version.expiresOn && <span className="block text-[13px] text-muted"><Expiry date={version.expiresOn} /></span>}</td></tr>)}</tbody></table></div>
        </Section>
        {document.needsAcknowledgement && <Section title={`Acknowledged by ${document.acknowledgedCount} of ${document.expectedCount}`}>
          {missing.length ? <><p className="pt-3 text-sm text-muted">Still to read the current version:</p><ul className="mt-1 columns-1 gap-8 text-sm sm:columns-2">{missing.map((person) => <li key={person.id} className="py-1"><Link href={`/workspace/people/${person.id}`} className="wrap-anywhere hover:underline">{person.name}</Link></li>)}</ul></> : <Empty>Everyone has acknowledged the current version.</Empty>}
        </Section>}
      </div>
      {!document.archived && <div className="grid content-start gap-9">
        <Section title="Folder and expiry"><div className="pt-3"><ActionForm key={`${document.folder}-${document.expiresOn}`} action={saveDocumentDetailsAction} submit="Save details" variant="secondary" hidden={{ id: document.id }}>
          <Field name="folder" label="Folder" maxLength={60} list="folders" defaultValue={document.folder} /><Field name="expiresOn" label="Expires on" type="date" defaultValue={document.expiresOn ?? ""} hint="Administrators and the person are reminded 30 days ahead." />
          <datalist id="folders">{folders.map((folder) => <option key={folder} value={folder} />)}</datalist>
        </ActionForm></div></Section>
        <Section title="Upload a new version"><div className="pt-3"><ActionForm action={addVersionAction} submit="Add version" pending="Uploading…" variant="secondary" hidden={{ id: document.id }}>
          <Field name="file" label="File" type="file" required accept="application/pdf,image/png,image/jpeg" hint={`PDF, PNG or JPEG, up to 5 MB.${document.needsAcknowledgement ? " People are asked to read and confirm it again." : ""}`} />
          <Field name="expiresOn" label="New expiry date" type="date" />
          <p className="text-[13px] text-muted">Earlier versions stay available to administrators.</p>
        </ActionForm></div></Section>
      </div>}
    </div>
  </>;
}
