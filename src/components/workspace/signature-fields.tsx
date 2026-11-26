"use client";

import { useState } from "react";
import { inputStyle } from "@/components/ui";
import { Field } from "@/components/workspace/action-form";
import { signerOrderLabels, signerOrders, type SignerOrder } from "@/lib/domains/records";
import type { Signatory } from "@/lib/server/templates";

export function SignatoryFields({ signatories, signatoryId, order = "employee_first" }: { signatories: Signatory[]; signatoryId?: string | null; order?: SignerOrder }) {
  return <div className="grid gap-4 sm:grid-cols-2">
    <Field name="signatoryId" label="Also signed for the company by" required defaultValue={signatoryId ?? ""} options={[{ value: "", label: "Nobody" }, ...(signatoryId && !signatories.some(person => person.id === signatoryId) ? [{ value: signatoryId, label: "Previous signatory (unavailable)" }] : []), ...signatories.map((person) => ({ value: person.id, label: person.role === "admin" ? `${person.name} (administrator)` : person.name }))]} hint="They see the full text, including pay if it mentions it." />
    <Field name="signerOrder" label="Order" required defaultValue={order} options={signerOrders.map((value) => ({ value, label: signerOrderLabels[value] }))} />
  </div>;
}

export function SignerFields({ people, signatories, employeeId }: { people: { id: string; name: string }[]; signatories: Signatory[]; employeeId?: string }) {
  return <>
    <Field name="employeeId" label="Employee" required defaultValue={employeeId} options={people.map((person) => ({ value: person.id, label: person.name }))} />
    <SignatoryFields signatories={signatories} />
  </>;
}

type TemplateOption = { id: string; name: string; starter: boolean; signatoryId: string | null; signerOrder: SignerOrder; version: number };

export function TemplateSignerFields({ templates, people, signatories, employeeId }: { templates: TemplateOption[]; people: { id: string; name: string }[]; signatories: Signatory[]; employeeId?: string }) {
  const [id, setId] = useState(templates[0].id);
  const selected = templates.find(template => template.id === id) ?? templates[0];
  return <>
    <label className="grid gap-1.5 text-sm font-medium">Template<select required name="templateId" value={selected.id} onChange={event => setId(event.target.value)} className={inputStyle}>
      {templates.map(template => <option key={template.id} value={template.id}>{template.name}{template.starter ? " (starting point)" : ""}</option>)}
    </select></label>
    <input type="hidden" name="templateVersion" value={selected.version} />
    <Field name="employeeId" label="Employee" required defaultValue={employeeId} options={people.map(person => ({ value: person.id, label: person.name }))} />
    <SignatoryFields key={selected.id} signatories={signatories} signatoryId={selected.signatoryId} order={selected.signerOrder} />
  </>;
}
