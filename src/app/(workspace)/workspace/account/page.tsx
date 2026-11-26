import type { Metadata } from "next";
import { ActionButtons, ActionForm, Field } from "@/components/workspace/action-form";
import { PasswordForm } from "@/components/workspace/auth-controls";
import { TwoFactorPanel } from "@/components/workspace/platform-two-factor";
import { PageHeader, Section } from "@/components/workspace/presentation";
import { emailPreferences } from "@/lib/domains/platform";
import { formatTime } from "@/lib/people";
import { readPreference } from "@/lib/server/email";
import { requireMember } from "@/lib/server/member";
import { emailConfigured, readPolicy } from "@/lib/server/platform-settings";
import { listSessions } from "@/lib/server/sessions";
import { readTwoFactor } from "@/lib/server/two-factor";
import { preferenceAction, sessionAction } from "./actions";

export const metadata: Metadata = { title: "My account" };

export default async function AccountPage() {
  const member = await requireMember();
  const [policy, twoFactor, sessions, preference] = await Promise.all([readPolicy(), readTwoFactor(member), listSessions(member), readPreference(member)]);
  const others = sessions.filter((session) => !session.current);
  return <>
    <PageHeader title="My account" description={`Signed in as ${member.email}.`} />
    <div className="grid max-w-2xl gap-10">
      <Section title="Change password"><div className="max-w-md"><PasswordForm minLength={policy.minPasswordLength} /></div></Section>
      <Section title="Two-factor sign-in"><div className="pt-3"><TwoFactorPanel enabled={twoFactor.enabled} required={twoFactor.required} codesLeft={twoFactor.codesLeft} singleSignOn={twoFactor.method === "sso"} /></div></Section>
      <Section title="Sessions" action={others.length > 0 && <ActionButtons action={sessionAction} hidden={{}} name="operation" buttons={[{ value: "others", label: "Sign out all others", describe: "Sign out all others", variant: "text", confirm: { title: "Sign out every other session?", body: "Those browsers have to sign in again.", action: "Sign out others", danger: true } }]} />}>
        <ul className="divide-y divide-line">{sessions.map((session) => <li key={session.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3 text-sm">
          <div className="min-w-0"><p className="font-medium">{session.device}{session.current && <span className="font-normal text-positive"> · This session</span>}</p>
            <p className="wrap-anywhere text-muted">Signed in {formatTime(session.createdAt)} UTC{session.method === "sso" && " with single sign-on"}. Last active {formatTime(session.lastSeenAt)} UTC{session.address && ` from ${session.address}`}.</p></div>
          {!session.current && <ActionButtons action={sessionAction} hidden={{ sessionId: session.id }} name="operation" buttons={[{ value: "revoke", label: "End session", describe: `End session: ${session.device}, ${formatTime(session.createdAt)}`, variant: "text" }]} />}
        </li>)}</ul>
        <p className="pt-2 text-[13px] text-muted">Sessions end after {policy.sessionHours} hours{policy.idleMinutes ? `, or after ${policy.idleMinutes} minutes without activity` : ""}.</p>
      </Section>
      {emailConfigured() && <Section title="Email"><div className="pt-3"><ActionForm key={preference} action={preferenceAction} submit="Save" variant="secondary" inline><Field name="email" label="Email me about" required defaultValue={preference} options={Object.entries(emailPreferences).map(([value, label]) => ({ value, label }))} wrapperClass="w-full sm:w-72" /></ActionForm></div></Section>}
    </div>
  </>;
}
