"use server";

import type { ActionState } from "@/components/workspace/action-state";
import { idField, newHireDocumentFields, signatureTemplateFields } from "@/lib/domains/records";
import { requireAdmin } from "@/lib/server/member";
import { perform } from "@/lib/server/perform";
import { addNewHireDocument, archiveSignatureTemplate, removeNewHireDocument, saveSignatureTemplate } from "@/lib/server/templates";

export async function saveTemplateAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, signatureTemplateFields, data, async (member, input) => { await saveSignatureTemplate(member, input); return { redirect: "/workspace/settings/templates?saved=template" }; });
}

export async function archiveTemplateAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, idField, data, (member, { id }) => archiveSignatureTemplate(member, id));
}

export async function addNewHireDocumentAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, newHireDocumentFields, data, async (member, input) => { await addNewHireDocument(member, input); return "Document added."; });
}

export async function removeNewHireDocumentAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, idField, data, (member, { id }) => removeNewHireDocument(member, id));
}
