"use client";

import { useActionState } from "react";
import { accountCommandAction, createAccountAction, linkAccountAction, type AccountState } from "@/app/(workspace)/workspace/operations";
import { CopyButton } from "@/components/marketing/copy-button";
import { inputStyle } from "@/components/ui";
import { ActionForm, Field } from "./action-form";
import { FormError } from "./action-state";
import { SubmitButton } from "./buttons";

function TemporaryPassword({ password }: { password: string }) {
  return <div role="status" className="rounded-[10px] border border-line-strong bg-background p-4 text-sm">
    <p className="font-medium">Temporary password</p>
    <div className="mt-1 flex flex-wrap items-center gap-2"><code className="font-mono text-base select-all">{password}</code><CopyButton text={password} label="Copy temporary password" /></div>
    <p className="mt-1 text-muted">Share it privately. It’s shown once, and they choose a new password when they sign in.</p>
  </div>;
}

export function CreateAccountForm({ employees }: { employees: { id: string; name: string; email: string }[] }) {
  const [state, run, pending] = useActionState<AccountState, FormData>(createAccountAction, {});
  const error = (name: string) => state.fields?.[name]?.[0];
  return <form key={state.password ?? "new"} action={run} onReset={(event) => { if (!state.password) event.preventDefault(); }} aria-busy={pending} className="grid gap-4">
    <FormError error={state.error} />
    {state.password && <TemporaryPassword password={state.password} />}
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="grid gap-1.5 text-sm font-medium">Employee record
        <select name="employeeId" className={inputStyle} defaultValue="" onChange={(event) => {
          const employee = employees.find((entry) => entry.id === event.currentTarget.value);
          const form = event.currentTarget.form;
          if (!employee || !form) return;
          (form.elements.namedItem("name") as HTMLInputElement).value = employee.name;
          (form.elements.namedItem("email") as HTMLInputElement).value = employee.email;
        }}><option value="">Not an employee</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select>
        {error("employeeId") && <span className="text-[13px] font-normal text-danger">{error("employeeId")}</span>}
      </label>
      <label className="grid gap-1.5 text-sm font-medium">Role
        <select name="role" className={inputStyle} defaultValue="viewer"><option value="viewer">Member</option><option value="admin">Administrator</option></select>
      </label>
      <label className="grid gap-1.5 text-sm font-medium">Name
        <input name="name" className={inputStyle} maxLength={160} autoComplete="off" required aria-invalid={error("name") ? true : undefined} />
        {error("name") && <span className="text-[13px] font-normal text-danger">{error("name")}</span>}
      </label>
      <label className="grid gap-1.5 text-sm font-medium">Sign-in email
        <input name="email" type="email" className={inputStyle} maxLength={254} autoComplete="off" required aria-invalid={error("email") ? true : undefined} />
        {error("email") && <span className="text-[13px] font-normal text-danger">{error("email")}</span>}
      </label>
    </div>
    <SubmitButton className="justify-self-start" pending="Creating…">Create account</SubmitButton>
  </form>;
}

type AccountProps = { account: { userId: string; name: string; email: string; role: string; employeeId: string | null; employeeName: string | null }; employees: { id: string; name: string }[]; self: boolean };

export function AccountControls({ account, employees, self }: AccountProps) {
  const [state, run, pending] = useActionState<AccountState, FormData>(accountCommandAction, {});
  const operations = [
    { value: "admin", label: "Make administrator", hidden: account.role === "admin" }, { value: "viewer", label: account.role === "disabled" ? "Restore as member" : "Make member", hidden: account.role === "viewer" },
    { value: "reset", label: "Reset password", hidden: account.role === "disabled" }, { value: "disabled", label: "Disable", hidden: account.role === "disabled" },
  ].filter((operation) => !operation.hidden);
  return <div className="grid gap-4 pt-1 pb-5 sm:pl-11">
    <ActionForm key={account.employeeId} action={linkAccountAction} submit="Save link" variant="secondary" hidden={{ userId: account.userId }} inline>
      <Field name="employeeId" label="Employee record" required defaultValue={account.employeeId ?? ""} wrapperClass="w-full sm:w-72" options={[{ value: "", label: "Not linked" }, ...(account.employeeId ? [{ value: account.employeeId, label: account.employeeName ?? "" }] : []), ...employees.map((employee) => ({ value: employee.id, label: employee.name }))]} />
    </ActionForm>
    {self ? <p className="text-[13px] text-muted">Another administrator can change your access.</p> : <form action={run} aria-busy={pending} className="grid gap-2">
      <input type="hidden" name="userId" value={account.userId} />
      <div className="-ml-2.5 flex flex-wrap gap-1">{operations.map(({ value, label }) => <SubmitButton key={value} name="operation" value={value} variant="text" label={`${label}: ${account.name}`} className={value === "disabled" ? "text-danger hover:text-danger" : undefined}
        confirm={{ title: `${label} for ${account.name}?`, body: value === "disabled" ? "They’re signed out everywhere and can’t sign in again until you restore them." : value === "reset" ? "Their current password stops working and they’re signed out everywhere." : "They’re signed out everywhere and get the new access when they sign in.", action: value === "disabled" ? "Disable account" : value === "reset" ? "Create new password" : "Change role", danger: value === "disabled" }}>{label}</SubmitButton>)}</div>
      <p className="text-[13px] text-muted">Changing a role or resetting a password signs them out everywhere.</p>
      <FormError error={state.error} />
      {state.message && <p role="status" className="text-[13px] text-positive">{state.message}</p>}
      {state.password && <TemporaryPassword password={state.password} />}
    </form>}
  </div>;
}
