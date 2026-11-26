import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CaretDownIcon } from "@/components/icons";
import { ActionButtons, ActionForm, Field } from "@/components/workspace/action-form";
import { BackLink, Callout, Empty, Notice, PageHeader, Section } from "@/components/workspace/presentation";
import { DataTable, ExportLink, StatusText } from "@/components/workspace/workplace-parts";
import { LessonContent, trainingDetail, TrainingStatus } from "@/components/workspace/workplace-training";
import { lessonKinds, lessonLabels } from "@/lib/domains/workplace";
import { employmentLabels, employmentTypes } from "@/lib/people";
import { listTeams } from "@/lib/server/directory";
import { listDocuments } from "@/lib/server/documents";
import { requireAdmin } from "@/lib/server/member";
import { assignTargets, readCourse, ruleLabel, type Lesson } from "@/lib/server/training";
import { addQuestionAction, addRuleAction, assignCourseAction, courseCommandAction, lessonCommandAction, remindCourseAction, removeQuestionAction, removeRuleAction, saveCourseAction, saveLessonAction, trainingCommandAction } from "../../actions";

export const metadata: Metadata = { title: "Manage course" };

function LessonForm({ courseId, lesson, documents }: { courseId: string; lesson?: Lesson; documents: { value: string; label: string }[] }) {
  return <ActionForm key={lesson ? `${lesson.title}${lesson.kind}${lesson.body.length}${lesson.url}${lesson.documentId}` : undefined} action={saveLessonAction} submit={lesson ? "Save lesson" : "Add lesson"} variant="secondary" hidden={{ courseId, ...(lesson ? { id: lesson.id } : {}) }}>
    <div className="grid gap-4 sm:grid-cols-2"><Field name="title" label="Lesson title" required maxLength={120} defaultValue={lesson?.title} /><Field name="kind" label="Lesson type" required defaultValue={lesson?.kind ?? "text"} options={lessonKinds.map((value) => ({ value, label: lessonLabels[value] }))} /></div>
    <Field name="body" label="Text" multiline maxLength={20000} defaultValue={lesson?.body} hint="Needed for a text lesson. Start a line with # for a heading or - for a list, and use **two asterisks** for bold." />
    <div className="grid gap-4 sm:grid-cols-2"><Field name="url" label="Link" type="url" maxLength={500} defaultValue={lesson?.url ?? ""} hint="Needed for a link lesson." /><Field name="documentId" label="Company document" defaultValue={lesson?.documentId ?? ""} options={[{ value: "", label: "None" }, ...documents]} hint="Needed for a document lesson." /></div>
  </ActionForm>;
}

export default async function ManageCoursePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const member = await requireAdmin();
  const [{ id }, { saved }] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(id).success) notFound();
  const result = await readCourse(id);
  if (!result) notFound();
  const { course, lessons, questions, rules, people } = result;
  const [targets, teams, allDocuments] = await Promise.all([assignTargets(), listTeams(member), listDocuments(member)]);
  const documents = allDocuments.filter((document) => !document.employeeId).map((document) => ({ value: document.id, label: document.name }));
  const audience = [{ value: "", label: "Choose who to assign" }, { value: "everyone", label: "Everyone" }, ...employmentTypes.map((type) => ({ value: `type:${type}`, label: `Everyone who is ${employmentLabels[type].toLowerCase()}` })), ...teams.map((team) => ({ value: `team:${team.id}`, label: `Team: ${team.name}` })), ...targets.map((person) => ({ value: `person:${person.id}`, label: person.name }))];
  const command = { id, version: course.version };
  return <>
    <BackLink href="/workspace/training">Training</BackLink>
    <PageHeader title={course.title} description={course.summary || undefined} actions={<>
      <StatusText tone={course.published ? "positive" : "muted"}>{course.published ? "Published" : "Draft"}</StatusText>
      <ActionButtons action={courseCommandAction} hidden={command} name="operation" buttons={[
        course.published ? { value: "unpublish", label: "Unpublish", describe: "Unpublish this course", confirm: { title: "Unpublish this course?", body: "People it is assigned to can’t open it until you publish it again.", action: "Unpublish course" } } : { value: "publish", label: "Publish", describe: "Publish this course", variant: "primary" },
        { value: "archive", label: "Archive", describe: "Archive this course", variant: "text", confirm: { title: `Archive ${course.title}?`, body: "Open training is cancelled. Completion records stay.", action: "Archive course", danger: true } },
      ]} />
    </>} />
    {saved === "added" && <Notice>Course added. Add lessons, then publish it.</Notice>}
    {!course.published && <Callout>This course is a draft. Publish it before assigning it.</Callout>}
    <div className="grid gap-x-12 gap-y-9 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="grid content-start gap-9">
        <Section title="Lessons">
          {lessons.length ? <ol className="divide-y divide-line">{lessons.map((lesson, index) => <li key={lesson.id} className="py-1.5">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm"><span className="min-w-0 wrap-anywhere"><span className="text-muted tabular-nums">{index + 1}.</span> <span className="font-medium">{lesson.title}</span> <span className="text-muted">· {lessonLabels[lesson.kind]}</span></span>
              <ActionButtons action={lessonCommandAction} hidden={{ id: lesson.id }} name="operation" buttons={[...(index ? [{ value: "up", label: "Move up", describe: `Move up: ${lesson.title}`, variant: "text" as const }] : []), ...(index < lessons.length - 1 ? [{ value: "down", label: "Move down", describe: `Move down: ${lesson.title}`, variant: "text" as const }] : []), { value: "remove", label: "Remove", describe: `Remove ${lesson.title}`, variant: "text" as const, confirm: { title: `Remove ${lesson.title}?`, body: "People part way through no longer need it.", action: "Remove lesson", danger: true } }]} /></div>
            <details className="group"><summary className="inline-flex min-h-9 items-center gap-1.5 rounded text-[13px] text-muted hover:text-foreground">Preview and edit<span className="sr-only"> {lesson.title}</span><CaretDownIcon aria-hidden="true" size={12} className="group-open:rotate-180" /></summary><div className="border-l border-line py-2 pl-4"><LessonContent lesson={lesson} /></div><div className="pt-3 pb-4"><LessonForm courseId={id} lesson={lesson} documents={documents} /></div></details>
          </li>)}</ol> : <Empty>No lessons yet.</Empty>}
          <details className="group border-t border-line" open={!lessons.length}><summary className="inline-flex min-h-11 items-center gap-1.5 rounded text-sm font-medium">New lesson<CaretDownIcon aria-hidden="true" size={12} className="text-hint group-open:rotate-180" /></summary><div className="pt-1 pb-4"><LessonForm courseId={id} documents={documents} /></div></details>
        </Section>
        <Section title="Quiz">
          {questions.length ? <ol className="divide-y divide-line">{questions.map((question, index) => <li key={question.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-3 text-sm"><div className="min-w-0"><p className="font-medium wrap-anywhere">{index + 1}. {question.prompt}</p><ol className="mt-1 list-decimal pl-5 text-[13px] text-muted">{question.options.map((option, position) => <li key={position} className="wrap-anywhere">{option}{position + 1 === question.correct && <span className="text-positive"> (correct)</span>}</li>)}</ol></div>
            <ActionButtons action={removeQuestionAction} hidden={{ id: question.id }} name="operation" buttons={[{ value: "remove", label: "Remove", describe: `Remove question ${index + 1}`, variant: "text", confirm: { title: "Remove this question?", body: "Attempts already sent keep their score.", action: "Remove question", danger: true } }]} /></li>)}</ol> : <Empty>No quiz. Without one, the course is complete when every lesson is done.</Empty>}
          <details className="group border-t border-line"><summary className="inline-flex min-h-11 items-center gap-1.5 rounded text-sm font-medium">New question<CaretDownIcon aria-hidden="true" size={12} className="text-hint group-open:rotate-180" /></summary><ActionForm action={addQuestionAction} submit="Add question" variant="secondary" hidden={{ courseId: id }} className="pt-1 pb-4"><Field name="prompt" label="Question" required maxLength={500} /><Field name="options" label="Answers" required multiline maxLength={2000} hint="One answer on each line, 2 to 6 in all." /><Field name="correct" label="Correct line" type="number" min={1} max={6} required wrapperClass="max-w-40" /></ActionForm></details>
        </Section>
      </div>
      <div className="grid content-start gap-9">
        <Section title="Assign"><div className="pt-3">{course.published ? <ActionForm action={assignCourseAction} submit="Assign" hidden={{ courseId: id }}><Field name="audience" label="Who" required options={audience} /><Field name="dueOn" label="Due date" type="date" /></ActionForm> : <p className="text-sm text-muted">Publish the course to assign it.</p>}</div></Section>
        <Section title="New hires">
          {rules.length ? <ul className="divide-y divide-line">{rules.map((rule) => <li key={rule.id} className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 text-sm"><span className="min-w-0 wrap-anywhere">{ruleLabel(rule)} <span className="text-muted">· due in {rule.dueDays} days</span></span><ActionButtons action={removeRuleAction} hidden={{ id: rule.id }} name="operation" buttons={[{ value: "remove", label: "Remove", describe: `Remove rule: ${ruleLabel(rule)}`, variant: "text", confirm: { title: "Remove this rule?", body: "New hires won’t get this course automatically. Existing assignments stay.", action: "Remove rule", danger: true } }]} /></li>)}</ul> : <Empty>Not assigned automatically.</Empty>}
          <ActionForm action={addRuleAction} submit="Add rule" variant="secondary" hidden={{ courseId: id }} className="border-t border-line pt-4"><div className="grid gap-4 sm:grid-cols-2"><Field name="teamId" label="Team" required options={[{ value: "", label: "Any team" }, ...teams.map((team) => ({ value: team.id, label: team.name }))]} /><Field name="employmentType" label="Employment type" required options={[{ value: "", label: "Any type" }, ...employmentTypes.map((value) => ({ value, label: employmentLabels[value] }))]} /></div><Field name="dueDays" label="Days to finish" type="number" min={1} max={365} required defaultValue={30} wrapperClass="max-w-40" /></ActionForm>
        </Section>
        <Section title="Details"><div className="pt-3"><ActionForm key={course.version} action={saveCourseAction} submit="Save course" variant="secondary" hidden={command}><Field name="title" label="Title" required maxLength={120} defaultValue={course.title} /><Field name="summary" label="Summary" multiline maxLength={500} defaultValue={course.summary} /><Field name="passPercent" label="Pass mark, percent" type="number" min={1} max={100} required defaultValue={course.passPercent} /><Field name="maxAttempts" label="Quiz attempts" type="number" min={1} max={20} defaultValue={course.maxAttempts ?? ""} hint="Leave empty for no limit." /><Field name="repeatMonths" label="Repeat after, months" type="number" min={1} max={120} defaultValue={course.repeatMonths ?? ""} hint="Applies to future completions. Existing certificates and scheduled renewals keep their dates. Leave empty for once." /></ActionForm></div></Section>
      </div>
    </div>
    <Section title="Progress" className="mt-9" action={<span className="flex flex-wrap items-center gap-x-4">{people.some((entry) => entry.state === "open") && <ActionButtons action={remindCourseAction} hidden={{ id }} name="operation" buttons={[{ value: "remind", label: "Send reminders", describe: "Send reminders to people who are overdue or due this week" }]} />}{people.length > 0 && <ExportLink href={`/workspace/training/export?course=${id}`} label={`${course.title} records`} />}</span>}>
      <DataTable caption="Progress by person" empty="Nobody has been assigned this course." columns={["Person", "Team", "Status", "Detail", "Attempts", "Actions"]} numeric={[4]} rows={people.map((entry) => [
        <Link key="person" href={`/workspace/people/${entry.employeeId}/training`} className="font-medium hover:underline">{entry.employeeName}</Link>, entry.teamName ?? <span key="team" className="text-muted">No team</span>, <TrainingStatus key="status" entry={entry} />, trainingDetail(entry), entry.attempts,
        entry.state === "open" ? <ActionButtons key="actions" action={trainingCommandAction} hidden={{ id: entry.id }} name="operation" buttons={[...(course.maxAttempts !== null && entry.attempts >= course.maxAttempts ? [{ value: "attempt", label: "Allow attempt", describe: `Allow attempt for ${entry.employeeName}` }] : []), { value: "cancel", label: "Cancel", describe: `Cancel training for ${entry.employeeName}`, variant: "text" as const, confirm: { title: `Cancel this training for ${entry.employeeName}?`, body: "Their progress is kept in the record but they can’t continue.", action: "Cancel training", danger: true } }]} /> : <span key="none" className="text-muted">None</span>,
      ])} />
    </Section>
  </>;
}
