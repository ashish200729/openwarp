import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CheckCircleIcon } from "@/components/icons";
import { Meter, textLink } from "@/components/ui";
import Link from "next/link";
import { ActionButtons, ActionForm } from "@/components/workspace/action-form";
import { BackLink, Empty, PageHeader, Section } from "@/components/workspace/presentation";
import { DataTable } from "@/components/workspace/workplace-parts";
import { LessonContent, trainingDetail, TrainingStatus } from "@/components/workspace/workplace-training";
import { formatTime } from "@/lib/people";
import { requireMember } from "@/lib/server/member";
import { readLearning } from "@/lib/server/training";
import { finishLessonAction, submitQuizAction } from "../actions";

export const metadata: Metadata = { title: "Course" };

export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const member = await requireMember();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const learning = await readLearning(member, id);
  if (!learning) notFound();
  const { assignment, course, lessons, questions, attempts, attemptsLeft } = learning;
  const open = assignment.state === "open";
  const ready = lessons.every((lesson) => lesson.done);
  const passed = attempts.some((attempt) => attempt.passed);
  return <>
    <BackLink href="/workspace/training">Training</BackLink>
    <PageHeader title={assignment.title} description={course.summary || undefined} actions={<TrainingStatus entry={assignment} />} />
    <p className="mb-3 text-sm text-muted">{trainingDetail(assignment)}{assignment.completionId && <> · <Link href={`/workspace/training/certificates/${assignment.completionId}`} className={textLink}>Certificate</Link></>}</p>
    {lessons.length > 0 && <div className="mb-8 max-w-3xl"><Meter value={lessons.filter((lesson) => lesson.done).length / lessons.length * 100} label="Lessons done" /></div>}
    <div className="grid max-w-3xl gap-9">
      {lessons.map((lesson, index) => <Section key={lesson.id} title={`${index + 1}. ${lesson.title}`} action={lesson.done && <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-positive"><CheckCircleIcon aria-hidden="true" size={14} weight="fill" />Done</span>}>
        <div className="py-3"><LessonContent lesson={lesson} /></div>
        {open && !lesson.done && <ActionButtons action={finishLessonAction} hidden={{ assignmentId: assignment.id, lessonId: lesson.id }} name="operation" buttons={[{ value: "done", label: "Mark as done", describe: `Mark as done: ${lesson.title}`, variant: "primary" }]} />}
      </Section>)}
      {questions.length > 0 && <Section title="Quiz">
        <p className="pt-2 pb-3 text-sm text-muted">{questions.length} {questions.length === 1 ? "question" : "questions"}. You need {course.passPercent}% to pass.{attemptsLeft === null ? "" : ` ${attemptsLeft} ${attemptsLeft === 1 ? "attempt" : "attempts"} left.`}</p>
        {!open || passed ? <Empty>You passed this quiz.</Empty> : !ready ? <Empty>Finish every lesson to take the quiz.</Empty> : attemptsLeft === 0 ? <Empty>You have no attempts left. Ask an administrator for another one.</Empty>
          : <ActionForm key={attempts.length} action={submitQuizAction} submit="Send answers" pending="Grading…" hidden={{ assignmentId: assignment.id }}>
            {questions.map((question, index) => <fieldset key={question.id} className="grid gap-1 border-t border-line pt-4"><legend className="float-left mb-1 text-sm font-medium wrap-anywhere">{index + 1}. {question.prompt}</legend>
              {question.options.map((option, position) => <label key={position} className="clear-left flex min-h-9 items-center gap-2.5 text-sm"><input type="radio" name={`q_${question.id}`} value={position + 1} required className="size-[18px] shrink-0 accent-(--primary)" /><span className="min-w-0 wrap-anywhere">{option}</span></label>)}
            </fieldset>)}
          </ActionForm>}
        {attempts.length > 0 && <div className="mt-5"><DataTable caption="Quiz attempts" columns={["Attempt", "Score", "Result"]} numeric={[1]} rows={attempts.map((attempt) => [`${formatTime(attempt.at)} UTC`, `${attempt.correct} of ${attempt.total}`, attempt.passed ? <span key="passed" className="text-positive">Passed</span> : <span key="failed" className="text-danger">Not passed</span>])} /></div>}
      </Section>}
      {!lessons.length && !questions.length && <Empty>This course has no lessons yet.</Empty>}
    </div>
  </>;
}
