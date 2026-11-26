import "server-only";
import { cookies } from "next/headers";
import { pool } from "./db";
import type { Member } from "./member";
import { workspaceOrigin } from "./platform-settings";

export const entryCookie = "openwarp-entry";
export type EntryPath = "worker" | "employer";

export async function rememberEntry(path: EntryPath) {
  (await cookies()).set(entryCookie, path, { path: "/", httpOnly: true, sameSite: "lax", secure: workspaceOrigin().startsWith("https:"), maxAge: 1800 });
}

export async function entryDestination(member: Member, path: string | undefined) {
  if (path === "employer") return member.role === "admin" ? "/workspace/setup" : "/get-started/employer";
  if (path === "worker" && member.employeeId) {
    const { rows } = await pool().query<{ status: string }>("SELECT status FROM employees WHERE id = $1", [member.employeeId]);
    if (rows[0]?.status === "onboarding") return "/workspace/onboarding";
  }
  return "/workspace";
}
