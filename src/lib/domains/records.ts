import { z } from "zod";
import { documentCategories, documentFields, today, workDate } from "@/lib/operations";
import { employmentTypes, type EmploymentType } from "@/lib/people";

export const recordsActivity = {
  "personal.updated": "Updated personal details", "emergency_contact.saved": "Saved an emergency contact", "emergency_contact.removed": "Removed an emergency contact",
  "identity.updated": "Updated identity details", "identity.viewed": "Viewed a national ID",
  "change_request.submitted": "Asked to change their record", "change_request.approved": "Approved a record change", "change_request.declined": "Declined a record change", "change_request.cancelled": "Cancelled a record change request",
  "custom_field.saved": "Saved a custom field", "custom_field.archived": "Archived a custom field", "custom_field.restored": "Restored a custom field", "custom_field.exported": "Exported custom fields",
  "document.replaced": "Added a document version", "document.updated": "Changed document details",
  "document_request.sent": "Asked for a document", "document_request.submitted": "Uploaded a requested document", "document_request.accepted": "Accepted a requested document", "document_request.returned": "Returned a requested document", "document_request.cancelled": "Cancelled a document request",
  "template.saved": "Saved a signature template", "template.archived": "Archived a signature template",
  "signature.created": "Prepared a document to sign", "signature.sent": "Sent a document to sign", "signature.signed": "Signed a document", "signature.completed": "Completed a signed document", "signature.declined": "Declined to sign a document", "signature.voided": "Voided a document to sign",
  "announcement.published": "Published an announcement", "announcement.updated": "Edited an announcement", "announcement.removed": "Removed an announcement", "announcement.acknowledged": "Acknowledged an announcement",
} as const;

export const workAuthorizations = ["citizen", "permanent_resident", "work_permit", "other"] as const;
export const changeKinds = ["legal_name", "national_id", "work_authorization"] as const;
export const customFieldKinds = ["text", "long_text", "number", "date", "choice", "boolean"] as const;
export const fieldVisibilities = ["everyone", "private", "admin"] as const;
export const signerOrders = ["employee_first", "company_first"] as const;
export type WorkAuthorization = (typeof workAuthorizations)[number];
export type ChangeKind = (typeof changeKinds)[number];
export type CustomFieldKind = (typeof customFieldKinds)[number];
export type FieldVisibility = (typeof fieldVisibilities)[number];
export type SignerOrder = (typeof signerOrders)[number];
export type ChangeState = "pending" | "approved" | "declined" | "cancelled";
export type DocumentRequestState = "open" | "submitted" | "returned" | "accepted" | "cancelled";
export type SignatureState = "draft" | "pending" | "completed" | "declined" | "voided";
export type SignatureEventKind = "sent" | "opened" | "signed" | "declined" | "voided";

export const authorizationLabels: Record<WorkAuthorization, string> = { citizen: "Citizen", permanent_resident: "Permanent resident", work_permit: "Work permit or visa", other: "Other" };
export const changeLabels: Record<ChangeKind, string> = { legal_name: "Legal name", national_id: "National ID", work_authorization: "Work authorization" };
// For the middle of a sentence.
export const changePhrases: Record<ChangeKind, string> = { legal_name: "legal name", national_id: "national ID", work_authorization: "work authorization" };
export const customFieldLabels: Record<CustomFieldKind, string> = { text: "Text", long_text: "Long text", number: "Number", date: "Date", choice: "Choice", boolean: "Yes or no" };
export const visibilityLabels: Record<FieldVisibility, string> = { everyone: "Everyone", private: "The person and administrators", admin: "Administrators only" };
export const signerOrderLabels: Record<SignerOrder, string> = { employee_first: "Employee signs first", company_first: "Company signs first" };
export const documentRequestLabels: Record<DocumentRequestState, string> = { open: "Waiting for upload", submitted: "Waiting for review", returned: "Returned", accepted: "Accepted", cancelled: "Cancelled" };
export const signatureLabels: Record<SignatureState, string> = { draft: "Draft", pending: "Waiting for signatures", completed: "Completed", declined: "Declined", voided: "Voided" };
export const signatureEventLabels: Record<SignatureEventKind, string> = { sent: "Sent for signature", opened: "Opened the PDF", signed: "Signed", declined: "Declined to sign", voided: "Voided" };

export const mergeFields = {
  first_name: "First name", last_name: "Last name", full_name: "Full name", email: "Work email", title: "Job title", team: "Team", manager: "Manager",
  employment_type: "Employment type", start_date: "Start date", location: "Location", salary: "Current pay", company_name: "Company name", today: "Date sent",
} as const;
export type MergeField = keyof typeof mergeFields;

export const consentText = "I have read this document in full. I agree to sign it electronically, and I intend my typed name to have the same effect as a signature on paper.";

const flag = z.literal("on").optional().transform(Boolean);
const version = z.coerce.number().int().min(0).max(2_147_483_647);
const optionalDate = z.union([z.literal(""), workDate]).default("").transform((value) => value || null);
const optionalEmail = z.union([z.literal(""), z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid email."))]).default("");
const phone = z.string().trim().regex(/^[+\d][\d\s().-]{4,29}$/, "Enter a phone number such as +1 555 010 2030.");
const line = (max: number) => z.string().trim().max(max).default("");
const employmentFlags = Object.fromEntries(employmentTypes.map((type) => [`type_${type}`, flag])) as Record<`type_${EmploymentType}`, typeof flag>;
export const chosenTypes = (input: Record<`type_${EmploymentType}`, boolean>) => employmentTypes.filter((type) => input[`type_${type}`]);

export const idField = z.object({ id: z.uuid() });
export const employeeField = z.object({ employeeId: z.uuid() });

export const addressKeys = ["line1", "line2", "city", "region", "postalCode", "country"] as const;
export const addressLabels: Record<(typeof addressKeys)[number], string> = { line1: "Address line 1", line2: "Address line 2", city: "City", region: "State or region", postalCode: "Postal code", country: "Country" };
export const personalFields = z.object({
  employeeId: z.uuid(), version, preferredName: line(80), pronouns: line(40), personalEmail: optionalEmail, phone: z.union([z.literal(""), phone]).default(""),
  dateOfBirth: optionalDate.refine((value) => !value || value <= today(), "Enter a date in the past."),
  line1: line(120), line2: line(120), city: line(80), region: line(80), postalCode: line(20), country: line(80),
});
export const contactFields = z.object({
  employeeId: z.uuid(), id: z.union([z.uuid(), z.literal("")]).default(""), name: z.string().trim().min(1, "Enter a name.").max(120),
  relationship: z.string().trim().min(1, "Enter a relationship, such as partner or parent.").max(60), phone, email: optionalEmail,
});
export const contactCommandFields = z.object({ employeeId: z.uuid(), id: z.uuid() });

const nationalId = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9 ./-]{3,39}$/, "Enter 4 to 40 letters and numbers.");
const legalName = { firstName: z.string().trim().min(1, "Enter a first name.").max(80), lastName: z.string().trim().min(1, "Enter a last name.").max(80) };
const authorization = { workAuthorization: z.enum(workAuthorizations, "Choose a type."), expiresOn: optionalDate };
export const identityFields = z.object({
  employeeId: z.uuid(), version, nationalId: z.union([z.literal(""), nationalId]).default(""), removeNationalId: flag,
  workAuthorization: z.union([z.literal(""), z.enum(workAuthorizations)]).transform((value) => value || null), expiresOn: optionalDate,
}).refine((value) => value.workAuthorization || !value.expiresOn, { path: ["workAuthorization"], message: "Choose a type for this expiry date." });
export const proposals = { legal_name: z.object(legalName), national_id: z.object({ nationalId }), work_authorization: z.object(authorization) };
export const changeFields = z.discriminatedUnion("kind", [
  z.object({ employeeId: z.uuid(), kind: z.literal("legal_name"), ...legalName }),
  z.object({ employeeId: z.uuid(), kind: z.literal("national_id"), nationalId }),
  z.object({ employeeId: z.uuid(), kind: z.literal("work_authorization"), ...authorization }),
]);
export const changeDecisionFields = z.object({ id: z.uuid(), version, decision: z.enum(["approved", "declined"]) });
export const revealFields = z.object({ employeeId: z.uuid(), requestId: z.union([z.uuid(), z.literal("")]).default("") });

export function maskId(value: string) {
  return `••••${value.slice(value.length >= 8 ? -4 : -2)}`;
}

export const customFieldFields = z.object({
  id: z.union([z.uuid(), z.literal("")]).default(""), version: version.default(0), label: z.string().trim().min(1, "Enter a label.").max(80), kind: z.enum(customFieldKinds, "Choose a type."),
  options: z.string().max(6_000).default("").transform((value) => [...new Set(value.split(/\r?\n/).map((option) => option.trim()).filter(Boolean))]),
  visibility: z.enum(fieldVisibilities), employeeEditable: flag, requiredForOnboarding: flag,
}).superRefine((value, context) => {
  if (value.kind === "choice" && value.options.length < 2) context.addIssue({ code: "custom", path: ["options"], message: "Enter at least two choices, one on each line." });
  if (value.kind === "choice" && (value.options.length > 60 || value.options.some((option) => option.length > 80))) context.addIssue({ code: "custom", path: ["options"], message: "Use at most 60 choices of 80 characters each." });
  if (value.employeeEditable && value.visibility === "admin") context.addIssue({ code: "custom", path: ["visibility"], message: "People can’t edit a field only administrators can see." });
  if (value.requiredForOnboarding && !value.employeeEditable) context.addIssue({ code: "custom", path: ["visibility"], message: "Let people edit a field you require during onboarding." });
});
export const customFieldCommandFields = z.object({ id: z.uuid(), operation: z.enum(["archive", "restore"]) });

// An empty string clears the value.
export function customValue(kind: CustomFieldKind, options: string[]) {
  const empty = z.literal("");
  if (kind === "number") return z.union([empty, z.string().trim().regex(/^-?\d{1,12}(\.\d{1,4})?$/, "Enter a number such as 42 or 3.5.")]).default("");
  if (kind === "date") return z.union([empty, workDate]).default("");
  if (kind === "choice") return z.union([empty, z.string().refine((value) => options.includes(value), "Choose one of the listed options.")]).default("");
  if (kind === "boolean") return z.enum(["", "yes", "no"]).default("");
  return z.string().trim().max(kind === "text" ? 200 : 2_000).default("");
}

const documentDetails = { folder: z.string().trim().max(60, "Use at most 60 characters.").default(""), expiresOn: optionalDate };
export const newDocumentFields = documentFields.extend(documentDetails);
export const documentDetailFields = idField.extend(documentDetails);
export const documentVersionFields = idField.extend({ expiresOn: optionalDate });
export type DocumentFilters = { query: string; category: string; folder: string; page: number };

const requestedDocument = { title: z.string().trim().min(1, "Enter what you need.").max(120), instructions: line(500), category: z.enum(documentCategories, "Choose a category.") };
export const documentRequestFields = z.object({
  ...requestedDocument, dueOn: optionalDate, audience: z.union([z.literal(""), z.literal("all"), z.uuid()]).default(""),
  people: z.string().default("").transform((value) => value.split(",").filter(Boolean)).pipe(z.array(z.uuid()).max(500, "Choose at most 500 people.")),
}).refine((value) => value.audience || value.people.length, { path: ["audience"], message: "Choose a team, everyone, or at least one person." });
export const documentUploadFields = idField.extend({ expiresOn: optionalDate });
export const documentReviewFields = idField.extend({ decision: z.enum(["accepted", "returned", "cancelled"]), note: line(300) })
  .refine((value) => value.decision !== "returned" || value.note, { path: ["note"], message: "Say what needs to change." });
export const newHireDocumentFields = z.object({ ...requestedDocument, ...employmentFlags })
  .refine((value) => chosenTypes(value).length, { path: ["title"], message: "Choose at least one employment type." });

const mergePattern = /\{\{\s*([^{}]*?)\s*\}\}/g;
export const usedMergeFields = (body: string) => [...new Set([...body.matchAll(mergePattern)].map((match) => match[1]))];
export const unknownMergeFields = (body: string) => usedMergeFields(body).filter((field) => !Object.hasOwn(mergeFields, field));
export function mergeBody(body: string, values: Record<string, string>) {
  return body.replaceAll(mergePattern, (found, field: string) => values[field] || found);
}

const templateBody = z.string().transform((value) => value.replaceAll("\r\n", "\n").trim()).pipe(z.string().min(1, "Enter the text of the document.").max(20_000, "Use at most 20,000 characters."))
  .superRefine((value, context) => {
    const unknown = unknownMergeFields(value);
    if (unknown.length) context.addIssue({ code: "custom", message: `Unknown merge fields: ${unknown.slice(0, 4).map((field) => `{{${field.slice(0, 40)}}}`).join(", ")}. Use the ones listed below the text.` });
  });
export const signatureTemplateFields = z.object({
  id: z.union([z.uuid(), z.literal("")]).default(""), version: version.default(0), name: z.string().trim().min(1, "Enter a name.").max(120), body: templateBody,
  signatoryId: z.string().max(100).default("").transform((value) => value || null), signerOrder: z.enum(signerOrders), includeNewHires: flag, reviewed: flag, ...employmentFlags,
}).refine((value) => !value.includeNewHires || chosenTypes(value).length, { path: ["name"], message: "Choose at least one employment type for new hires." });

const signers = { employeeId: z.uuid("Choose a person."), signatoryId: z.string().max(100).default("").transform((value) => value || null), signerOrder: z.enum(signerOrders) };
export const templateSignatureFields = z.object({ templateId: z.uuid("Choose a template."), ...signers });
export const fileSignatureFields = z.object({ title: z.string().trim().min(1, "Enter a name.").max(120), ...signers });
export const draftFields = z.object({ id: z.uuid(), version, title: z.string().trim().min(1, "Enter a name.").max(120), body: templateBody });
export const sendFields = z.object({ id: z.uuid(), version });
export const signFields = z.object({
  id: z.uuid(), sha256: z.string().regex(/^[0-9a-f]{64}$/), typedName: z.string().trim().min(1, "Type your full name.").max(200),
  consent: z.literal("on", "Tick the box to agree to sign electronically."), password: z.string().max(128).default(""),
});
export const reasonFields = z.object({ id: z.uuid(), reason: z.string().trim().min(1, "Enter a reason.").max(500) });

export const sameName = (left: string, right: string) => plainName(left) === plainName(right);
const plainName = (value: string) => value.normalize("NFKC").trim().replaceAll(/\s+/g, " ").toLocaleLowerCase("en");

export const announcementFields = z.object({
  id: z.union([z.uuid(), z.literal("")]).default(""), version: version.default(0), title: z.string().trim().min(1, "Enter a title.").max(140),
  body: z.string().transform((value) => value.replaceAll("\r\n", "\n").trim()).pipe(z.string().min(1, "Enter a message.").max(8_000, "Use at most 8,000 characters.")),
  teamId: z.union([z.uuid(), z.literal("")]).transform((value) => value || null), publishOn: workDate, expiresOn: optionalDate, pinned: flag, needsAcknowledgement: flag,
}).refine((value) => !value.expiresOn || value.expiresOn >= value.publishOn, { path: ["expiresOn"], message: "The last day must be on or after the first day." });

export type TextBlock = { kind: "heading"; level: number; text: string } | { kind: "paragraph"; text: string } | { kind: "list"; ordered: boolean; start: number; items: string[] };

// Headings, lists, paragraphs and bold. Anything else stays as typed.
export function parseText(source: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  let open = false;
  for (const raw of source.split(/\r?\n/)) {
    const text = raw.trim();
    const last = blocks.at(-1);
    if (!text) { open = false; continue; }
    const heading = /^(#{1,3})\s+(.+)$/.exec(text);
    const item = /^(?:[-*]|(\d{1,3})\.)\s+(.+)$/.exec(text);
    if (heading) { blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] }); open = false; continue; }
    if (item) {
      const ordered = item[1] !== undefined;
      if (last?.kind === "list" && last.ordered === ordered) last.items.push(item[2]);
      else blocks.push({ kind: "list", ordered, start: ordered ? Number(item[1]) : 1, items: [item[2]] });
      open = true;
      continue;
    }
    if (open && last?.kind === "paragraph") last.text += `\n${text}`;
    else if (open && last?.kind === "list") last.items.push(`${last.items.pop()} ${text}`);
    else blocks.push({ kind: "paragraph", text });
    open = true;
  }
  return blocks;
}
