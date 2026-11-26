import { textLink } from "@/components/ui";
import { Field } from "@/components/workspace/action-form";
import type { ConfirmationOptions } from "@/lib/server/reauth";

export function ConfirmIdentity({ options, label }: { options: ConfirmationOptions; label: string }) {
  const again = <a href="/api/sso/start" className={textLink}>sign in again</a>;
  return <>
    {options.password && <Field name="password" label={label} type="password" required={!options.sso} autoComplete="current-password" maxLength={128} hint={options.sso ? "Or leave it empty within 10 minutes of signing in with single sign-on." : "Confirms that it’s you."} />}
    {options.sso && <p className="text-sm text-muted">{options.fresh ? "You signed in with single sign-on in the last 10 minutes, which confirms that it’s you." : <>Your single sign-on is more than 10 minutes old. To confirm that it’s you, {again} and come back{options.password ? ", or enter your password" : ""}.</>}</p>}
    {!options.sso && !options.password && <p className="text-sm text-muted">To confirm that it’s you, {again} with single sign-on and come back within 10 minutes.</p>}
  </>;
}
