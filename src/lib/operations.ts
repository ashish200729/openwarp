import { z } from "zod";

export const currencies = ["USD", "EUR", "GBP", "INR", "CAD", "AUD", "SGD", "CHF"] as const;
export const paySchedules = ["monthly", "semi_monthly", "biweekly", "weekly"] as const;
export const payBases = ["annual", "hourly"] as const;
export const expenseCategories = ["travel", "meals", "software", "equipment", "training", "other"] as const;
export const documentCategories = ["policy", "contract", "identity", "tax", "other"] as const;
export type PaySchedule = (typeof paySchedules)[number];
export type PayBasis = (typeof payBases)[number];
export type ExpenseCategory = (typeof expenseCategories)[number];
export type DocumentCategory = (typeof documentCategories)[number] | "receipt";
export type RequestState = "pending" | "approved" | "declined" | "cancelled" | "reimbursed";

export const scheduleLabels: Record<PaySchedule, string> = { monthly: "Monthly", semi_monthly: "Twice a month", biweekly: "Every two weeks", weekly: "Weekly" };
export const periodsPerYear: Record<PaySchedule, number> = { monthly: 12, semi_monthly: 24, biweekly: 26, weekly: 52 };
export const basisLabels: Record<PayBasis, string> = { annual: "per year", hourly: "per hour" };
export const expenseLabels: Record<ExpenseCategory, string> = { travel: "Travel", meals: "Meals", software: "Software", equipment: "Equipment", training: "Training", other: "Other" };
export const documentLabels: Record<DocumentCategory, string> = { policy: "Policy", contract: "Contract", identity: "Identity", tax: "Tax", receipt: "Receipt", other: "Other" };
export const requestLabels: Record<RequestState, string> = { pending: "Pending", approved: "Approved", declined: "Declined", cancelled: "Cancelled", reimbursed: "Reimbursed" };

export const workDate = z.iso.date("Choose a date.").refine((value) => value >= "1900-01-01" && value <= "9999-12-31", "Enter a valid date.");
const money = z.string().trim().regex(/^\d{1,9}(\.\d{1,2})?$/, "Enter an amount such as 1250.00.").transform(toCents);
const signedMoney = z.string().trim().regex(/^-?\d{1,9}(\.\d{1,2})?$/, "Enter an amount such as 250.00 or -80.00.").transform(toCents);
const positiveMoney = money.refine((cents) => cents > 0, "Enter an amount above zero.");
const note = z.string().trim().max(500).default("");
const flag = z.literal("on").optional().transform(Boolean);

export const timeOffFields = z.object({ typeId: z.uuid("Choose a type."), startsOn: workDate, endsOn: workDate, halfDay: flag, note })
  .refine((value) => value.endsOn >= value.startsOn, { path: ["endsOn"], message: "The last day must be on or after the first day." })
  .refine((value) => !value.halfDay || value.startsOn === value.endsOn, { path: ["endsOn"], message: "A half day starts and ends on the same date." });
export const decisionFields = z.object({ id: z.uuid(), decision: z.enum(["approved", "declined", "cancelled"]) });
export const expenseFields = z.object({ spentOn: workDate, merchant: z.string().trim().min(1, "Enter a merchant.").max(120), category: z.enum(expenseCategories, "Choose a category."), amount: positiveMoney, note });
export const compensationFields = z.object({ employeeId: z.uuid(), amount: positiveMoney, basis: z.enum(payBases), effectiveOn: workDate, reason: z.string().trim().max(200) });
export const documentFields = z.object({ name: z.string().trim().min(1, "Enter a name.").max(120), category: z.enum(documentCategories, "Choose a category."), employeeId: z.union([z.uuid(), z.literal("")]).transform((value) => value || null), needsAcknowledgement: flag });
export const payRunFields = z.object({ periodStart: workDate, periodEnd: workDate, payOn: workDate })
  .refine((value) => value.periodEnd >= value.periodStart, { path: ["periodEnd"], message: "The period must end on or after it starts." });
export const payLineFields = z.object({
  runId: z.uuid(), lineId: z.uuid(), adjustment: z.union([signedMoney, z.literal("").transform(() => 0)]), adjustmentNote: z.string().trim().max(120).default(""),
  hours: z.union([z.string().trim().regex(/^\d{1,3}(\.\d{1,2})?$/, "Enter hours such as 80 or 37.5.").transform(Number).refine((value) => value <= 744, "Enter at most 744 hours."), z.literal("").transform(() => 0)]).optional(),
});
export const payRunCommandFields = z.object({ id: z.uuid(), version: z.coerce.number().int().positive(), operation: z.enum(["approve", "delete"]) });
export const companyFields = z.object({ currency: z.enum(currencies), schedule: z.enum(paySchedules), version: z.coerce.number().int().positive() });
export const timeOffTypeFields = z.object({
  id: z.union([z.uuid(), z.literal("")]).default(""), name: z.string().trim().min(1, "Enter a name.").max(60),
  annualDays: z.union([z.literal("").transform(() => null), z.coerce.number().int("Enter whole days.").min(0).max(366)]), active: flag,
});
export const holidayFields = z.object({ day: workDate, name: z.string().trim().min(1, "Enter a name.").max(80) });
export const templateFields = z.object({ kind: z.enum(["onboarding", "offboarding"]), title: z.string().trim().min(1, "Enter a task.").max(180) });
export const accountFields = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(160), email: z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid email.")),
  role: z.enum(["admin", "viewer"]), employeeId: z.union([z.uuid(), z.literal("")]).transform((value) => value || null),
});
export const accountCommandFields = z.object({ userId: z.string().min(1).max(100), operation: z.enum(["admin", "viewer", "disabled", "reset"]) });
export const accountLinkFields = z.object({ userId: z.string().min(1).max(100), employeeId: z.union([z.uuid(), z.literal("")]).transform((value) => value || null) });

function toCents(value: string) {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace("-", "").split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return negative ? -cents : cents;
}

export function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat("en", { style: "currency", currency, currencyDisplay: "narrowSymbol" }).format(cents / 100);
}

export function formatDays(days: number) {
  // Monthly accrual produces fractions, and two decimals hide floating point residue.
  const rounded = Math.round(days * 100) / 100;
  return `${new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(rounded)} ${rounded === 1 ? "day" : "days"}`;
}

const day = 86_400_000;
const parse = (value: string) => Date.parse(`${value}T00:00:00Z`);
export const isoDate = (time: number) => new Date(time).toISOString().slice(0, 10);
export const today = () => isoDate(Date.now());
export const addDays = (value: string, count: number) => isoDate(parse(value) + count * day);

export function weekdaysBetween(start: string, end: string, skip: ReadonlySet<string> = new Set()) {
  let count = 0;
  for (let time = parse(start); time <= parse(end); time += day) {
    const weekday = new Date(time).getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !skip.has(isoDate(time))) count += 1;
  }
  return count;
}

export function csvCell(value: string) {
  const safe = /^[\u0000- ]*[=+\-@＝＋－＠]|^[\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function toCsv(rows: string[][]) {
  return `﻿${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^﻿/, "");
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { cell += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"' && cell === "") quoted = true;
    else if (character === ",") { row.push(cell); cell = ""; }
    else if (character === "\n" || character === "\r") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell); cell = "";
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
    } else cell += character;
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}
