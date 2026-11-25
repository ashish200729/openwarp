"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Check, ChevronRight, CornerUpLeft } from "lucide-react";
import { ButtonPixels, inputStyle, panelStyle, primaryButton, secondaryButton, textButton } from "@/components/ui";
import { FormError, type ActionState } from "./action-state";

export type FormAction = (state: ActionState, data: FormData) => Promise<ActionState>;

export function TeamForm({ action, editing }: { action: FormAction; editing?: { id: string; name: string; version: number } }) {
  const [state, submit, pending] = useActionState(action, {});
  const [name, setName] = useState(editing?.name ?? "");
  const fieldError = state.fields?.name?.[0];
  return <form action={submit} onReset={(event) => event.preventDefault()} className={`${panelStyle} mb-5 space-y-4 p-5`} aria-busy={pending}>
    <h2 className="text-lg font-medium tracking-tight">{editing ? "Rename team" : "Create a team"}</h2>
    <FormError error={state.error} />
    {editing && <><input type="hidden" name="id" value={editing.id} /><input type="hidden" name="version" value={editing.version} /></>}
    <div className="flex flex-wrap items-end gap-2.5">
      <div className="w-full sm:w-72">
        <label htmlFor="team-name" className="mb-2 block text-sm font-medium">Team name</label>
        <input id="team-name" name="name" className={inputStyle} value={name} maxLength={80} onChange={(event) => setName(event.target.value)} aria-invalid={fieldError ? true : undefined} aria-describedby={fieldError ? "team-error" : undefined} required />
      </div>
      <button type="submit" className={primaryButton} disabled={pending}><ButtonPixels />{pending ? "Saving…" : editing ? "Save name" : "Create team"}</button>
      <Link href="/workspace/teams" className={secondaryButton}>Cancel</Link>
    </div>
    {fieldError && <p id="team-error" className="text-xs text-danger">{fieldError}</p>}
  </form>;
}

export function WorkflowDateForm({ action, id, version, kind, minimum }: { action: FormAction; id: string; version: number; kind: "offboarding" | "onboarding"; minimum: string }) {
  const [state, submit, pending] = useActionState(action, {});
  const [date, setDate] = useState("");
  const offboarding = kind === "offboarding";
  const field = offboarding ? "lastDay" : "hireDate";
  const fieldError = state.fields?.[field]?.[0];
  return <form action={submit} onReset={(event) => event.preventDefault()} className={`${panelStyle} max-w-xl space-y-4 p-5 sm:p-6`} aria-busy={pending}>
    <FormError error={state.error} />
    <input type="hidden" name="id" value={id} />
    <input type="hidden" name="version" value={version} />
    <label className="grid max-w-64 gap-2 text-sm font-medium">{offboarding ? "Last day" : "New start date"}
      <input className={inputStyle} name={field} type="date" min={minimum} max="9999-12-31" value={date} onChange={(event) => setDate(event.target.value)} required aria-invalid={fieldError ? true : undefined} aria-describedby={fieldError ? "date-error" : undefined} />
    </label>
    {fieldError && <p id="date-error" className="text-xs text-danger">{fieldError}</p>}
    <div className="flex flex-wrap gap-2">
      <button type="submit" className={primaryButton} disabled={pending}><ButtonPixels />{pending ? "Starting…" : offboarding ? "Start offboarding" : "Restart onboarding"}</button>
      <Link href={`/workspace/people/${id}`} className={secondaryButton}>Cancel</Link>
    </div>
  </form>;
}

export function TaskControl({ action, employeeId, workflowId, taskId, title, completed }: { action: FormAction; employeeId: string; workflowId: string; taskId: string; title: string; completed: boolean }) {
  const [state, submit, pending] = useActionState(action, {});
  return <form action={submit} aria-busy={pending} className="max-w-full shrink-0">
    <input type="hidden" name="id" value={employeeId} />
    <input type="hidden" name="workflowId" value={workflowId} />
    <input type="hidden" name="taskId" value={taskId} />
    <input type="hidden" name="completed" value={String(!completed)} />
    <button type="submit" className={`${textButton} min-h-9! px-2.5 text-xs`} aria-label={completed ? `Reopen ${title}` : `Complete ${title}`} disabled={pending}>
      {completed ? <CornerUpLeft aria-hidden="true" size={14} /> : <Check aria-hidden="true" size={14} />}{pending ? "Saving…" : completed ? "Reopen" : "Complete"}
    </button>
    <FormError error={state.error} />
  </form>;
}

export function FinishWorkflow({ action, employeeId, workflowId, kind, hasOpenTasks }: { action: FormAction; employeeId: string; workflowId: string; kind: "onboarding" | "offboarding"; hasOpenTasks: boolean }) {
  const [state, submit, pending] = useActionState(action, {});
  const onboarding = kind === "onboarding";
  return <form action={submit} aria-busy={pending} className="mt-4 space-y-3 border-t border-line pt-4">
    <input type="hidden" name="id" value={employeeId} /><input type="hidden" name="workflowId" value={workflowId} />
    <FormError error={state.error} />
    {hasOpenTasks && <p className="text-xs text-muted">Complete all tasks to {onboarding ? "activate this employee" : "archive this profile"}.</p>}
    <div className="flex flex-wrap gap-2">
      <button type="submit" name="operation" value="complete" className={primaryButton} disabled={pending || hasOpenTasks}>{onboarding ? "Activate employee" : "Archive profile"} <ChevronRight aria-hidden="true" size={16} /></button>
      <button type="submit" name="operation" value="cancel" className={textButton} disabled={pending}>{onboarding ? "Cancel onboarding and archive" : "Cancel offboarding"}</button>
    </div>
  </form>;
}
