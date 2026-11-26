"use client";

import Link from "next/link";
import { useActionState, useId, useState, type ReactNode } from "react";
import { inputStyle, secondaryButton } from "@/components/ui";
import { employmentLabels, employmentTypes } from "@/lib/people";
import { FormError, type ActionState } from "./action-state";
import { SubmitButton } from "./buttons";

export type EmployeeFormValues = {
  firstName: string; lastName: string; email: string; title: string; teamId: string; managerId: string;
  employmentType: string; hireDate: string; lastDay: string; location: string; initialStatus: string;
};
const blankEmployee: EmployeeFormValues = {
  firstName: "", lastName: "", email: "", title: "", teamId: "", managerId: "",
  employmentType: "full_time", hireDate: "", lastDay: "", location: "", initialStatus: "onboarding",
};

type FormProps = {
  action: (state: ActionState, data: FormData) => Promise<ActionState>;
  profile?: { id: string; version: number };
  initial?: Partial<EmployeeFormValues>;
  teams: { id: string; name: string }[];
  managers: { id: string; name: string; title: string }[];
};

export function EmployeeForm({ action, profile, initial, teams, managers }: FormProps) {
  const [state, submit, pending] = useActionState(action, {});
  const [values, setValues] = useState({ ...blankEmployee, ...initial });
  const prefix = useId();
  const cancelHref = profile ? `/workspace/people/${profile.id}` : "/workspace/people";

  function field(name: keyof EmployeeFormValues, label: string, props: { options?: ReactNode; type?: string; maxLength?: number; required?: boolean; autoComplete?: string } = {}) {
    const { options, required, type = "text", ...inputProps } = props;
    const id = `${prefix}-${name}`;
    const error = state.fields?.[name]?.[0];
    const shared = {
      id, name, required, value: values[name], className: `${inputStyle} ${error ? "border-danger" : ""}`,
      "aria-invalid": error ? true : undefined,
      "aria-describedby": error ? `${id}-error` : undefined,
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const value = event.currentTarget.value;
        setValues((current) => ({ ...current, [name]: value }));
      },
    };
    return <div className="min-w-0">
      <label className="mb-2 block text-sm font-medium" htmlFor={id}>{label}{!required && <span className="ml-2 text-xs font-normal text-muted">Optional</span>}</label>
      {options ? <select {...shared}>{options}</select> : <input type={type} {...shared} {...inputProps} {...(type === "date" ? { min: "1900-01-01", max: "9999-12-31" } : {})} />}
      {error && <p id={`${id}-error`} className="mt-1.5 text-xs text-danger">{error}</p>}
    </div>;
  }

  return (
    <form action={submit} onReset={(event) => event.preventDefault()} className="max-w-3xl space-y-8" aria-busy={pending}>
      {profile && <><input name="id" type="hidden" value={profile.id} /><input name="version" type="hidden" value={profile.version} /></>}
      <FormError error={state.error} />
      <section >
        <h2 className="border-b border-line pb-2 text-[15px] font-semibold">Employee details</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {field("firstName", "First name", { required: true, maxLength: 80 })}
          {field("lastName", "Last name", { required: true, maxLength: 80 })}
          {field("email", "Work email", { required: true, type: "email", maxLength: 254, autoComplete: "off" })}
          {field("location", "Work location", { maxLength: 100, autoComplete: "off" })}
        </div>
      </section>
      <section >
        <h2 className="border-b border-line pb-2 text-[15px] font-semibold">Employment</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {field("title", "Job title", { required: true, maxLength: 120 })}
          {field("employmentType", "Employment type", { required: true, options: employmentTypes.map((type) => <option key={type} value={type}>{employmentLabels[type]}</option>) })}
          {field("teamId", "Team", { options: <><option value="">No team</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</> })}
          {field("managerId", "Manager", { options: <><option value="">No manager</option>{managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.name} · {manager.title}</option>)}</> })}
          {field("hireDate", "Start date", { required: true, type: "date" })}
          {initial?.lastDay ? field("lastDay", "Last day", { required: true, type: "date" }) : profile && <input type="hidden" name="lastDay" value="" />}
          {!profile && <div>
            {field("initialStatus", "Starting status", { required: true, options: <><option value="onboarding">Onboarding</option><option value="active">Active</option></> })}
            <p className="mt-2 text-xs leading-relaxed text-muted">Onboarding creates a checklist. Use Active for someone who has already started.</p>
          </div>}
        </div>
      </section>
      <div className="flex flex-wrap gap-2.5">
        <SubmitButton pending="Saving…">{profile ? "Save changes" : "Add employee"}</SubmitButton>
        <Link href={cancelHref} className={secondaryButton}>Cancel</Link>
      </div>
    </form>
  );
}
