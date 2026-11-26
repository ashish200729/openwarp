import { ActionButtons, type FormAction } from "@/components/workspace/action-form";
import { Avatar, RequestStatus } from "@/components/workspace/presentation";
import { expenseLabels, formatDays, formatMoney, today } from "@/lib/operations";
import { formatDate } from "@/lib/people";
import type { Expense } from "@/lib/server/expenses";
import type { TimeOffRequest } from "@/lib/server/time-off";

export function dateRange(start: string, end: string) {
  return start === end ? formatDate(start) : `${formatDate(start)} to ${formatDate(end)}`;
}

const decide = (what: string) => [
  { value: "approved", label: "Approve", describe: `Approve ${what}`, variant: "primary" as const },
  { value: "declined", label: "Decline", describe: `Decline ${what}` },
];

export function TimeOffList({ requests, action, canCancel }: { requests: TimeOffRequest[]; action?: FormAction; canCancel: boolean }) {
  return <ul className="divide-y divide-line">
    {requests.map((request) => <li key={request.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3 text-sm">
      <div className="min-w-0"><p className="font-medium">{dateRange(request.startsOn, request.endsOn)}</p><p className="text-muted">{request.typeName}, {request.halfDay ? "half day" : formatDays(request.days)}{request.decidedBy && request.state !== "cancelled" ? ` · ${request.decidedBy}` : ""}</p></div>
      <div className="flex items-center gap-3"><RequestStatus state={request.state} />
        {action && canCancel && (request.state === "pending" || request.state === "approved" && request.startsOn > today()) && <ActionButtons action={action} hidden={{ id: request.id }} name="decision" buttons={[{ value: "cancelled", label: "Cancel", describe: `Cancel ${request.typeName} on ${formatDate(request.startsOn)}`, variant: "text", confirm: { title: "Cancel this request?", body: `${dateRange(request.startsOn, request.endsOn)} goes back to your balance.`, action: "Cancel request", danger: true } }]} />}</div>
    </li>)}
  </ul>;
}

export function ExpenseList({ expenses, action, mode }: { expenses: Expense[]; action?: FormAction; mode: "decide" | "own" | "read" }) {
  return <ul className="divide-y divide-line">
    {expenses.map((expense) => <li key={expense.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-3">
      <div className="flex min-w-0 items-start gap-3">{mode !== "own" && <Avatar name={expense.employeeName} />}
        <div className="min-w-0 text-sm"><p className="font-medium wrap-anywhere">{expense.merchant} <span className="font-normal text-muted">· {expenseLabels[expense.category]}</span></p>
          <p className="text-muted">{mode !== "own" && `${expense.employeeName}, `}{formatDate(expense.spentOn)}{expense.receiptId && <> · <a href={`/workspace/documents/${expense.receiptId}`} className="text-accent underline underline-offset-3">Receipt</a></>}</p>
          {expense.note && <p className="mt-1 max-w-[60ch] wrap-anywhere">{expense.note}</p>}</div></div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2"><span className="text-sm font-medium tabular-nums">{formatMoney(expense.amountCents, expense.currency)}</span>
        {mode === "decide" && action ? <ActionButtons action={action} hidden={{ id: expense.id }} name="decision" buttons={decide(`${expense.employeeName}’s ${expense.merchant} expense`)} /> : <RequestStatus state={expense.state} />}
        {mode === "own" && action && expense.state === "pending" && <ActionButtons action={action} hidden={{ id: expense.id }} name="decision" buttons={[{ value: "cancelled", label: "Cancel", describe: `Cancel ${expense.merchant} expense`, variant: "text", confirm: { title: "Cancel this expense?", body: "You’ll need to submit it again to be reimbursed.", action: "Cancel expense", danger: true } }]} />}</div>
    </li>)}
  </ul>;
}
