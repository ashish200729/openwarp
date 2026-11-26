import "server-only";
import type { PoolClient } from "pg";
import { z } from "zod";
import { transaction } from "./db";
import type { ActivityEvent } from "@/lib/activity";
import type { Member, Role } from "./member";
import type { ActionState } from "@/components/workspace/action-state";

export class PeopleError extends Error {}

// Every administrative write takes one lock, which keeps reporting lines, role grants and pay runs serial.
export async function runAsAdmin<T>(member: Member, run: (client: PoolClient) => Promise<T>) {
  return transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(142050, 2)");
    const { rowCount } = await client.query("SELECT 1 FROM workspace_members WHERE user_id = $1 AND role = 'admin'", [member.id]);
    if (!rowCount) throw new PeopleError("Administrator access is required.");
    const result = await run(client);
    if (member.via) await audit(client, member, "api.changed", { detail: member.via });
    return result;
  });
}

export type Actor = { role: Role; employeeId: string | null };

// Self-service writes re-read the account inside the transaction, so a revoked role or link takes effect at once.
export async function runAsMember<T>(member: Member, run: (client: PoolClient, actor: Actor) => Promise<T>) {
  return transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(142050, 2)");
    const { rows } = await client.query<Actor>(
      `SELECT m.role, m.employee_id AS "employeeId" FROM workspace_members m WHERE m.user_id = $1 AND m.role IN ('admin', 'viewer')`, [member.id],
    );
    if (!rows[0]) throw new PeopleError("Your account no longer has access.");
    const result = await run(client, rows[0]);
    if (member.via) await audit(client, member, "api.changed", { detail: member.via });
    return result;
  });
}

export async function requireOwnEmployee(client: PoolClient, actor: Actor) {
  if (!actor.employeeId) throw new PeopleError("Your account isn’t linked to an employee record. Ask an administrator to link it.");
  const { rowCount } = await client.query("SELECT 1 FROM employees WHERE id = $1 AND status <> 'archived'", [actor.employeeId]);
  if (!rowCount) throw new PeopleError("Your employee record is archived.");
  return actor.employeeId;
}

// Administrators decide any request. A manager decides requests from their direct reports.
export async function requireDecider(client: PoolClient, actor: Actor, employeeId: string) {
  if (actor.role === "admin") return;
  const { rowCount } = actor.employeeId ? await client.query(
    `SELECT 1 FROM employees e JOIN employees m ON m.id = e.manager_id WHERE e.id = $1 AND m.id = $2 AND m.status = 'active'`, [employeeId, actor.employeeId],
  ) : { rowCount: 0 };
  if (!rowCount) throw new PeopleError("Only this person’s manager or an administrator can decide this request.");
}

export async function audit(client: PoolClient, member: Member, event: ActivityEvent, options: { employeeId?: string; teamId?: string; subjectUserId?: string; detail?: string } = {}) {
  const { employeeId = null, teamId = null, subjectUserId = null, detail = "" } = options;
  await client.query(
    "INSERT INTO activity_log (actor_id, event, employee_id, team_id, subject_user_id, detail) VALUES ($1, $2, $3, $4, $5, $6)",
    [member.id, event, employeeId, teamId, subjectUserId, detail.slice(0, 300)],
  );
}

export function invalid(error: z.ZodError): ActionState {
  return { error: "Check the highlighted fields and try again.", fields: z.flattenError(error).fieldErrors as Record<string, string[]> };
}

const conflicts: Record<string, ActionState> = {
  employees_email_unique: { error: "That work email is already in the directory.", fields: { email: ["Use a unique work email."] } },
  teams_name_unique: { error: "That team name already exists.", fields: { name: ["Choose a different name."] } },
  user_email_key: { error: "An account already uses that email.", fields: { email: ["Use a different email."] } },
  workspace_members_employee_id_key: { error: "Another account is already linked to that employee.", fields: { employeeId: ["Choose a different employee."] } },
  compensation_employee_id_effective_on_key: { error: "Pay is already recorded for that date.", fields: { effectiveOn: ["Choose a different date."] } },
  time_off_types_name_unique: { error: "That time off type already exists.", fields: { name: ["Choose a different name."] } },
  holidays_pkey: { error: "A holiday is already set for that date.", fields: { day: ["Choose a different date."] } },
};

export function failed(error: unknown): ActionState {
  if (error instanceof PeopleError) return { error: error.message };
  const databaseError = typeof error === "object" && error ? error as { code?: string; constraint?: string } : {};
  if (databaseError.code === "23505" && databaseError.constraint && conflicts[databaseError.constraint]) return conflicts[databaseError.constraint];
  if (databaseError.code === "23503") return { error: "A selected record changed. Reload the page and try again." };
  console.error("OpenWarp could not save a change", databaseError.code ?? (error instanceof Error ? error.name : "unknown"));
  return { error: "We couldn’t save your changes. Try again in a moment." };
}
