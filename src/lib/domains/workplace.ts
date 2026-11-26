import { z } from "zod";
import { currencies, workDate } from "@/lib/operations";
import { employmentTypes } from "@/lib/people";

export const workplaceActivity = {
  "device.added": "Added a device", "device.updated": "Changed a device", "device.imported": "Imported devices", "device.exported": "Exported devices",
  "device.assigned": "Assigned a device", "device.received": "Confirmed a device", "device.return_requested": "Asked for a device back", "device.sent_back": "Sent a device back", "device.returned": "Recorded a device return",
  "device.requested": "Requested a device", "device.request_closed": "Closed a device request", "device.repair_reported": "Reported a device problem", "device.repair_closed": "Closed a device repair", "device.attested": "Confirmed device security",
  "app.added": "Added an app", "app.updated": "Changed an app", "app.archived": "Archived an app", "app.exported": "Exported the app register", "app.default_added": "Added a default app", "app.default_removed": "Removed a default app",
  "access.requested": "Requested app access", "access.approved": "Approved app access", "access.declined": "Declined app access", "access.granted": "Recorded app access", "access.revoked": "Recorded app access removal", "access.withdrawn": "Withdrew an app request",
  "course.added": "Added a course", "course.updated": "Changed a course", "course.published": "Published a course", "course.unpublished": "Unpublished a course", "course.archived": "Archived a course",
  "training.assigned": "Assigned training", "training.cancelled": "Cancelled training", "training.completed": "Completed training", "training.attempted": "Took a quiz", "training.attempt_added": "Allowed another quiz attempt", "training.reminded": "Sent training reminders", "training.exported": "Exported training records",
  "obligation.added": "Added an obligation", "obligation.updated": "Changed an obligation", "obligation.completed": "Completed an obligation", "obligation.skipped": "Skipped an obligation", "obligation.archived": "Archived an obligation", "obligation.reference_viewed": "Viewed an obligation reference",
  "notice.recorded": "Recorded a notice", "notice.updated": "Changed a notice", "notice.file_opened": "Opened a compliance file",
  "compliance.exported": "Exported the compliance calendar", "jurisdiction.mapped": "Set a location’s jurisdiction",
  "report.exported": "Exported a report", "report.saved": "Saved a report view", "role.planned": "Planned a role", "role.updated": "Changed a planned role",
  "task.added": "Added a checklist task", "task.planned": "Changed a task’s date or assignee", "activity.exported": "Exported activity",
} as const;

export const deviceKinds = ["laptop", "desktop", "phone", "tablet", "monitor", "accessory", "other"] as const;
export const deviceStatuses = ["in_stock", "assigned", "repair", "retired", "lost"] as const;
export const deviceConditions = ["new", "good", "fair", "poor"] as const;
export const criticalities = ["low", "normal", "critical"] as const;
export const billings = ["monthly", "annual"] as const;
export const lessonKinds = ["text", "link", "document"] as const;
export const obligationCategories = ["tax_registration", "filing", "licence", "insurance", "posting", "policy_review", "other"] as const;
export const recurrences = ["none", "monthly", "quarterly", "semiannual", "annual"] as const;
export const noticeStates = ["received", "in_progress", "responded", "closed"] as const;
export const roleStatuses = ["planned", "open", "filled", "dropped"] as const;
export type DeviceKind = (typeof deviceKinds)[number];
export type DeviceStatus = (typeof deviceStatuses)[number];
export type DeviceCondition = (typeof deviceConditions)[number];
export type Criticality = (typeof criticalities)[number];
export type Billing = (typeof billings)[number];
export type LessonKind = (typeof lessonKinds)[number];
export type ObligationCategory = (typeof obligationCategories)[number];
export type Recurrence = (typeof recurrences)[number];
export type NoticeState = (typeof noticeStates)[number];
export type RoleStatus = (typeof roleStatuses)[number];
export type GrantState = "requested" | "approved" | "granted" | "declined" | "withdrawn" | "revoked";

export const deviceKindLabels: Record<DeviceKind, string> = { laptop: "Laptop", desktop: "Desktop", phone: "Phone", tablet: "Tablet", monitor: "Monitor", accessory: "Accessory", other: "Other" };
export const deviceStatusLabels: Record<DeviceStatus, string> = { in_stock: "In stock", assigned: "Assigned", repair: "In repair", retired: "Retired", lost: "Lost" };
export const conditionLabels: Record<DeviceCondition | "lost", string> = { new: "New", good: "Good", fair: "Fair", poor: "Poor", lost: "Lost" };
export const criticalityLabels: Record<Criticality, string> = { low: "Low", normal: "Normal", critical: "Critical" };
export const billingLabels: Record<Billing, string> = { monthly: "a month", annual: "a year" };
export const grantLabels: Record<GrantState, string> = { requested: "Requested", approved: "Approved, not set up", granted: "Has access", declined: "Declined", withdrawn: "Withdrawn", revoked: "Removed" };
export const lessonLabels: Record<LessonKind, string> = { text: "Text", link: "Link", document: "Company document" };
export const obligationLabels: Record<ObligationCategory, string> = { tax_registration: "Tax registration", filing: "Filing", licence: "Licence", insurance: "Insurance", posting: "Posting", policy_review: "Policy review", other: "Other" };
export const recurrenceLabels: Record<Recurrence, string> = { none: "Once", monthly: "Every month", quarterly: "Every quarter", semiannual: "Every six months", annual: "Every year" };
export const recurrenceMonths: Record<Recurrence, number> = { none: 0, monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };
export const noticeLabels: Record<NoticeState, string> = { received: "Received", in_progress: "In progress", responded: "Responded", closed: "Closed" };
export const roleStatusLabels: Record<RoleStatus, string> = { planned: "Planned", open: "Open", filled: "Filled", dropped: "Dropped" };
export const attestationChecks = [
  { key: "diskEncrypted", label: "Disk encryption is on" }, { key: "screenLock", label: "The screen locks by itself" },
  { key: "osUpdated", label: "The operating system is up to date" }, { key: "firewallOn", label: "The firewall is on" },
] as const;

const blankDate = z.string().default("").refine((value) => !value || workDate.safeParse(value).success, "Enter a valid date.").transform((value) => value || null);
const optionalId = z.union([z.uuid(), z.literal("")]).default("").transform((value) => value || null);
const optionalAccount = z.string().max(100).default("").transform((value) => value || null);
const flag = z.literal("on").optional().transform(Boolean);
const cents = (value: string) => {
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
};
const blankMoney = z.string().trim().default("").refine((value) => /^(\d{1,9}(\.\d{1,2})?)?$/.test(value), "Enter an amount such as 1250.00.").transform((value) => value ? cents(value) : null);
const text = (max: number) => z.string().trim().max(max, `Use at most ${max} characters.`).default("");
const required = (max: number, message: string) => z.string().trim().min(1, message).max(max, `Use at most ${max} characters.`);
const version = z.coerce.number().int().positive();
const newOrId = z.union([z.uuid(), z.literal("")]).default("");
const optionalWhole = (min: number, max: number, message: string) => z.string().trim().default("").refine((value) => !value || /^\d{1,7}$/.test(value) && Number(value) >= min && Number(value) <= max, message).transform((value) => value ? Number(value) : null);

export const idField = z.object({ id: z.uuid() });
export const deviceFields = z.object({
  id: newOrId, version: z.coerce.number().int().min(0).default(0), assetTag: required(40, "Enter an asset tag."), kind: z.enum(deviceKinds, "Choose a type."), make: text(80), model: required(120, "Enter a model."), serial: text(80),
  purchasedOn: blankDate, cost: blankMoney, currency: z.enum(currencies, "Choose a currency."), warrantyEndsOn: blankDate, condition: z.enum(deviceConditions, "Choose a condition."), notes: text(1000),
}).refine((value) => !value.purchasedOn || !value.warrantyEndsOn || value.warrantyEndsOn >= value.purchasedOn, { path: ["warrantyEndsOn"], message: "The warranty must end on or after the purchase date." });
export const deviceCommandFields = z.object({ id: z.uuid(), version, status: z.enum(["in_stock", "repair", "retired", "lost"]) });
export const deviceAssignFields = z.object({ id: z.uuid(), version, employeeId: z.uuid("Choose a person.") });
export const deviceReturnFields = z.object({ id: z.uuid(), version, condition: z.enum([...deviceConditions, "lost"], "Choose a condition."), next: z.enum(["in_stock", "repair", "retired"]), note: text(500) });
export const deviceReturnRequestFields = z.object({ id: z.uuid(), dueOn: workDate });
export const deviceRequestFields = z.object({ kind: z.enum(deviceKinds, "Choose a type."), note: text(500) });
export const deviceRequestCommandFields = z.object({ id: z.uuid(), operation: z.enum(["declined", "cancelled"]) });
export const repairFields = z.object({ deviceId: z.uuid(), issue: required(500, "Describe the problem.") });
export const closeRepairFields = z.object({ id: z.uuid(), vendor: text(120), cost: blankMoney, outcome: required(500, "Say what was done.") });
export const attestationFields = z.object({ assignmentId: z.uuid(), diskEncrypted: flag, screenLock: flag, osUpdated: flag, firewallOn: flag });
export const appFields = z.object({
  id: newOrId, version: z.coerce.number().int().min(0).default(0), name: required(80, "Enter a name."), ownerId: optionalId, seatCost: blankMoney.transform((value) => value ?? 0), billing: z.enum(billings), currency: z.enum(currencies),
  seats: optionalWhole(0, 1_000_000, "Enter whole seats."), renewsOn: blankDate, criticality: z.enum(criticalities), notes: text(1000),
});
export const appRequestFields = z.object({ appId: z.uuid("Choose an app."), role: required(60, "Enter the role you need."), reason: text(500) });
export const appGrantFields = z.object({ appId: z.uuid(), employeeId: z.uuid("Choose a person."), role: required(60, "Enter a role.") });
export const grantCommandFields = z.object({ id: z.uuid(), operation: z.enum(["approved", "declined", "withdrawn", "granted", "revoked"]) });
export const appDefaultFields = z.object({ appId: z.uuid("Choose an app."), teamId: optionalId, title: text(120), role: required(60, "Enter a role.") });
export const workplaceSettingsFields = z.object({ version, attestDays: z.coerce.number("Enter whole days.").int("Enter whole days.").min(7, "Use at least 7 days.").max(730, "Use at most 730 days."), full_time: flag, part_time: flag, contractor: flag, intern: flag });

export const courseFields = z.object({
  id: newOrId, version: z.coerce.number().int().min(0).default(0), title: required(120, "Enter a title."), summary: text(500), passPercent: z.coerce.number("Enter a percentage.").int("Enter a whole percentage.").min(1, "Use 1 to 100.").max(100, "Use 1 to 100."),
  maxAttempts: optionalWhole(1, 20, "Enter 1 to 20 attempts."), repeatMonths: optionalWhole(1, 120, "Enter 1 to 120 months."),
});
export const courseCommandFields = z.object({ id: z.uuid(), version, operation: z.enum(["publish", "unpublish", "archive"]) });
export const lessonFields = z.object({ id: newOrId, courseId: z.uuid(), title: required(120, "Enter a title."), kind: z.enum(lessonKinds), body: text(20_000), url: z.string().trim().max(500).default(""), documentId: optionalId })
  .refine((value) => value.kind !== "text" || value.body, { path: ["body"], message: "Write the lesson." })
  .refine((value) => value.kind !== "link" || /^https?:\/\/[^\s]+$/.test(value.url), { path: ["url"], message: "Enter a link that starts with https://." })
  .refine((value) => value.kind !== "document" || value.documentId, { path: ["documentId"], message: "Choose a company document." });
export const lessonCommandFields = z.object({ id: z.uuid(), operation: z.enum(["up", "down", "remove"]) });
export const questionFields = z.object({ courseId: z.uuid(), prompt: required(500, "Enter a question."), options: z.string().trim().transform((value) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)).refine((lines) => lines.length >= 2 && lines.length <= 6, "Enter 2 to 6 answers, one on each line.").refine((lines) => lines.every((line) => line.length <= 300), "Keep each answer under 300 characters."), correct: z.coerce.number("Enter the number of the correct line.").int().min(1, "Enter the number of the correct line.").max(6, "Enter the number of the correct line.") })
  .refine((value) => value.correct <= value.options.length, { path: ["correct"], message: "There is no answer on that line." });
export const assignFields = z.object({ courseId: z.uuid(), audience: z.string().regex(/^(everyone|team:[0-9a-f-]{36}|person:[0-9a-f-]{36}|type:(full_time|part_time|contractor|intern))$/, "Choose who to assign."), dueOn: blankDate });
export const ruleFields = z.object({ courseId: z.uuid(), teamId: optionalId, employmentType: z.union([z.enum(employmentTypes), z.literal("")]).default("").transform((value) => value || null), dueDays: z.coerce.number("Enter whole days.").int("Enter whole days.").min(1, "Use 1 to 365 days.").max(365, "Use 1 to 365 days.") });
export const trainingCommandFields = z.object({ id: z.uuid(), operation: z.enum(["cancel", "attempt"]) });
export const lessonDoneFields = z.object({ assignmentId: z.uuid(), lessonId: z.uuid() });
export const quizFields = z.object({ assignmentId: z.uuid() }).catchall(z.string());

export const obligationFields = z.object({
  id: newOrId, version: z.coerce.number().int().min(0).default(0), name: required(120, "Enter a name."), authority: text(120), jurisdiction: text(100), category: z.enum(obligationCategories, "Choose a category."),
  reference: text(80), ownerId: optionalAccount, recurrence: z.enum(recurrences), dueOn: workDate, notes: text(1000),
});
export const occurrenceFields = z.object({ id: z.uuid(), operation: z.enum(["completed", "skipped"]), closedOn: workDate, note: text(500), documentId: optionalId, visibility: z.enum(["admins", "everyone"]).default("admins") });
export const noticeFields = z.object({ id: newOrId, version: z.coerce.number().int().min(0).default(0), title: required(160, "Enter a title."), authority: text(120), receivedOn: workDate, deadlineOn: blankDate, assigneeId: optionalAccount, obligationId: optionalId })
  .refine((value) => !value.deadlineOn || value.deadlineOn >= value.receivedOn, { path: ["deadlineOn"], message: "The deadline must be on or after the date received." });
export const noticeEventFields = z.object({ id: z.uuid(), version, state: z.enum(noticeStates), note: text(1000) });
export const noticeFileFields = z.object({ id: z.uuid(), name: required(120, "Enter a name.") });
export const jurisdictionFields = z.object({ location: required(100, "Choose a location."), jurisdiction: text(100) });

export const plannedRoleFields = z.object({ id: newOrId, version: z.coerce.number().int().min(0).default(0), title: required(120, "Enter a job title."), teamId: optionalId, targetStart: workDate, status: z.enum(roleStatuses) });
export const reportViews = ["headcount", "turnover", "time_off", "plan", "workplace"] as const;
export type ReportView = (typeof reportViews)[number];
export const reportViewLabels: Record<ReportView, string> = { headcount: "Headcount", turnover: "Turnover and tenure", time_off: "Time off", plan: "Headcount plan", workplace: "Training, compliance and devices" };
export type ReportFilters = { teamId: string; location: string; type: string; from: string; to: string };
export const saveViewFields = z.object({ name: required(60, "Enter a name."), query: z.string().max(500) });

export const addTaskFields = z.object({ workflowId: z.uuid(), title: required(180, "Enter a task."), dueOn: blankDate, assigneeId: optionalAccount });
export const planTaskFields = z.object({ taskId: z.uuid(), dueOn: blankDate, assigneeId: optionalAccount });
export const ownTaskFields = z.object({ taskId: z.uuid(), completed: z.enum(["true", "false"]).transform((value) => value === "true") });
export const bulkTaskFields = z.object({ taskIds: z.string().transform((value) => value.split(",").filter(Boolean)).pipe(z.array(z.uuid()).max(200)), operation: z.enum(["complete", "assign", "due"]), assigneeId: optionalAccount, dueOn: blankDate });

const monthNumber = (value: string) => Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7)) - 1;

// Adds months and lands on the anchor day, or on the last day of a shorter month.
export function addMonths(value: string, months: number, anchor = Number(value.slice(8, 10))) {
  const total = monthNumber(value) + months;
  const last = new Date(Date.UTC(Math.floor(total / 12), total % 12 + 1, 0)).getUTCDate();
  return `${String(Math.floor(total / 12)).padStart(4, "0")}-${String(total % 12 + 1).padStart(2, "0")}-${String(Math.min(anchor, last)).padStart(2, "0")}`;
}
