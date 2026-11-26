import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PencilSimpleIcon } from "@/components/icons";
import { panelStyle, secondaryButton, textButton, textLink } from "@/components/ui";
import { ActionForm, Field } from "@/components/workspace/action-form";
import { BackLink, Empty, Notice, PageHeader, Section } from "@/components/workspace/presentation";
import { NoticeForm, NoticeStatus } from "@/components/workspace/workplace-compliance";
import { Details, StatusText } from "@/components/workspace/workplace-parts";
import { noticeLabels, noticeStates } from "@/lib/domains/workplace";
import { formatDate, formatTime } from "@/lib/people";
import { listAdmins, listObligations, readNotice } from "@/lib/server/compliance";
import { requireAdmin } from "@/lib/server/member";
import { addNoticeFileAction, moveNoticeAction } from "../../actions";

export const metadata: Metadata = { title: "Notice" };

export default async function NoticePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string; saved?: string }> }) {
  await requireAdmin();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(id).success) notFound();
  const result = await readNotice(id);
  if (!result) notFound();
  const { notice, events, files } = result;
  const editing = query.edit === "1";
  const [admins, obligations] = editing ? await Promise.all([listAdmins(), listObligations()]) : [[], []];
  return <>
    <BackLink href="/workspace/compliance/notices">Notices</BackLink>
    <PageHeader title={notice.title} description={notice.authority || undefined} actions={!editing && <Link href={`/workspace/compliance/notices/${id}?edit=1`} className={secondaryButton}><PencilSimpleIcon aria-hidden="true" size={15} /> Edit notice</Link>} />
    {query.saved === "added" && <Notice>Notice recorded.</Notice>}
    {query.saved === "changed" && <Notice>Notice saved.</Notice>}
    {editing ? <section className={`${panelStyle} mb-8 max-w-3xl p-5`}><h2 className="mb-4 text-[15px] font-semibold">Edit notice</h2><NoticeForm key={notice.version} notice={notice} admins={admins} obligations={notice.obligationId && !obligations.some((entry) => entry.id === notice.obligationId) ? [...obligations, { id: notice.obligationId, name: notice.obligation ?? "Archived obligation" }] : obligations} cancel={<Link href={`/workspace/compliance/notices/${id}`} className={textButton}>Close</Link>} /></section>
      : <Section title="Details" className="mb-9"><Details items={[["Status", <NoticeStatus key="status" state={notice.state} />], ["Received", formatDate(notice.receivedOn)], ["Deadline", notice.deadlineOn ? <StatusText key="deadline" tone={notice.overdue ? "danger" : "muted"}>{notice.overdue ? "Overdue, " : ""}{formatDate(notice.deadlineOn)}</StatusText> : "None"], ["Assigned to", notice.assignee ?? "All administrators"], ["Related obligation", notice.obligationId ? <Link key="obligation" href={`/workspace/compliance/obligations/${notice.obligationId}`} className={textLink}>{notice.obligation}</Link> : "None"]]} /></Section>}
    <div className="grid gap-x-12 gap-y-9 lg:grid-cols-2">
      <div className="grid content-start gap-9">
        <Section title="Update"><div className="pt-3"><ActionForm key={notice.version} action={moveNoticeAction} submit="Save update" hidden={{ id, version: notice.version }}><Field name="state" label="Status" required defaultValue={notice.state} options={noticeStates.map((value) => ({ value, label: noticeLabels[value] }))} /><Field name="note" label="Update note" multiline maxLength={1000} /></ActionForm></div></Section>
        <Section title="Files">{files.length ? <ul className="divide-y divide-line">{files.map((file) => <li key={file.id} className="py-3 text-sm"><a href={`/workspace/compliance/files/${file.id}`} className={`${textLink} font-medium wrap-anywhere`}>{file.name}</a><p className="text-[13px] text-muted">{Math.max(1, Math.round(file.sizeBytes / 1024))} KB, added {formatDate(file.createdAt)}</p></li>)}</ul> : <Empty>No files attached.</Empty>}
          <ActionForm action={addNoticeFileAction} submit="Attach file" variant="secondary" hidden={{ id }} className="border-t border-line pt-4"><Field name="name" label="File name" required maxLength={120} /><Field name="file" label="File to attach" type="file" required accept="application/pdf,image/png,image/jpeg" hint="PDF, PNG or JPEG, up to 5 MB. Only administrators can open it." /></ActionForm></Section>
      </div>
      <Section title="Status history"><ol className="divide-y divide-line">{events.map((event) => <li key={event.id} className="py-3 text-sm"><div className="flex flex-wrap justify-between gap-x-4"><NoticeStatus state={event.state} /><time dateTime={event.at.toISOString()} className="text-[13px] text-muted">{formatTime(event.at)} UTC</time></div>{event.note && <p className="mt-1 whitespace-pre-line wrap-anywhere">{event.note}</p>}<p className="text-[13px] text-muted">{event.actor}</p></li>)}</ol></Section>
    </div>
  </>;
}
