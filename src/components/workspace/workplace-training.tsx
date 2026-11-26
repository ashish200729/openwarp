import Link from "next/link";
import { RecordText } from "@/components/workspace/record-text";
import { StatusText } from "@/components/workspace/workplace-parts";
import { textLink } from "@/components/ui";
import { formatDate } from "@/lib/people";
import type { Assignment, Lesson } from "@/lib/server/training";

export function TrainingStatus({ entry }: { entry: Assignment }) {
  if (entry.state === "cancelled") return <StatusText tone="muted">Cancelled</StatusText>;
  if (entry.state === "completed") return <StatusText tone="positive">Completed</StatusText>;
  if (entry.upcoming) return <StatusText tone="muted">Opens {formatDate(entry.opensOn)}</StatusText>;
  if (entry.overdue) return <StatusText tone="danger">Overdue</StatusText>;
  return <StatusText tone="amber">{entry.lessonsDone ? "In progress" : "Not started"}</StatusText>;
}

export function trainingDetail(entry: Assignment) {
  if (entry.state === "cancelled") return `${entry.lessonsDone} of ${entry.lessons} lessons recorded`;
  if (entry.state === "completed") return [`Completed ${entry.completedOn ? formatDate(entry.completedOn) : ""}`, entry.scorePercent === null ? "" : `${entry.scorePercent}%`, entry.expiresOn ? `valid until ${formatDate(entry.expiresOn)}` : ""].filter(Boolean).join(", ");
  return [entry.dueOn ? `Due ${formatDate(entry.dueOn)}` : "No due date", entry.lessons ? `${entry.lessonsDone} of ${entry.lessons} lessons` : ""].filter(Boolean).join(", ");
}

export function TrainingList({ entries, open = false }: { entries: Assignment[]; open?: boolean }) {
  return <ul className="divide-y divide-line">{entries.map((entry) => <li key={entry.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-3 text-sm">
    <div className="min-w-0"><p className="font-medium wrap-anywhere">{open && entry.state === "open" && !entry.upcoming ? <Link href={`/workspace/training/${entry.courseId}`} className="hover:underline">{entry.title}</Link> : entry.title}</p><p className="text-[13px] text-muted">{trainingDetail(entry)}</p></div>
    <div className="flex items-center gap-4"><TrainingStatus entry={entry} />{entry.completionId && <Link href={`/workspace/training/certificates/${entry.completionId}`} aria-label={`Certificate for ${entry.title}`} className={`${textLink} text-[13px]`}>Certificate</Link>}</div>
  </li>)}</ul>;
}

export function LessonContent({ lesson }: { lesson: Lesson }) {
  return <>
    {lesson.body && <RecordText source={lesson.body} level={4} className="max-w-[70ch]" />}
    {lesson.kind === "link" && lesson.url && <p className="mt-2 text-sm"><a href={lesson.url} target="_blank" rel="noreferrer noopener" className={`${textLink} underline wrap-anywhere`}>{lesson.url}<span className="sr-only"> (opens in a new tab)</span></a></p>}
    {lesson.kind === "document" && <p className="mt-2 text-sm">{lesson.documentName ? <a href={`/workspace/documents/${lesson.documentId}`} className={`${textLink} underline wrap-anywhere`}>Download {lesson.documentName}</a> : <span className="text-muted">This document is no longer available. Ask an administrator for the current one.</span>}</p>}
  </>;
}
