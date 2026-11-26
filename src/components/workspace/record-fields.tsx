import Link from "next/link";
import type { ReactNode } from "react";
import { documentRequestLabels, signatureLabels, type DocumentRequestState, type SignatureState } from "@/lib/domains/records";
import { employmentLabels, employmentTypes, formatDate, type EmploymentType } from "@/lib/people";
import type { SignatureRow } from "@/lib/server/signatures";
import { Checkbox } from "@/components/workspace/action-form";
import { cn } from "@/lib/utils";

export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0"><dt className="text-[13px] text-muted">{label}</dt><dd className="mt-0.5 text-sm wrap-anywhere whitespace-pre-line">{children || <span className="text-muted">Not added</span>}</dd></div>;
}

export function EmploymentTypes({ legend, chosen }: { legend: string; chosen: EmploymentType[] }) {
  return <fieldset><legend className="mb-2 text-sm font-medium">{legend}</legend>
    <div className="flex flex-wrap gap-x-6 gap-y-2.5">{employmentTypes.map((type) => <Checkbox key={type} name={`type_${type}`} label={employmentLabels[type]} defaultChecked={chosen.includes(type)} />)}</div>
  </fieldset>;
}

const signatureTones: Record<SignatureState, string> = { draft: "text-muted", pending: "text-amber", completed: "text-positive", declined: "text-danger", voided: "text-muted" };
const requestTones: Record<DocumentRequestState, string> = { open: "text-amber", submitted: "text-accent", returned: "text-danger", accepted: "text-positive", cancelled: "text-muted" };
const statusStyle = "shrink-0 text-[13px] font-medium";

export function SignatureStatus({ state }: { state: SignatureState }) {
  return <span className={cn(statusStyle, signatureTones[state])}>{signatureLabels[state]}</span>;
}

export function DocumentRequestStatus({ state }: { state: DocumentRequestState }) {
  return <span className={cn(statusStyle, requestTones[state])}>{documentRequestLabels[state]}</span>;
}

export function SignatureList({ signatures, showPerson = true }: { signatures: SignatureRow[]; showPerson?: boolean }) {
  return <ul className="divide-y divide-line">
    {signatures.map((row) => <li key={row.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-3 text-sm">
      <div className="min-w-0"><Link href={`/workspace/documents/signatures/${row.id}`} className="font-medium wrap-anywhere text-accent underline-offset-3 hover:underline">{row.title}</Link>
        <p className="text-[13px] text-muted">{showPerson && `${row.employeeName}, `}{row.closedAt ? `closed ${formatDate(row.closedAt)}` : row.sentAt ? `sent ${formatDate(row.sentAt)}` : `prepared ${formatDate(row.createdAt)}`}{row.waitingFor && `, waiting for ${row.waitingFor}`}</p></div>
      <SignatureStatus state={row.state} />
    </li>)}
  </ul>;
}
