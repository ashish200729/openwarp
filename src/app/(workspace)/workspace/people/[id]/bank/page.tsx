import type { Metadata } from "next";
import Link from "next/link";
import { tableBody, tableHead } from "@/components/ui";
import { ActionForm, Field } from "@/components/workspace/action-form";
import { ConfirmIdentity } from "@/components/workspace/confirm-identity";
import { Empty, Notice, Section } from "@/components/workspace/presentation";
import { ProfileHeader } from "@/components/workspace/profile-header";
import { formatTime } from "@/lib/people";
import { bankHistory } from "@/lib/server/bank";
import { confirmationOptions } from "@/lib/server/reauth";
import { readCompany } from "@/lib/server/settings";
import { privateProfile } from "../profile";
import { saveBankAction } from "./actions";

export const metadata: Metadata = { title: "Bank details" };

export default async function BankPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ kind?: string; saved?: string }> }) {
  const { member, employee } = await privateProfile(params);
  const query = await searchParams;
  const own = member.employeeId === employee.id;
  const [history, company, options] = await Promise.all([bankHistory(member, employee.id), readCompany(), own ? confirmationOptions(member) : null]);
  const usual = company.currency === "EUR" || company.currency === "GBP" || company.currency === "CHF" ? "iban" : "us";
  const kind = query.kind === "us" || query.kind === "iban" ? query.kind : history[0]?.kind ?? usual;
  const base = `/workspace/people/${employee.id}/bank`;
  return <>
    <ProfileHeader employee={employee} current="job" canSeePrivate />
    {query.saved === "1" && <Notice>Bank details saved. They apply to the next payment file.</Notice>}
    <div className="grid gap-x-12 gap-y-9 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <Section title="Bank details">
        {history.length ? <table className="w-full"><caption className="sr-only">Bank details history</caption><thead className={tableHead}><tr><th scope="col">Account</th><th scope="col">Recorded</th><th scope="col">By</th></tr></thead>
          <tbody className={tableBody}>{history.map((entry, index) => <tr key={entry.createdAt.toISOString()}><th scope="row" className="align-top"><span className={index === 0 ? "font-semibold" : ""}>{entry.kind === "us" ? "US account" : "IBAN"} ending {entry.last4}</span>{index === 0 && <span className="block text-[13px] text-positive">Current</span>}</th><td className="align-top">{formatTime(entry.createdAt)}</td><td className="align-top wrap-anywhere">{entry.createdBy}</td></tr>)}</tbody></table> : <Empty>No bank details recorded.</Empty>}
        <p className="pt-3 text-[13px] leading-relaxed text-muted">Full numbers are encrypted and never shown again, including to administrators. They leave OpenWarp only inside a payment file. Every change notifies {own ? "you" : "the employee"} and the administrators.</p>
      </Section>
      {employee.status !== "archived" && <Section title={history.length ? "Change bank details" : "Add bank details"}>
        <p className="py-3 text-sm">{kind === "us" ? <>Adding a US account. <Link href={`${base}?kind=iban`} className="text-accent underline underline-offset-3">Use an IBAN instead</Link></> : <>Adding an IBAN. <Link href={`${base}?kind=us`} className="text-accent underline underline-offset-3">Use a US account instead</Link></>}</p>
        <ActionForm key={kind} action={saveBankAction} submit="Save bank details" hidden={{ employeeId: employee.id, kind }}>
          <Field name="holder" label="Account holder" required maxLength={70} autoComplete="off" />
          {kind === "us" ? <>
            <Field name="routing" label="Routing number" required inputMode="numeric" maxLength={9} autoComplete="off" /><Field name="account" label="Account number" required inputMode="numeric" maxLength={20} autoComplete="off" />
            <Field name="confirmAccount" label="Repeat the account number" required inputMode="numeric" maxLength={20} autoComplete="off" /><Field name="type" label="Account type" required options={[{ value: "checking", label: "Checking" }, { value: "savings", label: "Savings" }]} />
          </> : <><Field name="iban" label="IBAN" required maxLength={42} autoComplete="off" /><Field name="bic" label="BIC" maxLength={11} autoComplete="off" /></>}
          {options && <ConfirmIdentity options={options} label="Your current password" />}
        </ActionForm>
      </Section>}
    </div>
  </>;
}
