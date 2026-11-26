import "server-only";
import type { PoolClient } from "pg";
import type { Member } from "./member";
import * as pay from "./pay-module";
import * as records from "./records-module";
import * as time from "./time-module";
import * as workplace from "./workplace-module";

export type Todo = { key: string; href: string; title: string; detail: string; meta: string };

// Each module contributes to the home page and to the employee lifecycle through the same small set of functions.
const modules = [time, pay, records, workplace];

export async function moduleTodos(member: Member): Promise<Todo[]> {
  return (await Promise.all(modules.map((entry) => entry.todos(member)))).flat();
}

export async function onOnboarding(client: PoolClient, member: Member, employeeId: string) {
  for (const entry of modules) await entry.onOnboarding(client, member, employeeId);
}

export async function onOffboarding(client: PoolClient, member: Member, employeeId: string) {
  for (const entry of [pay, records, workplace]) await entry.onOffboarding(client, member, employeeId);
}

// Reasons an employee can't be archived yet, written for the administrator.
export async function archiveBlockers(client: PoolClient, employeeId: string) {
  const blockers: string[] = [];
  for (const entry of modules) blockers.push(...await entry.archiveBlockers(client, employeeId));
  return blockers;
}

export async function afterArchive(client: PoolClient, member: Member, employeeId: string) {
  await client.query("UPDATE benefit_elections SET state='cancelled', decided_by=$2, decided_at=now() WHERE employee_id=$1 AND state='pending'", [employeeId, member.id]);
  await client.query("UPDATE enrollment_windows SET state='declined' WHERE employee_id=$1 AND state IN ('requested','open')", [employeeId]);
  await time.afterArchive(client, member, employeeId);
  await records.afterArchive(client, member, employeeId);
  await workplace.afterArchive(client, member, employeeId);
}
