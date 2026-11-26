"use server";

import type { ActionState } from "@/components/workspace/action-state";
import { decideFields, invoiceFields } from "@/lib/domains/pay";
import { readUpload } from "@/lib/server/documents";
import { decideInvoice, submitInvoice } from "@/lib/server/invoices";
import { requireMember } from "@/lib/server/member";
import { perform } from "@/lib/server/perform";

export async function submitInvoiceAction(_state: ActionState, data: FormData) {
  const file = data.get("file");
  data.delete("file");
  return perform(requireMember, invoiceFields, data, async (member, input) => {
    await submitInvoice(member, input, await readUpload(file));
    return { redirect: "/workspace/invoices?saved=submitted" };
  });
}

export async function decideInvoiceAction(_state: ActionState, data: FormData) {
  return perform(requireMember, decideFields, data, (member, input) => decideInvoice(member, input));
}
