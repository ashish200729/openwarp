import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon } from "@/components/icons";
import { panelStyle, primaryButton, textButton } from "@/components/ui";
import { ActionForm, Field } from "@/components/workspace/action-form";
import { Callout, Empty, EmptyState, Notice, PageHeader, Section } from "@/components/workspace/presentation";
import { DataTable, ExportLink, StatusText } from "@/components/workspace/workplace-parts";
import { TrainingList } from "@/components/workspace/workplace-training";
import { requireMember } from "@/lib/server/member";
import { listCourses, ownTraining } from "@/lib/server/training";
import { saveCourseAction } from "./actions";

export const metadata: Metadata = { title: "Training" };

export default async function TrainingPage({ searchParams }: { searchParams: Promise<{ new?: string; saved?: string }> }) {
  const member = await requireMember();
  const query = await searchParams;
  const admin = member.role === "admin";
  const adding = admin && query.new === "1";
  const [own, courses] = await Promise.all([ownTraining(member), admin ? listCourses() : []]);
  const open = own.filter((entry) => entry.state === "open");
  const done = own.filter((entry) => entry.state === "completed");
  return <>
    <PageHeader title="Training" description={admin ? "Write courses, assign them and follow progress." : "Courses assigned to you and what you’ve completed."} actions={admin && !adding && <Link href="/workspace/training?new=1" className={primaryButton}><PlusIcon aria-hidden="true" size={15} weight="bold" /> Add course</Link>} />
    {query.saved === "archived" && <Notice>Course archived. Open training for it was cancelled.</Notice>}
    {adding && <section className={`${panelStyle} mb-8 max-w-2xl p-5`}><h2 className="mb-4 text-[15px] font-semibold">Add a course</h2>
      <ActionForm action={saveCourseAction} submit="Add course" secondary={<Link href="/workspace/training" className={textButton}>Close</Link>}>
        <Field name="title" label="Title" required maxLength={120} /><Field name="summary" label="Summary" multiline maxLength={500} />
        <div className="grid gap-4 sm:grid-cols-3"><Field name="passPercent" label="Pass mark, percent" type="number" min={1} max={100} required defaultValue={80} /><Field name="maxAttempts" label="Quiz attempts" type="number" min={1} max={20} hint="Leave empty for no limit." /><Field name="repeatMonths" label="Repeat after, months" type="number" min={1} max={120} hint="Leave empty for once." /></div>
      </ActionForm></section>}
    {(member.employeeId || !admin) && <Section title="Your training" className="mb-9">{!member.employeeId ? <div className="pt-4"><Callout>Your account isn’t linked to an employee record, so training can’t be assigned to you. Ask an administrator to link it.</Callout></div> : open.length ? <TrainingList entries={open} open /> : <Empty>You have no training to do.</Empty>}</Section>}
    {done.length > 0 && <Section title="Completed" className="mb-9"><TrainingList entries={done} /></Section>}
    {admin && <Section title="Courses" action={courses.length > 0 && <ExportLink href="/workspace/training/export" label="all training records" />}>
      {courses.length ? <DataTable caption="Courses" columns={["Course", "Status", "Lessons", "Open", "Overdue", "Completed"]} numeric={[2, 3, 4, 5]} rows={courses.map((course) => [
        <Link key="course" href={`/workspace/training/${course.id}/manage`} className="font-medium hover:underline">{course.title}</Link>, <StatusText key="status" tone={course.published ? "positive" : "muted"}>{course.published ? "Published" : "Draft"}</StatusText>,
        course.lessons, course.open, course.overdue ? <span key="overdue" className="text-danger">{course.overdue}</span> : 0, course.completed,
      ])} /> : <div className="pt-4"><EmptyState title="No courses yet" description="Add a course with lessons and an optional quiz, then assign it." /></div>}
    </Section>}
  </>;
}
