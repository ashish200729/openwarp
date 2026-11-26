"use client";

import { useId, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { primaryButton, secondaryButton, textButton } from "@/components/ui";
import { cn } from "@/lib/utils";

export const buttonVariants = {
  primary: primaryButton, secondary: secondaryButton, text: textButton,
  danger: cn(secondaryButton, "border-danger/40 text-danger hover:border-danger hover:bg-danger/8"),
};
export type ButtonVariant = keyof typeof buttonVariants;
export type Confirmation = { title: string; body: string; action: string; danger?: boolean };

export function Spinner() {
  return <span aria-hidden="true" className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none motion-reduce:opacity-60" />;
}

type SubmitProps = { children: ReactNode; pending?: string; variant?: ButtonVariant; name?: string; value?: string; label?: string; disabled?: boolean; className?: string; confirm?: Confirmation };

// The pressed button keeps its width and shows a spinner. Every other button in the form is disabled until the action settles.
export function SubmitButton({ children, pending: pendingLabel, variant = "primary", name, value, label, disabled, className, confirm }: SubmitProps) {
  const { pending, data } = useFormStatus();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const pressed = pending && (!name || data?.get(name) === value);
  const content = <>{pressed && <Spinner />}{pressed && pendingLabel ? pendingLabel : children}</>;
  if (!confirm) return <button type="submit" name={name} value={value} aria-label={label} disabled={disabled || pending} className={cn(buttonVariants[variant], className)}>{content}</button>;
  return <>
    <button type="button" aria-label={label} aria-haspopup="dialog" disabled={disabled || pending} onClick={() => dialog.current?.showModal()} className={cn(buttonVariants[variant], className)}>{content}</button>
    <dialog ref={dialog} aria-labelledby={titleId} onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }} className="m-auto w-[min(27rem,calc(100vw-2rem))] rounded-xl border border-line-strong bg-panel p-0 text-left whitespace-normal text-foreground shadow-float backdrop:bg-black/40">
      <div className="p-5">
        <h2 id={titleId} className="text-base font-semibold">{confirm.title}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-pretty text-muted">{confirm.body}</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" autoFocus onClick={() => dialog.current?.close()} className={secondaryButton}>Keep as is</button>
          <button type="submit" name={name} value={value} onClick={() => setTimeout(() => dialog.current?.close())} className={cn(primaryButton, confirm.danger && "bg-danger text-surface hover:bg-danger/85")}>{confirm.action}</button>
        </div>
      </div>
    </dialog>
  </>;
}
