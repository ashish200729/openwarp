import { z } from "zod";
import { employmentTypes, statuses } from "@/lib/people";

export const platformActivity = {
  "two_factor.enabled": "Turned on two-factor sign-in", "two_factor.disabled": "Turned off two-factor sign-in",
  "two_factor.reset": "Reset two-factor sign-in", "two_factor.codes_replaced": "Replaced backup codes",
  "account.signed_out": "Signed an account out everywhere", "account.invitation_revoked": "Revoked an invitation link", "account.invited": "Issued an account invitation", "account.sso_linked": "Linked single sign-on", "account.sso_unlinked": "Unlinked single sign-on",
  "security.updated": "Changed the security policy", "email.tested": "Sent a test email",
  "api_token.created": "Created an API token", "api_token.revoked": "Revoked an API token", "api.changed": "Made a change through the API",
  "webhook.created": "Added a webhook", "webhook.updated": "Changed a webhook", "webhook.deleted": "Deleted a webhook", "webhook.disabled": "Turned off a failing webhook",
  "routine.created": "Created a routine", "routine.updated": "Changed a routine", "routine.activated": "Activated a routine", "routine.paused": "Paused a routine",
  "routine.deleted": "Deleted a routine", "routine.started": "Ran a routine", "routine.task_added": "Added a checklist task from a routine",
} as const;

export const scopeLabels = {
  "people:read": "Read people", "people:write": "Add and change people", "teams:read": "Read teams", "teams:write": "Add teams",
  "time_off:read": "Read time off", "time_off:write": "Decide time off", "expenses:read": "Read expenses", "expenses:write": "Decide expenses",
  "documents:read": "Read document details", "activity:read": "Read activity, within this token’s other scopes",
  "personal:read": "Read personal details: time off types and notes, expense notes, and documents about a person",
  "pay:read": "Read pay runs and pay amounts",
} as const;
export type Scope = keyof typeof scopeLabels;
export const scopes = Object.keys(scopeLabels) as [Scope, ...Scope[]];
export const sensitiveScopes: ReadonlySet<Scope> = new Set(["personal:read", "pay:read"]);

// What an event is about decides who may read it. A new kind of event stays behind personal:read until it is listed here.
const openSubjects = new Set(["employee", "team", "workflow", "task", "account", "settings", "shift", "announcement", "device", "app", "access", "course", "obligation", "compliance", "jurisdiction", "report", "role", "activity",
  "two_factor", "security", "email", "api_token", "api", "webhook", "routine", "template", "custom_field"]);
const subjectScopes: Partial<Record<string, Scope>> = {
  expense: "expenses:read", time_off: "time_off:read", compensation: "pay:read", pay_run: "pay:read", pay_rule: "pay:read", pay_settings: "pay:read", recurring_pay: "pay:read", garnishment: "pay:read", bank_details: "pay:read", invoice: "pay:read",
};
export function eventScope(event: string): Scope | null {
  const subject = event.split(".")[0];
  return openSubjects.has(subject) ? null : subjectScopes[subject] ?? "personal:read";
}

export const twoFactorPolicies = { none: "Optional for everyone", admins: "Required for administrators", everyone: "Required for everyone" } as const;
export const passwordPolicies = { everyone: "Everyone can use a password", admins: "Only administrators can use a password" } as const;
export const emailPreferences = { all: "Every notification", requests: "Only requests waiting for me", none: "Nothing" } as const;
export type EmailPreference = keyof typeof emailPreferences;
export const webhookFormats = { openwarp: "OpenWarp JSON", slack: "Slack-compatible text" } as const;
export type WebhookFormat = keyof typeof webhookFormats;

const optionalNumber = (minimum: number, maximum: number, message: string) => z.union([z.literal("").transform(() => null), z.coerce.number(message).int(message).min(minimum, message).max(maximum, message)]);
const domainPattern = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])$/;

export const policyFields = z.object({
  requireTwoFactor: z.enum(["none", "admins", "everyone"]),
  sessionHours: z.coerce.number("Enter 1 to 720 hours.").int("Enter whole hours.").min(1, "Enter 1 to 720 hours.").max(720, "Enter 1 to 720 hours."),
  idleMinutes: optionalNumber(5, 1440, "Enter 5 to 1440 minutes, or leave it empty."),
  minPasswordLength: z.coerce.number("Use 12 to 64 characters.").int("Use 12 to 64 characters.").min(12, "Use 12 to 64 characters.").max(64, "Use 12 to 64 characters."),
  allowedDomains: z.string().max(2000).transform((value) => [...new Set(value.toLowerCase().split(/[\s,;]+/).map((part) => part.replace(/^@/, "")).filter(Boolean))])
    .refine((domains) => domains.length <= 20 && domains.every((domain) => domainPattern.test(domain)), "Enter up to 20 domains such as example.com, separated by spaces."),
  passwordSignIn: z.enum(["everyone", "admins"]).default("everyone"),
  retentionDays: optionalNumber(365, 36_500, "Enter 365 days or more, or leave it empty to keep everything."),
  version: z.coerce.number().int().positive(),
});

export const codeField = z.string().transform((value) => value.replace(/[\s-]/g, "").toLowerCase()).pipe(z.string().regex(/^(\d{6}|[a-z2-7]{16})$/, "Enter the 6-digit code from your app, or a backup code."));
export const verifyFields = z.object({ code: codeField });
export const enrollFields = z.object({ password: z.string().max(128).default("") });
export const twoFactorCommandFields = z.object({ password: z.string().max(128).default(""), operation: z.enum(["disable", "codes"]) });
export const sessionCommandFields = z.object({ sessionId: z.string().max(100).default(""), operation: z.enum(["revoke", "others"]) });
export const preferenceFields = z.object({ email: z.enum(["all", "requests", "none"]) });
export const accountSecurityFields = z.object({ userId: z.string().min(1).max(100), operation: z.enum(["sign_out", "reset_two_factor", "invite", "unlink_sso"]) });
export const forgotFields = z.object({ email: z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid email.")) });
export const resetFields = z.object({ token: z.string().regex(/^[\w-]{43}$/), password: z.string().max(128), confirmation: z.string().max(128) })
  .refine((value) => value.password === value.confirmation, { path: ["confirmation"], message: "The passwords don’t match." });

export const tokenFields = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(80), expiresIn: z.enum(["30", "90", "365", "never"]),
  scopes: z.array(z.enum(scopes)).min(1, "Choose at least one scope."),
});

const eventName = z.string().regex(/^[a-z_]{2,40}\.[a-z_]{2,40}$/, "Choose an event.");
const optionalId = z.union([z.uuid(), z.literal("")]).default("");
const optionalVersion = z.coerce.number().int().min(0).default(0);
export const webhookFields = z.object({
  id: optionalId, version: optionalVersion, name: z.string().trim().min(1, "Enter a name.").max(80), url: z.string().trim().max(1000).default(""),
  format: z.enum(["openwarp", "slack"]), events: z.array(eventName).max(200),
});
export const webhookCommandFields = z.object({ id: z.uuid(), operation: z.enum(["pause", "activate", "delete", "test"]) });
export const webhookSecretFields = z.object({ id: z.uuid() });
export const deliveryCommandFields = z.object({ id: z.uuid(), operation: z.literal("resend") });

export const dateTriggers = { start_date: "Start date", last_day: "Last day", document: "Document waiting to be confirmed" } as const;
export const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Choose a time.");
const schedule = z.discriminatedUnion("frequency", [
  z.object({ kind: z.literal("schedule"), frequency: z.literal("daily"), time }),
  z.object({ kind: z.literal("schedule"), frequency: z.literal("weekly"), time, weekday: z.coerce.number().int().min(0).max(6) }),
  z.object({ kind: z.literal("schedule"), frequency: z.literal("monthly"), time, monthDay: z.coerce.number("Choose a day from 1 to 28.").int().min(1, "Choose a day from 1 to 28.").max(28, "Choose a day from 1 to 28.") }),
]);
export const routineTrigger = z.discriminatedUnion("kind", [
  schedule,
  z.object({ kind: z.literal("event"), event: eventName }),
  z.object({ kind: z.literal("date"), date: z.enum(["start_date", "last_day", "document"]), offset: z.coerce.number("Enter -90 to 90 days.").int("Enter whole days.").min(-90, "Enter -90 to 90 days.").max(90, "Enter -90 to 90 days.") }),
]);
export const routineConditions = z.object({
  teamId: z.uuid().nullable().default(null), employmentType: z.enum(employmentTypes).nullable().default(null), status: z.enum(statuses).exclude(["archived"]).nullable().default(null),
});
const line = z.string().trim().min(1, "Enter a message.").max(120, "Use 120 characters or fewer.");
export const routineAction = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("notify"), audience: z.enum(["person", "manager", "admins"]), title: line, body: z.string().trim().max(400).default("") }),
  z.object({ kind: z.literal("task"), title: line }),
  z.object({ kind: z.literal("webhook"), endpointId: z.uuid("Choose a webhook."), title: line }),
]);
export type RoutineTrigger = z.infer<typeof routineTrigger>;
export type RoutineConditions = z.infer<typeof routineConditions>;
export type RoutineAction = z.infer<typeof routineAction>;
export const routineFields = z.object({
  id: optionalId, version: optionalVersion, name: z.string().trim().min(1, "Enter a name.").max(80), trigger: routineTrigger, conditions: routineConditions, action: routineAction,
});
export const routineCommandFields = z.object({ id: z.uuid(), operation: z.enum(["activate", "pause", "delete"]) });
export const routineRunFields = z.object({ id: z.uuid(), employeeId: optionalId.transform((value) => value || null) });

export function describeTrigger(trigger: RoutineTrigger, label: (event: string) => string) {
  if (trigger.kind === "event") return `After: ${label(trigger.event)}`;
  if (trigger.kind === "date") {
    const days = Math.abs(trigger.offset);
    const distance = `${days} ${days === 1 ? "day" : "days"}`;
    if (trigger.date === "document") return days ? `${distance} after a document is added and still isn’t confirmed` : "On the day a document that needs confirming is added";
    const date = dateTriggers[trigger.date].toLowerCase();
    return days ? `${distance} ${trigger.offset < 0 ? "before" : "after"} the ${date}` : `On the ${date}`;
  }
  const at = `at ${trigger.time} UTC`;
  return trigger.frequency === "daily" ? `Every day ${at}` : trigger.frequency === "weekly" ? `Every ${weekdays[trigger.weekday]} ${at}` : `On day ${trigger.monthDay} of every month ${at}`;
}

export function describeAction(action: RoutineAction) {
  if (action.kind === "task") return `Add “${action.title}” to their open checklist`;
  if (action.kind === "webhook") return "Post to a webhook";
  return `Notify ${action.audience === "person" ? "the person" : action.audience === "manager" ? "their manager" : "administrators"}`;
}
