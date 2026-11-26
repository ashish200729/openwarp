"use client";

import { useState, type FormEvent } from "react";
import { SignOutIcon } from "@/components/icons";
import { inputStyle, primaryButton, textButton } from "@/components/ui";
import { cn } from "@/lib/utils";
import { FormError } from "./action-state";
import { Spinner } from "./buttons";

const fetchOptions = {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  credentials: "same-origin",
  cache: "no-store",
} as const;

function navigateAfterSessionChange(path: "/workspace" | "/login") {
  // Use a full navigation so no prefetched workspace response survives a session change.
  window.location.replace(path);
}

export function SignInForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    const fields = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/sign-in/email", {
        ...fetchOptions,
        body: JSON.stringify({ email: String(fields.get("email")).trim().toLowerCase(), password: fields.get("password"), rememberMe: false }),
      });
      if (response.ok) {
        navigateAfterSessionChange("/workspace");
        return;
      }
      setError(response.status === 429 ? "Too many attempts. Wait a minute and try again."
        : response.status >= 500 ? "The workspace is unavailable right now. Try again shortly."
        : "Check your email and password, or ask your workspace administrator for access.");
    } catch {
      setError("We couldn’t reach the workspace. Check your connection and try again.");
    }
    setPending(false);
  }

  return (
    <form onSubmit={submit} method="post" className="mt-6 grid gap-4" aria-busy={pending}>
      <FormError error={error} />
      <label className="grid gap-2 text-sm font-medium">Work email
        <input className={inputStyle} name="email" type="email" autoComplete="username" maxLength={254} required />
      </label>
      <label className="grid gap-2 text-sm font-medium">Password
        <input className={inputStyle} name="password" type="password" autoComplete="current-password" maxLength={128} required />
      </label>
      <button type="submit" className={`${primaryButton} mt-1 min-h-11!`} disabled={pending}>{pending && <Spinner />}{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}

export function SignOutButton({ compact = false }: { compact?: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function signOut() {
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/auth/sign-out", { ...fetchOptions, body: "{}" });
      if (!response.ok) throw new Error();
      navigateAfterSessionChange("/login");
    } catch {
      setError("Sign-out failed. Try again.");
      setPending(false);
    }
  }

  return <div>
    <button className={cn(textButton, "w-full", compact ? "px-2! text-[13px]!" : "justify-start")} type="button" onClick={signOut} disabled={pending}>{!compact && <SignOutIcon aria-hidden="true" size={16} />}{pending ? "Signing out…" : "Sign out"}</button>
    <FormError error={error} />
  </div>;
}

export function PasswordForm({ welcome = false, minLength = 12 }: { welcome?: boolean; minLength?: number }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    setSaved(false);
    setError("");
    if (fields.get("newPassword") !== fields.get("confirmation")) {
      setError("The new passwords don’t match.");
      return;
    }
    if (fields.get("newPassword") === fields.get("currentPassword")) {
      setError("Choose a password you aren’t using now.");
      return;
    }
    setPending(true);
    try {
      const response = await fetch("/api/auth/change-password", {
        ...fetchOptions,
        body: JSON.stringify({ currentPassword: fields.get("currentPassword"), newPassword: fields.get("newPassword"), revokeOtherSessions: true }),
      });
      if (response.ok) {
        if (welcome) {
          navigateAfterSessionChange("/workspace");
          return;
        }
        form.reset();
        setSaved(true);
      } else {
        setError(response.status === 429 ? "Too many attempts. Try again in a minute."
          : response.status === 422 ? `Use a new password of at least ${minLength} characters.`
          : response.status >= 500 ? "We couldn’t update your password. Try again in a moment."
          : "Check your current password and make sure your session is still active.");
      }
    } catch {
      setError("We couldn’t reach the workspace. Try again in a moment.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} method="post" className="mt-4 grid gap-4" aria-busy={pending}>
      <FormError error={error} />
      {saved && <p role="status" className="text-sm font-medium text-positive">Password updated. Other sessions were signed out.</p>}
      <label className="grid gap-2 text-sm font-medium">{welcome ? "Temporary password" : "Current password"} <input className={inputStyle} name="currentPassword" type="password" autoComplete="current-password" maxLength={128} required /></label>
      <label className="grid gap-2 text-sm font-medium">New password <input className={inputStyle} name="newPassword" type="password" autoComplete="new-password" minLength={minLength} maxLength={128} aria-describedby="password-hint" required /></label>
      <p id="password-hint" className="-mt-2 text-xs text-muted">Use at least {minLength} characters.</p>
      <label className="grid gap-2 text-sm font-medium">Confirm new password <input className={inputStyle} name="confirmation" type="password" autoComplete="new-password" minLength={minLength} maxLength={128} required /></label>
      <button className={`${primaryButton} justify-self-start`} type="submit" disabled={pending}>{pending && <Spinner />}{pending ? "Updating…" : "Update password"}</button>
    </form>
  );
}
