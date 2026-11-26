import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { z } from "zod";
import { fileLabels, type FileFormat, type ItemKind, type ItemSource, type JournalAccount, type JournalFormat, journalAccounts, type payFileFields } from "@/lib/domains/pay";
import { toCsv } from "@/lib/operations";
import type { EmploymentType } from "@/lib/people";
import { type BankDetails, unsealBankDetails } from "./bank";
import { seal, unseal } from "./crypto";
import { pool } from "./db";
import { requireAdmin, type Member } from "./member";
import { type PaySettings, readPaySettings } from "./payroll-rules";
import { audit, PeopleError, runAsAdmin } from "./write";

export type PayFile = { id: string; format: FileFormat; payments: number; totalCents: number; sha256: string; createdAt: Date; createdBy: string };
export type Payment = { lineId: string; employeeId: string; name: string; amountCents: number; bank: BankDetails };

// Bank formats accept a narrow character set, so accents are dropped and anything else becomes a space.
export function plainText(value: string, length: number) {
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").replace(/[æÆ]/g, "ae").replace(/[øØ]/g, "o").replace(/[łŁ]/g, "l").replace(/[^A-Za-z0-9 .,'()/+-]/g, " ").replace(/\s+/g, " ").trim().slice(0, length);
}

const left = (value: string, length: number) => plainText(value, length).toUpperCase().padEnd(length);
const digits = (value: number, length: number) => {
  const text = String(value);
  if (text.length > length) throw new PeopleError("An amount is too large for this file format.");
  return text.padStart(length, "0");
};

export function buildNacha(settings: PaySettings, payments: Payment[], payOn: string, created: Date, modifier: string) {
  const stamp = created.toISOString();
  const date = (value: string) => value.slice(2, 10).replaceAll("-", "");
  const odfi = settings.nachaRouting.slice(0, 8);
  const accounts = payments.map((payment) => {
    if (payment.bank.kind !== "us") throw new PeopleError("Every payment in a NACHA file needs a US account.");
    return { ...payment, bank: payment.bank };
  });
  const total = payments.reduce((sum, payment) => sum + payment.amountCents, 0);
  const hash = digits(accounts.reduce((sum, { bank }) => sum + Number(bank.routing.slice(0, 8)), 0) % 10_000_000_000, 10);
  const count = payments.length;
  const records = [
    `101 ${settings.nachaRouting}${settings.nachaOriginId.padStart(10)}${date(stamp)}${stamp.slice(11, 13)}${stamp.slice(14, 16)}${modifier}094101${left(settings.nachaBankName, 23)}${left(settings.nachaCompanyName, 23)}${" ".repeat(8)}`,
    `5220${left(settings.nachaCompanyName, 16)}${" ".repeat(20)}${settings.nachaCompanyId}PPD${left("PAYROLL", 10)}${date(payOn)}${date(payOn)}   1${odfi}0000001`,
    ...accounts.map(({ bank, amountCents, name, employeeId }, index) => `6${bank.type === "checking" ? "22" : "32"}${bank.routing}${bank.account.padEnd(17)}${digits(amountCents, 10)}${employeeId.replaceAll("-", "").slice(0, 15).toUpperCase()}${left(bank.holder || name, 22)}  0${odfi}${digits(index + 1, 7)}`),
    `8220${digits(count, 6)}${hash}${digits(0, 12)}${digits(total, 12)}${settings.nachaCompanyId}${" ".repeat(25)}${odfi}0000001`,
  ];
  const blocks = Math.ceil((records.length + 1) / 10);
  records.push(`9000001${digits(blocks, 6)}${digits(count, 8)}${hash}${digits(0, 12)}${digits(total, 12)}${" ".repeat(39)}`);
  while (records.length % 10) records.push("9".repeat(94));
  if (records.some((record) => record.length !== 94)) throw new PeopleError("The payment file couldn’t be built. Check the company bank details in Payroll settings.");
  return `${records.join("\r\n")}\r\n`;
}

const xml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("'", "&apos;").replaceAll('"', "&quot;");
const decimal = (cents: number) => `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

export function buildSepa(settings: PaySettings, companyIban: string, payments: Payment[], payOn: string, created: Date, fileId: string) {
  const total = decimal(payments.reduce((sum, payment) => sum + payment.amountCents, 0));
  const name = xml(plainText(settings.sepaName, 70));
  const id = fileId.replaceAll("-", "");
  const agent = (bic: string) => `<FinInstnId>${bic ? `<BICFI>${bic}</BICFI>` : "<Othr><Id>NOTPROVIDED</Id></Othr>"}</FinInstnId>`;
  const transfers = payments.map(({ bank, lineId, amountCents, name: person }) => {
    if (bank.kind !== "iban") throw new PeopleError("Every payment in a SEPA file needs an IBAN.");
    return `      <CdtTrfTxInf>
        <PmtId><EndToEndId>${lineId.replaceAll("-", "")}</EndToEndId></PmtId>
        <Amt><InstdAmt Ccy="EUR">${decimal(amountCents)}</InstdAmt></Amt>
${bank.bic ? `        <CdtrAgt>${agent(bank.bic)}</CdtrAgt>\n` : ""}        <Cdtr><Nm>${xml(plainText(bank.holder || person, 70))}</Nm></Cdtr>
        <CdtrAcct><Id><IBAN>${bank.iban}</IBAN></Id></CdtrAcct>
        <RmtInf><Ustrd>Salary ${payOn}</Ustrd></RmtInf>
      </CdtTrfTxInf>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${id}</MsgId>
      <CreDtTm>${created.toISOString().slice(0, 19)}Z</CreDtTm>
      <NbOfTxs>${payments.length}</NbOfTxs>
      <CtrlSum>${total}</CtrlSum>
      <InitgPty><Nm>${name}</Nm></InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${id}</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <BtchBookg>true</BtchBookg>
      <NbOfTxs>${payments.length}</NbOfTxs>
      <CtrlSum>${total}</CtrlSum>
      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl><CtgyPurp><Cd>SALA</Cd></CtgyPurp></PmtTpInf>
      <ReqdExctnDt><Dt>${payOn}</Dt></ReqdExctnDt>
      <Dbtr><Nm>${name}</Nm></Dbtr>
      <DbtrAcct><Id><IBAN>${companyIban}</IBAN></Id></DbtrAcct>
      <DbtrAgt>${agent(settings.sepaBic)}</DbtrAgt>
      <ChrgBr>SLEV</ChrgBr>
${transfers.join("\n")}
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>
`;
}

function buildCsv(payments: Payment[], payOn: string, currency: string) {
  return toCsv([["Name", "Account holder", "Routing number", "Account number", "Account type", "IBAN", "BIC", "Amount", "Currency", "Pay date", "Reference"],
    ...payments.map(({ name, bank, amountCents, lineId }) => [name, bank.holder, bank.kind === "us" ? bank.routing : "", bank.kind === "us" ? bank.account : "", bank.kind === "us" ? bank.type : "", bank.kind === "iban" ? bank.iban : "", bank.kind === "iban" ? bank.bic : "", decimal(amountCents), currency, payOn, lineId])]);
}

export async function listPayFiles(runId: string) {
  await requireAdmin();
  const [files, covered] = await Promise.all([
    pool().query<PayFile>(
      `SELECT f.id, f.format, f.payments, f.total_cents::float8 AS "totalCents", f.sha256, f.created_at AS "createdAt", u.name AS "createdBy" FROM pay_files f JOIN "user" u ON u.id = f.created_by WHERE f.pay_run_id = $1 ORDER BY f.created_at DESC, f.id`, [runId]),
    pool().query<{ lineId: string }>(`SELECT DISTINCT p.line_id AS "lineId" FROM pay_file_lines p JOIN pay_files f ON f.id = p.file_id WHERE f.pay_run_id = $1`, [runId]),
  ]);
  return { files: files.rows, covered: new Set(covered.rows.map((row) => row.lineId)) };
}

// By default a second file holds only people no earlier file covers. Repeating someone needs an explicit confirmation.
export function createPayFile(member: Member, input: z.infer<typeof payFileFields>) {
  return runAsAdmin(member, async (client) => {
    const { rows: [run] } = await client.query<{ state: string; kind: string; currency: string; payOn: string; period: string; reversed: boolean }>(
      `SELECT r.state, r.kind, r.currency, to_char(r.pay_on, 'YYYY-MM-DD') AS "payOn", to_char(r.period_start, 'YYYY-MM-DD') || ' to ' || to_char(r.period_end, 'YYYY-MM-DD') AS period,
       EXISTS (SELECT 1 FROM pay_runs v WHERE v.reverses_id = r.id) AS reversed FROM pay_runs r WHERE r.id = $1`, [input.runId]);
    if (!run) throw new PeopleError("This pay run could not be found.");
    if (run.state !== "approved") throw new PeopleError("Approve the run before creating a payment file.");
    if (run.kind === "reversal") throw new PeopleError("A reversal has nothing to pay. Recall or collect the original payments with your bank.");
    if (run.reversed) throw new PeopleError("This run has a reversal, so it can’t be paid.");
    if (input.format === "nacha" && run.currency !== "USD") throw new PeopleError("NACHA files are only for pay in USD.");
    if (input.format === "sepa" && run.currency !== "EUR") throw new PeopleError("SEPA files are only for pay in EUR.");
    const settings = await readPaySettings(client);
    if (input.format === "nacha" && !settings.nachaRouting || input.format === "sepa" && !settings.sepaIbanLast4) throw new PeopleError("Add the company’s bank details in Payroll settings first.");
    const { rows: lines } = await client.query<{ lineId: string; employeeId: string; name: string; amountCents: number; covered: boolean }>(
      `SELECT l.id AS "lineId", l.employee_id AS "employeeId", concat_ws(' ', e.first_name, e.last_name) AS name, l.net_cents::float8 AS "amountCents", EXISTS (SELECT 1 FROM pay_file_lines p WHERE p.line_id = l.id) AS covered
       FROM pay_run_lines l JOIN employees e ON e.id = l.employee_id WHERE l.pay_run_id = $1 AND l.net_cents > 0 ORDER BY lower(e.last_name), lower(e.first_name), e.id`, [input.runId]);
    const repeats = lines.some((line) => line.covered);
    if (input.scope === "all" && repeats && !input.confirmRepeat) throw new PeopleError("Some of these payments are already in a file. Confirm that the earlier file was never accepted by the bank, or include only people not yet in a file.");
    const bank = await unsealBankDetails(client, lines.map((line) => line.employeeId));
    const wanted = input.format === "nacha" ? "us" : input.format === "sepa" ? "iban" : null;
    const payments = lines.flatMap((line): Payment[] => {
      const details = bank.get(line.employeeId);
      return details && (!wanted || details.kind === wanted) && (input.scope === "all" || !line.covered) ? [{ ...line, bank: details }] : [];
    });
    if (!payments.length) throw new PeopleError(repeats ? "Everyone with usable bank details is already in a file." : "No one in this run has bank details this format can use.");
    const id = randomUUID();
    const created = new Date();
    const content = input.format === "nacha" ? buildNacha(settings, payments, run.payOn, created, await nextModifier(client, created))
      : input.format === "sepa" ? buildSepa(settings, await companyIban(client), payments, run.payOn, created, id) : buildCsv(payments, run.payOn, run.currency);
    await client.query("INSERT INTO pay_files (id, pay_run_id, format, sealed, sha256, payments, total_cents, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [id, input.runId, input.format, seal(content, id), createHash("sha256").update(content).digest("hex"), payments.length, payments.reduce((sum, payment) => sum + payment.amountCents, 0), member.id]);
    await client.query("INSERT INTO pay_file_lines (file_id, line_id) SELECT $1, unnest($2::uuid[])", [id, payments.map((payment) => payment.lineId)]);
    await audit(client, member, "pay_run.file_created", { detail: `${run.period}, ${fileLabels[input.format]}, ${payments.length} ${payments.length === 1 ? "payment" : "payments"}${input.scope === "all" && repeats ? ", repeated" : ""}` });
    return `File created with ${payments.length} ${payments.length === 1 ? "payment" : "payments"}. Download it below.`;
  });
}

async function nextModifier(client: PoolClient, created: Date) {
  const { rows } = await client.query<{ count: number }>("SELECT count(*)::int AS count FROM pay_files WHERE format = 'nacha' AND created_at >= $1::date", [created.toISOString().slice(0, 10)]);
  return "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[rows[0].count % 36];
}

async function companyIban(client: PoolClient) {
  const { rows } = await client.query<{ sealed: Buffer }>("SELECT sepa_iban_sealed AS sealed FROM pay_settings");
  return unseal(rows[0].sealed, "company");
}

export function downloadPayFile(member: Member, runId: string, fileId: string) {
  return runAsAdmin(member, async (client) => {
    const { rows: [file] } = await client.query<{ format: FileFormat; sealed: Buffer; sha256: string; payOn: string; reversed: boolean }>(
      `SELECT f.format, f.sealed, f.sha256, to_char(r.pay_on, 'YYYY-MM-DD') AS "payOn", EXISTS (SELECT 1 FROM pay_runs v WHERE v.reverses_id = r.id) AS reversed FROM pay_files f JOIN pay_runs r ON r.id = f.pay_run_id WHERE f.id = $1 AND f.pay_run_id = $2`, [fileId, runId]);
    if (!file) return null;
    if (file.reversed) throw new PeopleError("This run has a reversal, so its payment files can’t be downloaded.");
    const content = unseal(file.sealed, fileId);
    if (createHash("sha256").update(content).digest("hex") !== file.sha256) throw new Error("A payment file failed its integrity check.");
    await audit(client, member, "pay_run.file_downloaded", { detail: fileLabels[file.format] });
    return { name: `openwarp-payments-${file.payOn}-${fileId.slice(0, 8)}.${{ nacha: "ach", sepa: "xml", csv: "csv" }[file.format]}`, content, type: file.format === "sepa" ? "application/xml" : file.format === "csv" ? "text/csv" : "text/plain" };
  });
}

export type JournalEntry = { account: string; description: string; cents: number };
type JournalItem = { kind: ItemKind; source: ItemSource; employmentType: EmploymentType; account: string; cents: number };

// Positive is a debit and negative a credit. The entries of a run always sum to zero.
export function buildJournal(items: JournalItem[], netCents: number, accounts: Partial<Record<JournalAccount, string>>) {
  const entries = new Map<string, JournalEntry>();
  const post = (key: JournalAccount, cents: number, override = "", description: string = journalAccounts[key]) => {
    const account = override || accounts[key] || journalAccounts[key];
    const id = `${account}\n${description}`;
    entries.set(id, { account, description, cents: (entries.get(id)?.cents ?? 0) + cents });
  };
  for (const item of items) {
    if (item.kind === "earning") post(item.employmentType === "contractor" ? "contractors" : "wages", item.cents);
    else if (item.kind === "non_taxed") post(item.source === "expense" ? "reimbursements" : item.source === "invoice" ? "contractors" : "wages", item.cents);
    else if (item.kind === "employer") { post("employer", item.cents); post("employerPayable", -item.cents, item.account); }
    else post(item.kind === "tax" ? "taxes" : "deductions", -item.cents, item.account);
  }
  post("net", -netCents);
  const result = [...entries.values()].filter((entry) => entry.cents !== 0);
  if (result.reduce((sum, entry) => sum + entry.cents, 0) !== 0) throw new Error("A pay run journal did not balance.");
  return result;
}

const journalDate = (value: string, style: PaySettings["journalDates"]) => {
  const [year, month, day] = value.split("-");
  return style === "iso" ? value : style === "us" ? `${month}/${day}/${year}` : `${day}/${month}/${year}`;
};

export function exportJournal(member: Member, runId: string, format: JournalFormat) {
  return runAsAdmin(member, async (client) => {
    const { rows: [run] } = await client.query<{ payOn: string; period: string; net: number; kind: string }>(
      `SELECT to_char(r.pay_on, 'YYYY-MM-DD') AS "payOn", to_char(r.period_start, 'YYYY-MM-DD') || ' to ' || to_char(r.period_end, 'YYYY-MM-DD') AS period, r.kind, (SELECT coalesce(sum(net_cents), 0) FROM pay_run_lines WHERE pay_run_id = r.id)::float8 AS net
       FROM pay_runs r WHERE r.id = $1 AND r.state = 'approved'`, [runId]);
    if (!run) return null;
    const { rows: items } = await client.query<JournalItem>(
      `SELECT i.kind, i.source, e.employment_type AS "employmentType", coalesce(p.account, '') AS account, sum(i.amount_cents)::float8 AS cents
       FROM pay_run_items i JOIN pay_run_lines l ON l.id = i.line_id AND l.revision = i.revision JOIN employees e ON e.id = l.employee_id LEFT JOIN pay_rules p ON p.id = i.source_id AND i.source = 'rule'
       WHERE l.pay_run_id = $1 GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 3, 4`, [runId]);
    const settings = await readPaySettings(client);
    const entries = buildJournal(items, run.net, settings.journalAccounts);
    if (!entries.length) throw new PeopleError("This run has nothing to post.");
    await audit(client, member, "pay_run.journal_exported", { detail: run.period });
    const date = journalDate(run.payOn, settings.journalDates);
    const number = `PAY-${run.payOn.replaceAll("-", "")}-${runId.slice(0, 4).toUpperCase()}`;
    const memo = `${run.kind === "reversal" ? "Reversal of payroll" : "Payroll"} ${run.period}`;
    const side = (entry: JournalEntry, debit: boolean) => (entry.cents > 0) === debit ? decimal(Math.abs(entry.cents)) : "";
    const rows = format === "xero" ? [["*Narration", "*Date", "Description", "*AccountCode", "*TaxRate", "*Amount"], ...entries.map((entry) => [memo, date, entry.description, entry.account, "Tax Exempt", `${entry.cents < 0 ? "-" : ""}${decimal(Math.abs(entry.cents))}`])]
      : format === "quickbooks" ? [["*JournalNo", "*JournalDate", "*AccountName", "*Debits", "*Credits", "Description"], ...entries.map((entry) => [number, date, entry.account, side(entry, true), side(entry, false), `${memo}: ${entry.description}`])]
      : [["Journal", "Date", "Account", "Description", "Debit", "Credit"], ...entries.map((entry) => [number, date, entry.account, entry.description, side(entry, true), side(entry, false)])];
    return { name: `openwarp-journal-${run.payOn}-${format}`, text: journalCsv(rows) };
  });
}

// Accounting imports need a bare negative number, so only numeric cells skip the spreadsheet formula guard.
function journalCsv(rows: string[][]) {
  return rows.map((row) => row.map((cell) => /^-?\d+\.\d{2}$/.test(cell) ? cell : toCsv([[cell]]).slice(1, -2)).join(",")).join("\r\n") + "\r\n";
}
