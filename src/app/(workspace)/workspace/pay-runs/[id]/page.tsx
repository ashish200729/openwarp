import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CaretDownIcon, DownloadSimpleIcon } from "@/components/icons";
import { secondaryButton, tableBody, tableHead, textLink } from "@/components/ui";
import { ActionButtons, ActionForm, Checkbox, Field } from "@/components/workspace/action-form";
import { PayItems } from "@/components/workspace/pay-items";
import { Avatar, BackLink, Callout, Empty, Figure, FigureRow, Notice, PageHeader, Section } from "@/components/workspace/presentation";
import { dateRange } from "@/components/workspace/requests";
import { earningLabels, earningTypes, fileLabels, journalFormats, journalLabels, ptoPayout, runTitle, type FileFormat } from "@/lib/domains/pay";
import { basisLabels, formatMoney } from "@/lib/operations";
import { employmentLabels, formatDate, formatTime } from "@/lib/people";
import { requireAdmin } from "@/lib/server/member";
import { type PayCheck, readPayRun } from "@/lib/server/pay";
import { listPayFiles } from "@/lib/server/pay-files";
import { payRunCommandAction } from "../../operations";
import { addEarningAction, addPersonAction, addPtoAction, createFileAction, recalculateAction, removeEarningAction, removePersonAction, reverseAction, saveLineAction } from "../actions";

export const metadata: Metadata = { title: "Pay run" };

// One line per finding, so a problem that affects everyone doesn't push the pay lines off the page.
function groupChecks(checks: PayCheck[]) {
  const groups = new Map<string, { problem: string; blocking: boolean; people: PayCheck[] }>();
  for (const check of checks) {
    const key = `${check.blocking}:${check.problem}`;
    const group = groups.get(key) ?? { problem: check.problem, blocking: check.blocking, people: [] };
    group.people.push(check);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export default async function PayRunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  await requireAdmin();
  const [{ id }, { saved }] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(id).success) notFound();
  const result = await readPayRun(id);
  if (!result) notFound();
  const { run, lines, items, missing, earnings, candidates, checks, stale, notes, paidElsewhere } = result;
  const reversal = run.kind === "reversal";
  const draft = run.state === "draft";
  const editable = draft && !reversal;
  const payable = !draft && !reversal && !run.reversalId;
  const [{ files, covered }, reversedFiles] = await Promise.all([draft ? { files: [], covered: new Set<string>() } : listPayFiles(id), draft && run.reversesId ? listPayFiles(run.reversesId) : null]);
  const filed = reversedFiles?.files.length ?? 0;
  const amount = (cents: number) => formatMoney(cents, run.currency);
  const withheld = run.preTaxCents + run.taxCents + run.postTaxCents;
  const blocked = checks.some((check) => check.blocking) || stale;
  const unfiled = lines.filter((line) => line.netCents > 0 && !covered.has(line.id));
  const formats: FileFormat[] = run.currency === "USD" ? ["nacha", "csv"] : run.currency === "EUR" ? ["sepa", "csv"] : ["csv"];
  const total = `${amount(run.totalCents)} for ${run.people} ${run.people === 1 ? "person" : "people"}`;
  return <>
    <BackLink href="/workspace/pay-runs">Pay runs</BackLink>
    <PageHeader title={dateRange(run.periodStart, run.periodEnd)} description={`${run.kind === "regular" ? "" : `${runTitle(run)}. `}${draft ? "Draft" : `Approved by ${run.approvedBy ?? "an administrator"}`}. Pays on ${formatDate(run.payOn)}.`} actions={<>
      <a href={`/workspace/pay-runs/${id}/export`} className={secondaryButton}><DownloadSimpleIcon aria-hidden="true" size={15} /> Export CSV</a>
      {editable && <ActionButtons action={recalculateAction} hidden={{ id }} name="operation" buttons={[
        { value: "recalculate", label: "Recalculate", describe: "Recalculate this draft" },
        ...(lines.some((line) => line.hours !== null) ? [{ value: "hours", label: "Refresh hours", describe: "Refresh hours from approved timesheets", confirm: { title: "Refresh hours from timesheets?", body: "Everyone with approved timesheets for this period gets those hours. Hours typed for them are replaced.", action: "Use timesheet hours" } }] : []),
      ]} />}
      {draft && <ActionButtons action={payRunCommandAction} hidden={{ id, version: run.version }} name="operation" buttons={[
        { value: "delete", label: "Delete draft", describe: "Delete draft", variant: "text", confirm: { title: "Delete this draft?", body: reversal ? "The run it reverses stays approved." : "Its adjustments are lost. Expenses and invoices in it become available to another run.", action: "Delete draft", danger: true } },
        { value: "approve", label: "Approve run", describe: "Approve run", variant: "primary", confirm: reversal
          ? { title: `Approve the reversal of ${amount(-run.totalCents)}?`, body: `${filed ? `The original run has ${filed === 1 ? "a payment file" : `${filed} payment files`}. If the bank accepted ${filed === 1 ? "it" : "any of them"}, the next run pays the same people again. ` : ""}Approve it only if the original payments were never sent or you are collecting them back. Its expenses and invoices become payable again in another run, and its timesheets can be reopened.`, action: "Approve pay run", danger: true }
          : { title: `Approve ${total}?`, body: "An approved run is read-only. Its expenses are marked reimbursed, its invoices paid, and each person gets a payslip.", action: "Approve pay run" } },
      ]} />}
    </>} />
    {saved === "approved" && <Notice>{reversal ? "Reversal approved. Its expenses and invoices can be paid again." : "Pay run approved. Its expenses are marked reimbursed."}</Notice>}
    {reversal && <Callout>This reverses <Link href={`/workspace/pay-runs/${run.reversesId}`} className="text-accent underline underline-offset-3">the approved run</Link> for the same dates, with every amount the opposite. Recall or collect the original payments with your bank.</Callout>}
    {filed > 0 && <Callout><span className="font-medium">The run being reversed has {filed === 1 ? "a payment file" : `${filed} payment files`}.</span> Check with your bank whether {filed === 1 ? "it was" : "they were"} accepted before approving. {filed === 1 ? "It" : "They"} can’t be downloaded while this reversal exists.</Callout>}
    {run.reversalId && <Callout>{run.reversed ? "This run was reversed." : "A reversal of this run is waiting for approval."} <Link href={`/workspace/pay-runs/${run.reversalId}`} className="text-accent underline underline-offset-3">Open the reversal</Link></Callout>}
    {missing.length > 0 && <Callout><span className="font-medium">{missing.length === 1 ? "One person has" : `${missing.length} people have`} no pay recorded and {missing.length === 1 ? "isn’t" : "aren’t"} in this run.</span> {missing.slice(0, 8).map((person, index) => <span key={person.id}>{index > 0 && ", "}<Link href={`/workspace/people/${person.id}/job`} className="text-accent underline underline-offset-3">{person.name}</Link></span>)}{missing.length > 8 && ` and ${missing.length - 8} more`}. After recording their pay, add them below.</Callout>}
    {paidElsewhere.length > 0 && <Callout><span className="font-medium">Already paid off-cycle for all of this period:</span> {paidElsewhere.slice(0, 8).map((person) => person.name).join(", ")}{paidElsewhere.length > 8 && ` and ${paidElsewhere.length - 8} more`}. Add them below if this run should still pay them something, such as a recurring payment.</Callout>}
    {stale && <Callout>Rules, benefits or year-to-date amounts changed after this draft was calculated. Recalculate it before approving.</Callout>}
    <FigureRow><Figure label="Net pay" value={amount(run.totalCents)} /><Figure label="Gross pay" value={amount(run.grossCents)} /><Figure label="Deductions and taxes" value={amount(withheld)} /><Figure label="Untaxed payments" value={amount(run.nontaxedCents)} /><Figure label="Employer contributions" value={amount(run.employerCents)} /><Figure label="People" value={run.people} /></FigureRow>
    {editable && checks.length > 0 && <Section title="Checks before approval" className="mb-9">
      <p className="py-2 text-[13px] text-muted">{blocked ? "Fix the items marked Must fix before approving." : "Read these before approving. None of them stops the run."}</p>
      <dl className="divide-y divide-line">{groupChecks(checks).map((group) => <div key={`${group.blocking}-${group.problem}`} className="py-2.5 text-sm">
        <dt className="font-medium">{group.blocking && <span className="text-danger">Must fix. </span>}{group.problem}</dt>
        <dd className="mt-0.5 wrap-anywhere text-muted">{group.people.map((person, index) => <span key={person.employeeId}>{index > 0 && ", "}{person.href ? <Link href={person.href} className={textLink}>{person.name}</Link> : person.name}</span>)}</dd>
      </div>)}</dl>
    </Section>}
    <div aria-hidden="true" className="hidden gap-x-5 border-b border-line py-2 pr-[25px] text-[13px] font-medium text-muted md:grid md:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))]"><span>Employee</span><span className="text-right">Gross pay</span><span className="text-right">Deductions and taxes</span><span className="text-right">Untaxed payments</span><span className="text-right">Net pay</span></div>
    <ul className="max-md:border-t max-md:border-line">
      {lines.map((line) => {
        const deductions = line.preTaxCents + line.taxCents + line.postTaxCents;
        const added = earnings.filter((earning) => earning.lineId === line.id);
        const day = ptoPayout(line.basis, line.rateCents, 1);
        return <li key={line.id} className="border-b border-line"><details className="group">
          <summary className="flex items-center gap-3 rounded focus-visible:outline-offset-[-2px]">
            <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-1 py-3 text-sm md:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))]">
              <span className="flex min-w-0 items-center gap-3"><Avatar name={line.name} /><span className="min-w-0"><span className="block font-medium wrap-anywhere">{line.name}</span><span className="block text-[13px] text-muted">{employmentLabels[line.employmentType]}, {line.rateCents ? `${amount(line.rateCents)} ${basisLabels[line.basis]}` : "no set pay"}{line.proration && `, ${line.proration}`}</span></span></span>
              <span className="hidden text-right tabular-nums md:block"><span className="sr-only">Gross pay </span>{amount(line.grossCents)}{line.hours !== null && <span className="block text-[13px] text-muted">{line.hours} hours{line.overtimeHours ? `, ${line.overtimeHours} overtime` : ""}{line.hoursSource === "timesheet" && ", from timesheets"}</span>}</span>
              <span className="hidden text-right tabular-nums md:block"><span className="sr-only">Deductions and taxes </span>{deductions ? amount(deductions) : <span className="text-hint">None</span>}</span>
              <span className="hidden text-right tabular-nums md:block"><span className="sr-only">Untaxed payments </span>{line.nontaxedCents ? amount(line.nontaxedCents) : <span className="text-hint">None</span>}</span>
              <span className={`text-right font-semibold tabular-nums ${line.netCents < 0 && !reversal ? "text-danger" : ""}`}><span className="sr-only">Net pay </span>{amount(line.netCents)}</span>
            </div>
            <CaretDownIcon aria-hidden="true" size={13} className="shrink-0 text-hint group-open:rotate-180" />
          </summary>
          <div className="grid gap-6 pb-5 sm:pl-11 lg:grid-cols-2">
            <div className="min-w-0"><PayItems items={items.get(line.id) ?? []} name={line.name} currency={run.currency} netCents={line.netCents} />
              {!draft && <p className="pt-3 text-sm"><Link href={`/workspace/payslips/${line.id}`} aria-label={`Open payslip for ${line.name}`} className={textLink}>Open payslip</Link></p>}</div>
            {editable && <div className="grid min-w-0 content-start gap-5">
              <ActionForm key={`${line.hours}-${line.overtimeHours}-${line.adjustmentCents}-${line.adjustmentNote}-${line.acceptedNotes}`} action={saveLineAction} submit="Save line" hidden={{ runId: id, lineId: line.id }} variant="secondary" inline>
                {line.hours !== null && <><Field name="hours" label="Hours worked" inputMode="decimal" required defaultValue={line.hours} wrapperClass="w-full sm:w-32" /><Field name="overtimeHours" label={`Overtime at ${line.overtimeMultiplierBp / 10_000}x`} inputMode="decimal" defaultValue={line.overtimeHours || ""} wrapperClass="w-full sm:w-44" /></>}
                <Field name="adjustment" label="Adjustment" inputMode="decimal" placeholder="0.00" defaultValue={line.adjustmentCents ? (line.adjustmentCents / 100).toFixed(2) : ""} wrapperClass="w-full sm:w-36" />
                <Field name="adjustmentNote" label="Reason" maxLength={120} defaultValue={line.adjustmentNote} wrapperClass="w-full sm:w-64" />
                {(notes.get(line.id) ?? []).length > 0 && <div className="w-full"><Checkbox name="acceptNotes" label="I’ve checked this line" hint={notes.get(line.id)!.join(" ")} defaultChecked={line.acceptedNotes === notes.get(line.id)!.join("\n")} /></div>}
              </ActionForm>
              {added.length > 0 && <table className="w-full"><caption className="sr-only">Added earnings for {line.name}</caption><thead className="sr-only"><tr><th scope="col">Earning</th><th scope="col">Amount</th><th scope="col">Action</th></tr></thead><tbody className={tableBody}>{added.map((earning) => <tr key={earning.id}><th scope="row" className="wrap-anywhere">{earning.label}</th><td className="text-right tabular-nums">{amount(earning.amountCents)}</td><td className="text-right"><ActionButtons action={removeEarningAction} hidden={{ runId: id, id: earning.id }} name="operation" buttons={[{ value: "remove", label: "Remove", describe: `Remove ${earning.label} from ${line.name}`, variant: "text" }]} /></td></tr>)}</tbody></table>}
              <ActionForm action={addEarningAction} submit="Add earning" hidden={{ runId: id, lineId: line.id }} variant="secondary" inline>
                <Field name="type" label="Earning type" required options={earningTypes.filter((type) => type !== "wages" || run.kind === "off_cycle").map((value) => ({ value, label: earningLabels[value] }))} wrapperClass="w-full sm:w-40" />
                <Field name="amount" label="Earning amount" required inputMode="decimal" placeholder="0.00" wrapperClass="w-full sm:w-36" /><Field name="label" label="Description" maxLength={120} wrapperClass="w-full sm:w-52" />
              </ActionForm>
              {day > 0 && <div><ActionForm action={addPtoAction} submit="Add PTO payout" hidden={{ runId: id, lineId: line.id }} variant="secondary" inline><Field name="days" label="Unused PTO days" required inputMode="decimal" wrapperClass="w-full sm:w-48" /></ActionForm><p className="mt-1.5 text-[13px] text-muted">One day is worth {amount(day)}, {line.basis === "annual" ? "the salary divided by 260" : "8 hours at their rate"}.</p></div>}
              {lines.length > 1 && <ActionButtons action={removePersonAction} hidden={{ runId: id, employeeId: line.employeeId }} name="operation" buttons={[{ value: "remove", label: "Remove from run", describe: `Remove from run: ${line.name}`, variant: "text", confirm: { title: `Remove ${line.name} from this run?`, body: "Their adjustments here are lost. Their expenses and invoices become available to another run.", action: "Remove person", danger: true } }]} />}
            </div>}
          </div>
        </details></li>;
      })}
    </ul>
    {editable && candidates.length > 0 && <div className="pt-5"><ActionForm action={addPersonAction} submit="Add to run" hidden={{ runId: id }} variant="secondary" inline><Field name="employeeId" label="Add a person" required options={candidates.map((person) => ({ value: person.id, label: person.name }))} wrapperClass="w-full sm:w-72" /></ActionForm></div>}
    {!draft && !reversal && <Section title="Payment files" className="mt-10">
      <p className="max-w-[75ch] py-3 text-sm leading-relaxed text-muted">OpenWarp prepares the file. Your company uploads it to your bank, which makes the payments. Files are the only place full account numbers appear, so store them carefully.</p>
      {files.length ? <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Payment files"><table className="w-full min-w-[40rem]"><caption className="sr-only">Payment files</caption><thead className={tableHead}><tr><th scope="col">Format</th><th scope="col">Created</th><th scope="col">By</th><th scope="col">SHA-256</th><th scope="col" className="text-right">Payments</th><th scope="col" className="text-right">Total</th><th scope="col">File</th></tr></thead>
        <tbody className={tableBody}>{files.map((file) => <tr key={file.id}><th scope="row">{fileLabels[file.format]}</th><td className="whitespace-nowrap">{formatTime(file.createdAt)}</td><td className="wrap-anywhere">{file.createdBy}</td><td><code className="text-[13px]" title={file.sha256}>{file.sha256.slice(0, 12)}</code></td><td className="text-right tabular-nums">{file.payments}</td><td className="text-right tabular-nums">{amount(file.totalCents)}</td><td>{run.reversalId ? <span className="text-muted">Reversed</span> : <a href={`/workspace/pay-runs/${id}/files/${file.id}`} aria-label={`Download ${fileLabels[file.format]} file created ${formatTime(file.createdAt)}`} className={textLink}>Download</a>}</td></tr>)}</tbody></table></div> : <Empty>No payment file yet.</Empty>}
      {unfiled.length > 0 && <p className="py-3 text-sm wrap-anywhere"><span className="font-medium">Not in a file yet:</span> {unfiled.slice(0, 20).map((line) => line.name).join(", ")}{unfiled.length > 20 && ` and ${unfiled.length - 20} more`}.</p>}
      {payable && <div className="pt-3"><ActionForm action={createFileAction} submit="Create file" pending="Creating…" hidden={{ runId: id }} variant="secondary" className="max-w-2xl" confirm={files.length ? { title: "Create another payment file?", body: "A file already exists for this run. Uploading the same payment twice pays it twice.", action: "Create another file", danger: true } : undefined}>
        <div className="grid gap-4 sm:grid-cols-2"><Field name="format" label="Format" required options={formats.map((value) => ({ value, label: fileLabels[value] }))} />
          {files.length > 0 && <Field name="scope" label="Payments" required options={[{ value: "remaining", label: "Only people not in a file yet" }, { value: "all", label: "Everyone again" }]} />}</div>
        {files.length > 0 && <Checkbox name="confirmRepeat" label="The bank never accepted the earlier file" hint="Needed to include anyone again." />}
      </ActionForm></div>}
    </Section>}
    {!draft && <Section title="Accounting journal" className="mt-10">
      <p className="max-w-[75ch] py-3 text-sm leading-relaxed text-muted">Debits equal credits. Set the accounts in <Link href="/workspace/settings/pay#journal" className="text-accent underline underline-offset-3">Payroll settings</Link> before importing.</p>
      <div className="flex flex-wrap gap-2">{journalFormats.map((format) => <a key={format} href={`/workspace/pay-runs/${id}/journal?format=${format}`} className={secondaryButton}><DownloadSimpleIcon aria-hidden="true" size={15} /> {journalLabels[format]}</a>)}</div>
    </Section>}
    {payable && <Section title="Reverse this run" className="mt-10">
      <p className="max-w-[75ch] py-3 text-sm leading-relaxed text-muted">An approved run is never deleted. Reversing it creates a draft with every amount the opposite, which needs its own approval. Approving it unlocks the timesheets it paid, unless another run still pays them.</p>
      <ActionButtons action={reverseAction} hidden={{ id }} name="operation" buttons={[{ value: "reverse", label: "Create reversal", describe: "Create reversal of this run", variant: "danger", confirm: { title: "Create a reversal of this run?", body: "No new payment files can be created while the reversal exists. You can delete its draft.", action: "Create reversal draft", danger: true } }]} />
    </Section>}
  </>;
}
