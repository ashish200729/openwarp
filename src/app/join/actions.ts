"use server";

import { redirect } from "next/navigation";
import type { ActionState } from "@/components/workspace/action-state";
import { workspaceOrigin } from "@/lib/server/platform-settings";

export async function openInvitation(_state: ActionState, data: FormData): Promise<ActionState> {
  const value = data.get("invitation");
  if (typeof value !== "string" || value.length > 2048) return { error: "Enter the invitation link or code your administrator shared." };
  let token = value.trim();
  if (!/^[\w-]{43}$/.test(token)) {
    let url: URL;
    try { url = new URL(token); } catch { return { error: "Paste the full invitation link or the 43-character code." }; }
    if (url.origin !== workspaceOrigin()) return { error: "This link is for another workspace. Open your original invitation directly." };
    if (url.pathname === "/join" && url.searchParams.get("signin") === "sso" && !url.searchParams.has("token")) redirect("/join?signin=sso");
    if (!["/join", "/login/reset"].includes(url.pathname) || url.searchParams.getAll("token").length !== 1) return { error: "Use the invitation link your administrator shared." };
    token = url.searchParams.get("token") ?? "";
  }
  if (!/^[\w-]{43}$/.test(token)) return { error: "This invitation looks incomplete. Copy the whole link and try again." };
  redirect(`/join?token=${token}`);
}
