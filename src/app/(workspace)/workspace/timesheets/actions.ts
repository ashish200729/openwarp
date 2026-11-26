"use server";

import type { ActionState } from "@/components/workspace/action-state";
import { clockFields, entryFields, entryRemovalFields, sheetCommandFields, timesheetUrl } from "@/lib/domains/time";
import { requireMember, type Member } from "@/lib/server/member";
import { perform } from "@/lib/server/perform";
import { clock, commandSheet, removeEntry, saveEntry } from "@/lib/server/timesheets";

const clockMessages = { clock_in: "Clocked in.", clock_out: "Clocked out.", break_start: "Break started.", break_end: "Break ended." };
const sheetMessages = { submit: "Timesheet submitted.", withdraw: "Timesheet withdrawn.", approve: "Timesheet approved.", return: "Timesheet returned.", reopen: "Timesheet reopened." };

const after = (member: Member, { employeeId, week }: { employeeId: string; week: string }, saved: string) => ({ redirect: `${member.employeeId === employeeId ? `/workspace/timesheets?week=${week}` : timesheetUrl(employeeId, week)}&saved=${saved}` });

export async function clockAction(_state: ActionState, data: FormData) {
  return perform(requireMember, clockFields, data, async (member, input) => { await clock(member, input); return clockMessages[input.operation]; });
}

export async function saveEntryAction(_state: ActionState, data: FormData) {
  return perform(requireMember, entryFields, data, async (member, input) => { await saveEntry(member, input); return after(member, input, "entry"); });
}

export async function removeEntryAction(_state: ActionState, data: FormData) {
  return perform(requireMember, entryRemovalFields, data, async (member, input) => { await removeEntry(member, input); return after(member, input, "removed"); });
}

export async function sheetAction(_state: ActionState, data: FormData) {
  return perform(requireMember, sheetCommandFields, data, async (member, input) => { await commandSheet(member, input); return sheetMessages[input.operation]; });
}
