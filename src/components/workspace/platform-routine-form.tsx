"use client";

import Link from "next/link";
import { useState, type ChangeEvent } from "react";
import { saveRoutineAction } from "@/app/(workspace)/workspace/routines/actions";
import { textButton } from "@/components/ui";
import { dateTriggers, weekdays, type RoutineAction, type RoutineConditions, type RoutineTrigger } from "@/lib/domains/platform";
import { employmentLabels, employmentTypes, statuses, statusLabels } from "@/lib/people";
import { ActionForm, Field } from "./action-form";

type Choice = { id: string; name: string };
type FormProps = { routine?: { id: string; version: number; name: string; trigger: RoutineTrigger; conditions: RoutineConditions; action: RoutineAction }; events: { value: string; label: string }[]; teams: Choice[]; webhooks: Choice[] };

const named = (choices: Choice[]) => choices.map(({ id, name }) => ({ value: id, label: name }));

// Only the fields that belong to the chosen trigger and action are on the page, so nothing else is submitted.
export function RoutineForm({ routine, events, teams, webhooks }: FormProps) {
  const { trigger, conditions, action } = routine ?? {};
  const [triggerKind, setTriggerKind] = useState<string>(trigger?.kind ?? "schedule");
  const [frequency, setFrequency] = useState<string>(trigger?.kind === "schedule" ? trigger.frequency : "daily");
  const [actionKind, setActionKind] = useState<string>(action?.kind ?? "notify");
  const schedule = trigger?.kind === "schedule" ? trigger : undefined;
  const choose = (set: (value: string) => void) => (event: ChangeEvent<HTMLDivElement>) => set((event.target as unknown as HTMLSelectElement).value);
  return <ActionForm action={saveRoutineAction} submit={routine ? "Save routine" : "Save draft"} hidden={routine ? { id: routine.id, version: routine.version } : undefined} secondary={<Link href={routine ? `/workspace/routines/${routine.id}` : "/workspace/routines"} className={textButton}>Close</Link>}>
    <Field name="name" label="Name" required maxLength={80} defaultValue={routine?.name} autoComplete="off" wrapperClass="max-w-md" />
    <fieldset className="grid min-w-0 gap-4 sm:grid-cols-2"><legend className="mb-3 text-sm font-semibold">When</legend>
      <div onChange={choose(setTriggerKind)}><Field name="triggerKind" label="Trigger" required defaultValue={triggerKind} options={[{ value: "schedule", label: "On a schedule" }, { value: "event", label: "After something happens" }, { value: "date", label: "Around a date" }]} /></div>
      {triggerKind === "schedule" && <>
        <div onChange={choose(setFrequency)}><Field name="frequency" label="Repeats" required defaultValue={frequency} options={[{ value: "daily", label: "Every day" }, { value: "weekly", label: "Every week" }, { value: "monthly", label: "Every month" }]} /></div>
        {frequency === "weekly" && <Field name="weekday" label="Weekday" required defaultValue={schedule?.frequency === "weekly" ? schedule.weekday : 1} options={weekdays.map((day, index) => ({ value: String(index), label: day }))} />}
        {frequency === "monthly" && <Field name="monthDay" label="Day of the month" type="number" required min={1} max={28} defaultValue={schedule?.frequency === "monthly" ? schedule.monthDay : 1} />}
        <Field name="time" label="Time in UTC" type="time" required defaultValue={schedule?.time ?? "09:00"} />
      </>}
      {triggerKind === "event" && <Field name="event" label="Event" required defaultValue={trigger?.kind === "event" ? trigger.event : undefined} options={events} />}
      {triggerKind === "date" && <>
        <Field name="date" label="Date" required defaultValue={trigger?.kind === "date" ? trigger.date : "start_date"} options={Object.entries(dateTriggers).map(([value, label]) => ({ value, label }))} />
        <Field name="offset" label="Days from the date" type="number" required min={-90} max={90} defaultValue={trigger?.kind === "date" ? trigger.offset : 0} hint="Negative for days before it." />
      </>}
    </fieldset>
    <fieldset className="grid min-w-0 gap-4 sm:grid-cols-3"><legend className="mb-3 text-sm font-semibold">For whom</legend>
      <Field name="teamId" label="Team" defaultValue={conditions?.teamId ?? ""} options={[{ value: "", label: "Any team" }, ...named(teams), ...(conditions?.teamId && !teams.some(team => team.id === conditions.teamId) ? [{ value: conditions.teamId, label: "Previous team (archived)" }] : [])]} />
      <Field name="employmentType" label="Employment type" defaultValue={conditions?.employmentType ?? ""} options={[{ value: "", label: "Any type" }, ...employmentTypes.map((value) => ({ value, label: employmentLabels[value] }))]} />
      <Field name="status" label="Status" defaultValue={conditions?.status ?? ""} options={[{ value: "", label: "Any status" }, ...statuses.filter((value) => value !== "archived").map((value) => ({ value, label: statusLabels[value] }))]} />
    </fieldset>
    <fieldset className="grid min-w-0 gap-4 sm:grid-cols-2"><legend className="mb-3 text-sm font-semibold">Then</legend>
      <div onChange={choose(setActionKind)}><Field name="actionKind" label="Action" required defaultValue={actionKind} options={[{ value: "notify", label: "Send a notification" }, { value: "task", label: "Add a checklist task" }, { value: "webhook", label: "Post to a webhook" }]} /></div>
      {actionKind === "notify" && <Field name="audience" label="Who gets it" required defaultValue={action?.kind === "notify" ? action.audience : "person"} options={[{ value: "person", label: "The person" }, { value: "manager", label: "Their manager" }, { value: "admins", label: "Administrators" }]} />}
      {actionKind === "webhook" && <Field name="endpointId" label="Webhook" required defaultValue={action?.kind === "webhook" ? action.endpointId : undefined} options={webhooks.length ? named(webhooks) : [{ value: "", label: "Add a webhook in Settings first" }]} />}
      <Field name="title" label={actionKind === "task" ? "Task" : "Message"} required maxLength={120} defaultValue={action?.title} hint="You can use {{first_name}}, {{full_name}}, {{title}} and {{date}}." wrapperClass="sm:col-span-2" />
      {actionKind === "notify" && <Field name="body" label="Details" multiline maxLength={400} defaultValue={action?.kind === "notify" ? action.body : ""} wrapperClass="sm:col-span-2" />}
    </fieldset>
  </ActionForm>;
}
