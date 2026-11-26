"use client";

import { useActionState } from "react";
import { FormError, type ActionState } from "./action-state";
import { SubmitButton } from "./buttons";

export type RevealState = ActionState & { value?: string };

// The value lives only in this form's state, so leaving the page hides it again.
export function RevealValue({ action, hidden, masked, label }: { action: (state: RevealState, data: FormData) => Promise<RevealState>; hidden: Record<string, string>; masked: string; label: string }) {
  const [state, run, pending] = useActionState(action, {});
  return <form action={run} aria-busy={pending} className="flex flex-wrap items-center gap-x-3 gap-y-1">
    {Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
    <span role="status" className="text-sm tabular-nums">{state.value ?? masked}</span>
    {!state.value && <SubmitButton variant="text" label={label} className="min-h-10! px-2 text-[13px] pointer-fine:min-h-8!">Show</SubmitButton>}
    <FormError error={state.error} />
  </form>;
}
