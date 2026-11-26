import type { Metadata } from "next";
import Link from "next/link";
import { panelStyle, primaryButton, textButton } from "@/components/ui";
import { ActionForm, Field } from "@/components/workspace/action-form";
import { InvoiceList } from "@/components/workspace/pay-invoices";
import { Callout, Empty, Notice, PageHeader, Section } from "@/components/workspace/presentation";
import { invoiceLineCount } from "@/lib/domains/pay";
import { today } from "@/lib/operations";
import { approvedInvoices, canInvoice, ownInvoices, pendingInvoices } from "@/lib/server/invoices";
import { requireMember } from "@/lib/server/member";
import { readCompany } from "@/lib/server/settings";
import { decideInvoiceAction, submitInvoiceAction } from "./actions";

export const metadata: Metadata = { title: "Invoices" };

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ new?: string; saved?: string }> }) {
  const member = await requireMember();
  const query = await searchParams;
  const decides = member.role === "admin" || member.managesPeople;
  const contractor = await canInvoice(member);
  const adding = query.new === "1" && contractor;
  const [pending, own, approved, company] = await Promise.all([decides ? pendingInvoices(member) : [], ownInvoices(member), approvedInvoices(member), readCompany()]);
  return <>
    <PageHeader title="Invoices" description="Approved contractor invoices are paid, untaxed, in the next pay run." actions={contractor && !adding && <Link href="/workspace/invoices?new=1" className={primaryButton}>Submit an invoice</Link>} />
    {query.saved === "submitted" && <Notice>Invoice sent for approval.</Notice>}
    {!contractor && !decides && !own.length && <Callout>Invoices are for contractors with an account linked to their employee record.</Callout>}
    {adding && <section className={`${panelStyle} mb-8 max-w-3xl p-5`}>
      <h2 className="mb-4 text-[15px] font-semibold">Submit an invoice</h2>
      <ActionForm action={submitInvoiceAction} submit="Send for approval" pending="Sending…" secondary={<Link href="/workspace/invoices" className={textButton}>Close</Link>}>
        <div className="grid gap-4 sm:grid-cols-2"><Field name="number" label="Invoice number" required maxLength={40} /><Field name="issuedOn" label="Invoice date" type="date" required defaultValue={today()} /></div>
        {Array.from({ length: invoiceLineCount }, (_, index) => index + 1).map((row) => <div key={row} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem_9rem]">
          <Field name={`description${row}`} label={`Line ${row} description`} maxLength={160} required={row === 1} /><Field name={`quantity${row}`} label={`Line ${row} quantity`} inputMode="decimal" defaultValue="1" required={row === 1} /><Field name={`price${row}`} label={`Line ${row} price in ${company.currency}`} inputMode="decimal" placeholder="0.00" required={row === 1} />
        </div>)}
        <Field name="file" label="Attachment" type="file" accept="application/pdf,image/png,image/jpeg" hint="PDF, PNG or JPEG, up to 5 MB." />
        <Field name="note" label="Note" multiline maxLength={500} />
      </ActionForm>
    </section>}
    {decides && <Section title="Waiting for approval" className="mb-9">{pending.length ? <InvoiceList invoices={pending} action={decideInvoiceAction} mode="decide" /> : <Empty>No invoices are waiting.</Empty>}</Section>}
    {(contractor || own.length > 0) && <Section title="Your invoices" className="mb-9">{own.length ? <InvoiceList invoices={own} action={decideInvoiceAction} mode="own" /> : <Empty>You haven’t submitted an invoice.</Empty>}</Section>}
    {member.role === "admin" && <Section title="Approved">{approved.length ? <InvoiceList invoices={approved} mode="read" /> : <Empty>No approved invoices yet.</Empty>}</Section>}
  </>;
}
