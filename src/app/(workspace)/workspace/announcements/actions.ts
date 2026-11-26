"use server";

import type { ActionState } from "@/components/workspace/action-state";
import { announcementFields, idField } from "@/lib/domains/records";
import { acknowledgeAnnouncement, removeAnnouncement, saveAnnouncement } from "@/lib/server/announcements";
import { requireAdmin, requireMember } from "@/lib/server/member";
import { perform } from "@/lib/server/perform";

export async function saveAnnouncementAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, announcementFields, data, async (member, input) => { await saveAnnouncement(member, input); return { redirect: "/workspace/announcements?saved=1" }; });
}

export async function removeAnnouncementAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, idField, data, (member, { id }) => removeAnnouncement(member, id));
}

export async function acknowledgeAnnouncementAction(_state: ActionState, data: FormData) {
  return perform(requireMember, idField, data, (member, { id }) => acknowledgeAnnouncement(member, id));
}
