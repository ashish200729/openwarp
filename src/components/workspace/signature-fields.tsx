import { Field } from "@/components/workspace/action-form";
import { signerOrderLabels, signerOrders, type SignerOrder } from "@/lib/domains/records";
import type { Signatory } from "@/lib/server/templates";

export function SignatoryFields({ signatories, signatoryId, order = "employee_first" }: { signatories: Signatory[]; signatoryId?: string | null; order?: SignerOrder }) {
  return <div className="grid gap-4 sm:grid-cols-2">
    <Field name="signatoryId" label="Also signed for the company by" required defaultValue={signatoryId ?? ""} options={[{ value: "", label: "Nobody" }, ...signatories.map((person) => ({ value: person.id, label: person.role === "admin" ? `${person.name} (administrator)` : person.name }))]} hint="They see the full text, including pay if it mentions it." />
    <Field name="signerOrder" label="Order" required defaultValue={order} options={signerOrders.map((value) => ({ value, label: signerOrderLabels[value] }))} />
  </div>;
}

export function SignerFields({ people, signatories, employeeId }: { people: { id: string; name: string }[]; signatories: Signatory[]; employeeId?: string }) {
  return <>
    <Field name="employeeId" label="Employee" required defaultValue={employeeId} options={people.map((person) => ({ value: person.id, label: person.name }))} />
    <SignatoryFields signatories={signatories} />
  </>;
}
