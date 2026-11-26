import type { ReactNode } from "react";
import { ActionForm, Checkbox, Field, type FormAction } from "@/components/workspace/action-form";
import { EmploymentTypes } from "@/components/workspace/pay-types";
import { bracketText, plainAmount, ruleKindLabels, ruleKinds, ruleMethodLabels, ruleMethods } from "@/lib/domains/pay";
import { today } from "@/lib/operations";
import type { PayRule } from "@/lib/server/payroll-rules";

export function RuleForm({ action, rule, currency, secondary }: { action: FormAction; rule?: PayRule; currency: string; secondary?: ReactNode }) {
  return <ActionForm key={rule?.version ?? 0} action={action} submit={rule ? "Save rule" : "Add rule"} hidden={{ id: rule?.id ?? "", version: rule?.version ?? 0, ...(rule ? { kind: rule.kind } : {}) }} variant={rule ? "secondary" : "primary"} secondary={secondary} className="pb-5">
    <div className="grid gap-4 sm:grid-cols-2">
      <Field name="name" label="Rule name" required maxLength={80} defaultValue={rule?.name} />
      {!rule && <Field name="kind" label="Kind" required options={ruleKinds.map((value) => ({ value, label: ruleKindLabels[value] }))} />}
      <Field name="method" label="Method" required defaultValue={rule?.method} options={ruleMethods.map((value) => ({ value, label: ruleMethodLabels[value] }))} />
      <Field name="rate" label="Percent" inputMode="decimal" placeholder="6.20" defaultValue={rule?.rateBp ? plainAmount(rule.rateBp) : ""} hint="For percent methods." />
      <Field name="amount" label={`Flat amount in ${currency}`} inputMode="decimal" placeholder="0.00" defaultValue={rule?.amountCents ? plainAmount(rule.amountCents) : ""} hint="For flat amounts. Regular runs only." />
    </div>
    <Field name="brackets" label="Annual brackets" multiline maxLength={2000} defaultValue={rule ? bracketText(rule.brackets) : ""} hint="One per line: starting annual amount, then percent, such as 11600 12. Begin with 0." />
    <div className="grid gap-4 sm:grid-cols-2">
      <Field name="wageCap" label="Annual wage cap" inputMode="decimal" defaultValue={plainAmount(rule?.wageCapCents ?? null)} hint="Pay above this in a calendar year isn’t counted." /><Field name="amountCap" label="Annual amount cap" inputMode="decimal" defaultValue={plainAmount(rule?.amountCapCents ?? null)} hint="The most taken or paid for one person in a calendar year." />
      <Field name="enrollment" label="Who it covers" required defaultValue={rule?.enrollment} options={[{ value: "everyone", label: "Everyone who matches" }, { value: "chosen", label: "Only people enrolled on their profile" }]} /><Field name="location" label="Location contains" maxLength={100} defaultValue={rule?.location} />
      <Field name="effectiveFrom" label="Effective from" type="date" required defaultValue={rule?.effectiveFrom ?? `${today().slice(0, 4)}-01-01`} /><Field name="effectiveTo" label="Effective to" type="date" defaultValue={rule?.effectiveTo ?? ""} />
      <Field name="account" label="Liability account" maxLength={60} defaultValue={rule?.account} hint="Overrides the journal account." />
    </div>
    <EmploymentTypes selected={rule?.employmentTypes ?? []} />
    <Checkbox name="active" label="Active" defaultChecked={rule?.active ?? true} />
  </ActionForm>;
}
