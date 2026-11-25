import "server-only";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { auth, hasWorkspaceConfig } from "./auth";
import { pool } from "./db";

export type Role = "admin" | "viewer";
export type Member = { id: string; name: string; email: string; role: Role };

export const currentMember = cache(async (): Promise<Member | null> => {
  if (!hasWorkspaceConfig()) return null;
  const session = await auth().api.getSession({ headers: await headers() });
  if (!session) return null;
  const { rows } = await pool().query<{ role: Role }>(
    "SELECT role FROM workspace_members WHERE user_id = $1 AND role IN ('admin', 'viewer')", [session.user.id],
  );
  if (!rows[0]) return null;
  return { id: session.user.id, name: session.user.name, email: session.user.email, role: rows[0].role };
});

export async function requireMember(): Promise<Member> {
  const member = await currentMember();
  if (!member) redirect("/login");
  return member;
}

export async function requireAdmin(): Promise<Member> {
  const member = await requireMember();
  if (member.role !== "admin") notFound();
  return member;
}

export function workspaceName() {
  return process.env.OPENWARP_WORKSPACE_NAME?.trim().slice(0, 80) || "People workspace";
}
