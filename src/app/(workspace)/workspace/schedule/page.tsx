import type { Metadata } from "next";
import Link from "next/link";
import { inputStyle, panelStyle, primaryButton, secondaryButton, textButton } from "@/components/ui";
import { ActionButtons, ActionForm, Field } from "@/components/workspace/action-form";
import { Empty, Notice, PageHeader, Section } from "@/components/workspace/presentation";
import { dateRange } from "@/components/workspace/requests";
import { WeekNavigation } from "@/components/workspace/time-sheet";
import { ShiftGrid } from "@/components/workspace/time-shifts";
import { parseWeek, weekDays } from "@/lib/domains/time";
import { addDays } from "@/lib/operations";
import { formatDate } from "@/lib/people";
import { listTeams } from "@/lib/server/directory";
import { requireMember } from "@/lib/server/member";
import { listSchedulable, listShifts } from "@/lib/server/schedule";
import { companyToday, readTimeSettings } from "@/lib/server/timesheets";
import { deleteShiftAction, saveShiftAction, scheduleAction } from "./actions";

export const metadata: Metadata = { title: "Schedule" };

const isCount = (value: string | undefined) => /^\d{1,4}$/.test(value ?? "");
const plural = (count: string) => `${count} ${count === "1" ? "shift" : "shifts"}`;

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ week?: string; new?: string; edit?: string; team?: string; saved?: string; count?: string; skipped?: string }> }) {
  const member = await requireMember();
  const query = await searchParams;
  const admin = member.role === "admin";
  const day = await companyToday();
  const week = parseWeek(query.week, day);
  const teams = admin ? await listTeams(member) : [];
  const teamId = teams.some((team) => team.id === query.team) ? query.team! : "";
  const [shifts, people, settings] = await Promise.all([listShifts(member, week, teamId), listSchedulable(member, teamId), readTimeSettings()]);
  const plans = people.length > 0;
  const days = weekDays(week);
  const teamQuery = teamId ? `&team=${teamId}` : "";
  const base = `/workspace/schedule?week=${week}${teamQuery}`;
  const managed = shifts.filter((shift) => shift.manages);
  const own = shifts.filter((shift) => shift.own && shift.published);
  const team = shifts.filter((shift) => !shift.manages && !shift.own);
  const drafts = managed.filter((shift) => !shift.published).length;
  const editing = managed.find((shift) => shift.id === query.edit) ?? null;
  const open = plans && (query.new === "1" || editing);
  const editUrl = (id: string) => `${base}&edit=${id}`;
  const notice = query.saved === "shift" ? "Shift saved." : query.saved === "half" ? "Shift saved. This person has approved half-day time off that day." : query.saved === "deleted" ? "Shift deleted."
    : query.saved === "published" && isCount(query.count) ? `${plural(query.count!)} published.` : query.saved === "copied" && isCount(query.count) && isCount(query.skipped) ? `${plural(query.count!)} copied as drafts.${query.skipped === "0" ? "" : ` ${plural(query.skipped!)} left out because of a conflict.`}` : null;
  return <>
    <PageHeader title="Schedule" description={`Times are in the company time zone, ${settings.timeZone.replaceAll("_", " ")}.`} actions={plans && !open && <Link href={`${base}&new=1`} className={primaryButton}>Add shift</Link>} />
    {notice && <Notice>{notice}</Notice>}
    {open && <section className={`${panelStyle} mb-8 max-w-2xl p-5`}>
      <h2 className="mb-4 text-[15px] font-semibold">{editing ? "Edit shift" : "Add shift"}</h2>
      <ActionForm key={editing ? `${editing.id}-${editing.version}` : "new"} action={saveShiftAction} submit={editing ? "Save shift" : "Add draft"} hidden={{ team: teamId, ...(editing ? { id: editing.id, version: editing.version } : {}) }} secondary={<Link href={base} className={textButton}>Close</Link>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="employeeId" label="Person" required defaultValue={editing?.employeeId} options={people.map((person) => ({ value: person.id, label: person.name }))} /><Field name="day" label="Date" type="date" required defaultValue={editing?.day ?? (days.includes(day) ? day : week)} />
          <Field name="start" label="Start" type="time" required defaultValue={editing?.start ?? "09:00"} /><Field name="end" label="End" type="time" required defaultValue={editing?.end ?? "17:00"} hint="An end before the start means the next day." />
          <Field name="role" label="Role" maxLength={60} defaultValue={editing?.role} /><Field name="note" label="Note" maxLength={200} defaultValue={editing?.note} hint="Shown to this person and their planners." />
        </div>
        {editing?.published && <p className="text-[13px] text-muted">This shift is published. Saving notifies the person.</p>}
      </ActionForm>
      {editing && <div className="mt-5 border-t border-line pt-4"><ActionButtons action={deleteShiftAction} hidden={{ id: editing.id, version: editing.version, team: teamId }} name="operation" buttons={[{ value: "delete", label: "Delete shift", describe: "Delete shift", variant: "danger", confirm: { title: "Delete this shift?", body: editing.published ? `${editing.name} is notified that it was cancelled.` : "It hasn’t been published, so no one is notified.", action: "Delete", danger: true } }]} /></div>}
    </section>}
    {admin && teams.length > 0 && <form key={`${week}-${teamId}`} method="get" action="/workspace/schedule" className="mb-5 flex flex-wrap items-end gap-3">
      <input type="hidden" name="week" value={week} />
      <div className="min-w-0 grow sm:max-w-56"><label htmlFor="schedule-team" className="mb-2 block text-[13px] font-medium text-muted">Team</label><select id="schedule-team" name="team" defaultValue={teamId} className={inputStyle}><option value="">All teams</option>{teams.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></div>
      <button type="submit" className={secondaryButton}>Apply</button>
    </form>}
    <Section title={dateRange(week, addDays(week, 6))} className="mb-9" action={<WeekNavigation path="/workspace/schedule" week={week} query={teamQuery} />}>
      {plans && <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3"><p className="text-sm text-muted">{managed.length === 0 ? "No shifts planned." : drafts ? `${drafts} of ${plural(String(managed.length))} not published yet.` : "Every shift is published."}</p>
        {managed.length > 0 && <ActionButtons action={scheduleAction} hidden={{ week, team: teamId }} name="operation" buttons={[
          ...(drafts ? [{ value: "publish", label: "Publish", describe: `Publish ${plural(String(drafts))}`, variant: "primary" as const, confirm: { title: `Publish ${plural(String(drafts))}?`, body: "Each person is notified and can see their shifts.", action: "Publish shifts" } }] : []),
          { value: "copy", label: "Copy to next week", describe: "Copy to next week", confirm: { title: "Copy this week?", body: `Shifts are added as drafts to the week of ${formatDate(addDays(week, 7))}. Any that clash with another shift or time off are left out.`, action: "Copy shifts" } },
        ]} />}</div>}
      {managed.length > 0 && <ShiftGrid shifts={managed} days={days} today={day} editUrl={editUrl} label="Planned shifts" />}
      {!plans && !own.length && <Empty>{member.employeeId ? "You have no published shifts this week." : "Your account isn’t linked to an employee record, so you have no shifts."}</Empty>}
    </Section>
    {own.some((shift) => !shift.manages) && <Section title="Your shifts" className="mb-9"><ShiftGrid shifts={own} days={days} today={day} editUrl={editUrl} label="Your shifts" /></Section>}
    {team.length > 0 && <Section title="Your team"><ShiftGrid shifts={team} days={days} today={day} editUrl={editUrl} label="Shifts on your team" /></Section>}
  </>;
}
