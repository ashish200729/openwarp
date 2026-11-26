import type { Metadata } from "next";
import { ActionForm, Field } from "@/components/workspace/action-form";
import { BackLink, Notice, PageHeader, Section } from "@/components/workspace/presentation";
import { passwordPolicies, twoFactorPolicies } from "@/lib/domains/platform";
import { requireAdmin } from "@/lib/server/member";
import { readPolicy, ssoConfigured, ssoLabel, workspaceOrigin } from "@/lib/server/platform-settings";
import { savePolicyAction } from "./actions";

export const metadata: Metadata = { title: "Security" };

const options = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }));

export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  await requireAdmin();
  const policy = await readPolicy();
  const sso = ssoConfigured();
  return <>
    <BackLink href="/workspace/settings">Settings</BackLink>
    <PageHeader title="Security" description="These rules apply to every account, including yours." />
    {(await searchParams).saved === "1" && <Notice>Security policy saved.</Notice>}
    <ActionForm key={policy.version} action={savePolicyAction} submit="Save policy" hidden={{ version: policy.version }} className="max-w-3xl gap-8">
      <Section title="Sign-in"><div className="grid gap-4 pt-3 sm:grid-cols-2">
        <Field name="requireTwoFactor" label="Two-factor sign-in" required defaultValue={policy.requireTwoFactor} options={options(twoFactorPolicies)} hint="Anyone who must use it sets it up before they can continue." />
        {sso ? <Field name="passwordSignIn" label="Password sign-in" required defaultValue={policy.passwordSignIn} options={options(passwordPolicies)} hint="Administrators always keep a password, so a provider outage can’t lock everyone out." /> : <input type="hidden" name="passwordSignIn" value="everyone" />}
        <Field name="minPasswordLength" label="Shortest password" type="number" required min={12} max={64} defaultValue={policy.minPasswordLength} hint="Characters. Applies when a password is next changed." />
        <Field name="allowedDomains" label="Email domains for new accounts" defaultValue={policy.allowedDomains.join(" ")} hint="Separate several with spaces. Leave empty to allow any." autoCapitalize="none" spellCheck={false} maxLength={2000} />
      </div></Section>
      <Section title="Sessions"><div className="grid gap-4 pt-3 sm:grid-cols-2">
        <Field name="sessionHours" label="Session length in hours" type="number" required min={1} max={720} defaultValue={policy.sessionHours} hint="People sign in again after this, even if they’re active." />
        <Field name="idleMinutes" label="Idle timeout in minutes" type="number" min={5} max={1440} defaultValue={policy.idleMinutes ?? ""} hint="Leave empty for no idle timeout." />
      </div></Section>
      <Section title="Activity history"><div className="grid gap-4 pt-3 sm:grid-cols-2">
        <Field name="retentionDays" label="Keep activity for, in days" type="number" min={365} max={36500} defaultValue={policy.retentionDays ?? ""} hint="Leave empty to keep everything." />
        <p className="text-[13px] leading-relaxed text-muted sm:pt-7">The application can’t delete activity. A server operator removes older entries with <code className="font-mono wrap-anywhere">node scripts/prune-activity.mjs --confirm</code>, which uses this number.</p>
      </div></Section>
    </ActionForm>
    <Section title="Single sign-on" className="mt-10 max-w-3xl"><div className="grid gap-2 pt-3 text-sm">
      {sso ? <>
        <p><span className="font-medium text-positive">On.</span> People can continue with {ssoLabel()}. An account must exist first, with the same email.</p>
        <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[8rem_minmax(0,1fr)]"><dt className="text-muted">Issuer</dt><dd className="wrap-anywhere">{process.env.OPENWARP_OIDC_ISSUER}</dd><dt className="text-muted">Redirect URI</dt><dd className="wrap-anywhere"><code className="font-mono">{workspaceOrigin()}/api/sso/callback</code></dd></dl>
      </> : <p className="max-w-[65ch] text-muted">Off. To turn it on, register an OpenID Connect application with the redirect URI <code className="font-mono wrap-anywhere text-foreground">{workspaceOrigin()}/api/sso/callback</code> and set OPENWARP_OIDC_ISSUER, OPENWARP_OIDC_CLIENT_ID and OPENWARP_OIDC_CLIENT_SECRET on the server.</p>}
    </div></Section>
  </>;
}
