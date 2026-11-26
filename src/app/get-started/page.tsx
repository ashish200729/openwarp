import Link from "next/link";
import { BuildingsIcon, CaretRightIcon, UserCircleIcon } from "@/components/icons";
import { EntryFrame } from "@/components/workspace/entry-frame";
import { currentMember, pendingStep } from "@/lib/server/member";
import { textLink } from "@/components/ui";

export const metadata = { title: "Get started", robots: { index: false, follow: false } };
const paths = [
  { href: "/join", title: "Join my team", detail: "I’m an employee or contractor invited to a workspace.", Icon: UserCircleIcon },
  { href: "/get-started/employer", title: "Set up my company", detail: "I manage the team, payroll, or people operations.", Icon: BuildingsIcon },
];

export default async function GetStarted() {
  const member = await currentMember();
  return <EntryFrame title="How will you use OpenWarp?" description="Choose where you’d like to start.">
    <div className="grid gap-3">{paths.map(({ href, title, detail, Icon }) => <Link key={href} href={href} className="group flex min-h-24 items-center gap-3 rounded-xl border border-line-strong bg-panel px-4 py-5 hover:border-control hover:bg-surface sm:gap-5 sm:px-6">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-raised sm:size-11"><Icon size={23} aria-hidden="true" /></span>
      <span className="min-w-0 flex-1"><span className="block text-lg leading-snug font-semibold">{title}</span><span className="mt-1 block text-sm leading-relaxed text-muted">{detail}</span></span>
      <CaretRightIcon size={18} className="shrink-0 text-hint group-hover:text-foreground" aria-hidden="true" />
    </Link>)}</div>
    {member && !pendingStep(member) ? <div className="mt-7 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-line pt-4 text-sm"><p className="min-w-0 wrap-anywhere text-muted">Signed in as {member.email}</p><Link className={textLink} href="/workspace">Continue to workspace</Link></div>
      : <p className="mt-7 text-sm text-muted">Already have an account? <Link className={textLink} href="/login">Sign in</Link></p>}
  </EntryFrame>;
}
