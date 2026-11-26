import Link from "next/link";
import { redirect } from "next/navigation";
import { repositoryUrl } from "@/components/brand";
import { primaryButton, textLink } from "@/components/ui";
import { SignOutButton } from "@/components/workspace/auth-controls";
import { EntryFrame } from "@/components/workspace/entry-frame";
import { hasWorkspaceConfig } from "@/lib/server/auth";
import { currentMember, pendingStep, workspaceName } from "@/lib/server/member";
import { enterWorkspace } from "../actions";

export const metadata = { title: "Company setup", robots: { index: false, follow: false } };

export default async function EmployerEntry() {
  const member = await currentMember();
  if (member?.role === "admin" && !pendingStep(member)) redirect("/workspace/setup");
  const configured = hasWorkspaceConfig();
  return <EntryFrame back title="Set up your company" description="Choose your payroll settings, add your first hire, and give them access to their team.">
    {configured && <section className="rounded-xl border border-line-strong bg-panel p-5 sm:p-6">
      <h2 className="text-xl font-semibold wrap-anywhere">{workspaceName()}</h2>
      <p className="mt-2 mb-5 text-sm leading-relaxed text-muted">{member && member.role !== "admin" ? "An administrator manages setup for this workspace. You can continue to your member account." : "Continue with the administrator account for this workspace."}</p>
      {member && member.role !== "admin" ? <div className="flex flex-wrap items-center gap-3"><Link href="/workspace" className={primaryButton}>Open my workspace</Link><SignOutButton stayOnPage /></div> : <form action={enterWorkspace.bind(null, "employer")}><button className={primaryButton}>Continue as administrator</button></form>}
    </section>}
    <div className="mt-6"><h2 className="font-semibold">Starting a new workspace?</h2><p className="mt-1 text-sm leading-relaxed text-muted">Install OpenWarp for your company and create its first administrator.</p><a className={`${textLink} mt-2 inline-flex min-h-10 items-center`} href={`${repositoryUrl}#self-host`}>Open the setup guide</a></div>
  </EntryFrame>;
}
