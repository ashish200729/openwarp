import type { ReactNode } from "react";
import { ActionForm, Checkbox, Field, type FormAction } from "@/components/workspace/action-form";
import { EmploymentTypes } from "@/components/workspace/pay-types";
import { plainAmount, planKindLabels, planKinds } from "@/lib/domains/pay";
import type { Plan } from "@/lib/server/benefits";

export function PlanForm({ action, plan, documents, secondary }: { action: FormAction; plan?: Plan; documents: { id: string; name: string }[]; secondary?: ReactNode }) {
  return <ActionForm key={plan?.version ?? 0} action={action} submit={plan ? "Save plan" : "Add plan"} hidden={{ id: plan?.id ?? "", version: plan?.version ?? 0, ...(plan ? { kind: plan.kind, ...(plan.percent ? { percent: "on" } : {}) } : {}) }} variant={plan ? "secondary" : "primary"} secondary={secondary} className="pb-5">
    <div className="grid gap-4 sm:grid-cols-2"><Field name="name" label="Plan name" required maxLength={80} defaultValue={plan?.name} />{!plan && <Field name="kind" label="Type" required options={planKinds.map((value) => ({ value, label: planKindLabels[value] }))} />}
      <Field name="waitingDays" label="Waiting days" type="number" min={0} max={365} required defaultValue={plan?.waitingDays ?? 0} hint="Days after the start date before coverage." /><Field name="annualLimit" label="Annual employee limit" inputMode="decimal" defaultValue={plainAmount(plan?.annualLimitCents ?? null)} hint="The most taken from one person in a calendar year." />
      <Field name="documentId" label="Document" defaultValue={plan?.documentId ?? ""} options={[{ value: "", label: "None" }, ...documents.map((document) => ({ value: document.id, label: document.name }))]} /></div>
    <Field name="description" label="Plan details" multiline maxLength={1000} defaultValue={plan?.description} />
    <EmploymentTypes selected={plan?.employmentTypes ?? []} />
    {!plan && <Checkbox name="percent" label="Percent of pay" hint="For retirement plans. Can’t change later." />}
    <Checkbox name="employeeChooses" label="People choose their own contribution" defaultChecked={plan?.employeeChooses} hint="For retirement, HSA, FSA and similar plans." />
    <Checkbox name="preTax" label="Taken before tax" defaultChecked={plan?.preTax ?? true} /><Checkbox name="active" label="Offer this plan" defaultChecked={plan?.active ?? true} />
  </ActionForm>;
}
