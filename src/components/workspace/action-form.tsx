"use client";

import { createContext, use, useActionState, useEffect, useId, useRef, type ComponentProps, type ReactNode } from "react";
import { CheckCircleIcon } from "@/components/icons";
import { inputStyle } from "@/components/ui";
import { cn } from "@/lib/utils";
import { FormError, type ActionState } from "./action-state";
import { SubmitButton, type ButtonVariant, type Confirmation } from "./buttons";

export type FormAction = (state: ActionState, data: FormData) => Promise<ActionState>;

const FieldErrors = createContext<Record<string, string[]>>({});

type ActionFormProps = {
  action: FormAction; children: ReactNode; submit: string; pending?: string; className?: string; hidden?: Record<string, string | number>;
  secondary?: ReactNode; variant?: ButtonVariant; inline?: boolean; confirm?: Confirmation;
};

export function ActionForm({ action, children, submit, pending: pendingLabel = "Saving…", className, hidden = {}, secondary, variant = "primary", inline = false, confirm }: ActionFormProps) {
  const [state, run, pending] = useActionState(action, {});
  const form = useRef<HTMLFormElement>(null);
  const allowReset = useRef(false);

  useEffect(() => {
    if (!state.done) return;
    allowReset.current = true;
    form.current?.reset();
    allowReset.current = false;
  }, [state.done]);

  return (
    // React resets a form after its action. Entries stay in place unless the action reports success.
    <form ref={form} action={run} onReset={(event) => { if (!allowReset.current) event.preventDefault(); }} aria-busy={pending} className={cn("grid gap-4", className)}>
      {Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      <FormError error={state.error} />
      <FieldErrors value={state.fields ?? {}}>
        <div className={inline ? "flex flex-wrap items-end gap-3" : "contents"}>
          {children}
          <div className="flex flex-wrap items-center gap-2">
            <SubmitButton variant={variant} pending={pendingLabel} confirm={confirm}>{submit}</SubmitButton>
            {secondary}
            {state.message && !pending && <p role="status" className="flex items-center gap-1.5 text-sm font-medium text-positive"><CheckCircleIcon aria-hidden="true" size={16} weight="fill" />{state.message}</p>}
          </div>
        </div>
      </FieldErrors>
    </form>
  );
}

type FieldProps = Omit<ComponentProps<"input">, "name" | "id"> & { name: string; label: string; hint?: string; options?: { value: string; label: string }[]; multiline?: boolean; wrapperClass?: string };

export function Field({ name, label, hint, options, multiline, wrapperClass, className, required, type = "text", ...props }: FieldProps) {
  const id = useId();
  const error = use(FieldErrors)[name]?.[0];
  const described = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  // Browsers reject a required select whose chosen option has an empty value, even when that option is a real answer.
  const shared = { id, name, required: required && !options?.some((option) => option.value === ""), "aria-invalid": error ? true : undefined, "aria-describedby": described, className: cn(inputStyle, className) };
  return <div className={cn("min-w-0", wrapperClass)}>
    <label htmlFor={id} className="mb-1.5 block text-sm font-medium">{label}{!required && <span className="ml-1.5 text-[13px] font-normal text-muted">Optional</span>}</label>
    {options ? <select {...shared} defaultValue={props.defaultValue}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
      : multiline ? <textarea {...shared} rows={3} maxLength={props.maxLength} defaultValue={props.defaultValue} className={cn(shared.className, "py-2")} />
      : <input {...shared} type={type} {...(type === "date" ? { min: "1900-01-01", max: "9999-12-31" } : {})} {...props} className={cn(shared.className, type === "file" && "pt-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-raised file:px-2 file:text-foreground")} />}
    {hint && <p id={`${id}-hint`} className="mt-1.5 text-[13px] leading-snug text-muted">{hint}</p>}
    {error && <p id={`${id}-error`} className="mt-1.5 text-[13px] text-danger">{error}</p>}
  </div>;
}

export function Checkbox({ name, label, hint, defaultChecked }: { name: string; label: string; hint?: string; defaultChecked?: boolean }) {
  const id = useId();
  return <div className="flex items-start gap-2.5">
    <input id={id} name={name} type="checkbox" defaultChecked={defaultChecked} aria-describedby={hint ? `${id}-hint` : undefined} className="mt-0.5 size-[18px] accent-(--primary)" />
    <div><label htmlFor={id} className="text-sm font-medium">{label}</label>{hint && <p id={`${id}-hint`} className="text-[13px] text-muted">{hint}</p>}</div>
  </div>;
}

export function ActionButtons({ action, hidden, name, buttons }: { action: FormAction; hidden: Record<string, string | number>; name: string; buttons: { value: string; label: string; describe: string; variant?: ButtonVariant; confirm?: Confirmation }[] }) {
  const [state, run, pending] = useActionState(action, {});
  return <form action={run} aria-busy={pending} className="min-w-0">
    {Object.entries(hidden).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}
    <div className="flex flex-wrap items-center gap-1.5">
      {buttons.map(({ value, label, describe, variant = "secondary", confirm }) => <SubmitButton key={value} name={name} value={value} label={describe} variant={variant} confirm={confirm} className="min-h-10! px-3 text-[13px] pointer-fine:min-h-8!">{label}</SubmitButton>)}
    </div>
    {state.error && <div className="mt-2"><FormError error={state.error} /></div>}
    {state.message && <p role="status" className="mt-2 text-[13px] text-positive">{state.message}</p>}
  </form>;
}
