import type { ReactNode } from "react";
import { ActionForm, Field } from "@/components/workspace/action-form";
import { StatusText, type Tone } from "@/components/workspace/workplace-parts";
import { noticeLabels, obligationCategories, obligationLabels, recurrenceLabels, recurrences, type NoticeState } from "@/lib/domains/workplace";
import { today } from "@/lib/operations";
import type { NoticeRow, Obligation } from "@/lib/server/compliance";
import type { AccountOption } from "@/lib/server/checklists";
import { saveNoticeAction, saveObligationAction } from "@/app/(workspace)/workspace/compliance/actions";

const noticeTones: Record<NoticeState, Tone> = { received: "amber", in_progress: "accent", responded: "positive", closed: "muted" };

export function NoticeStatus({ state }: { state: NoticeState }) {
  return <StatusText tone={noticeTones[state]}>{noticeLabels[state]}</StatusText>;
}

const accountOptions = (label: string, accounts: AccountOption[], current?: { id: string | null; name: string | null }) => [
  { value: "", label }, ...accounts.map((account) => ({ value: account.id, label: account.name })),
  ...(current?.id && !accounts.some((account) => account.id === current.id) ? [{ value: current.id, label: current.name ?? "Current" }] : []),
];

export function ObligationForm({ obligation, admins, jurisdictions, cancel }: { obligation?: Obligation; admins: AccountOption[]; jurisdictions: string[]; cancel: ReactNode }) {
  return <ActionForm action={saveObligationAction} submit={obligation ? "Save obligation" : "Add obligation"} hidden={obligation ? { id: obligation.id, version: obligation.version } : {}} secondary={cancel}>
    <Field name="name" label="Name" required maxLength={120} defaultValue={obligation?.name} placeholder="Quarterly payroll return" />
    <div className="grid gap-4 sm:grid-cols-2">
      <Field name="category" label="Category" required defaultValue={obligation?.category ?? "filing"} options={obligationCategories.map((value) => ({ value, label: obligationLabels[value] }))} /><Field name="authority" label="Authority" maxLength={120} defaultValue={obligation?.authority} />
      <Field name="jurisdiction" label="Jurisdiction" maxLength={100} defaultValue={obligation?.jurisdiction} list="jurisdictions" /><Field name="ownerId" label="Owner" defaultValue={obligation?.ownerId ?? ""} options={accountOptions("All administrators", admins, obligation && { id: obligation.ownerId, name: obligation.owner })} />
      <Field name="dueOn" label={obligation ? "Next due date" : "Due date"} type="date" required defaultValue={obligation?.dueOn ?? today()} /><Field name="recurrence" label="Repeats" required defaultValue={obligation?.recurrence ?? "none"} options={recurrences.map((value) => ({ value, label: recurrenceLabels[value] }))} />
    </div>
    <datalist id="jurisdictions">{jurisdictions.map((value) => <option key={value} value={value} />)}</datalist>
    <Field name="reference" label="Account or reference number" maxLength={80} autoComplete="off" hint={obligation?.hasReference ? "A number is stored. Enter a new one to replace it." : "Encrypted before it is stored."} />
    <Field name="notes" label="Notes" multiline maxLength={1000} defaultValue={obligation?.notes} />
  </ActionForm>;
}

export function NoticeForm({ notice, admins, obligations, cancel }: { notice?: NoticeRow; admins: AccountOption[]; obligations: { id: string; name: string }[]; cancel: ReactNode }) {
  return <ActionForm action={saveNoticeAction} submit={notice ? "Save notice" : "Record notice"} hidden={notice ? { id: notice.id, version: notice.version } : {}} secondary={cancel}>
    <Field name="title" label="Title" required maxLength={160} defaultValue={notice?.title} />
    <div className="grid gap-4 sm:grid-cols-2">
      <Field name="authority" label="From" maxLength={120} defaultValue={notice?.authority} /><Field name="assigneeId" label="Assigned to" defaultValue={notice?.assigneeId ?? ""} options={accountOptions("All administrators", admins, notice && { id: notice.assigneeId, name: notice.assignee })} />
      <Field name="receivedOn" label="Date received" type="date" required defaultValue={notice?.receivedOn ?? today()} /><Field name="deadlineOn" label="Deadline" type="date" defaultValue={notice?.deadlineOn ?? ""} />
    </div>
    <Field name="obligationId" label="Related obligation" defaultValue={notice?.obligationId ?? ""} options={[{ value: "", label: "None" }, ...obligations.map((entry) => ({ value: entry.id, label: entry.name }))]} />
    {!notice && <Field name="file" label="Copy of the notice" type="file" accept="application/pdf,image/png,image/jpeg" hint="PDF, PNG or JPEG, up to 5 MB. Only administrators can open it." />}
  </ActionForm>;
}
