"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, LogOut } from "lucide-react";
import { ButtonPixels, inputStyle, primaryButton, textButton } from "@/components/ui";
import { FormError } from "./action-state";

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
    <form onSubmit={submit} method="post" className="mt-7 grid gap-4" aria-busy={pending}>
      <FormError error={error} />
      <label className="grid gap-2 text-sm font-medium">Work email
        <input className={inputStyle} name="email" type="email" autoComplete="username" maxLength={254} required />
      </label>
      <label className="grid gap-2 text-sm font-medium">Password
        <input className={inputStyle} name="password" type="password" autoComplete="current-password" maxLength={128} required />
      </label>
      <button type="submit" className={`${primaryButton} mt-1`} disabled={pending}><ButtonPixels /> {pending ? "Signing in…" : "Sign in"} <ArrowRight aria-hidden="true" size={16} /></button>
    </form>
  );
}

export function SignOutButton() {
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
    <button className={`${textButton} w-full justify-start`} type="button" onClick={signOut} disabled={pending}><LogOut aria-hidden="true" size={16} /> {pending ? "Signing out…" : "Sign out"}</button>
    <FormError error={error} />
  </div>;
}

export function PasswordForm() {
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
    setPending(true);
    try {
      const response = await fetch("/api/auth/change-password", {
        ...fetchOptions,
        body: JSON.stringify({ currentPassword: fields.get("currentPassword"), newPassword: fields.get("newPassword"), revokeOtherSessions: true }),
      });
      if (response.ok) {
        form.reset();
        setSaved(true);
      } else {
        setError(response.status === 429 ? "Too many attempts. Try again in a minute."
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
    <form onSubmit={submit} method="post" className="mt-5 grid gap-4" aria-busy={pending}>
      <FormError error={error} />
      {saved && <p role="status" className="rounded-md bg-positive/10 p-3 text-sm text-positive">Password updated. Other sessions were signed out.</p>}
      <label className="grid gap-2 text-sm font-medium">Current password <input className={inputStyle} name="currentPassword" type="password" autoComplete="current-password" maxLength={128} required /></label>
      <label className="grid gap-2 text-sm font-medium">New password <input className={inputStyle} name="newPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} aria-describedby="password-hint" required /></label>
      <p id="password-hint" className="-mt-2 text-xs text-muted">Use at least 12 characters.</p>
      <label className="grid gap-2 text-sm font-medium">Confirm new password <input className={inputStyle} name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label>
      <button className={`${primaryButton} justify-self-start`} type="submit" disabled={pending}>{pending ? "Updating…" : "Update password"}</button>
    </form>
  );
}
