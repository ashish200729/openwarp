import Link from "next/link";
import { EntryFrame } from "@/components/workspace/entry-frame";
import { ActionForm, Field } from "@/components/workspace/action-form";
import { SignOutButton } from "@/components/workspace/auth-controls";
import { primaryButton, textLink } from "@/components/ui";
import { invitationDetails } from "@/lib/server/accounts";
import { hasWorkspaceConfig } from "@/lib/server/auth";
import { currentMember, workspaceName } from "@/lib/server/member";
import { passwordAllowed, readPolicy, ssoConfigured, ssoLabel } from "@/lib/server/platform-settings";
import { enterWorkspace } from "../get-started/actions";
import { resetPasswordAction } from "../login/actions";
import { openInvitation } from "./actions";

export const metadata = { title: "Join your team", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default async function JoinPage({ searchParams }: { searchParams: Promise<{ token?: string | string[]; signin?: string }> }) {
  const { token, signin } = await searchParams;
  const configured = hasWorkspaceConfig();
  if (!configured) return <EntryFrame back title="Open your company’s invitation" description="This installation hasn’t been set up yet. Use the workspace address your employer sent, or ask them for a new invitation."><Link href="/get-started" className={textLink}>Back to getting started</Link></EntryFrame>;
  if (token === undefined && signin === "sso" && ssoConfigured()) return <EntryFrame back title={`Join ${workspaceName()}`} description="Use your company identity to open the account your administrator prepared.">
    <a href="/api/sso/start?entry=worker" className={primaryButton}>Continue with {ssoLabel()}</a>
  </EntryFrame>;
  if (token === undefined) return <EntryFrame back title="Join your team" description="Open the invitation from your employer, or paste it here to find your place in the workspace.">
    <ActionForm action={openInvitation} submit="Open invitation"><Field name="invitation" label="Invitation link or code" required autoComplete="off" maxLength={2048} spellCheck={false} autoCapitalize="none" /></ActionForm>
    <div className="mt-7 border-t border-line pt-5"><h2 className="font-semibold">Already have sign-in details?</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">Use your work account or the temporary password your administrator gave you. If you haven’t been invited, ask them for a link.</p>
      <form action={enterWorkspace.bind(null, "worker")}><button className={`${textLink} inline-flex min-h-11 items-center`}>Continue to sign in</button></form>
    </div>
  </EntryFrame>;
  const invitation = typeof token === "string" && /^[\w-]{43}$/.test(token) ? await invitationDetails(token) : null;
  if (!invitation) return <EntryFrame back title="This invitation is unavailable" description="The link may have expired, been replaced, or already been accepted. Ask your administrator for a fresh invitation.">
    <Link className={primaryButton} href="/join">Enter another invitation</Link><Link className={`${textLink} ml-4`} href="/login">Sign in</Link>
  </EntryFrame>;
  const [member, policy] = await Promise.all([currentMember(), readPolicy()]);
  if (member && member.id !== invitation.userId) return <EntryFrame back title="Switch accounts to join" description={`You’re signed in as ${member.email}. Sign out to continue with this invitation.`}>
    <SignOutButton stayOnPage />
  </EntryFrame>;
  const name = workspaceName();
  return <EntryFrame back title={`Join ${name}`} description={invitation.team ? `You’ve been invited to the ${invitation.team} team.` : "Your administrator has invited you to this workspace."}>
    <div className="mb-6 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-lg border border-line bg-panel px-4 py-3 text-sm"><span className="text-muted">Invited account</span><strong className="min-w-0 wrap-anywhere">{invitation.email}</strong></div>
    {passwordAllowed(policy, invitation.role) ? <ActionForm action={resetPasswordAction} submit="Accept invitation" pending="Accepting…" hidden={{ token: String(token) }}>
      <Field name="password" label="New password" type="password" required minLength={policy.minPasswordLength} maxLength={128} autoComplete="new-password" hint={`Use at least ${policy.minPasswordLength} characters. You’ll sign in with this password next.`} />
      <Field name="confirmation" label="Confirm new password" type="password" required minLength={policy.minPasswordLength} maxLength={128} autoComplete="new-password" />
    </ActionForm> : <form action={enterWorkspace.bind(null, invitation.role === "admin" ? "employer" : "worker")}><p className="mb-4 text-sm text-muted">Your company uses single sign-on.</p><button className={primaryButton}>Continue to sign in</button></form>}
  </EntryFrame>;
}
