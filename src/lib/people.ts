import { z } from "zod";

export const statuses = ["onboarding", "active", "offboarding", "archived"] as const;
export const employmentTypes = ["full_time", "part_time", "contractor", "intern"] as const;
export const workflowKinds = ["onboarding", "offboarding"] as const;
export type EmployeeStatus = (typeof statuses)[number];
export type EmploymentType = (typeof employmentTypes)[number];
export type WorkflowKind = (typeof workflowKinds)[number];

export const statusLabels: Record<EmployeeStatus, string> = {
  onboarding: "Onboarding", active: "Active", offboarding: "Offboarding", archived: "Archived",
};
export const employmentLabels: Record<EmploymentType, string> = {
  full_time: "Full-time", part_time: "Part-time", contractor: "Contractor", intern: "Intern",
};

const optionalId = z.union([z.uuid(), z.literal("")]).transform((value) => value || null);
const workDate = z.iso.date().refine((value) => value >= "1900-01-01" && value <= "9999-12-31", "Enter a valid work date.");

export const employeeFields = z.object({
  firstName: z.string().trim().min(1, "Enter a first name.").max(80),
  lastName: z.string().trim().min(1, "Enter a last name.").max(80),
  email: z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid work email.")),
  title: z.string().trim().min(1, "Enter a job title.").max(120),
  teamId: optionalId,
  managerId: optionalId,
  employmentType: z.enum(employmentTypes, "Choose an employment type."),
  hireDate: workDate,
  location: z.string().trim().max(100),
});
export const createEmployeeFields = employeeFields.extend({ initialStatus: z.enum(["onboarding", "active"]) });
export const employeeVersionFields = z.object({ id: z.uuid(), version: z.coerce.number().int().min(1).max(2_147_483_647) });
export const editEmployeeFields = employeeFields.extend({ ...employeeVersionFields.shape, lastDay: z.union([workDate, z.literal("")]).transform((value) => value || null) });
export const rehireFields = employeeVersionFields.extend({ hireDate: workDate });
export const startOffboardingFields = employeeVersionFields.extend({ lastDay: workDate });
export const workflowCommandFields = z.object({ id: z.uuid(), workflowId: z.uuid(), operation: z.enum(["complete", "cancel"]) });
export const taskCommandFields = z.object({ id: z.uuid(), workflowId: z.uuid(), taskId: z.uuid(), completed: z.enum(["true", "false"]).transform((value) => value === "true") });
export const teamNameField = z.object({ name: z.string().trim().min(1, "Enter a team name.").max(80) });

export type EmployeeInput = z.infer<typeof employeeFields>;
export type EmployeeFilters = { query: string; status: EmployeeStatus | "current"; teamId: string; page: number };

export function employeeFilters(params: Record<string, string | string[] | undefined>, canManage: boolean): EmployeeFilters {
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 120) : "";
  const status = z.enum(statuses).safeParse(params.status);
  const teamId = z.uuid().safeParse(params.team);
  return { query, status: canManage && status.success ? status.data : "current", teamId: teamId.success ? teamId.data : "", page: pageNumber(params.page) };
}

export function pageNumber(value: unknown) {
  return typeof value === "string" && /^\d{1,6}$/.test(value) ? Math.max(1, Number(value)) : 1;
}

export function directoryUrl(filters: EmployeeFilters, path = "/workspace/people") {
  const params = new URLSearchParams();
  if (filters.query) params.set("q", filters.query);
  if (filters.status !== "current") params.set("status", filters.status);
  if (filters.teamId) params.set("team", filters.teamId);
  if (filters.page > 1 && path === "/workspace/people") params.set("page", String(filters.page));
  const values = params.toString();
  return values ? `${path}?${values}` : path;
}

export function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => Array.from(part)[0]?.toLocaleUpperCase("en") ?? "").join("");
}

const dateFormatter = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });
const timeFormatter = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

export function formatDate(value: string | Date) {
  return dateFormatter.format(typeof value === "string" ? new Date(`${value}T00:00:00Z`) : value);
}

export function formatTime(value: Date) {
  return timeFormatter.format(value);
}
