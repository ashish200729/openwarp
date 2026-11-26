import { activityLabels, type ActivityEvent } from "@/lib/activity";
import { routineEvents } from "@/lib/server/routines";

export function eventChoices() {
  return routineEvents.map((event) => ({ value: event, label: activityLabels[event as ActivityEvent] })).sort((a, b) => a.label.localeCompare(b.label, "en"));
}
