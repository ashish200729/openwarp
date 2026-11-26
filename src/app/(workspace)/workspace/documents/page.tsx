import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon } from "@/components/icons";
import { inputStyle, panelStyle, primaryButton, secondaryButton, textButton, textLink } from "@/components/ui";
import { ActionForm, Checkbox, Field } from "@/components/workspace/action-form";
import { DocumentList } from "@/components/workspace/document-list";
import { Empty, Notice, PageHeader, Pagination, Section } from "@/components/workspace/presentation";
import { documentCategories, documentLabels } from "@/lib/operations";
import { documentFilters, listFolders, searchDocuments } from "@/lib/server/documents";
import { readOrg } from "@/lib/server/insights";
import { requireMember } from "@/lib/server/member";
import { addDocumentAction } from "./actions";

export const metadata: Metadata = { title: "Documents" };

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ new?: string; saved?: string; employee?: string; q?: string; category?: string; folder?: string; page?: string }> }) {
  const member = await requireMember();
  const query = await searchParams;
  const canManage = member.role === "admin";
  const adding = canManage && query.new === "1";
  const filters = documentFilters(query);
  const filtered = Boolean(filters.query || filters.category || filters.folder);
  const [company, personal, folders, people] = await Promise.all([searchDocuments(member, "company", { ...filters, page: 1 }, 200), searchDocuments(member, "personal", filters), listFolders(member), adding ? readOrg(member) : []]);
  const url = (page: number) => `/workspace/documents?${new URLSearchParams({ q: filters.query, category: filters.category, folder: filters.folder, page: String(page) })}`;
  const nothing = filtered ? "No documents match." : null;
  return <>
    <PageHeader title="Documents" description="Company documents are visible to everyone. Personal documents are visible to that person and administrators." actions={<>
      <Link href="/workspace/documents/signatures" className={secondaryButton}>Signatures</Link>
      {(canManage || member.employeeId) && <Link href="/workspace/documents/requests" className={secondaryButton}>Requests</Link>}
      {canManage && !adding && <Link href="/workspace/documents?new=1" className={primaryButton}><PlusIcon aria-hidden="true" size={15} weight="bold" /> Add document</Link>}
    </>} />
    {query.saved === "added" && <Notice>Document added.</Notice>}
    {adding ? <section className={`${panelStyle} mb-8 max-w-2xl p-5`}>
      <h2 className="mb-4 text-[15px] font-semibold">Add a document</h2>
      <ActionForm action={addDocumentAction} submit="Add document" pending="Uploading…" secondary={<Link href="/workspace/documents" className={textButton}>Close</Link>}>
        <Field name="file" label="File" type="file" required accept="application/pdf,image/png,image/jpeg" hint="PDF, PNG or JPEG, up to 5 MB." />
        <div className="grid gap-4 sm:grid-cols-2"><Field name="name" label="Name" required maxLength={120} /><Field name="category" label="Category" required options={documentCategories.map((value) => ({ value, label: documentLabels[value] }))} />
          <Field name="folder" label="Folder" maxLength={60} list="folders" hint="Type a new one or choose one you already use." /><Field name="expiresOn" label="Expires on" type="date" /></div>
        <datalist id="folders">{folders.map((folder) => <option key={folder} value={folder} />)}</datalist>
        <Field name="employeeId" label="Shared with" required defaultValue={query.employee ?? ""} options={[{ value: "", label: "Everyone in the company" }, ...people.map((person) => ({ value: person.id, label: person.name }))]} />
        <Checkbox name="needsAcknowledgement" label="Ask people to confirm they’ve read it" />
      </ActionForm>
    </section> : <form role="search" aria-label="Documents" className="mb-7 flex flex-wrap items-end gap-3">
      <div className="w-full sm:w-64"><label htmlFor="document-query" className="mb-1.5 block text-sm font-medium">Search</label><input id="document-query" name="q" type="search" maxLength={120} defaultValue={filters.query} className={inputStyle} /></div>
      <div className="w-full sm:w-40"><label htmlFor="document-category" className="mb-1.5 block text-sm font-medium">Category</label><select id="document-category" name="category" defaultValue={filters.category} className={inputStyle}><option value="">All categories</option>{documentCategories.map((value) => <option key={value} value={value}>{documentLabels[value]}</option>)}</select></div>
      {folders.length > 0 && <div className="w-full sm:w-44"><label htmlFor="document-folder" className="mb-1.5 block text-sm font-medium">Folder</label><select id="document-folder" name="folder" defaultValue={filters.folder} className={inputStyle}><option value="">All folders</option>{folders.map((folder) => <option key={folder} value={folder}>{folder}</option>)}</select></div>}
      <button type="submit" className={secondaryButton}>Filter</button>
      {filtered && <Link href="/workspace/documents" className={textLink}>Clear</Link>}
    </form>}
    <Section title="Company" className="mb-9">{company.documents.length ? <DocumentList documents={company.documents} canManage={canManage} employeeId={member.employeeId} /> : <Empty>{nothing ?? "No company documents yet."}</Empty>}</Section>
    <Section title={canManage ? "Personal" : "Yours"}>{personal.documents.length ? <DocumentList documents={personal.documents} canManage={canManage} employeeId={member.employeeId} /> : <Empty>{nothing ?? "No personal documents yet."}</Empty>}<Pagination page={personal.page} pages={personal.pages} url={url} /></Section>
  </>;
}
