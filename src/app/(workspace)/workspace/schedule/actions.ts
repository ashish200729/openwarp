"use server";

import type { ActionState } from "@/components/workspace/action-state";
import { scheduleCommandFields, shiftFields, shiftRemovalFields, weekStart } from "@/lib/domains/time";
import { addDays } from "@/lib/operations";
import { requireMember } from "@/lib/server/member";
import { perform } from "@/lib/server/perform";
import { copyWeek, deleteShift, publishWeek, saveShift } from "@/lib/server/schedule";

const url = (week: string, saved: string) => `/workspace/schedule?week=${week}&saved=${saved}`;

export async function saveShiftAction(_state: ActionState, data: FormData) {
  return perform(requireMember, shiftFields, data, async (member, input) => ({ redirect: url(weekStart(input.day), await saveShift(member, input) ? "half" : "shift") }));
}

export async function deleteShiftAction(_state: ActionState, data: FormData) {
  return perform(requireMember, shiftRemovalFields, data, async (member, input) => ({ redirect: url(await deleteShift(member, input), "deleted") }));
}

export async function scheduleAction(_state: ActionState, data: FormData) {
  return perform(requireMember, scheduleCommandFields, data, async (member, input) => {
    const scope = { ...input, week: weekStart(input.week) };
    const team = input.team ? `&team=${input.team}` : "";
    if (input.operation === "publish") {
      const count = await publishWeek(member, scope);
      return { redirect: `${url(scope.week, "published")}&count=${count}${team}` };
    }
    const { copied, skipped } = await copyWeek(member, scope);
    return { redirect: `${url(addDays(scope.week, 7), "copied")}&count=${copied}&skipped=${skipped}${team}` };
  });
}
