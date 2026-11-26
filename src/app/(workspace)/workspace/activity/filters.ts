import { workDate } from "@/lib/operations";
import { activityGroups, type ActivityFilters } from "@/lib/server/insights";

export function activityFilters(params: Record<string, string | string[] | undefined>): ActivityFilters {
  const text = (value: unknown, length: number) => typeof value === "string" ? value.trim().slice(0, length) : "";
  const date = (value: unknown) => { const parsed = workDate.safeParse(value); return parsed.success ? parsed.data : ""; };
  return { person: text(params.person, 120), actor: text(params.actor, 100), group: activityGroups.find((group) => group.value === params.group)?.value ?? "", from: date(params.from), to: date(params.to) };
}

export function activityUrl(filters: ActivityFilters, path = "/workspace/activity", before?: string) {
  const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
  if (before) params.set("before", before);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
