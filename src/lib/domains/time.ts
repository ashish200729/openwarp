import { z } from "zod";
import { addDays, isoDate, workDate } from "@/lib/operations";

export const timeActivity = {
  "timesheet.submitted": "Submitted a timesheet", "timesheet.withdrawn": "Withdrew a timesheet", "timesheet.approved": "Approved a timesheet", "timesheet.returned": "Returned a timesheet",
  "timesheet.reopened": "Reopened a timesheet", "timesheet.exported": "Exported timesheets",
  "time_entry.added": "Added a time entry", "time_entry.edited": "Changed a time entry", "time_entry.removed": "Removed a time entry",
  "shift.created": "Scheduled a shift", "shift.updated": "Changed a shift", "shift.deleted": "Deleted a shift", "shift.copied": "Copied a week of shifts", "shift.published": "Published shifts",
  "time_off.recorded": "Recorded time off for someone", "time_off.adjusted": "Adjusted a time off balance",
} as const;

export const sheetStates = ["open", "submitted", "returned", "approved", "locked"] as const;
export type SheetState = (typeof sheetStates)[number];
export const sheetLabels: Record<SheetState, string> = { open: "Not submitted", submitted: "Waiting for approval", returned: "Returned", approved: "Approved", locked: "Locked" };
export const clockOperations = ["clock_in", "clock_out", "break_start", "break_end"] as const;
export const eventLabels = { clocked_in: "Clocked in", clocked_out: "Clocked out", break_started: "Started a break", break_ended: "Ended a break", added: "Added", edited: "Changed", removed: "Removed" } as const;
export const entryNotices: Record<string, string> = { entry: "Entry saved.", removed: "Entry removed." };
export const accrualLabels = { annual: "All at the start of the year", monthly: "A twelfth each month worked" } as const;
export type Accrual = keyof typeof accrualLabels;

const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a time such as 09:00.");
const reason = z.string().trim().max(200).default("");
const flag = z.literal("on").optional().transform(Boolean);
const version = z.coerce.number().int().positive();
const optionalUuid = z.union([z.uuid(), z.literal("")]).default("");
const hours = (most: number) => z.string().trim().regex(/^\d{1,3}(\.\d{1,2})?$/, "Enter hours such as 40 or 7.5.").transform((value) => Math.round(Number(value) * 60)).refine((minutes) => minutes >= 60 && minutes <= most * 60, `Enter between 1 and ${most} hours.`);
const minutes = (most: number) => z.coerce.number("Enter whole minutes.").int("Enter whole minutes.").min(0, "Enter zero or more.").max(most, `Enter at most ${most} minutes.`);
const halfDays = (most: number) => z.string().trim().regex(/^\d{1,3}(\.[05])?$/, "Enter whole or half days.").transform(Number).refine((days) => days <= most, `Enter at most ${most} days.`);
const optionalDays = (most: number) => z.union([z.literal("").transform(() => null), halfDays(most)]);

export const clockFields = z.object({ operation: z.enum(clockOperations) });
export const entryFields = z.object({
  employeeId: z.uuid(), id: optionalUuid, version: z.coerce.number().int().min(0).default(0), week: workDate, day: workDate, start: clockTime, end: clockTime,
  breakMinutes: minutes(1440), note: z.string().trim().max(200).default(""), reason,
}).refine((value) => value.start !== value.end, { path: ["end"], message: "The end must be different from the start." });
export const entryRemovalFields = z.object({ employeeId: z.uuid(), week: workDate, id: z.uuid(), version, reason: reason.refine(Boolean, "Enter a reason.") });
export const sheetCommandFields = z.object({
  employeeId: z.uuid(), week: workDate, version: z.coerce.number().int().min(0), operation: z.enum(["submit", "withdraw", "approve", "return", "reopen"]), note: z.string().trim().max(500).default(""),
});
export const shiftFields = z.object({
  team: optionalUuid, id: optionalUuid, version: z.coerce.number().int().min(0).default(0), employeeId: z.uuid("Choose a person."), day: workDate, start: clockTime, end: clockTime,
  role: z.string().trim().max(60).default(""), note: z.string().trim().max(200).default(""),
}).refine((value) => value.start !== value.end, { path: ["end"], message: "The end must be different from the start." });
export const shiftRemovalFields = z.object({ id: z.uuid(), version, team: optionalUuid });
export const scheduleCommandFields = z.object({ week: workDate, team: optionalUuid, operation: z.enum(["publish", "copy"]) });
export const trackingFields = z.object({
  version, timeZone: z.string().min(1).max(64), tracking: flag, trackSalaried: flag, weeklyHours: hours(168), dailyHours: z.union([z.literal("").transform(() => null), hours(24)]),
  multiplier: z.string().trim().regex(/^[1-4](\.\d{1,2})?$/, "Enter a multiplier such as 1.5.").transform((value) => Math.round(Number(value) * 10_000)).refine((value) => value <= 40_000, "Enter at most 4."),
  paidBreak: minutes(480), autoBreak: minutes(120), autoBreakAfter: hours(24), lateAfter: minutes(120),
});
export const policyFields = z.object({
  id: z.uuid(), version, accrual: z.enum(["annual", "monthly"]).default("annual"), carryoverDays: optionalDays(366).default(0),
  maxBalanceDays: optionalDays(999).refine((days) => days === null || days > 0, "Enter at least half a day, or leave it empty.").default(null),
  waitingDays: z.coerce.number("Enter whole days.").int("Enter whole days.").min(0).max(730), negativeDays: halfDays(60).default(0),
  noticeDays: z.coerce.number("Enter whole days.").int("Enter whole days.").min(0).max(365), trackedFrom: z.union([z.literal("").transform(() => null), workDate]).default(null),
});
export const adjustmentFields = z.object({
  employeeId: z.uuid(), typeId: z.uuid("Choose a type."), effectiveOn: workDate, reason: reason.refine(Boolean, "Enter a reason."),
  days: z.string().trim().regex(/^-?\d{1,3}(\.[05])?$/, "Enter days such as 2, 0.5 or -1.").transform(Number).refine((days) => days !== 0 && Math.abs(days) <= 366, "Enter between half a day and 366 days."),
});
export const recordTimeOffFields = z.object({ employeeId: z.uuid("Choose a person."), typeId: z.uuid("Choose a type."), startsOn: workDate, endsOn: workDate, halfDay: flag, overBalance: flag, note: z.string().trim().max(500).default("") })
  .refine((value) => value.endsOn >= value.startsOn, { path: ["endsOn"], message: "The last day must be on or after the first day." })
  .refine((value) => !value.halfDay || value.startsOn === value.endsOn, { path: ["endsOn"], message: "A half day starts and ends on the same date." });

export const weekStart = (day: string) => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
export const weekDays = (week: string) => Array.from({ length: 7 }, (_, index) => addDays(week, index));
export const timesheetUrl = (employeeId: string, week: string) => `/workspace/timesheets/${employeeId}?week=${week}`;

// A week from the address bar. Anything unreadable falls back to the current week.
export function parseWeek(value: string | undefined, day: string) {
  const parsed = workDate.safeParse(value);
  return weekStart(parsed.success && parsed.data >= "2000-01-01" && parsed.data <= "2100-12-31" ? parsed.data : day);
}

export function formatMinutes(minutes: number) {
  return `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
}

export const decimalHours = (minutes: number) => Math.round(minutes / 60 * 100) / 100;
export const formatMultiplier = (basisPoints: number) => `${basisPoints / 10_000}×`;

const weekdayFormat = new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
export const formatWeekday = (day: string) => weekdayFormat.format(new Date(`${day}T00:00:00Z`));

export type TimePolicy = { weeklyOvertimeMinutes: number; dailyOvertimeMinutes: number | null; overtimeMultiplierBp: number; paidBreakMinutes: number; autoBreakMinutes: number; autoBreakAfterMinutes: number };
export type DayTotal = { day: string; regular: number; overtime: number; breaks: number };

// Hours past the daily threshold are overtime first. What remains counts toward the weekly threshold, so no hour is overtime twice.
export function splitWeek(week: string, entries: { day: string; minutes: number; breakMinutes: number }[], policy: TimePolicy): DayTotal[] {
  let counted = 0;
  return weekDays(week).map((day) => {
    const own = entries.filter((entry) => entry.day === day);
    const gross = own.reduce((sum, entry) => sum + entry.minutes, 0);
    const taken = own.reduce((sum, entry) => sum + entry.breakMinutes, 0);
    const automatic = gross >= policy.autoBreakAfterMinutes ? policy.autoBreakMinutes : 0;
    const breaks = Math.min(gross, Math.max(taken - policy.paidBreakMinutes, automatic, 0));
    const worked = gross - breaks;
    const regular = Math.min(worked, policy.dailyOvertimeMinutes ?? worked, Math.max(policy.weeklyOvertimeMinutes - counted, 0));
    counted += regular;
    return { day, regular, overtime: worked - regular, breaks };
  });
}

export type LeavePolicy = {
  annualDays: number; accrual: Accrual; carryoverDays: number | null; maxBalanceDays: number | null; negativeDays: number; trackedFrom: string | null;
};
export type LeaveRequest = { startsOn: string; days: number; pending: boolean };
export type LeaveAdjustment = { effectiveOn: string; days: number };

// Every completed month since the start date. The day is held to the length of shorter months.
function monthAnniversaries(start: string, from: string, to: string) {
  const [year, month, day] = start.split("-").map(Number);
  const dates: string[] = [];
  const first = Math.max(1, (Number(from.slice(0, 4)) - year) * 12 + Number(from.slice(5, 7)) - month);
  for (let count = first; ; count += 1) {
    const last = new Date(Date.UTC(year, month - 1 + count + 1, 0)).getUTCDate();
    const date = isoDate(Date.UTC(year, month - 1 + count, Math.min(day, last)));
    if (date > to) return dates;
    if (date >= from) dates.push(date);
  }
}

const tidy = (days: number) => Math.round(days * 100) / 100 + 0;

// Replays grants, adjustments and time off in date order up to a year. Nothing is stored, so a policy change applies to the whole history at once.
export function leaveYear(policy: LeavePolicy, hireDate: string, requests: LeaveRequest[], adjustments: LeaveAdjustment[], year: number, asOf: string) {
  const start = policy.trackedFrom && policy.trackedFrom > hireDate ? policy.trackedFrom : hireDate;
  let balance = 0;
  let allowance = 0;
  let taken: { startsOn: string; days: number; pending: boolean; after: number }[] = [];
  for (let current = Math.min(Number(start.slice(0, 4)), year); current <= year; current += 1) {
    const [first, last] = [`${current}-01-01`, `${current}-12-31`];
    const until = current === year ? asOf : last;
    const carried = Math.min(Math.max(balance, -policy.negativeDays), policy.carryoverDays ?? Infinity);
    const grants = policy.accrual === "annual" ? [{ on: first, days: policy.annualDays }]
      : monthAnniversaries(start, first, until).map((on) => ({ on, days: policy.annualDays / 12 }));
    const events = [
      ...grants.map((grant) => ({ ...grant, order: 0 as const })),
      ...adjustments.filter((entry) => entry.effectiveOn >= first && entry.effectiveOn <= until).map((entry) => ({ on: entry.effectiveOn, days: entry.days, order: 1 as const })),
      ...requests.filter((entry) => entry.startsOn >= first && entry.startsOn <= last).map((entry) => ({ on: entry.startsOn, days: entry.days, order: 2 as const, pending: entry.pending })),
    ].sort((one, two) => one.on < two.on ? -1 : one.on > two.on ? 1 : one.order - two.order);
    balance = carried;
    allowance = carried;
    taken = [];
    for (const event of events) {
      if (event.order === 2) {
        balance -= event.days;
        taken.push({ startsOn: event.on, days: event.days, pending: event.pending, after: tidy(balance) });
        continue;
      }
      const added = event.order === 0 ? Math.max(0, Math.min(event.days, (policy.maxBalanceDays ?? Infinity) - balance)) : event.days;
      balance += added;
      allowance += added;
    }
  }
  return { allowance: tidy(allowance), taken };
}

// Days this person could take from a date, after everything already booked on or after it in the same year.
export function leaveLeft(policy: LeavePolicy, hireDate: string, requests: LeaveRequest[], adjustments: LeaveAdjustment[], from: string) {
  const year = Number(from.slice(0, 4));
  const candidate = leaveYear(policy, hireDate, [...requests, { startsOn: from, days: 0, pending: true }], adjustments, year, `${year}-12-31`);
  return tidy(Math.min(...candidate.taken.filter((entry) => entry.startsOn >= from).map((entry) => entry.after)) + policy.negativeDays);
}
