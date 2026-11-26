"use server";

import type { ActionState } from "@/components/workspace/action-state";
import { idField, jurisdictionFields, noticeEventFields, noticeFields, noticeFileFields, obligationFields, occurrenceFields } from "@/lib/domains/workplace";
import { addNoticeFile, archiveObligation, closeOccurrence, mapJurisdiction, moveNotice, readReference, saveNotice, saveObligation } from "@/lib/server/compliance";
import { readUpload } from "@/lib/server/documents";
import { requireAdmin } from "@/lib/server/member";
import { perform } from "@/lib/server/perform";
import { failed, invalid, PeopleError } from "@/lib/server/write";

function takeFile(data: FormData) {
  const file = data.get("file");
  data.delete("file");
  return file;
}

export async function saveObligationAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, obligationFields, data, async (member, input) => ({ redirect: `/workspace/compliance/obligations/${await saveObligation(member, input)}?saved=${input.id ? "changed" : "added"}` }));
}

export async function archiveObligationAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, idField, data, async (member, { id }) => { await archiveObligation(member, id); return { redirect: "/workspace/compliance/register?saved=archived" }; });
}

export async function closeOccurrenceAction(_state: ActionState, data: FormData) {
  const file = takeFile(data);
  return perform(requireAdmin, occurrenceFields, data, async (member, input) => { await closeOccurrence(member, input, await readUpload(file)); });
}

// The number is returned to the one form that asked for it and is never part of a page.
export async function readReferenceAction(_state: ActionState, data: FormData): Promise<ActionState> {
  const member = await requireAdmin();
  const input = idField.safeParse(Object.fromEntries(data));
  if (!input.success) return invalid(input.error);
  try {
    return { message: await readReference(member, input.data.id) };
  } catch (error) {
    return failed(error);
  }
}

export async function saveNoticeAction(_state: ActionState, data: FormData) {
  const file = takeFile(data);
  return perform(requireAdmin, noticeFields, data, async (member, input) => ({ redirect: `/workspace/compliance/notices/${await saveNotice(member, input, await readUpload(file))}?saved=${input.id ? "changed" : "added"}` }));
}

export async function moveNoticeAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, noticeEventFields, data, async (member, input) => { await moveNotice(member, input); return "Notice updated."; });
}

export async function addNoticeFileAction(_state: ActionState, data: FormData) {
  const file = takeFile(data);
  return perform(requireAdmin, noticeFileFields, data, async (member, input) => {
    const upload = await readUpload(file);
    if (!upload) throw new PeopleError("Choose a file to attach.");
    await addNoticeFile(member, input, upload);
    return "File attached.";
  });
}

export async function mapJurisdictionAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, jurisdictionFields, data, (member, input) => mapJurisdiction(member, input));
}
