import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { CheckCircleIcon, PlusIcon } from "@/components/icons";
import { panelStyle, primaryButton, textButton } from "@/components/ui";
import { ActionButtons, ActionForm, Checkbox, Field } from "@/components/workspace/action-form";
import { Empty, Notice, PageHeader, Section } from "@/components/workspace/presentation";
import { RecordText } from "@/components/workspace/record-text";
import { today } from "@/lib/operations";
import { formatDate } from "@/lib/people";
import { currentAnnouncements, otherAnnouncements, readAnnouncement, type Announcement } from "@/lib/server/announcements";
import { listTeams, type Team } from "@/lib/server/directory";
import { requireMember } from "@/lib/server/member";
import { sendDueNotices } from "@/lib/server/records-module";
import { acknowledgeAnnouncementAction, removeAnnouncementAction, saveAnnouncementAction } from "./actions";

export const metadata: Metadata = { title: "Announcements" };

function AnnouncementForm({ announcement, teams }: { announcement?: Announcement; teams: Team[] }) {
  return <section className={`${panelStyle} mb-8 max-w-2xl p-5`}>
    <h2 className="mb-4 text-[15px] font-semibold">{announcement ? "Edit announcement" : "Write an announcement"}</h2>
    <ActionForm action={saveAnnouncementAction} submit={announcement ? "Save announcement" : "Publish"} pending="Saving…" secondary={<Link href="/workspace/announcements" className={textButton}>Close</Link>} hidden={announcement ? { id: announcement.id, version: announcement.version } : {}}>
      <Field name="title" label="Title" required maxLength={140} defaultValue={announcement?.title} />
      <Field name="body" label="Message" required multiline maxLength={8_000} defaultValue={announcement?.body} className="min-h-40" hint="Start a line with - for a list, and put **two asterisks** around bold text." />
      <div className="grid gap-4 sm:grid-cols-3"><Field name="teamId" label="For" required defaultValue={announcement?.teamId ?? ""} options={[{ value: "", label: "Everyone" }, ...teams.map((team) => ({ value: team.id, label: `${team.name} team` }))]} /><Field name="publishOn" label="Publish on" type="date" required defaultValue={announcement?.publishOn ?? today()} /><Field name="expiresOn" label="Last day shown" type="date" defaultValue={announcement?.expiresOn ?? ""} /></div>
      <Checkbox name="pinned" label="Keep at the top" defaultChecked={announcement?.pinned} />
      <Checkbox name="needsAcknowledgement" label="Ask people to acknowledge it" defaultChecked={announcement?.needsAcknowledgement} />
    </ActionForm>
  </section>;
}

function ManageLinks({ announcement }: { announcement: Announcement }) {
  return <div className="flex items-center gap-1.5"><Link href={`/workspace/announcements?edit=${announcement.id}`} className={`${textButton} min-h-10! text-[13px] pointer-fine:min-h-8!`}>Edit<span className="sr-only"> {announcement.title}</span></Link>
    <ActionButtons action={removeAnnouncementAction} hidden={{ id: announcement.id }} name="operation" buttons={[{ value: "remove", label: "Remove", describe: `Remove ${announcement.title}`, variant: "text", confirm: { title: "Remove this announcement?", body: "Nobody sees it any more, including administrators.", action: "Remove announcement", danger: true } }]} /></div>;
}

function Summary({ announcements }: { announcements: Announcement[] }) {
  return <ul className="divide-y divide-line">{announcements.map((row) => <li key={row.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-2 text-sm"><div className="min-w-0"><p className="font-medium wrap-anywhere">{row.title}</p><p className="text-[13px] text-muted">{row.teamName ? `${row.teamName} team` : "Everyone"}, from {formatDate(row.publishOn)}{row.expiresOn && ` to ${formatDate(row.expiresOn)}`}{row.needsAcknowledgement && `, ${row.acknowledgedCount} of ${row.expectedCount} acknowledged`}</p></div><ManageLinks announcement={row} /></li>)}</ul>;
}

export default async function AnnouncementsPage({ searchParams }: { searchParams: Promise<{ new?: string; edit?: string; saved?: string }> }) {
  const member = await requireMember();
  await sendDueNotices();
  const query = await searchParams;
  const canManage = member.role === "admin";
  const writing = canManage && query.new === "1";
  const [current, others, editing, teams] = await Promise.all([currentAnnouncements(member), canManage ? otherAnnouncements() : null, canManage && z.uuid().safeParse(query.edit).success ? readAnnouncement(query.edit!) : null, canManage && (writing || query.edit) ? listTeams(member) : []]);
  return <>
    <PageHeader title="Announcements" actions={canManage && !writing && <Link href="/workspace/announcements?new=1" className={primaryButton}><PlusIcon aria-hidden="true" size={15} weight="bold" /> Write an announcement</Link>} />
    {query.saved === "1" && <Notice>Announcement saved.</Notice>}
    {writing ? <AnnouncementForm teams={teams} /> : editing && <AnnouncementForm key={`${editing.id}-${editing.version}`} announcement={editing} teams={teams} />}
    <div className="grid max-w-3xl gap-9">
      <Section title="Current">{current.length ? <ul className="divide-y divide-line">{current.map((row) => <li key={row.id}><article className="py-5">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-1"><div className="min-w-0"><h3 className="text-[15px] font-semibold wrap-anywhere">{row.title}</h3><p className="text-[13px] text-muted">{row.pinned && "Pinned, "}{row.author}, {formatDate(row.publishOn)}{row.teamName && `, for the ${row.teamName} team`}{canManage && row.needsAcknowledgement && `, ${row.acknowledgedCount} of ${row.expectedCount} acknowledged`}</p></div>{canManage && <ManageLinks announcement={row} />}</div>
        <RecordText source={row.body} level={4} className="mt-3 max-w-[70ch]" />
        {row.needsAcknowledgement && row.inAudience && <div className="mt-3">{row.acknowledged ? <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-positive"><CheckCircleIcon aria-hidden="true" size={14} weight="fill" />Acknowledged</span> : <ActionButtons action={acknowledgeAnnouncementAction} hidden={{ id: row.id }} name="operation" buttons={[{ value: "acknowledge", label: "I’ve read this", describe: `I’ve read this: ${row.title}`, variant: "primary" }]} />}</div>}
      </article></li>)}</ul> : <Empty>No announcements right now.</Empty>}</Section>
      {others && others.scheduled.length > 0 && <Section title="Scheduled"><Summary announcements={others.scheduled} /></Section>}
      {others && others.expired.length > 0 && <Section title="Expired"><Summary announcements={others.expired} /></Section>}
    </div>
  </>;
}
