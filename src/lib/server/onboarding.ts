import "server-only";
import type { EmployeeStatus } from "@/lib/people";
import { today } from "@/lib/operations";
import { pool } from "./db";
import type { Member } from "./member";
import { paySetup } from "./pay-module";

export type OnboardingStep = { key: string; title: string; detail: string; href: string; done: boolean };
export type OnboardingPerson = { id: string; name: string; status: EmployeeStatus; hireDate: string };
type Counts = {
  employeeId: string; phone: boolean; birth: boolean; address: boolean; contacts: number; fields: number; fieldsDone: number; toSign: number; signed: number; preparing: number;
  requested: number; uploaded: number; readings: number; read: number; notices: number; noticesRead: number;
};

// Completion comes from the records themselves, so nothing has to be ticked off by hand.
async function readCounts(employeeIds: string[]) {
  const { rows } = await pool().query<Counts>(
    `SELECT e.id AS "employeeId", coalesce(p.phone <> '', false) AS phone, p.date_of_birth_sealed IS NOT NULL AS birth, p.address_sealed IS NOT NULL AS address,
     (SELECT count(*)::int FROM emergency_contacts c WHERE c.employee_id = e.id) AS contacts,
     (SELECT count(*)::int FROM custom_fields f WHERE f.required_for_onboarding AND f.archived_at IS NULL) AS fields,
     (SELECT count(*)::int FROM custom_fields f JOIN custom_field_values v ON v.field_id = f.id AND v.employee_id = e.id WHERE f.required_for_onboarding AND f.archived_at IS NULL) AS "fieldsDone",
     (SELECT count(*)::int FROM signature_requests r WHERE r.employee_id = e.id AND r.state IN ('pending', 'completed', 'declined')) AS "toSign",
     (SELECT count(*)::int FROM signature_requests r JOIN signature_signers s ON s.request_id = r.id AND s.kind = 'employee' JOIN signature_events v ON v.signer_id = s.id AND v.event = 'signed' WHERE r.employee_id = e.id AND r.state IN ('pending', 'completed')) AS signed,
     (SELECT count(*)::int FROM signature_requests r WHERE r.employee_id = e.id AND r.state = 'draft') AS preparing,
     (SELECT count(*)::int FROM document_requests r WHERE r.employee_id = e.id AND r.state <> 'cancelled') AS requested,
     (SELECT count(*)::int FROM document_requests r WHERE r.employee_id = e.id AND r.state IN ('submitted', 'accepted')) AS uploaded,
     d.total AS readings, d.done AS read, n.total AS notices, n.done AS "noticesRead"
     FROM employees e LEFT JOIN employee_personal p ON p.employee_id = e.id
     CROSS JOIN LATERAL (
       SELECT count(*)::int AS total, count(a.document_id)::int AS done FROM documents d LEFT JOIN document_acknowledgements a ON a.document_id = d.id AND a.employee_id = e.id
       WHERE d.needs_acknowledgement AND d.archived_at IS NULL AND d.category <> 'receipt' AND (d.employee_id IS NULL OR d.employee_id = e.id)
       AND NOT EXISTS (SELECT 1 FROM documents newer WHERE newer.series_id = coalesce(d.series_id, d.id) AND newer.version > d.version)
     ) d
     CROSS JOIN LATERAL (
       SELECT count(*)::int AS total, count(k.user_id)::int AS done FROM announcements a LEFT JOIN workspace_members m ON m.employee_id = e.id LEFT JOIN announcement_acknowledgements k ON k.announcement_id = a.id AND k.user_id = m.user_id
       WHERE a.needs_acknowledgement AND a.removed_at IS NULL AND a.publish_on <= $2 AND (a.expires_on IS NULL OR a.expires_on >= $2) AND (a.team_id IS NULL OR a.team_id = e.team_id)
     ) n WHERE e.id = ANY($1::uuid[])`, [employeeIds, today()],
  );
  return rows;
}

const part = (done: number, total: number, what: string) => `${done} of ${total} ${what}`;

async function steps(counts: Counts): Promise<OnboardingStep[]> {
  const pay = await paySetup(counts.employeeId);
  const profile = `/workspace/people/${counts.employeeId}`;
  const missing = [!counts.phone && "phone number", !counts.birth && "date of birth", !counts.address && "home address"].filter((field) => field !== false);
  const list: (OnboardingStep | false)[] = [
    { key: "personal", title: "Add your personal details", detail: missing.length ? `Missing: ${missing.join(", ")}` : "Phone, date of birth and address added", href: `${profile}/personal?edit=details`, done: !missing.length },
    { key: "contact", title: "Add an emergency contact", detail: counts.contacts ? `${counts.contacts} ${counts.contacts === 1 ? "contact" : "contacts"} added` : "Someone to call if something happens at work", href: counts.contacts ? `${profile}/personal` : `${profile}/personal?edit=contact`, done: counts.contacts > 0 },
    counts.fields > 0 && { key: "fields", title: "Fill in the remaining details", detail: part(counts.fieldsDone, counts.fields, "required fields filled in"), href: `${profile}/personal?edit=fields`, done: counts.fieldsDone >= counts.fields },
    counts.toSign + counts.preparing > 0 && { key: "sign", title: "Sign your documents", detail: counts.preparing ? `${part(counts.signed, counts.toSign, "signed")}, ${counts.preparing} being prepared` : part(counts.signed, counts.toSign, "signed"), href: "/workspace/documents/signatures", done: counts.preparing === 0 && counts.signed >= counts.toSign },
    counts.requested > 0 && { key: "upload", title: "Upload the documents we asked for", detail: part(counts.uploaded, counts.requested, "uploaded"), href: "/workspace/documents/requests", done: counts.uploaded >= counts.requested },
    { key: "bank", title: "Add your bank details", detail: pay.hasBankDetails ? "Bank details added" : "Where your pay goes", href: `${profile}/bank`, done: pay.hasBankDetails },
    (pay.enrollmentOpen || pay.enrollmentDone) && { key: "benefits", title: "Choose your benefits", detail: pay.enrollmentDone ? "Choices recorded" : "Enrollment is open", href: "/workspace/benefits", done: pay.enrollmentDone },
    counts.readings + counts.notices > 0 && { key: "read", title: "Read and acknowledge", detail: part(counts.read + counts.noticesRead, counts.readings + counts.notices, "acknowledged"), href: counts.read < counts.readings ? "/workspace/documents" : "/workspace/announcements", done: counts.read + counts.noticesRead >= counts.readings + counts.notices },
  ];
  return list.filter((step) => step !== false);
}

export async function onboardingSteps(member: Member, employeeId: string) {
  if (member.role !== "admin" && member.employeeId !== employeeId) return null;
  const [people, counts] = await Promise.all([
    pool().query<OnboardingPerson>(`SELECT id, concat_ws(' ', first_name, last_name) AS name, status, to_char(hire_date, 'YYYY-MM-DD') AS "hireDate" FROM employees WHERE id = $1 AND status <> 'archived'`, [employeeId]),
    readCounts([employeeId]),
  ]);
  if (!people.rows[0] || !counts[0]) return null;
  const list = await steps(counts[0]);
  return { person: people.rows[0], steps: list, done: list.filter((step) => step.done).length };
}

// Progress by employee id, for administrators’ lists of people who are joining.
export async function onboardingProgress(member: Member, employeeIds: string[]) {
  if (member.role !== "admin" || !employeeIds.length) return new Map<string, { done: number; total: number }>();
  const counts = await readCounts(employeeIds);
  return new Map(await Promise.all(counts.map(async (entry) => {
    const list = await steps(entry);
    return [entry.employeeId, { done: list.filter((step) => step.done).length, total: list.length }] as const;
  })));
}
