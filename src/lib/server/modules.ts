import "server-only";
import type { PoolClient } from "pg";
import type { Member } from "./member";
import * as pay from "./pay-module";
import * as time from "./time-module";

export type Todo = { key: string; href: string; title: string; detail: string; meta: string };

// Each module contributes to the home page and to the employee lifecycle through the same small set of functions.
const modules = [time, pay];

export async function moduleTodos(member: Member): Promise<Todo[]> {
  return (await Promise.all(modules.map((entry) => entry.todos(member)))).flat();
}

export async function onOnboarding(client: PoolClient, member: Member, employeeId: string) {
  for (const entry of modules) await entry.onOnboarding(client, member, employeeId);
}

export async function onOffboarding(client: PoolClient, member: Member, employeeId: string) {
  for (const entry of modules) await entry.onOffboarding(client, member, employeeId);
}

// Reasons an employee can't be archived yet, written for the administrator.
export async function archiveBlockers(client: PoolClient, employeeId: string) {
  const blockers: string[] = [];
  for (const entry of modules) blockers.push(...await entry.archiveBlockers(client, employeeId));
  return blockers;
}
