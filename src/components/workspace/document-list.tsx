import Link from "next/link";
import { ActionButtons, type FormAction } from "@/components/workspace/action-form";
import { CheckCircleIcon } from "@/components/icons";
import { addDays, documentLabels, today } from "@/lib/operations";
import { formatDate } from "@/lib/people";
import type { DocumentRow } from "@/lib/server/documents";
import { acknowledgeDocumentAction, archiveDocumentAction } from "@/app/(workspace)/workspace/operations";

const acknowledge: FormAction = acknowledgeDocumentAction;
const archive: FormAction = archiveDocumentAction;

export function fileSize(bytes: number) {
  return bytes < 1_048_576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export function Expiry({ date }: { date: string }) {
  const day = today();
  return <span className={date < day ? "text-danger" : date <= addDays(day, 30) ? "text-amber" : undefined}>{date < day ? "expired" : "expires"} {formatDate(date)}</span>;
}

export function DocumentList({ documents, canManage, employeeId, showPerson = true }: { documents: DocumentRow[]; canManage: boolean; employeeId: string | null; showPerson?: boolean }) {
  return <ul className="divide-y divide-line">
    {documents.map((document) => {
      const mine = Boolean(employeeId) && (document.employeeId === null || document.employeeId === employeeId);
      return <li key={document.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3 text-sm">
        <div className="min-w-0"><a id={`document-${document.id}`} href={`/workspace/documents/${document.id}`} className="font-medium wrap-anywhere text-accent underline-offset-3 hover:underline">{document.name}</a>
          <p className="text-[13px] text-muted">{document.folder && `${document.folder}, `}{documentLabels[document.category]}{showPerson && document.employeeId && `, ${document.employeeName}`}, {fileSize(document.sizeBytes)}, {document.version > 1 && `version ${document.version}, `}added {formatDate(document.createdAt)}{document.expiresOn && <>, <Expiry date={document.expiresOn} /></>}{document.needsAcknowledgement && canManage && ` · ${document.acknowledgedCount} of ${document.expectedCount} acknowledged`}</p></div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {document.needsAcknowledgement && mine && (document.acknowledged ? <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-positive"><CheckCircleIcon aria-hidden="true" size={14} weight="fill" />Acknowledged</span>
            : <ActionButtons action={acknowledge} hidden={{ id: document.id }} name="operation" buttons={[{ value: "acknowledge", label: "I’ve read this", describe: `I’ve read this: ${document.name}`, variant: "primary" }]} />)}
          {canManage && <Link href={`/workspace/documents/${document.id}/details`} aria-describedby={`document-${document.id}`} className="inline-flex min-h-10 items-center rounded px-1 text-[13px] text-muted underline-offset-3 hover:text-foreground hover:underline pointer-fine:min-h-8">Details</Link>}
          {canManage && <ActionButtons action={archive} hidden={{ id: document.id }} name="operation" buttons={[{ value: "archive", label: "Archive", describe: `Archive ${document.name}`, variant: "text", confirm: { title: `Archive ${document.name}?`, body: "It leaves every list. Administrators can still open it from its link.", action: "Archive document", danger: true } }]} />}
        </div>
      </li>;
    })}
  </ul>;
}
