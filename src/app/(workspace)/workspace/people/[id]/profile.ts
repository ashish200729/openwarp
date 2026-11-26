import "server-only";
import { notFound } from "next/navigation";
import { z } from "zod";
import { employeeProfile } from "@/lib/server/directory";
import { requireMember } from "@/lib/server/member";

// Pay, time off and documents are for the person themselves and administrators.
export async function privateProfile(params: Promise<{ id: string }>) {
  const member = await requireMember();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success || (member.role !== "admin" && member.employeeId !== id)) notFound();
  const profile = await employeeProfile(member, id);
  if (!profile) notFound();
  return { member, employee: profile.employee, canManage: member.role === "admin" };
}
