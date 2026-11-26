"use server";

import type { ActionState } from "@/components/workspace/action-state";
import {
  documentDetailFields, documentRequestFields, documentReviewFields, documentUploadFields, documentVersionFields, draftFields, fileSignatureFields, newDocumentFields, reasonFields, sendFields, signFields, templateSignatureFields,
} from "@/lib/domains/records";
import { addDocument, addDocumentVersion, readUpload, requestDocuments, reviewDocumentRequest, saveDocumentDetails, submitRequestedDocument } from "@/lib/server/documents";
import { requireAdmin, requireMember } from "@/lib/server/member";
import { perform } from "@/lib/server/perform";
import { createFromFile, createFromTemplate, declineSignature, saveDraft, sendSignature, signDocument, voidSignature } from "@/lib/server/signatures";
import { PeopleError } from "@/lib/server/write";

function takeFile(data: FormData) {
  const file = data.get("file");
  data.delete("file");
  return async () => {
    const upload = await readUpload(file);
    if (!upload) throw new PeopleError("Choose a file to add.");
    return upload;
  };
}

export async function addDocumentAction(_state: ActionState, data: FormData) {
  const file = takeFile(data);
  return perform(requireAdmin, newDocumentFields, data, async (member, input) => {
    await addDocument(member, input, await file());
    return { redirect: input.employeeId ? `/workspace/people/${input.employeeId}/documents` : "/workspace/documents?saved=added" };
  });
}

export async function addVersionAction(_state: ActionState, data: FormData) {
  const file = takeFile(data);
  return perform(requireAdmin, documentVersionFields, data, async (member, input) => ({ redirect: `/workspace/documents/${await addDocumentVersion(member, input, await file())}/details?saved=version` }));
}

export async function saveDocumentDetailsAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, documentDetailFields, data, async (member, input) => { await saveDocumentDetails(member, input); return { redirect: `/workspace/documents/${input.id}/details?saved=details` }; });
}

// Each ticked person arrives as its own field, named after their record.
export async function requestDocumentsAction(_state: ActionState, data: FormData) {
  const people = [...data.keys()].flatMap((key) => key.startsWith("person_") ? [key.slice(7)] : []);
  for (const id of people) data.delete(`person_${id}`);
  data.set("people", people.join(","));
  return perform(requireAdmin, documentRequestFields, data, async (member, input) => ({ redirect: `/workspace/documents/requests?asked=${await requestDocuments(member, input)}` }));
}

export async function uploadRequestedAction(_state: ActionState, data: FormData) {
  const file = takeFile(data);
  return perform(requireMember, documentUploadFields, data, async (member, input) => {
    await submitRequestedDocument(member, input, await file());
    return { redirect: "/workspace/documents/requests?saved=uploaded" };
  });
}

export async function reviewRequestAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, documentReviewFields, data, (member, input) => reviewDocumentRequest(member, input));
}

export async function createFromTemplateAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, templateSignatureFields, data, async (member, input) => ({ redirect: `/workspace/documents/signatures/${await createFromTemplate(member, input)}` }));
}

export async function createFromFileAction(_state: ActionState, data: FormData) {
  const file = takeFile(data);
  return perform(requireAdmin, fileSignatureFields, data, async (member, input) => ({ redirect: `/workspace/documents/signatures/${await createFromFile(member, input, await file())}` }));
}

export async function saveDraftAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, draftFields, data, async (member, input) => { await saveDraft(member, input); return { redirect: `/workspace/documents/signatures/${input.id}` }; });
}

export async function sendSignatureAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, sendFields, data, async (member, input) => { await sendSignature(member, input); return { redirect: `/workspace/documents/signatures/${input.id}?saved=sent` }; });
}

export async function signAction(_state: ActionState, data: FormData) {
  if (data.get("consent") !== "on") return { error: "Tick the box to agree to sign electronically." };
  return perform(requireMember, signFields, data, async (member, input) => { await signDocument(member, input); return { redirect: `/workspace/documents/signatures/${input.id}?saved=signed` }; });
}

export async function declineAction(_state: ActionState, data: FormData) {
  return perform(requireMember, reasonFields, data, async (member, input) => { await declineSignature(member, input); return { redirect: `/workspace/documents/signatures/${input.id}?saved=declined` }; });
}

export async function voidAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, reasonFields, data, async (member, input) => { await voidSignature(member, input); return { redirect: `/workspace/documents/signatures/${input.id}?saved=voided` }; });
}
