"use server";

import type { ActionState } from "@/components/workspace/action-state";
import { assignFields, courseCommandFields, courseFields, idField, lessonCommandFields, lessonDoneFields, lessonFields, questionFields, quizFields, ruleFields, trainingCommandFields } from "@/lib/domains/workplace";
import { requireAdmin, requireMember } from "@/lib/server/member";
import { perform } from "@/lib/server/perform";
import { addQuestion, addRule, assignCourse, commandCourse, commandLesson, commandTraining, finishLesson, remindCourse, removeQuestion, removeRule, saveCourse, saveLesson, submitQuiz } from "@/lib/server/training";

export async function saveCourseAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, courseFields, data, async (member, input) => {
    const id = await saveCourse(member, input);
    return input.id ? "Course saved." : { redirect: `/workspace/training/${id}/manage?saved=added` };
  });
}

export async function courseCommandAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, courseCommandFields, data, async (member, input) => {
    await commandCourse(member, input);
    return input.operation === "archive" ? { redirect: "/workspace/training?saved=archived" } : input.operation === "publish" ? "Published." : "Unpublished.";
  });
}

export async function saveLessonAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, lessonFields, data, async (member, input) => { await saveLesson(member, input); return input.id ? "Lesson saved." : "Lesson added."; });
}

export async function lessonCommandAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, lessonCommandFields, data, (member, input) => commandLesson(member, input));
}

export async function addQuestionAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, questionFields, data, async (member, input) => { await addQuestion(member, input); return "Question added."; });
}

export async function removeQuestionAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, idField, data, (member, { id }) => removeQuestion(member, id));
}

export async function addRuleAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, ruleFields, data, async (member, input) => { await addRule(member, input); return "Rule added."; });
}

export async function removeRuleAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, idField, data, (member, { id }) => removeRule(member, id));
}

export async function assignCourseAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, assignFields, data, (member, input) => assignCourse(member, input));
}

export async function trainingCommandAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, trainingCommandFields, data, (member, input) => commandTraining(member, input));
}

export async function remindCourseAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, idField, data, (member, { id }) => remindCourse(member, id));
}

export async function finishLessonAction(_state: ActionState, data: FormData) {
  return perform(requireMember, lessonDoneFields, data, (member, input) => finishLesson(member, input));
}

export async function submitQuizAction(_state: ActionState, data: FormData) {
  return perform(requireMember, quizFields, data, async (member, input) => {
    const { passed, correct, total } = await submitQuiz(member, input);
    return `${passed ? "Passed" : "Not passed"}: ${correct} of ${total} correct.`;
  });
}
