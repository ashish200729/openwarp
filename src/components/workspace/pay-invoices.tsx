import { ActionButtons, type FormAction } from "@/components/workspace/action-form";
import { Avatar } from "@/components/workspace/presentation";
import { invoiceLabels, type InvoiceState } from "@/lib/domains/pay";
import { formatMoney } from "@/lib/operations";
import { formatDate } from "@/lib/people";
import type { Invoice } from "@/lib/server/invoices";

const colors: Record<InvoiceState, string> = { pending: "text-amber", approved: "text-positive", paid: "text-positive", declined: "text-danger", cancelled: "text-muted" };

export function InvoiceList({ invoices, action, mode }: { invoices: Invoice[]; action?: FormAction; mode: "decide" | "own" | "read" }) {
  return <ul className="divide-y divide-line">
    {invoices.map((invoice) => <li key={invoice.id} className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 py-3">
      <div className="flex min-w-0 items-start gap-3">{mode !== "own" && <Avatar name={invoice.employeeName} />}
        <div className="min-w-0 text-sm"><p className="font-medium wrap-anywhere">Invoice {invoice.number}</p>
          <p className="text-muted">{mode !== "own" && `${invoice.employeeName}, `}{formatDate(invoice.issuedOn)}{invoice.documentId && <> · <a href={`/workspace/documents/${invoice.documentId}`} className="text-accent underline underline-offset-3">Attachment</a></>}</p>
          {invoice.lines.map((line, index) => <p key={index} className="mt-1 max-w-[60ch] wrap-anywhere">{line.description}: {line.quantity} at {formatMoney(line.unitCents, invoice.currency)}</p>)}
          {invoice.note && <p className="mt-1 max-w-[60ch] wrap-anywhere text-muted">{invoice.note}</p>}</div></div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2"><span className="text-sm font-medium tabular-nums">{formatMoney(invoice.amountCents, invoice.currency)}</span>
        {mode === "decide" && action ? <ActionButtons action={action} hidden={{ id: invoice.id }} name="decision" buttons={[{ value: "approved", label: "Approve", describe: `Approve ${invoice.employeeName}’s invoice ${invoice.number}`, variant: "primary" }, { value: "declined", label: "Decline", describe: `Decline ${invoice.employeeName}’s invoice ${invoice.number}` }]} />
          : <span className={`text-[13px] font-medium ${colors[invoice.state]}`}>{invoiceLabels[invoice.state]}</span>}
        {mode === "own" && action && invoice.state === "pending" && <ActionButtons action={action} hidden={{ id: invoice.id }} name="decision" buttons={[{ value: "cancelled", label: "Cancel", describe: `Cancel invoice ${invoice.number}`, variant: "text", confirm: { title: "Cancel this invoice?", body: "You’ll need to submit it again to be paid.", action: "Cancel invoice", danger: true } }]} />}</div>
    </li>)}
  </ul>;
}
