import type { Metadata } from "next";
import { ActionButtons } from "@/components/workspace/action-form";
import { BackLink, Empty, PageHeader, Section } from "@/components/workspace/presentation";
import { formatTime } from "@/lib/people";
import { readEmailStatus } from "@/lib/server/email";
import { requireAdmin } from "@/lib/server/member";
import { testEmailAction } from "./actions";

export const metadata: Metadata = { title: "Email" };

const states = { queued: ["Waiting", "text-amber"], sent: ["Sent", "text-positive"], failed: ["Failed", "text-danger"] } as const;

export default async function EmailPage() {
  const member = await requireAdmin();
  const status = await readEmailStatus(member);
  return <>
    <BackLink href="/workspace/settings">Settings</BackLink>
    <PageHeader title="Email" description="Email carries notifications, account invitations and password resets. Without it, everything still works in the workspace." />
    <div className="grid max-w-3xl gap-10">
      <Section title="Status">{status.configured ? <div className="grid gap-3 pt-3 text-sm">
        {status.problem ? <p className="font-medium text-danger">{status.problem}</p> : <p className="font-medium text-positive">Set up</p>}
        <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[8rem_minmax(0,1fr)]">{status.server && <><dt className="text-muted">Server</dt><dd className="wrap-anywhere">{status.server}</dd></>}<dt className="text-muted">From</dt><dd className="wrap-anywhere">{status.from}</dd><dt className="text-muted">Waiting</dt><dd>{status.queued}</dd><dt className="text-muted">Failed</dt><dd>{status.failed} in 30 days</dd></dl>
        <ActionButtons action={testEmailAction} hidden={{}} name="operation" buttons={[{ value: "test", label: "Send test email", describe: "Send test email" }]} />
      </div> : <p className="max-w-[65ch] pt-3 text-sm leading-relaxed text-muted">Not set up. Set OPENWARP_SMTP_URL, such as <code className="font-mono wrap-anywhere text-foreground">smtp://user:password@mail.example.com:587</code>, and OPENWARP_EMAIL_FROM on the server, then restart it. Use smtps:// for a server that starts with TLS.</p>}</Section>
      {(status.configured || status.recent.length > 0) && <Section title="Recent email">{status.recent.length ? <ul className="divide-y divide-line">{status.recent.map((message) => {
        const [label, color] = states[message.state];
        return <li key={message.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-3 text-sm"><div className="min-w-0"><p className="font-medium wrap-anywhere">{message.subject}</p><p className="wrap-anywhere text-muted">{message.recipient}, {formatTime(message.at)} UTC{message.error && `. ${message.error}`}</p></div><span className={`text-[13px] font-medium ${color}`}>{label}</span></li>;
      })}</ul> : <Empty>Nothing has been sent yet.</Empty>}</Section>}
    </div>
  </>;
}
