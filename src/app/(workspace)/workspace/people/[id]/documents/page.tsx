import type { Metadata } from "next";
import Link from "next/link";
import { textLink } from "@/components/ui";
import { DocumentList } from "@/components/workspace/document-list";
import { Empty, Section } from "@/components/workspace/presentation";
import { ProfileHeader } from "@/components/workspace/profile-header";
import { SignatureList } from "@/components/workspace/record-fields";
import { listDocuments } from "@/lib/server/documents";
import { employeeSignatures } from "@/lib/server/signatures";
import { privateProfile } from "../profile";

export const metadata: Metadata = { title: "Documents" };

export default async function ProfileDocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { member, employee, canManage } = await privateProfile(params);
  const [documents, signatures] = await Promise.all([listDocuments(member, employee.id), employeeSignatures(member, employee.id)]);
  const current = employee.status !== "archived";
  return <>
    <ProfileHeader employee={employee} current="documents" canSeePrivate />
    <div className="grid gap-9">
      <Section title="Personal documents" action={canManage && current && <Link href={`/workspace/documents?new=1&employee=${employee.id}`} className={`${textLink} text-[13px]`}>Add document</Link>}>
        {documents.length ? <DocumentList documents={documents} canManage={canManage} employeeId={member.employeeId} showPerson={false} /> : <Empty>No personal documents yet.</Empty>}
      </Section>
      <Section title="Signatures" action={canManage && current && <Link href={`/workspace/documents/signatures?new=template&employee=${employee.id}`} className={`${textLink} text-[13px]`}>Send for signature</Link>}>
        {signatures.length ? <SignatureList signatures={signatures} showPerson={false} /> : <Empty>No documents to sign.</Empty>}
      </Section>
    </div>
  </>;
}
