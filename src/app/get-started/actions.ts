"use server";

import { redirect } from "next/navigation";
import { currentMember, pendingStep } from "@/lib/server/member";
import { entryDestination, rememberEntry, type EntryPath } from "@/lib/server/entry";

export async function enterWorkspace(path: EntryPath) {
  if (path !== "worker" && path !== "employer") redirect("/get-started");
  const member = await currentMember();
  const next = member ? pendingStep(member) : "/login";
  if (member && !next) redirect(await entryDestination(member, path));
  await rememberEntry(path);
  redirect(next ?? "/login");
}
