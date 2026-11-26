"use client";

import { useActionState } from "react";
import { readReferenceAction } from "@/app/(workspace)/workspace/compliance/actions";
import { FormError } from "./action-state";
import { SubmitButton } from "./buttons";

export function Reference({ id }: { id: string }) {
  const [state, run] = useActionState(readReferenceAction, {});
  if (state.message) return <span role="status" className="font-mono text-[13px]">{state.message}</span>;
  return <form action={run}><input type="hidden" name="id" value={id} /><SubmitButton variant="secondary" className="min-h-10! px-3 text-[13px] pointer-fine:min-h-8!">Show number</SubmitButton><FormError error={state.error} /></form>;
}
