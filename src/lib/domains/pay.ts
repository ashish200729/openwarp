import { z } from "zod";
import { addDays, formatMoney, payLineFields, periodsPerYear, weekdaysBetween, workDate, type PaySchedule } from "@/lib/operations";
import { employmentTypes, type EmploymentType } from "@/lib/people";

export const payActivity = {
  "pay_run.hours_refreshed": "Refreshed hours in a pay run", "pay_run.recalculated": "Recalculated a pay run", "pay_run.person_added": "Added someone to a pay run",
  "pay_run.person_removed": "Removed someone from a pay run", "pay_run.reversed": "Started a reversal of a pay run", "pay_run.file_created": "Created a payment file",
  "pay_run.file_downloaded": "Downloaded a payment file", "pay_run.journal_exported": "Exported a pay run journal",
  "pay_rule.saved": "Saved a payroll rule", "pay_rule.assigned": "Changed a payroll rule for an employee", "pay_settings.updated": "Changed payroll settings",
  "recurring_pay.added": "Added a recurring payment", "recurring_pay.ended": "Ended a recurring payment", "garnishment.added": "Added an ordered deduction", "garnishment.ended": "Ended an ordered deduction",
  "bank_details.updated": "Changed bank details", "invoice.submitted": "Submitted an invoice", "invoice.approved": "Approved an invoice", "invoice.declined": "Declined an invoice", "invoice.cancelled": "Cancelled an invoice",
  "benefit_plan.saved": "Saved a benefit plan", "benefit_plan.priced": "Set a benefit cost", "enrollment.opened": "Opened an enrollment window", "enrollment.requested": "Asked for an enrollment window",
  "enrollment.declined": "Declined an enrollment window", "election.submitted": "Submitted a benefit choice", "election.approved": "Approved a benefit choice", "election.declined": "Declined a benefit choice",
  "election.cancelled": "Cancelled a benefit choice", "election.ended": "Ended benefit coverage", "election.restored": "Updated an end of coverage", "dependent.added": "Added a dependent", "dependent.removed": "Removed a dependent",
  "benefits.exported": "Exported benefit elections", "benefits.carrier_notified": "Confirmed a carrier notice",
} as const;

export const runKinds = ["regular", "off_cycle", "reversal"] as const;
export const runPurposes = ["bonus", "correction", "final_pay", "other"] as const;
export const earningTypes = ["bonus", "commission", "pto_payout", "severance", "wages", "correction", "other"] as const;
export const ruleKinds = ["pre_tax", "tax", "post_tax", "employer"] as const;
export const ruleMethods = ["percent_gross", "percent_taxable", "flat", "brackets"] as const;
export const garnishmentMethods = ["flat", "percent_gross", "percent_disposable"] as const;
export const planKinds = ["medical", "dental", "vision", "life", "retirement", "hsa", "fsa", "commuter", "wellness", "other"] as const;
export const tiers = ["employee", "spouse", "children", "family"] as const;
export const journalFormats = ["quickbooks", "xero", "csv"] as const;
export const fileFormats = ["nacha", "sepa", "csv"] as const;
export type RunKind = (typeof runKinds)[number];
export type RunPurpose = (typeof runPurposes)[number];
export type EarningType = (typeof earningTypes)[number];
export type RuleKind = (typeof ruleKinds)[number];
export type RuleMethod = (typeof ruleMethods)[number];
export type GarnishmentMethod = (typeof garnishmentMethods)[number];
export type PlanKind = (typeof planKinds)[number];
export type Tier = (typeof tiers)[number];
export type JournalFormat = (typeof journalFormats)[number];
export type FileFormat = (typeof fileFormats)[number];
export type ItemKind = "earning" | "non_taxed" | RuleKind;
export type ItemSource = "regular" | "overtime" | "adjustment" | "earning" | "recurring" | "expense" | "invoice" | "rule" | "benefit" | "garnishment";

export const purposeLabels: Record<RunPurpose, string> = { bonus: "Bonus", correction: "Correction", final_pay: "Final pay", other: "Other" };
export const earningLabels: Record<EarningType, string> = { bonus: "Bonus", commission: "Commission", pto_payout: "PTO payout", severance: "Severance", wages: "Unpaid wages", correction: "Correction", other: "Other earning" };
export const ruleKindLabels: Record<RuleKind, string> = { pre_tax: "Pre-tax deduction", tax: "Tax withholding", post_tax: "Post-tax deduction", employer: "Employer contribution" };
export const ruleMethodLabels: Record<RuleMethod, string> = { percent_gross: "Percent of gross pay", percent_taxable: "Percent of taxable pay", flat: "Flat amount each regular run", brackets: "Annual brackets on taxable pay" };
export const garnishmentLabels: Record<GarnishmentMethod, string> = { flat: "Flat amount each regular run", percent_gross: "Percent of gross pay", percent_disposable: "Percent of pay after pre-tax deductions and taxes" };
export const planKindLabels: Record<PlanKind, string> = { medical: "Medical", dental: "Dental", vision: "Vision", life: "Life", retirement: "Retirement", hsa: "HSA", fsa: "FSA", commuter: "Commuter", wellness: "Wellness", other: "Other" };
export const tierLabels: Record<Tier, string> = { employee: "Employee only", spouse: "Employee and spouse", children: "Employee and children", family: "Family" };
export const relationshipLabels = { spouse: "Spouse or partner", child: "Child" } as const;
export const fileLabels: Record<FileFormat, string> = { nacha: "NACHA (US direct deposit)", sepa: "SEPA pain.001", csv: "CSV" };
export const journalLabels: Record<JournalFormat, string> = { quickbooks: "QuickBooks", xero: "Xero", csv: "Plain CSV" };
export const invoiceLabels = { pending: "Pending", approved: "Approved", declined: "Declined", cancelled: "Cancelled", paid: "Paid" } as const;
export type InvoiceState = keyof typeof invoiceLabels;
export const electionLabels = { pending: "Waiting for approval", approved: "Approved", declined: "Declined", cancelled: "Cancelled", replaced: "Replaced" } as const;
export type ElectionState = keyof typeof electionLabels;
export const journalAccounts = {
  wages: "Wages and salaries", contractors: "Contractor costs", employer: "Employer contributions", reimbursements: "Reimbursed expenses",
  taxes: "Payroll taxes payable", deductions: "Deductions payable", employerPayable: "Employer contributions payable", net: "Net pay clearing",
} as const;
export type JournalAccount = keyof typeof journalAccounts;

// Exact integer arithmetic. Every computed line is rounded once, to whole cents, half away from zero.
export function ratio(value: number, numerator: number, denominator: number) {
  const top = BigInt(value) * BigInt(numerator);
  const bottom = BigInt(denominator);
  const magnitude = ((top < 0n ? -top : top) * 2n + bottom) / (bottom * 2n);
  return Number(top < 0n ? -magnitude : magnitude);
}

export function hundredths(value: number) {
  return Math.round(value * 100);
}

export type DateRange = { start: string; end: string };
export type Rate = { from: string; amountCents: number; basis: "annual" | "hourly" };
export type WorkSegment = DateRange & { rate: Rate };

// The parts of a range that fall outside every excluded range.
export function subtractRanges(range: DateRange, excluded: DateRange[]) {
  let left = range.start <= range.end ? [range] : [];
  for (const gap of excluded) {
    left = left.flatMap((part) => gap.end < part.start || gap.start > part.end ? [part]
      : [{ start: part.start, end: addDays(gap.start, -1) }, { start: addDays(gap.end, 1), end: part.end }].filter((piece) => piece.start <= piece.end));
  }
  return left;
}

// Splits working time at each change of pay. Days before the first recorded rate use that rate. Rates are in date order.
export function workSegments(ranges: DateRange[], rates: Rate[]): WorkSegment[] {
  if (!rates.length) return [];
  return ranges.flatMap((range) => rates.flatMap((rate, index) => {
    const start = index === 0 || rate.from < range.start ? range.start : rate.from;
    const until = index + 1 < rates.length ? addDays(rates[index + 1].from, -1) : range.end;
    const end = until < range.end ? until : range.end;
    return start <= end ? [{ start, end, rate }] : [];
  }));
}

// Each weekday of the period is an equal share of it, at the salary in force that day. Rounded once.
export function salaryForSegments(segments: WorkSegment[], schedule: PaySchedule, periodDays: number) {
  return periodDays ? ratio(segments.reduce((sum, segment) => sum + segment.rate.amountCents * weekdaysBetween(segment.start, segment.end), 0), 1, periodsPerYear[schedule] * periodDays) : 0;
}

export function hourlyPay(rateCents: number, hours: number, multiplierBp = 10_000) {
  return ratio(rateCents, hundredths(hours) * multiplierBp, 1_000_000);
}

// A day of PTO is worth one 260th of a salary, or eight hours of an hourly rate.
export function ptoPayout(basis: "annual" | "hourly", rateCents: number, days: number) {
  return basis === "annual" ? ratio(rateCents, hundredths(days), 26_000) : ratio(rateCents, hundredths(days) * 8, 100);
}

export type Bracket = { from: number; bp: number };

// Tax on an annual amount in ten-thousandths of a cent, so that rounding happens once at the end.
function bracketTax(annual: bigint, brackets: Bracket[]) {
  let tax = 0n;
  brackets.forEach((bracket, index) => {
    const from = BigInt(bracket.from);
    const next = index + 1 < brackets.length ? BigInt(brackets[index + 1].from) : null;
    const top = next !== null && annual > next ? next : annual;
    if (top > from) tax += (top - from) * BigInt(bracket.bp);
  });
  return tax;
}

const roundTax = (tax: bigint, divisor: bigint) => Number((tax * 2n + divisor) / (divisor * 2n));

export function bracketWithholding(base: number, brackets: Bracket[], periods: number) {
  return roundTax(bracketTax(BigInt(base) * BigInt(periods), brackets), 10_000n * BigInt(periods));
}

// An off-cycle payment is taxed as the top slice of the person's regular annual pay.
export function bracketWithholdingOnTop(base: number, brackets: Bracket[], annualBase: number) {
  return roundTax(bracketTax(BigInt(annualBase) + BigInt(base), brackets) - bracketTax(BigInt(annualBase), brackets), 10_000n);
}

export type Period = { key: string; index: number; count: number };

// The position of a regular period within the calendar year in which it ends.
export function periodOfYear(schedule: PaySchedule, periodEnd: string): Period {
  const [year, month, day] = periodEnd.split("-").map(Number);
  if (schedule === "monthly") return { key: `${year}-M${month}`, index: month, count: 12 };
  if (schedule === "semi_monthly") { const index = (month - 1) * 2 + (day <= 15 ? 1 : 2); return { key: `${year}-S${index}`, index, count: 24 }; }
  const step = schedule === "weekly" ? 7 : 14;
  const first = Date.UTC(year, 0, 1);
  const offset = (Date.UTC(year, month - 1, day) - first) / 86_400_000;
  const days = (Date.UTC(year + 1, 0, 1) - first) / 86_400_000;
  const index = Math.floor(offset / step) + 1;
  return { key: `${year}-${schedule === "weekly" ? "W" : "B"}${index}`, index, count: Math.floor((days - 1 - offset % step) / step) + 1 };
}

// The difference between two rounded running totals, so a full year of periods always sums to twelve months.
export function monthlyToPeriod(monthlyCents: number, period: Period) {
  return ratio(monthlyCents * 12, period.index, period.count) - ratio(monthlyCents * 12, period.index - 1, period.count);
}

export type Item = { kind: ItemKind; source: ItemSource; sourceId: string | null; label: string; detail: string; baseCents: number; amountCents: number };
export type CalculationRule = {
  id: string; name: string; kind: RuleKind; method: RuleMethod; rateBp: number; amountCents: number; brackets: Bracket[]; wageCapCents: number | null; amountCapCents: number | null;
};
export type CalculationBenefit = { id: string; label: string; preTax: boolean; employeeCents: number; employerCents: number; employeeBp: number; employerBp: number; annualLimitCents: number | null; employeeYtd: number };
export type CalculationGarnishment = { id: string; label: string; method: GarnishmentMethod; rateBp: number; amountCents: number; remainingCents: number | null };
export type Calculation = {
  regular: boolean; periods: number; earnings: Omit<Item, "kind" | "baseCents">[]; nonTaxed: Omit<Item, "kind" | "baseCents">[];
  rules: CalculationRule[]; benefits: CalculationBenefit[]; garnishments: CalculationGarnishment[];
  ytdGross: number; ytdTaxable: number; ytdByRule: ReadonlyMap<string, number>; annualTaxable: number;
};
export type PayTotals = { grossCents: number; taxableCents: number; preTaxCents: number; taxCents: number; postTaxCents: number; nontaxedCents: number; netCents: number; employerCents: number };

const percentText = (bp: number) => `${(bp / 100).toFixed(2).replace(/\.?0+$/, "")}%`;

export function calculatePay(input: Calculation): { items: Item[]; totals: PayTotals } {
  const items: Item[] = [];
  const add = (item: Item) => { if (item.amountCents) items.push(item); return item.amountCents; };
  let gross = 0;
  for (const earning of input.earnings) gross += add({ ...earning, kind: "earning", baseCents: 0 });

  const apply = (rule: CalculationRule, taxable: number) => {
    if (rule.method === "flat" && !input.regular) return 0;
    const usesGross = rule.method === "percent_gross";
    let base = rule.method === "flat" ? 0 : Math.max(0, usesGross ? gross : taxable);
    if (rule.wageCapCents !== null) base = Math.min(base, Math.max(0, rule.wageCapCents - (usesGross ? input.ytdGross : input.ytdTaxable)));
    let amount = rule.method === "flat" ? rule.amountCents
      : rule.method === "brackets" ? input.regular ? bracketWithholding(base, rule.brackets, input.periods) : bracketWithholdingOnTop(base, rule.brackets, input.annualTaxable)
      : ratio(base, rule.rateBp, 10_000);
    if (rule.amountCapCents !== null) amount = Math.min(amount, Math.max(0, rule.amountCapCents - (input.ytdByRule.get(rule.id) ?? 0)));
    return add({ kind: rule.kind, source: "rule", sourceId: rule.id, label: rule.name, detail: rule.method === "flat" ? "Flat amount" : rule.method === "brackets" ? "Annual brackets" : `${percentText(rule.rateBp)} of ${usesGross ? "gross" : "taxable"} pay`, baseCents: base, amountCents: amount });
  };
  const benefit = (entry: CalculationBenefit, kind: "pre_tax" | "post_tax") => {
    let amount = entry.employeeBp ? ratio(Math.max(0, gross), entry.employeeBp, 10_000) : entry.employeeCents;
    if (entry.annualLimitCents !== null) amount = Math.min(amount, Math.max(0, entry.annualLimitCents - entry.employeeYtd));
    return add({ kind, source: "benefit", sourceId: entry.id, label: entry.label, detail: entry.employeeBp ? `${percentText(entry.employeeBp)} of gross pay` : "Share of monthly cost", baseCents: entry.employeeBp ? Math.max(0, gross) : 0, amountCents: amount });
  };

  let preTax = 0;
  for (const entry of input.benefits) if (entry.preTax) preTax += benefit(entry, "pre_tax");
  for (const rule of input.rules) if (rule.kind === "pre_tax") preTax += apply(rule, gross);
  const taxable = Math.max(0, gross - preTax);
  let tax = 0;
  for (const rule of input.rules) if (rule.kind === "tax") tax += apply(rule, taxable);
  let postTax = 0;
  for (const entry of input.benefits) if (!entry.preTax) postTax += benefit(entry, "post_tax");
  for (const rule of input.rules) if (rule.kind === "post_tax") postTax += apply(rule, taxable);
  // An ordered deduction stops at what is owed and never takes pay below zero.
  const disposable = Math.max(0, gross - preTax - tax);
  for (const entry of input.garnishments) {
    if (entry.method === "flat" && !input.regular) continue;
    const base = entry.method === "flat" ? 0 : entry.method === "percent_gross" ? Math.max(0, gross) : disposable;
    const due = entry.method === "flat" ? entry.amountCents : ratio(base, entry.rateBp, 10_000);
    const amount = Math.max(0, Math.min(due, entry.remainingCents ?? due, gross - preTax - tax - postTax));
    postTax += add({ kind: "post_tax", source: "garnishment", sourceId: entry.id, label: entry.label, detail: entry.method === "flat" ? "Flat amount" : `${percentText(entry.rateBp)} of ${entry.method === "percent_gross" ? "gross" : "disposable"} pay`, baseCents: base, amountCents: amount });
  }
  let employer = 0;
  for (const entry of input.benefits) employer += add({ kind: "employer", source: "benefit", sourceId: entry.id, label: entry.label, detail: entry.employerBp ? `${percentText(entry.employerBp)} of gross pay` : "Share of monthly cost", baseCents: entry.employerBp ? Math.max(0, gross) : 0, amountCents: entry.employerBp ? ratio(Math.max(0, gross), entry.employerBp, 10_000) : entry.employerCents });
  for (const rule of input.rules) if (rule.kind === "employer") employer += apply(rule, taxable);
  let nontaxed = 0;
  for (const payment of input.nonTaxed) nontaxed += add({ ...payment, kind: "non_taxed", baseCents: 0 });
  return { items, totals: { grossCents: gross, taxableCents: taxable, preTaxCents: preTax, taxCents: tax, postTaxCents: postTax, nontaxedCents: nontaxed, netCents: gross - preTax - tax - postTax + nontaxed, employerCents: employer } };
}

// Two calculations are the same when every component is, in the same order.
export function itemsKey(items: Item[]) {
  return JSON.stringify(items.map((item) => [item.kind, item.source, item.sourceId, item.label, item.baseCents, item.amountCents]));
}

export function validRouting(value: string) {
  if (!/^\d{9}$/.test(value) || value === "000000000") return false;
  return [...value].reduce((sum, digit, index) => sum + Number(digit) * [3, 7, 1][index % 3], 0) % 10 === 0;
}

const ibanLengths: Record<string, number> = { AD: 24, AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18, EE: 20, ES: 24, FI: 18, FR: 27, GB: 22, GI: 23, GR: 27, HR: 21, HU: 28, IE: 22, IS: 26, IT: 27, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MT: 31, NL: 18, NO: 15, PL: 28, PT: 25, RO: 24, SE: 24, SI: 19, SK: 24, SM: 27, VA: 22 };

export function validIban(value: string) {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(value)) return false;
  const expected = ibanLengths[value.slice(0, 2)];
  if (expected && value.length !== expected) return false;
  const digits = [...value.slice(4) + value.slice(0, 4)].map((character) => parseInt(character, 36)).join("");
  return [...digits].reduce((remainder, digit) => (remainder * 10 + Number(digit)) % 97, 0) === 1;
}

export function formatPercent(bp: number) {
  return percentText(bp);
}

export function ruleSummary(rule: { method: RuleMethod; rateBp: number; amountCents: number; brackets: Bracket[] }, currency: string) {
  return rule.method === "flat" ? `${formatMoney(rule.amountCents, currency)} each regular run` : rule.method === "brackets" ? `${rule.brackets.length} annual brackets`
    : `${percentText(rule.rateBp)} of ${rule.method === "percent_gross" ? "gross" : "taxable"} pay`;
}

export function bracketText(brackets: Bracket[]) {
  return brackets.map((bracket) => `${(bracket.from / 100).toFixed(2).replace(/\.00$/, "")} ${(bracket.bp / 100).toFixed(2).replace(/\.?0+$/, "")}`).join("\n");
}

function cents(value: string) {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace("-", "").split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return negative ? -amount : amount;
}

const amountPattern = /^\d{1,8}(\.\d{1,2})?$/;
const amountMessage = "Enter an amount such as 1250.00.";
const amount = z.string().trim().regex(amountPattern, amountMessage).transform(cents);
const positive = amount.refine((value) => value > 0, "Enter an amount above zero.");
const signed = z.string().trim().regex(/^-?\d{1,8}(\.\d{1,2})?$/, "Enter an amount such as 250.00 or -80.00.").transform(cents);
const optional = <T>(schema: z.ZodType<T, string>) => z.union([z.literal("").transform(() => null), schema]).optional().transform((value) => value ?? null);
const percent = z.string().trim().regex(/^\d{1,3}(\.\d{1,2})?$/, "Enter a percent such as 6.2.").transform(cents).refine((value) => value <= 10_000, "Enter at most 100 percent.");
const flag = z.literal("on").optional().transform(Boolean);
const version = z.coerce.number().int().positive();
const optionalDate = z.union([z.literal("").transform(() => null), workDate]).optional().transform((value) => value ?? null);
const newOrId = z.union([z.uuid(), z.literal("")]).default("");
const text = (label: string, max: number) => z.string().trim().min(1, `Enter ${label}.`).max(max);
const bracketsField = z.string().trim().max(2000).default("").transform((value, context) => {
  if (!value) return [];
  const rows = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => line.match(/^(\d{1,9}(?:\.\d{1,2})?)[\s,]+(\d{1,2}(?:\.\d{1,2})?|100)%?$/));
  if (rows.some((row) => !row)) { context.addIssue({ code: "custom", message: "Write each bracket as a starting amount and a percent, such as 11600 12." }); return z.NEVER; }
  const brackets = rows.map((row) => ({ from: cents(row![1]), bp: cents(row![2]) }));
  if (brackets[0].from !== 0) { context.addIssue({ code: "custom", message: "Start the first bracket at 0." }); return z.NEVER; }
  if (brackets.some((bracket, index) => index > 0 && bracket.from <= brackets[index - 1].from)) { context.addIssue({ code: "custom", message: "List the brackets from the lowest amount to the highest." }); return z.NEVER; }
  return brackets;
});
const selectedTypes = Object.fromEntries(employmentTypes.map((type) => [`type-${type}`, flag])) as Record<`type-${EmploymentType}`, typeof flag>;

export function chosenTypes(input: Partial<Record<`type-${EmploymentType}`, boolean>>) {
  return employmentTypes.filter((type) => input[`type-${type}`]);
}

export const runIdFields = z.object({ id: z.uuid() });
export const lineSaveFields = payLineFields.extend({
  overtimeHours: z.union([z.string().trim().regex(/^\d{1,3}(\.\d{1,2})?$/, "Enter hours such as 8 or 7.5.").transform(Number).refine((value) => value <= 744, "Enter at most 744 hours."), z.literal("").transform(() => 0)]).optional(),
  acceptNotes: flag,
});
export const offCycleFields = z.object({
  purpose: z.enum(runPurposes, "Choose a purpose."), label: z.string().trim().max(80).default(""), periodStart: workDate, periodEnd: workDate, payOn: workDate,
  includesClaims: flag, people: z.string().transform((value) => value.split(",").filter(Boolean)).pipe(z.array(z.uuid()).min(1, "Choose at least one person.").max(500)),
  type: z.enum(earningTypes).default("bonus"), amount: optional(signed),
}).refine((value) => value.periodEnd >= value.periodStart, { path: ["periodEnd"], message: "The period must end on or after it starts." })
  .refine((value) => value.amount === null || value.amount > 0 || value.type === "correction" && value.amount !== 0, { path: ["amount"], message: "Only a correction can be below zero." });
export const earningFields = z.object({ runId: z.uuid(), lineId: z.uuid(), type: z.enum(earningTypes, "Choose a type."), label: z.string().trim().max(120).default(""), amount: signed })
  .refine((value) => value.amount > 0 || value.type === "correction" && value.amount < 0, { path: ["amount"], message: "Enter an amount above zero. Only a correction can be below it." });
export const ptoFields = z.object({ runId: z.uuid(), lineId: z.uuid(), days: z.string().trim().regex(/^\d{1,3}(\.\d{1,2})?$/, "Enter days such as 4.5.").transform(Number).refine((value) => value > 0 && value <= 366, "Enter between 0.01 and 366 days.") });
export const removeEarningFields = z.object({ runId: z.uuid(), id: z.uuid() });
export const runPersonFields = z.object({ runId: z.uuid(), employeeId: z.uuid("Choose a person.") });
export const payFileFields = z.object({ runId: z.uuid(), format: z.enum(fileFormats, "Choose a format."), scope: z.enum(["remaining", "all"]).default("remaining"), confirmRepeat: flag });
export const ruleFields = z.object({
  id: newOrId, version: z.coerce.number().int().min(0), name: text("a name", 80), kind: z.enum(ruleKinds), method: z.enum(ruleMethods), rate: optional(percent), amount: optional(amount), brackets: bracketsField,
  wageCap: optional(positive), amountCap: optional(positive), ...selectedTypes, location: z.string().trim().max(100).default(""), enrollment: z.enum(["everyone", "chosen"]), effectiveFrom: workDate, effectiveTo: optionalDate,
  account: z.string().trim().max(60).default(""), active: flag,
}).superRefine((value, context) => {
  const issue = (path: string, message: string) => context.addIssue({ code: "custom", path: [path], message });
  if (value.method.startsWith("percent") && !value.rate) issue("rate", "Enter a percent above zero.");
  if (value.method === "flat" && !value.amount) issue("amount", "Enter an amount above zero.");
  if (value.method === "brackets" && !value.brackets.length) issue("brackets", "Enter at least one bracket.");
  if (value.method === "brackets" && value.kind !== "tax") issue("method", "Only tax withholding can use brackets.");
  if (value.kind === "pre_tax" && value.method === "percent_taxable") issue("method", "A pre-tax deduction is a percent of gross pay or a flat amount.");
  if (value.method === "flat" && value.wageCap) issue("wageCap", "A flat amount has no wage cap. Use the annual amount cap.");
  if (value.effectiveTo && value.effectiveTo < value.effectiveFrom) issue("effectiveTo", "The end must be on or after the start.");
});
export const assignmentFields = z.object({ employeeId: z.uuid(), ruleId: z.uuid(), mode: z.enum(["default", "enrolled", "override", "exempt"]), value: z.union([z.literal("").transform(() => null), z.string().trim().regex(amountPattern, "Enter a number such as 6.2 or 125.00.").transform(cents)]).optional().transform((value) => value ?? null) })
  .refine((value) => value.mode !== "override" || value.value !== null, { path: ["value"], message: "Enter this person’s percent or amount." });
export const recurringFields = z.object({ employeeId: z.uuid(), label: text("a name", 80), amount: positive, taxable: flag, startsOn: workDate, endsOn: optionalDate })
  .refine((value) => !value.endsOn || value.endsOn >= value.startsOn, { path: ["endsOn"], message: "The end must be on or after the start." });
export const garnishmentFields = z.object({ employeeId: z.uuid(), label: text("a name", 80), method: z.enum(garnishmentMethods), value: z.string().trim().regex(amountPattern, "Enter a percent or an amount above zero.").transform(cents).refine((value) => value > 0, "Enter a percent or an amount above zero."), totalOwed: optional(positive), startsOn: workDate })
  .refine((value) => value.method === "flat" || value.value <= 10_000, { path: ["value"], message: "Enter at most 100 percent." });
export const endFields = z.object({ id: z.uuid(), endsOn: workDate });
export const paySettingsFields = z.object({ version, journalDates: z.enum(["iso", "us", "eu"]) });
const routing = z.string().trim().refine(validRouting, "Enter a valid nine-digit routing number.");
const ascii = (max: number, label: string) => z.string().trim().min(1, `Enter ${label}.`).max(max).regex(/^[\x20-\x7e]+$/, "Use letters and numbers without accents.");
export const nachaFields = z.object({ version, routing, bankName: ascii(23, "the bank’s name"), originId: z.string().trim().toUpperCase().regex(/^[0-9A-Z]{9,10}$/, "Enter the 9 or 10 character ID your bank gave you."), companyId: z.string().trim().toUpperCase().regex(/^[0-9A-Z]{10}$/, "Enter the 10 character ID your bank gave you."), companyName: ascii(16, "the company name") });
const iban = z.string().transform((value) => value.replace(/\s+/g, "").toUpperCase()).refine(validIban, "Enter a valid IBAN.");
const bic = z.union([z.literal(""), z.string().trim().toUpperCase().regex(/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/, "Enter a valid BIC.")]).default("");
export const sepaFields = z.object({ version, name: text("the company name", 70), iban: z.union([z.literal("").transform(() => null), iban]), bic });
export const journalFields = z.object({ version, ...Object.fromEntries(Object.keys(journalAccounts).map((key) => [key, z.string().trim().max(60).default("")])) as Record<JournalAccount, z.ZodDefault<z.ZodString>> });
const holder = text("the account holder’s name", 70);
const bankCommon = { employeeId: z.uuid(), holder, password: z.string().max(128).default("") };
export const bankFields = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("us"), ...bankCommon, routing, account: z.string().transform((value) => value.replace(/[\s-]+/g, "")).pipe(z.string().regex(/^\d{4,17}$/, "Enter an account number of 4 to 17 digits.")), confirmAccount: z.string().transform((value) => value.replace(/[\s-]+/g, "")), type: z.enum(["checking", "savings"]) }),
  z.object({ kind: z.literal("iban"), ...bankCommon, iban, bic }),
]).superRefine((value, context) => { if (value.kind === "us" && value.account !== value.confirmAccount) context.addIssue({ code: "custom", path: ["confirmAccount"], message: "The account numbers don’t match." }); });
export const invoiceLineCount = 5;
const quantityPattern = /^\d{1,5}(\.\d{1,2})?$/;
export const invoiceFields = z.object({
  number: text("the invoice number", 40), issuedOn: workDate, note: z.string().trim().max(500).default(""),
  ...Object.fromEntries(Array.from({ length: invoiceLineCount }, (_, index) => [[`description${index + 1}`, z.string().trim().max(160).default("")], [`quantity${index + 1}`, z.string().trim().default("")], [`price${index + 1}`, z.string().trim().default("")]]).flat()) as Record<string, z.ZodDefault<z.ZodString>>,
}).transform((raw, context) => {
  const value = raw as typeof raw & Record<string, string>;
  const lines: { description: string; quantity: number; unitCents: number; amountCents: number }[] = [];
  for (let row = 1; row <= invoiceLineCount; row += 1) {
    const [description, quantity, price] = [value[`description${row}`], value[`quantity${row}`], value[`price${row}`]];
    if (!description && !price) continue;
    const issue = (path: string, message: string) => context.addIssue({ code: "custom", path: [`${path}${row}`], message });
    if (!description) issue("description", "Describe this line.");
    if (!quantityPattern.test(quantity) || Number(quantity) <= 0) issue("quantity", "Enter a quantity such as 12 or 7.5.");
    if (!amountPattern.test(price) || cents(price) <= 0) issue("price", "Enter a price above zero, such as 95.00.");
    if (description && quantityPattern.test(quantity) && amountPattern.test(price)) lines.push({ description, quantity: Number(quantity), unitCents: cents(price), amountCents: ratio(cents(price), cents(quantity), 100) });
  }
  if (!lines.length && !context.issues.length) context.addIssue({ code: "custom", path: ["description1"], message: "Add at least one line." });
  return { number: raw.number as string, issuedOn: raw.issuedOn as string, note: raw.note as string, lines };
});
export const planFields = z.object({
  id: newOrId, version: z.coerce.number().int().min(0), name: text("a name", 80), kind: z.enum(planKinds), description: z.string().trim().max(1000).default(""), percent: flag, preTax: flag, employeeChooses: flag,
  annualLimit: optional(positive), ...selectedTypes, waitingDays: z.coerce.number().int("Enter whole days.").min(0).max(365), documentId: z.union([z.uuid(), z.literal("")]).default("").transform((value) => value || null), active: flag,
}).superRefine((value, context) => {
  if (value.percent && value.kind !== "retirement") context.addIssue({ code: "custom", path: ["kind"], message: "Only a retirement plan can be a percent of pay." });
});
export const rateFields = z.object({ planId: z.uuid(), tier: z.enum(tiers), effectiveOn: workDate, employee: z.string().trim().regex(amountPattern, "Enter a number such as 120.00."), employer: z.string().trim().regex(amountPattern, "Enter a number such as 480.00.") })
  .transform((value) => ({ ...value, employee: cents(value.employee), employer: cents(value.employer) }));
export const windowFields = z.object({ name: text("a name", 80), opensOn: workDate, closesOn: workDate, coverageOn: workDate })
  .refine((value) => value.closesOn >= value.opensOn, { path: ["closesOn"], message: "It must close on or after it opens." });
export const lifeEvents = ["Marriage or partnership", "Divorce or separation", "Birth or adoption", "Loss of other coverage", "Move", "Other"] as const;
export const eventFields = z.object({ employeeId: z.uuid(), name: z.enum(lifeEvents, "Choose an event."), eventOn: workDate });
export const decideFields = z.object({ id: z.uuid(), decision: z.enum(["approved", "declined", "cancelled"]) });
export const newHireFields = z.object({ version, days: z.coerce.number().int("Enter whole days.").min(0).max(365) });
export const dependentFields = z.object({ employeeId: z.uuid(), name: text("a name", 160), relationship: z.enum(["spouse", "child"]), born: workDate });
export const electionFields = z.object({
  employeeId: z.uuid(), planKind: z.enum(planKinds), choice: z.string().regex(/^(waive|[0-9a-f-]{36}:(employee|spouse|children|family))$/, "Choose a plan or waive."),
  contribution: z.union([z.literal("").transform(() => null), z.string().trim().regex(amountPattern, "Enter a number such as 5 or 125.00.").transform(cents)]).optional().transform((value) => value ?? null),
  dependents: z.string().default("").transform((value) => value.split(",").filter(Boolean)).pipe(z.array(z.uuid()).max(20)),
});
export const commandFields = z.object({ id: z.uuid() });

export function plainAmount(cents: number | null) {
  return cents === null ? "" : (cents / 100).toFixed(2);
}

export function runTitle(run: { kind: RunKind; purpose: RunPurpose | ""; label: string }) {
  return run.kind === "reversal" ? "Reversal" : run.purpose ? run.label || purposeLabels[run.purpose] : "Regular";
}
