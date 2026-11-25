"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createEmployeeFields, editEmployeeFields, employeeVersionFields, rehireFields, startOffboardingFields, taskCommandFields, teamNameField, workflowCommandFields } from "@/lib/people";
import { requireAdmin } from "@/lib/server/member";
import { closeWorkflow, createEmployee, PeopleError, rehireEmployee, saveTeam, setTask, startOffboarding, updateEmployee } from "@/lib/server/people-mutations";
import type { ActionState } from "@/components/workspace/action-state";

function invalid(error: z.ZodError): ActionState {
  const fields = z.flattenError(error).fieldErrors as Record<string, string[]>;
  return { error: "Check the highlighted fields and try again.", fields };
}

function failed(error: unknown): ActionState {
  if (error instanceof PeopleError) return { error: error.message };
  const databaseError = typeof error === "object" && error ? error as { code?: string; constraint?: string } : {};
  if (databaseError.code === "23505" && databaseError.constraint === "employees_email_unique") {
    return { error: "That work email is already in the directory.", fields: { email: ["Use a unique work email."] } };
  }
  if (databaseError.code === "23505" && databaseError.constraint === "teams_name_unique") {
    return { error: "That team name already exists.", fields: { name: ["Choose a different name."] } };
  }
  if (databaseError.code === "23503") return { error: "A selected record changed. Reload the page and try again." };
  console.error("OpenWarp could not save a change", databaseError.code ?? (error instanceof Error ? error.name : "unknown"));
  return { error: "We couldn’t save your changes. Try again in a moment." };
}

export async function saveEmployeeAction(mode: "create" | "edit", _previous: ActionState, formData: FormData): Promise<ActionState> {
  const member = await requireAdmin();
  const fields = Object.fromEntries(formData);
  let id: string;
  try {
    if (mode === "create") {
      const input = createEmployeeFields.safeParse(fields);
      if (!input.success) return invalid(input.error);
      id = await createEmployee(member, input.data);
    } else {
      const input = editEmployeeFields.safeParse(fields);
      if (!input.success) return invalid(input.error);
      await updateEmployee(member, input.data);
      id = input.data.id;
    }
  } catch (error) {
    return failed(error);
  }
  revalidatePath("/workspace", "layout");
  redirect(`/workspace/people/${id}?saved=${mode}`);
}

export async function offboardAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const member = await requireAdmin();
  const input = startOffboardingFields.safeParse(Object.fromEntries(formData));
  if (!input.success) return invalid(input.error);
  try {
    await startOffboarding(member, input.data);
  } catch (error) {
    return failed(error);
  }
  revalidatePath("/workspace", "layout");
  redirect(`/workspace/people/${input.data.id}?saved=offboarding#checklist`);
}

export async function rehireAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const member = await requireAdmin();
  const input = rehireFields.safeParse(Object.fromEntries(formData));
  if (!input.success) return invalid(input.error);
  try {
    await rehireEmployee(member, input.data);
  } catch (error) {
    return failed(error);
  }
  revalidatePath("/workspace", "layout");
  redirect(`/workspace/people/${input.data.id}?saved=rehired#checklist`);
}

export async function taskAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const member = await requireAdmin();
  const input = taskCommandFields.safeParse(Object.fromEntries(formData));
  if (!input.success) return invalid(input.error);
  try {
    await setTask(member, input.data);
  } catch (error) {
    return failed(error);
  }
  revalidatePath(`/workspace/people/${input.data.id}`);
  return {};
}

export async function workflowAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const member = await requireAdmin();
  const input = workflowCommandFields.safeParse(Object.fromEntries(formData));
  if (!input.success) return invalid(input.error);
  try {
    await closeWorkflow(member, input.data);
  } catch (error) {
    return failed(error);
  }
  revalidatePath("/workspace", "layout");
  redirect(`/workspace/people/${input.data.id}?saved=${input.data.operation}`);
}

export async function saveTeamAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const member = await requireAdmin();
  const fields = Object.fromEntries(formData);
  const input = teamNameField.safeParse(fields);
  if (!input.success) return invalid(input.error);
  const existing = fields.id === undefined ? null : employeeVersionFields.safeParse(fields);
  if (existing && !existing.success) return invalid(existing.error);
  try {
    await saveTeam(member, input.data.name, existing?.data);
  } catch (error) {
    return failed(error);
  }
  revalidatePath("/workspace", "layout");
  redirect(`/workspace/teams?saved=${existing ? "renamed" : "created"}`);
}
