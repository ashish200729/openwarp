import "server-only";
import type { PoolClient } from "pg";
import type { z } from "zod";
import { addMonths, type assignFields, type courseCommandFields, type courseFields, type LessonKind, type lessonCommandFields, type lessonDoneFields, type lessonFields, type questionFields, type quizFields, type ruleFields, type trainingCommandFields } from "@/lib/domains/workplace";
import { addDays, today } from "@/lib/operations";
import { employmentLabels, formatDate, type EmployeeStatus, type EmploymentType } from "@/lib/people";
import { pool } from "./db";
import { requireAdmin, type Member } from "./member";
import { audit, ensureCurrentTeam, PeopleError, requireOwnEmployee, runAsAdmin, runAsMember } from "./write";

export type Course = {
  id: string; title: string; summary: string; passPercent: number; maxAttempts: number | null; repeatMonths: number | null; published: boolean; version: number;
  lessons: number; questions: number; open: number; overdue: number; completed: number;
};
export type Lesson = { id: string; title: string; kind: LessonKind; body: string; url: string | null; documentId: string | null; documentName: string | null; done: boolean };
export type Question = { id: string; prompt: string; options: string[] };
export type AnsweredQuestion = Question & { correct: number };
export type Rule = { id: string; teamName: string | null; employmentType: EmploymentType | null; dueDays: number };
export type Attempt = { id: string; correct: number; total: number; passed: boolean; at: Date };
export type Assignment = {
  id: string; courseId: string; title: string; employeeId: string; employeeName: string; teamName: string | null; state: "open" | "completed" | "cancelled"; opensOn: string; dueOn: string | null; overdue: boolean; upcoming: boolean;
  lessonsDone: number; lessons: number; attempts: number; completionId: string | null; scorePercent: number | null; completedOn: string | null; expiresOn: string | null;
};
export type Certificate = { id: string; courseTitle: string; employeeName: string; scorePercent: number | null; completedOn: string; expiresOn: string | null };

const activeLessons = "SELECT count(*)::int FROM course_lessons l WHERE l.course_id = c.id AND l.removed_at IS NULL";
const overdue = "a.state = 'open' AND a.due_on < current_date";
const current = "e.status <> 'archived'";
const assignmentColumns = `a.id, c.id AS "courseId", coalesce(x.course_title, c.title) AS title, e.id AS "employeeId", concat_ws(' ', e.first_name, e.last_name) AS "employeeName", t.name AS "teamName", a.state, to_char(a.opens_on, 'YYYY-MM-DD') AS "opensOn",
  to_char(a.due_on, 'YYYY-MM-DD') AS "dueOn", coalesce(${overdue}, false) AS overdue, a.state = 'open' AND a.opens_on > current_date AS upcoming, (${activeLessons}) AS lessons,
  (SELECT count(*)::int FROM lesson_progress g JOIN course_lessons l ON l.id = g.lesson_id AND l.removed_at IS NULL WHERE g.assignment_id = a.id) AS "lessonsDone", (SELECT count(*)::int FROM quiz_attempts q WHERE q.assignment_id = a.id) AS attempts,
  x.id AS "completionId", x.score_percent AS "scorePercent", to_char(x.completed_on, 'YYYY-MM-DD') AS "completedOn", to_char(x.expires_on, 'YYYY-MM-DD') AS "expiresOn"`;
const assignmentFrom = `FROM training_assignments a JOIN courses c ON c.id = a.course_id JOIN employees e ON e.id = a.employee_id LEFT JOIN teams t ON t.id = e.team_id LEFT JOIN training_completions x ON x.assignment_id = a.id`;
const offered = "c.published AND c.archived_at IS NULL";
const courseColumns = `c.id, c.title, c.summary, c.pass_percent AS "passPercent", c.max_attempts AS "maxAttempts", c.repeat_months AS "repeatMonths", c.published, c.version, (${activeLessons}) AS lessons,
  (SELECT count(*)::int FROM course_questions q WHERE q.course_id = c.id AND q.removed_at IS NULL) AS questions`;

export async function listCourses() {
  await requireAdmin();
  const { rows } = await pool().query<Course>(
    `SELECT ${courseColumns}, n.open, n.overdue, n.completed FROM courses c
     CROSS JOIN LATERAL (SELECT count(*) FILTER (WHERE a.state = 'open' AND a.opens_on <= current_date)::int AS open, count(*) FILTER (WHERE ${overdue})::int AS overdue, count(*) FILTER (WHERE a.state = 'completed')::int AS completed
       FROM training_assignments a JOIN employees e ON e.id = a.employee_id AND ${current} WHERE a.course_id = c.id) n
     WHERE c.archived_at IS NULL ORDER BY lower(c.title), c.id LIMIT 300`,
  );
  return rows;
}

export async function readCourse(id: string) {
  await requireAdmin();
  const { rows: [course] } = await pool().query<Omit<Course, "open" | "overdue" | "completed">>(`SELECT ${courseColumns} FROM courses c WHERE c.id = $1 AND c.archived_at IS NULL`, [id]);
  if (!course) return null;
  const [lessons, questions, rules, people] = await Promise.all([
    readLessons(id, null),
    pool().query<AnsweredQuestion>("SELECT id, prompt, options, correct FROM course_questions WHERE course_id = $1 AND removed_at IS NULL ORDER BY position, id", [id]),
    pool().query<Rule>(`SELECT r.id, t.name AS "teamName", r.employment_type AS "employmentType", r.due_days AS "dueDays" FROM course_rules r LEFT JOIN teams t ON t.id = r.team_id WHERE r.course_id = $1 ORDER BY t.name NULLS FIRST, r.employment_type NULLS FIRST`, [id]),
    courseAssignments(pool(), id),
  ]);
  return { course, lessons, questions: questions.rows, rules: rules.rows, people };
}

async function readLessons(courseId: string, assignmentId: string | null) {
  const { rows } = await pool().query<Lesson>(
    `SELECT l.id, l.title, l.kind, l.body, l.url, l.document_id AS "documentId", CASE WHEN d.archived_at IS NULL THEN d.name END AS "documentName", EXISTS (SELECT 1 FROM lesson_progress g WHERE g.lesson_id = l.id AND g.assignment_id = $2::uuid) AS done
     FROM course_lessons l LEFT JOIN documents d ON d.id = l.document_id WHERE l.course_id = $1 AND l.removed_at IS NULL ORDER BY l.position, l.id`, [courseId, assignmentId],
  );
  return rows;
}

// An export passes the connection that already holds the write lock.
async function courseAssignments(db: Pick<PoolClient, "query">, courseId: string | null) {
  const { rows } = await db.query<Assignment>(
    `SELECT ${assignmentColumns} ${assignmentFrom} WHERE ($1::uuid IS NULL OR c.id = $1) ORDER BY lower(c.title), a.state DESC, a.due_on NULLS LAST, lower(e.last_name), e.id, a.created_at DESC LIMIT 5000`, [courseId],
  );
  return rows;
}

export function exportTraining(member: Member, courseId: string | null) {
  return runAsAdmin(member, async (client) => {
    const rows = await courseAssignments(client, courseId);
    await audit(client, member, "training.exported", { detail: `${rows.length} records` });
    return rows;
  });
}

// The person and administrators see scores. A manager sees only whether training is done.
export async function employeeTraining(member: Member, employeeId: string) {
  const full = member.role === "admin" || member.employeeId === employeeId;
  if (!full) {
    const { rowCount } = await pool().query("SELECT 1 FROM employees e JOIN employees m ON m.id = e.manager_id AND m.status = 'active' WHERE e.id = $1 AND m.id = $2", [employeeId, member.employeeId]);
    if (!rowCount) return null;
  }
  const { rows } = await pool().query<Assignment>(
    `SELECT ${assignmentColumns} ${assignmentFrom} WHERE a.employee_id = $1 AND (a.state IN ('completed','cancelled') OR ${offered}) ORDER BY a.state DESC, a.due_on NULLS LAST, x.completed_on DESC, a.id LIMIT 200`, [employeeId],
  );
  return { full, assignments: full ? rows : rows.map((row) => ({ ...row, attempts: 0, scorePercent: null, completionId: null })) };
}

export async function ownTraining(member: Member) {
  return member.employeeId ? (await employeeTraining(member, member.employeeId))?.assignments ?? [] : [];
}

// Questions reach the learner without the answers. Grading happens on the server.
export async function readLearning(member: Member, courseId: string) {
  if (!member.employeeId) return null;
  const { rows: [assignment] } = await pool().query<Assignment & { extraAttempts: number }>(
    `SELECT ${assignmentColumns}, a.extra_attempts AS "extraAttempts" ${assignmentFrom} WHERE a.employee_id = $1 AND c.id = $2 AND a.state <> 'cancelled' AND a.opens_on <= current_date AND ${offered}
     ORDER BY a.state = 'open' DESC, x.completed_on DESC NULLS LAST LIMIT 1`, [member.employeeId, courseId],
  );
  if (!assignment) return null;
  const { rows: [course] } = await pool().query<Pick<Course, "title" | "summary" | "passPercent" | "maxAttempts" | "repeatMonths">>(
    `SELECT title, summary, pass_percent AS "passPercent", max_attempts AS "maxAttempts", repeat_months AS "repeatMonths" FROM courses WHERE id = $1`, [courseId],
  );
  const [lessons, questions, attempts] = await Promise.all([
    readLessons(courseId, assignment.id),
    pool().query<Question>("SELECT id, prompt, options FROM course_questions WHERE course_id = $1 AND removed_at IS NULL ORDER BY position, id", [courseId]),
    pool().query<Attempt>("SELECT id, correct, total, passed, created_at AS at FROM quiz_attempts WHERE assignment_id = $1 ORDER BY created_at DESC, id", [assignment.id]),
  ]);
  const left = course.maxAttempts === null ? null : Math.max(0, course.maxAttempts + assignment.extraAttempts - attempts.rows.length);
  return { assignment, course, lessons, questions: questions.rows, attempts: attempts.rows, attemptsLeft: left };
}

export async function readCertificate(member: Member, id: string) {
  const { rows } = await pool().query<Certificate>(
    `SELECT x.id, x.course_title AS "courseTitle", concat_ws(' ', e.first_name, e.last_name) AS "employeeName", x.score_percent AS "scorePercent", to_char(x.completed_on, 'YYYY-MM-DD') AS "completedOn", to_char(x.expires_on, 'YYYY-MM-DD') AS "expiresOn"
     FROM training_completions x JOIN employees e ON e.id = x.employee_id WHERE x.id = $1 AND ($2 = 'admin' OR x.employee_id = $3)`, [id, member.role, member.employeeId],
  );
  return rows[0] ?? null;
}

async function currentCourse(client: PoolClient, id: string) {
  const { rows: [course] } = await client.query<{ title: string; published: boolean; version: number; passPercent: number; maxAttempts: number | null; repeatMonths: number | null; items: number }>(
    `SELECT title, published, version, pass_percent AS "passPercent", max_attempts AS "maxAttempts", repeat_months AS "repeatMonths",
     ((SELECT count(*) FROM course_lessons WHERE course_id = $1 AND removed_at IS NULL) + (SELECT count(*) FROM course_questions WHERE course_id = $1 AND removed_at IS NULL))::int AS items
     FROM courses WHERE id = $1 AND archived_at IS NULL`, [id],
  );
  if (!course) throw new PeopleError("This course could not be found.");
  return course;
}

export function saveCourse(member: Member, input: z.infer<typeof courseFields>) {
  return runAsAdmin(member, async (client) => {
    if (input.id && (await currentCourse(client, input.id)).passPercent !== input.passPercent) await requireEditableQuiz(client, input.id);
    const values = [input.title, input.summary, input.passPercent, input.maxAttempts, input.repeatMonths];
    const { rows: [course] } = input.id ? await client.query<{ id: string }>(
      "UPDATE courses SET title = $1, summary = $2, pass_percent = $3, max_attempts = $4, repeat_months = $5, version = version + 1 WHERE id = $6 AND version = $7 AND archived_at IS NULL RETURNING id", [...values, input.id, input.version],
    ) : await client.query<{ id: string }>("INSERT INTO courses (title, summary, pass_percent, max_attempts, repeat_months) VALUES ($1, $2, $3, $4, $5) RETURNING id", values);
    if (!course) throw new PeopleError("This course changed while you were editing. Reload it and try again.");
    await audit(client, member, input.id ? "course.updated" : "course.added", { detail: input.title });
    return course.id;
  });
}

export function commandCourse(member: Member, input: z.infer<typeof courseCommandFields>) {
  return runAsAdmin(member, async (client) => {
    const course = await currentCourse(client, input.id);
    if (course.version !== input.version) throw new PeopleError("This course changed while you were editing. Reload it and try again.");
    if (input.operation === "publish" && !course.items) throw new PeopleError("Add a lesson or a quiz question before publishing.");
    await client.query(`UPDATE courses SET published = $2, archived_at = CASE WHEN $3 THEN now() END, version = version + 1 WHERE id = $1`, [input.id, input.operation === "publish", input.operation === "archive"]);
    if (input.operation === "archive") {
      await client.query("UPDATE training_assignments SET state = 'cancelled' WHERE course_id = $1 AND state = 'open'", [input.id]);
      await client.query("DELETE FROM course_rules WHERE course_id = $1", [input.id]);
    }
    await audit(client, member, ({ publish: "course.published", unpublish: "course.unpublished", archive: "course.archived" } as const)[input.operation], { detail: course.title });
  });
}

export function saveLesson(member: Member, input: z.infer<typeof lessonFields>) {
  return runAsAdmin(member, async (client) => {
    const course = await currentCourse(client, input.courseId);
    if (input.kind === "document") {
      const { rowCount } = await client.query("SELECT 1 FROM documents WHERE id = $1 AND employee_id IS NULL AND archived_at IS NULL AND category <> 'receipt'", [input.documentId]);
      if (!rowCount) throw new PeopleError("Choose a company document.");
    }
    const values = [input.courseId, input.title, input.kind, input.body, input.kind === "link" ? input.url : null, input.kind === "document" ? input.documentId : null];
    const { rowCount } = input.id ? await client.query("UPDATE course_lessons SET title = $2, kind = $3, body = $4, url = $5, document_id = $6 WHERE id = $7 AND course_id = $1 AND removed_at IS NULL", [...values, input.id])
      : await client.query("INSERT INTO course_lessons (course_id, position, title, kind, body, url, document_id) SELECT $1, coalesce(max(position), 0) + 1, $2, $3, $4, $5, $6 FROM course_lessons WHERE course_id = $1", values);
    if (!rowCount) throw new PeopleError("This lesson was removed. Reload the page.");
    await audit(client, member, "course.updated", { detail: course.title });
  });
}

export function commandLesson(member: Member, input: z.infer<typeof lessonCommandFields>) {
  return runAsAdmin(member, async (client) => {
    const { rows: [lesson] } = await client.query<{ courseId: string; position: number }>(`SELECT course_id AS "courseId", position FROM course_lessons WHERE id = $1 AND removed_at IS NULL`, [input.id]);
    if (!lesson) throw new PeopleError("This lesson was removed. Reload the page.");
    const course = await currentCourse(client, lesson.courseId);
    if (input.operation === "remove") {
      if (course.published && course.items < 2) throw new PeopleError("A published course needs at least one lesson or question.");
      await client.query("UPDATE course_lessons SET removed_at = now() WHERE id = $1", [input.id]);
    } else {
      const up = input.operation === "up";
      const { rows: [other] } = await client.query<{ id: string; position: number }>(
        `SELECT id, position FROM course_lessons WHERE course_id = $1 AND removed_at IS NULL AND position ${up ? "<" : ">"} $2 ORDER BY position ${up ? "DESC" : "ASC"} LIMIT 1`, [lesson.courseId, lesson.position],
      );
      if (!other) return;
      await client.query("UPDATE course_lessons SET position = CASE WHEN id = $1 THEN $3::int ELSE $4::int END WHERE id IN ($1, $2)", [input.id, other.id, other.position, lesson.position]);
    }
    await audit(client, member, "course.updated", { detail: course.title });
  });
}

async function requireEditableQuiz(client: PoolClient, courseId: string) {
  const { rowCount } = await client.query(
    "SELECT 1 FROM training_assignments a JOIN quiz_attempts q ON q.assignment_id=a.id WHERE a.course_id=$1 AND a.state='open' LIMIT 1", [courseId],
  );
  if (rowCount) throw new PeopleError("People are working on this quiz. Finish or cancel those assignments before changing the questions or pass mark.");
}

export function addQuestion(member: Member, input: z.infer<typeof questionFields>) {
  return runAsAdmin(member, async (client) => {
    const course = await currentCourse(client, input.courseId);
    await requireEditableQuiz(client, input.courseId);
    await client.query("INSERT INTO course_questions (course_id, position, prompt, options, correct) SELECT $1, coalesce(max(position), 0) + 1, $2, $3, $4 FROM course_questions WHERE course_id = $1", [input.courseId, input.prompt, input.options, input.correct]);
    await audit(client, member, "course.updated", { detail: course.title });
  });
}

export function removeQuestion(member: Member, id: string) {
  return runAsAdmin(member, async (client) => {
    const { rows: [question] } = await client.query<{ courseId: string }>(`SELECT course_id AS "courseId" FROM course_questions WHERE id = $1 AND removed_at IS NULL`, [id]);
    if (!question) return;
    const course = await currentCourse(client, question.courseId);
    await requireEditableQuiz(client, question.courseId);
    if (course.published && course.items < 2) throw new PeopleError("A published course needs at least one lesson or question.");
    await client.query("UPDATE course_questions SET removed_at = now() WHERE id = $1", [id]);
    await audit(client, member, "course.updated", { detail: course.title });
  });
}

export function addRule(member: Member, input: z.infer<typeof ruleFields>) {
  return runAsAdmin(member, async (client) => {
    await ensureCurrentTeam(client, input.teamId);
    const course = await currentCourse(client, input.courseId);
    const { rowCount } = await client.query("INSERT INTO course_rules (course_id, team_id, employment_type, due_days) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING", [input.courseId, input.teamId, input.employmentType, input.dueDays]);
    if (!rowCount) throw new PeopleError("That rule already exists.");
    await audit(client, member, "course.updated", { detail: course.title });
  });
}

export function removeRule(member: Member, id: string) {
  return runAsAdmin(member, async (client) => {
    const { rows: [row] } = await client.query<{ title: string }>("DELETE FROM course_rules r USING courses c WHERE r.id = $1 AND c.id = r.course_id RETURNING c.title", [id]);
    if (row) await audit(client, member, "course.updated", { detail: row.title });
  });
}

async function notifyLearners(client: PoolClient, member: Member, employeeIds: string[], title: string, body: string, courseId: string) {
  await client.query("INSERT INTO notifications (user_id, title, body, href) SELECT user_id, $2, $3, $4 FROM workspace_members WHERE employee_id = ANY($1::uuid[]) AND role <> 'disabled' AND user_id <> $5", [employeeIds, title.slice(0, 160), body, `/workspace/training/${courseId}`, member.id]);
}

export function assignCourse(member: Member, input: z.infer<typeof assignFields>) {
  return runAsAdmin(member, async (client) => {
    const course = await currentCourse(client, input.courseId);
    if (!course.published) throw new PeopleError("Publish this course before assigning it.");
    if (input.dueOn && input.dueOn < today()) throw new PeopleError("Choose a due date that hasn’t passed.");
    const [kind, value = null] = input.audience.split(":");
    const { rows: people } = await client.query<{ id: string }>(
      `SELECT id FROM employees WHERE status IN ('onboarding', 'active') AND ($1 = 'everyone' OR $1 = 'person' AND id::text = $2 OR $1 = 'team' AND team_id::text = $2 OR $1 = 'type' AND employment_type = $2)`, [kind, value],
    );
    if (!people.length) throw new PeopleError("Nobody matches. Choose someone who is active or onboarding.");
    const { rows: assigned } = await client.query<{ employeeId: string }>(
      `INSERT INTO training_assignments (course_id, employee_id, due_on, assigned_by) SELECT $1, unnest($2::uuid[]), $3::date, $4 ON CONFLICT (course_id, employee_id) WHERE state = 'open' DO NOTHING RETURNING employee_id AS "employeeId"`,
      [input.courseId, people.map((person) => person.id), input.dueOn, member.id],
    );
    if (!assigned.length) throw new PeopleError("Everyone you chose already has this course.");
    await audit(client, member, "training.assigned", { employeeId: kind === "person" ? value! : undefined, teamId: kind === "team" ? value! : undefined, detail: `${course.title}, ${assigned.length} ${assigned.length === 1 ? "person" : "people"}` });
    await notifyLearners(client, member, assigned.map((row) => row.employeeId), `New training: ${course.title}`, input.dueOn ? `Due ${formatDate(input.dueOn)}` : "", input.courseId);
    const skipped = people.length - assigned.length;
    return `Assigned to ${assigned.length} ${assigned.length === 1 ? "person" : "people"}.${skipped ? ` ${skipped} already had it.` : ""}`;
  });
}

export async function assignForNewHire(client: PoolClient, member: Member, employeeId: string) {
  const { rows } = await client.query<{ courseId: string; title: string }>(
    `WITH matched AS (
       SELECT c.id, c.title, min(r.due_days) AS days FROM course_rules r JOIN courses c ON c.id = r.course_id AND ${offered} JOIN employees e ON e.id = $1
       WHERE (r.team_id IS NULL OR r.team_id = e.team_id) AND (r.employment_type IS NULL OR r.employment_type = e.employment_type) GROUP BY c.id
     ), added AS (
       INSERT INTO training_assignments (course_id, employee_id, due_on, assigned_by) SELECT m.id, $1, greatest(e.hire_date, current_date) + m.days::int, $2 FROM matched m JOIN employees e ON e.id = $1
       ON CONFLICT (course_id, employee_id) WHERE state = 'open' DO NOTHING RETURNING course_id
     ) SELECT m.id AS "courseId", m.title FROM added JOIN matched m ON m.id = added.course_id`, [employeeId, member.id],
  );
  for (const { courseId, title } of rows) {
    await audit(client, member, "training.assigned", { employeeId, detail: title });
    await notifyLearners(client, member, [employeeId], `New training: ${title}`, "", courseId);
  }
}

export function commandTraining(member: Member, input: z.infer<typeof trainingCommandFields>) {
  return runAsAdmin(member, async (client) => {
    const { rows: [row] } = await client.query<{ employeeId: string; courseId: string; title: string }>(
      input.operation === "cancel"
        ? `UPDATE training_assignments a SET state = 'cancelled' FROM courses c WHERE a.id = $1 AND a.state = 'open' AND c.id = a.course_id RETURNING a.employee_id AS "employeeId", c.id AS "courseId", c.title`
        : `UPDATE training_assignments a SET extra_attempts = extra_attempts + 1 FROM courses c WHERE a.id = $1 AND a.state = 'open' AND a.extra_attempts < 50 AND c.id = a.course_id RETURNING a.employee_id AS "employeeId", c.id AS "courseId", c.title`, [input.id],
    );
    if (!row) throw new PeopleError("This training is no longer open.");
    await audit(client, member, input.operation === "cancel" ? "training.cancelled" : "training.attempt_added", { employeeId: row.employeeId, detail: row.title });
    if (input.operation === "attempt") await notifyLearners(client, member, [row.employeeId], `You have another attempt: ${row.title}`, "", row.courseId);
  });
}

export function remindCourse(member: Member, courseId: string) {
  return runAsAdmin(member, async (client) => {
    const course = await currentCourse(client, courseId);
    const { rows } = await client.query<{ employeeId: string }>(`SELECT a.employee_id AS "employeeId" FROM training_assignments a JOIN employees e ON e.id = a.employee_id AND ${current} WHERE a.course_id = $1 AND a.state = 'open' AND a.due_on <= current_date + 7`, [courseId]);
    if (!rows.length) throw new PeopleError("Nobody is overdue or due in the next week.");
    await notifyLearners(client, member, rows.map((row) => row.employeeId), `Finish your training: ${course.title}`, "It is overdue or due this week.", courseId);
    await audit(client, member, "training.reminded", { detail: `${course.title}, ${rows.length} ${rows.length === 1 ? "person" : "people"}` });
    return `Reminded ${rows.length} ${rows.length === 1 ? "person" : "people"}.`;
  });
}

type OpenAssignment = { courseId: string; title: string; passPercent: number; maxAttempts: number | null; repeatMonths: number | null; extraAttempts: number };

async function ownAssignment(client: PoolClient, employeeId: string, id: string) {
  const { rows: [assignment] } = await client.query<OpenAssignment>(
    `SELECT c.id AS "courseId", c.title, c.pass_percent AS "passPercent", c.max_attempts AS "maxAttempts", c.repeat_months AS "repeatMonths", a.extra_attempts AS "extraAttempts"
     FROM training_assignments a JOIN courses c ON c.id = a.course_id WHERE a.id = $1 AND a.employee_id = $2 AND a.state = 'open' AND a.opens_on <= current_date AND ${offered}`, [id, employeeId],
  );
  if (!assignment) throw new PeopleError("This training is no longer open.");
  return assignment;
}

async function lessonsLeft(client: PoolClient, id: string, courseId: string) {
  const { rows } = await client.query<{ left: number }>("SELECT count(*)::int AS left FROM course_lessons l WHERE l.course_id = $1 AND l.removed_at IS NULL AND NOT EXISTS (SELECT 1 FROM lesson_progress g WHERE g.lesson_id = l.id AND g.assignment_id = $2)", [courseId, id]);
  return rows[0].left;
}

// Training is complete once every lesson is done and the quiz, if there is one, is passed.
async function settle(client: PoolClient, member: Member, employeeId: string, id: string, course: OpenAssignment) {
  if (await lessonsLeft(client, id, course.courseId)) return false;
  const { rows: [quiz] } = await client.query<{ needed: boolean; score: number | null }>(
    `SELECT EXISTS (SELECT 1 FROM course_questions WHERE course_id = $1 AND removed_at IS NULL) AS needed, (SELECT max(round(correct * 100.0 / total))::int FROM quiz_attempts WHERE assignment_id = $2 AND passed) AS score`, [course.courseId, id],
  );
  if (quiz.needed && quiz.score === null) return false;
  const day = today();
  const expiresOn = course.repeatMonths ? addMonths(day, course.repeatMonths) : null;
  await client.query("UPDATE training_assignments SET state = 'completed' WHERE id = $1", [id]);
  await client.query("INSERT INTO training_completions (assignment_id, course_id, employee_id, course_title, score_percent, completed_on, expires_on) VALUES ($1, $2, $3, $4, $5, $6, $7)", [id, course.courseId, employeeId, course.title, quiz.score, day, expiresOn]);
  if (expiresOn) {
    const opensOn = addDays(expiresOn, -30);
    await client.query("INSERT INTO training_assignments (course_id, employee_id, opens_on, due_on) VALUES ($1, $2, $3, $4)", [course.courseId, employeeId, opensOn > day ? opensOn : addDays(day, 1), expiresOn]);
  }
  await audit(client, member, "training.completed", { employeeId, detail: course.title });
  return true;
}

export function finishLesson(member: Member, input: z.infer<typeof lessonDoneFields>) {
  return runAsMember(member, async (client, actor) => {
    const employeeId = await requireOwnEmployee(client, actor);
    const course = await ownAssignment(client, employeeId, input.assignmentId);
    const { rowCount } = await client.query("SELECT 1 FROM course_lessons WHERE id = $1 AND course_id = $2 AND removed_at IS NULL", [input.lessonId, course.courseId]);
    if (!rowCount) throw new PeopleError("This lesson changed. Reload the page.");
    await client.query("INSERT INTO lesson_progress (assignment_id, lesson_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [input.assignmentId, input.lessonId]);
    return await settle(client, member, employeeId, input.assignmentId, course) ? "Training complete." : "Lesson done.";
  });
}

export function submitQuiz(member: Member, input: z.infer<typeof quizFields>) {
  return runAsMember(member, async (client, actor) => {
    const employeeId = await requireOwnEmployee(client, actor);
    const course = await ownAssignment(client, employeeId, input.assignmentId);
    if (await lessonsLeft(client, input.assignmentId, course.courseId)) throw new PeopleError("Finish every lesson before the quiz.");
    const { rows: [taken] } = await client.query<{ count: number }>("SELECT count(*)::int AS count FROM quiz_attempts WHERE assignment_id = $1", [input.assignmentId]);
    if (course.maxAttempts !== null && taken.count >= course.maxAttempts + course.extraAttempts) throw new PeopleError("You have no attempts left. Ask an administrator for another one.");
    const { rows: questions } = await client.query<{ id: string; correct: number; options: number }>("SELECT id, correct, cardinality(options) AS options FROM course_questions WHERE course_id = $1 AND removed_at IS NULL ORDER BY position, id", [course.courseId]);
    if (!questions.length) throw new PeopleError("This course has no quiz.");
    const answers = Object.fromEntries(questions.map((question) => [question.id, Number(input[`q_${question.id}`])]));
    if (questions.some(({ id, options }) => !Number.isInteger(answers[id]) || answers[id] < 1 || answers[id] > options)) throw new PeopleError("Answer every question. If one is missing, reload the page.");
    const correct = questions.filter((question) => answers[question.id] === question.correct).length;
    const passed = correct * 100 >= questions.length * course.passPercent;
    await client.query("INSERT INTO quiz_attempts (assignment_id, answers, correct, total, passed) VALUES ($1, $2, $3, $4, $5)", [input.assignmentId, JSON.stringify(answers), correct, questions.length, passed]);
    await audit(client, member, "training.attempted", { employeeId, detail: course.title });
    if (passed) await settle(client, member, employeeId, input.assignmentId, course);
    return { passed, correct, total: questions.length };
  });
}

export async function assignTargets() {
  await requireAdmin();
  const { rows } = await pool().query<{ id: string; name: string; status: EmployeeStatus }>(`SELECT id, concat_ws(' ', first_name, last_name) AS name, status FROM employees WHERE status IN ('onboarding', 'active') ORDER BY lower(last_name), lower(first_name), id LIMIT 2000`);
  return rows;
}

export function ruleLabel(rule: Rule) {
  return [rule.teamName ?? "Any team", rule.employmentType ? employmentLabels[rule.employmentType].toLowerCase() : "any employment type"].join(", ");
}
