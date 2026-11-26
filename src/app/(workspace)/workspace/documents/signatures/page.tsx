import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon } from "@/components/icons";
import { panelStyle, primaryButton, secondaryButton, textButton, textLink } from "@/components/ui";
import { ActionForm, Field } from "@/components/workspace/action-form";
import { BackLink, Empty, PageHeader, Section } from "@/components/workspace/presentation";
import { SignatureList } from "@/components/workspace/record-fields";
import { SignerFields, TemplateSignerFields } from "@/components/workspace/signature-fields";
import { readOrg } from "@/lib/server/insights";
import { requireMember } from "@/lib/server/member";
import { listSignatures } from "@/lib/server/signatures";
import { listSignatories, listSignatureTemplates } from "@/lib/server/templates";
import { createFromFileAction, createFromTemplateAction } from "../actions";

export const metadata: Metadata = { title: "Signatures" };

export default async function SignaturesPage({ searchParams }: { searchParams: Promise<{ new?: string; employee?: string }> }) {
  const member = await requireMember();
  const query = await searchParams;
  const canManage = member.role === "admin";
  const source = canManage && (query.new === "template" || query.new === "pdf") ? query.new : null;
  const [open, closed, people, signatories, templates] = await Promise.all([listSignatures(member, "open"), listSignatures(member, "closed"), source ? readOrg(member) : [], source ? listSignatories() : [], source === "template" ? listSignatureTemplates() : []]);
  const signers = <SignerFields people={people} signatories={signatories} employeeId={query.employee} />;
  const close = <Link href="/workspace/documents/signatures" className={textButton}>Close</Link>;
  return <>
    <BackLink href="/workspace/documents">Documents</BackLink>
    <PageHeader title="Signatures" description="Documents sent for an electronic signature. Each signer reads the exact text, types their name and confirms that it’s them." actions={canManage && !source && <>
      <Link href="/workspace/documents/signatures?new=pdf" className={secondaryButton}>From a PDF</Link><Link href="/workspace/documents/signatures?new=template" className={primaryButton}><PlusIcon aria-hidden="true" size={15} weight="bold" /> From a template</Link>
    </>} />
    {source && <section className={`${panelStyle} mb-8 max-w-2xl p-5`}>
      <h2 className="mb-4 text-[15px] font-semibold">{source === "template" ? "Prepare from a template" : "Prepare from a PDF"}</h2>
      {source === "template" ? templates.length ? <ActionForm action={createFromTemplateAction} submit="Prepare draft" pending="Preparing…" secondary={close}>
        <TemplateSignerFields templates={templates.map(({ id, name, version, starter, signatoryId, signerOrder }) => ({ id, name, version, starter, signatoryId, signerOrder }))} people={people} signatories={signatories} employeeId={query.employee} />
        <p className="text-[13px] text-muted">Nothing is sent yet. You’ll see the finished text first.</p>
      </ActionForm> : <p className="text-sm">There are no templates. <Link href="/workspace/settings/templates?new=1" className={textLink}>Write one</Link> or use a PDF.</p>
      : <ActionForm action={createFromFileAction} submit="Prepare draft" pending="Uploading…" secondary={close}>
        <Field name="file" label="PDF" type="file" required accept="application/pdf" hint="Up to 5 MB. Signers download it and sign on its page here. The file itself isn’t changed." /><Field name="title" label="Document name" required maxLength={120} />{signers}
      </ActionForm>}
    </section>}
    <Section title="Open" className="mb-9">{open.length ? <SignatureList signatures={open} /> : <Empty>No documents are waiting for a signature.</Empty>}</Section>
    <Section title="Closed">{closed.length ? <SignatureList signatures={closed} /> : <Empty>No signed documents yet.</Empty>}</Section>
  </>;
}
