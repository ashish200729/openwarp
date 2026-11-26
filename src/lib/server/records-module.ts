import "server-only";
import type { PoolClient } from "pg";
import { addDays, today } from "@/lib/operations";
import { changeLabels } from "@/lib/domains/records";
import { formatDate } from "@/lib/people";
import { currentAnnouncements, notifyScheduled } from "./announcements";
import { pool, transaction } from "./db";
import { expiringDocuments, expiryNoticeDays, insertDocumentRequests, listDocumentRequests, notifyExpiring, ownDocumentRequests } from "./documents";
import type { Member } from "./member";
import type { Todo } from "./modules";
import { onboardingSteps } from "./onboarding";
import { expiringAuthorizations, pendingChanges } from "./personal";
import { closeEmployeeSignatures, createNewHireSignatures, signaturesToSign, stuckSignatures } from "./signatures";
import { audit } from "./write";

const due = (date: string | null) => !date ? "" : date < today() ? `Was due ${formatDate(date)}` : `Due ${formatDate(date)}`;
const expiry = (date: string) => date < today() ? `Expired ${formatDate(date)}` : `Expires ${formatDate(date)}`;

export async function todos(member: Member): Promise<Todo[]> {
  await sendDueNotices();
  const day = today();
  const [toSign, requests, announcements, documents, authorizations, changes, reviews, stuck, onboarding] = await Promise.all([
    signaturesToSign(member), ownDocumentRequests(member), currentAnnouncements(member), expiringDocuments(member), expiringAuthorizations(member, day, addDays(day, expiryNoticeDays)),
    pendingChanges(member), listDocumentRequests(member, ["submitted"], 20), stuckSignatures(member), member.employeeId ? onboardingSteps(member, member.employeeId) : null,
  ]);
  const uploads = requests.filter((request) => request.state === "open" || request.state === "returned");
  return [
    ...(onboarding?.person.status === "onboarding" && onboarding.done < onboarding.steps.length ? [{ key: "onboarding", href: "/workspace/onboarding", title: "Finish your onboarding", detail: onboarding.steps.find((step) => !step.done)!.title, meta: `${onboarding.done} of ${onboarding.steps.length}` }] : []),
    ...toSign.map((row) => ({ key: `sign-${row.id}`, href: `/workspace/documents/signatures/${row.id}`, title: `Sign ${row.title}`, detail: row.employeeId === member.employeeId ? "Needs your signature" : `For ${row.employeeName}, needs your signature`, meta: "" })),
    ...uploads.map((row) => ({ key: `upload-${row.id}`, href: "/workspace/documents/requests", title: `Upload ${row.title}`, detail: row.state === "returned" ? row.returnNote : row.instructions || "Requested from you", meta: due(row.dueOn) })),
    ...announcements.filter((row) => row.needsAcknowledgement && !row.acknowledged && row.inAudience).map((row) => ({ key: `announcement-${row.id}`, href: "/workspace/announcements", title: `Read ${row.title}`, detail: "Needs your acknowledgement", meta: "" })),
    ...changes.map((row) => ({ key: `change-${row.id}`, href: `/workspace/people/${row.employeeId}/personal`, title: `${row.employeeName} asked for a record change`, detail: changeLabels[row.kind], meta: "" })),
    ...reviews.map((row) => ({ key: `review-${row.id}`, href: "/workspace/documents/requests", title: `Review ${row.title}`, detail: `Uploaded by ${row.employeeName}`, meta: "" })),
    ...stuck.map((row) => ({ key: `stuck-${row.id}`, href: `/workspace/documents/signatures/${row.id}`, title: row.state === "draft" ? `Send ${row.title}` : `${row.title} is still unsigned`, detail: row.state === "draft" ? `Draft for ${row.employeeName}` : `Waiting for ${row.waitingFor}`, meta: row.sentAt ? `Sent ${formatDate(row.sentAt)}` : "" })),
    ...documents.map((row) => ({ key: `expires-${row.id}`, href: member.role === "admin" ? `/workspace/documents/${row.id}/details` : `/workspace/people/${row.employeeId}/documents`, title: `Renew ${row.name}`, detail: row.employeeName || "Company document", meta: expiry(row.expiresOn) })),
    ...authorizations.map((row) => ({ key: `authorization-${row.employeeId}`, href: `/workspace/people/${row.employeeId}/personal`, title: "Renew a work authorization", detail: row.employeeName, meta: expiry(row.expiresOn) })),
  ];
}

// Scheduled announcements and expiry reminders. Opening the workspace sends whatever is due, and a scheduler may call it too.
export async function sendDueNotices() {
  const day = today();
  const { rows: [{ waiting }] } = await pool().query<{ waiting: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM announcements WHERE notified_at IS NULL AND removed_at IS NULL AND publish_on <= $1 AND (expires_on IS NULL OR expires_on >= $1))
     OR EXISTS (SELECT 1 FROM documents d LEFT JOIN employees e ON e.id = d.employee_id WHERE d.expires_on BETWEEN $1 AND $2 AND d.expiry_notified_at IS NULL AND d.archived_at IS NULL AND coalesce(e.status, '') <> 'archived'
       AND NOT EXISTS (SELECT 1 FROM documents n WHERE n.series_id = coalesce(d.series_id, d.id) AND n.version > d.version))
     OR EXISTS (SELECT 1 FROM employee_personal p JOIN employees e ON e.id = p.employee_id AND e.status <> 'archived' WHERE p.work_authorization_expires_on BETWEEN $1 AND $2 AND p.work_authorization_notified_at IS NULL) AS waiting`, [day, addDays(day, expiryNoticeDays)],
  );
  if (!waiting) return;
  await transaction(async (client) => {
    await notifyScheduled(client, day);
    await notifyExpiring(client, day);
  });
}

export async function onOnboarding(client: PoolClient, member: Member, employeeId: string): Promise<void> {
  const { rows } = await client.query<{ title: string; instructions: string; category: string }>(
    "SELECT d.title, d.instructions, d.category FROM new_hire_documents d JOIN employees e ON e.id = $1 WHERE e.employment_type = ANY(d.employment_types) ORDER BY d.created_at, d.id", [employeeId],
  );
  for (const request of rows) {
    const asked = await insertDocumentRequests(client, member, [employeeId], { ...request, dueOn: null });
    if (asked.length) await audit(client, member, "document_request.sent", { employeeId, detail: request.title });
  }
  await createNewHireSignatures(client, member, employeeId);
}

/* eslint-disable @typescript-eslint/no-unused-vars */
export async function onOffboarding(client: PoolClient, member: Member, employeeId: string): Promise<void> {}

export async function archiveBlockers(client: PoolClient, employeeId: string): Promise<string[]> {
  return [];
}

export async function afterArchive(client: PoolClient, member: Member, employeeId: string) {
  await closeEmployeeSignatures(client, member, employeeId);
  const { rows } = await client.query<{ title: string }>(
    "UPDATE document_requests SET state='cancelled', decided_by=$2, decided_at=now(), return_note='' WHERE employee_id=$1 AND state IN ('open','submitted','returned') RETURNING title", [employeeId, member.id],
  );
  for (const row of rows) await audit(client, member, "document_request.cancelled", { employeeId, detail: row.title });
}
