"use server";

import type { ActionState } from "@/components/workspace/action-state";
import { addTaskFields, bulkTaskFields, ownTaskFields, planTaskFields } from "@/lib/domains/workplace";
import { addTask, bulkTasks, planChecklistTask, setOwnTask } from "@/lib/server/checklists";
import { requireAdmin, requireMember } from "@/lib/server/member";
import { perform } from "@/lib/server/perform";

export async function addTaskAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, addTaskFields, data, async (member, input) => { await addTask(member, input); return "Task added."; });
}

export async function planTaskAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, planTaskFields, data, async (member, input) => { await planChecklistTask(member, input); return "Task saved."; });
}

export async function bulkTasksAction(_state: ActionState, data: FormData) {
  data.set("taskIds", data.getAll("task").filter((value) => typeof value === "string").join(","));
  data.delete("task");
  return perform(requireAdmin, bulkTaskFields, data, async (member, input) => {
    const count = await bulkTasks(member, input);
    return `${count} ${count === 1 ? "task" : "tasks"} changed.`;
  });
}

export async function ownTaskAction(_state: ActionState, data: FormData) {
  return perform(requireMember, ownTaskFields, data, (member, input) => setOwnTask(member, input));
}
