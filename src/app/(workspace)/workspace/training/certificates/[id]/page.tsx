import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { BackLink } from "@/components/workspace/presentation";
import { PrintButton } from "@/components/workspace/record-print";
import { formatDate } from "@/lib/people";
import { requireMember, workspaceName } from "@/lib/server/member";
import { readCertificate } from "@/lib/server/training";

export const metadata: Metadata = { title: "Certificate" };

export default async function CertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const member = await requireMember();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const certificate = await readCertificate(member, id);
  if (!certificate) notFound();
  return <>
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden"><BackLink href="/workspace/training">Training</BackLink><PrintButton /></div>
    <article className="mx-auto max-w-2xl border border-line-strong px-6 py-14 text-center sm:px-12 print:fixed print:inset-0 print:z-50 print:max-w-none print:content-center print:border-0 print:bg-surface">
      <p className="text-sm text-muted">{workspaceName()}</p>
      <h1 className="mt-6 text-2xl font-semibold tracking-[-0.015em]">Certificate of completion</h1>
      <p className="mt-8 text-sm text-muted">This records that</p>
      <p className="mt-1 text-xl font-semibold wrap-anywhere">{certificate.employeeName}</p>
      <p className="mt-5 text-sm text-muted">completed</p>
      <p className="mt-1 text-xl font-semibold wrap-anywhere">{certificate.courseTitle}</p>
      <p className="mt-8 text-sm">{formatDate(certificate.completedOn)}{certificate.scorePercent !== null && `, quiz score ${certificate.scorePercent}%`}</p>
      {certificate.expiresOn && <p className="mt-1 text-sm text-muted">Valid until {formatDate(certificate.expiresOn)}</p>}
      <p className="mt-10 text-[13px] wrap-anywhere text-muted">Record {certificate.id}</p>
    </article>
  </>;
}
