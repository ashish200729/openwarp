import Link from "next/link";
import { CaretDownIcon, CaretLeftIcon, CaretRightIcon } from "@/components/icons";
import { panelStyle, secondaryButton, textButton, textLink } from "@/components/ui";
import { ActionButtons, ActionForm, Field, type FormAction } from "@/components/workspace/action-form";
import { Callout, Empty, Figure, FigureRow, Section } from "@/components/workspace/presentation";
import { dateRange } from "@/components/workspace/requests";
import { eventLabels, formatMinutes, formatMultiplier, formatWeekday, sheetLabels, weekDays, type SheetState } from "@/lib/domains/time";
import { addDays } from "@/lib/operations";
import { formatDate } from "@/lib/people";
import type { Sheet, TimeEntry } from "@/lib/server/timesheets";
import { cn } from "@/lib/utils";

const stateColors: Record<SheetState, string> = { open: "text-muted", submitted: "text-amber", returned: "text-danger", approved: "text-positive", locked: "text-muted" };

export function SheetStatus({ state }: { state: SheetState }) {
  return <span className={cn("text-[13px] font-medium whitespace-nowrap", stateColors[state])}>{sheetLabels[state]}</span>;
}

export function WeekNavigation({ path, week, query = "" }: { path: string; week: string; query?: string }) {
  return <div className="flex items-center gap-1.5">
    <Link href={`${path}?week=${addDays(week, -7)}${query}`} aria-label="Previous week" className={cn(secondaryButton, "px-2.5")}><CaretLeftIcon aria-hidden="true" size={14} /></Link>
    <Link href={`${path}${query ? `?${query.slice(1)}` : ""}`} className={secondaryButton}>This week</Link>
    <Link href={`${path}?week=${addDays(week, 7)}${query}`} aria-label="Next week" className={cn(secondaryButton, "px-2.5")}><CaretRightIcon aria-hidden="true" size={14} /></Link>
  </div>;
}

const times = (entry: TimeEntry) => `${entry.start} to ${entry.end ?? "now"}${entry.overnight ? " the next day" : ""}`;

function EntryPanel({ sheet, entry, own, path, save, remove }: { sheet: Sheet; entry: TimeEntry | null; own: boolean; path: string; save: FormAction; remove: FormAction }) {
  const days = weekDays(sheet.week).filter((day) => day <= sheet.today);
  const needsReason = !own || entry?.source === "clock";
  const hidden = { employeeId: sheet.employeeId, week: sheet.week, ...(entry ? { id: entry.id, version: entry.version } : {}) };
  return <section className={`${panelStyle} my-4 max-w-2xl p-5`}>
    <h3 className="mb-4 text-[15px] font-semibold">{entry ? `Edit ${formatWeekday(entry.day)}, ${times(entry)}` : "Add time"}</h3>
    <ActionForm action={save} submit={entry ? "Save entry" : "Add entry"} hidden={hidden} secondary={<Link href={path} className={textButton}>Close</Link>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="day" label="Day" required defaultValue={entry?.day ?? days.at(-1)} options={days.map((day) => ({ value: day, label: formatWeekday(day) }))} />
        <Field name="breakMinutes" label="Break in minutes" type="number" min={0} max={1440} required defaultValue={entry?.breakMinutes ?? 0} />
        <Field name="start" label="Start" type="time" required defaultValue={entry?.start ?? "09:00"} /><Field name="end" label="End" type="time" required defaultValue={entry?.end ?? (entry ? "" : "17:00")} hint="An end before the start means the next day." />
      </div>
      <Field name="note" label="Note" maxLength={200} defaultValue={entry?.note ?? ""} />
      {needsReason && <Field name="reason" label={entry ? "Reason for the change" : "Reason for adding time"} required maxLength={200} />}
    </ActionForm>
    {entry && <div className="mt-5 border-t border-line pt-4"><ActionForm action={remove} submit="Remove entry" variant="danger" hidden={hidden} inline confirm={{ title: "Remove this entry?", body: "It no longer counts toward the week. The history keeps it.", action: "Remove entry", danger: true }}>
      <Field name="reason" label="Reason for removing it" required maxLength={200} wrapperClass="w-full sm:w-72" />
    </ActionForm></div>}
  </section>;
}

type SheetViewProps = {
  sheet: Sheet; own: boolean; canEdit: boolean; canDecide: boolean; canReopen: boolean; path: string; query: { new?: string; edit?: string };
  actions: { save: FormAction; remove: FormAction; command: FormAction };
};

export function SheetView({ sheet, own, canEdit, canDecide, canReopen, path, query, actions }: SheetViewProps) {
  const base = `${path}?week=${sheet.week}`;
  const open = sheet.state === "open" || sheet.state === "returned";
  const editable = canEdit && open && !sheet.archived;
  const entry = sheet.entries.find((item) => item.id === query.edit) ?? null;
  const sum = (key: "regular" | "overtime" | "breaks") => sheet.days.reduce((total, day) => total + day[key], 0);
  const title = dateRange(sheet.week, addDays(sheet.week, 6));
  const name = own ? "your" : `${sheet.employeeName}’s`;
  const hidden = { employeeId: sheet.employeeId, week: sheet.week, version: sheet.version };
  const started = sheet.week <= sheet.today;
  return <>
    {sheet.state === "returned" && <Callout><span className="font-medium">Returned{sheet.decidedBy ? ` by ${sheet.decidedBy}` : ""}.</span> {sheet.note}</Callout>}
    <Section title={title} action={<WeekNavigation path={path} week={sheet.week} />}>
      <p className="py-2 text-sm"><SheetStatus state={sheet.state} />{(sheet.state === "approved" || sheet.state === "locked") && <span className="text-muted">{sheet.decidedBy ? ` by ${sheet.decidedBy}` : ""}{sheet.state === "locked" ? ". Included in an approved pay run, so it can’t change." : ""}</span>}</p>
      <FigureRow className="mb-4"><Figure label="Total" value={formatMinutes(sum("regular") + sum("overtime"))} /><Figure label="Regular" value={formatMinutes(sum("regular"))} /><Figure label="Overtime" value={formatMinutes(sum("overtime"))} detail={`paid at ${formatMultiplier(sheet.multiplierBp)}`} /><Figure label="Unpaid breaks" value={formatMinutes(sum("breaks"))} /></FigureRow>
      {editable && started && query.new === "1" && !entry && <EntryPanel key="new" sheet={sheet} entry={null} own={own} path={base} save={actions.save} remove={actions.remove} />}
      {editable && entry && <EntryPanel key={`${entry.id}-${entry.version}`} sheet={sheet} entry={entry} own={own} path={base} save={actions.save} remove={actions.remove} />}
      <ul className="divide-y divide-line border-b border-line">
        {sheet.days.map((total) => {
          const entries = sheet.entries.filter((item) => item.day === total.day);
          const away = sheet.away.filter((item) => item.day === total.day);
          return <li key={total.day} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 py-2.5 text-sm sm:grid-cols-[8rem_minmax(0,1fr)_auto]">
            <span className={cn("font-medium", total.day === sheet.today && "text-accent")}>{formatWeekday(total.day)}</span>
            <div className="min-w-0 max-sm:col-span-2 max-sm:row-start-2">
              {entries.map((item) => <p key={item.id} className="flex flex-wrap items-center gap-x-2.5 wrap-anywhere"><span className="tabular-nums">{times(item)}</span>
                <span className="text-[13px] text-muted">{[item.end === null ? "Running" : null, item.breakMinutes ? `${item.breakMinutes}m break` : null, item.source === "clock" ? "Clocked" : "Entered by hand", item.note || null].filter(Boolean).join(" · ")}</span>
                {editable && <Link href={`${base}&edit=${item.id}`} className={`${textLink} inline-flex min-h-6 min-w-6 items-center text-[13px]`} aria-label={`Edit ${formatWeekday(item.day)}, ${times(item)}`}>Edit</Link>}</p>)}
              {away.map((item) => <p key={item.typeName} className="text-muted">{item.typeName}{item.halfDay ? ", half day" : ""}</p>)}
              {!entries.length && !away.length && <span className="text-hint">No time</span>}
            </div>
            <span className="text-right tabular-nums"><span className="sr-only">Total </span>{formatMinutes(total.regular + total.overtime)}{total.overtime > 0 && <span className="block text-[13px] text-amber">{formatMinutes(total.overtime)} overtime</span>}</span>
          </li>;
        })}
      </ul>
      <div className="flex flex-wrap items-start gap-2 py-4">
        {editable && started && <Link href={`${base}&new=1`} className={cn(secondaryButton, "min-h-10! px-3 text-[13px] pointer-fine:min-h-8!")}>Add time</Link>}
        {editable && started && !sheet.running && <ActionButtons action={actions.command} hidden={hidden} name="operation" buttons={[{ value: "submit", label: "Submit week", describe: own ? "Submit week" : `Submit week for ${sheet.employeeName}`, variant: "primary", confirm: { title: `Submit ${name} week?`, body: `${title}, ${formatMinutes(sum("regular") + sum("overtime"))}. It goes to a manager or administrator for approval.`, action: "Submit timesheet" } }]} />}
        {canEdit && sheet.state === "submitted" && !sheet.archived && <ActionButtons action={actions.command} hidden={hidden} name="operation" buttons={[{ value: "withdraw", label: "Withdraw", describe: own ? "Withdraw timesheet" : `Withdraw ${name} timesheet` }]} />}
        {canReopen && sheet.state === "approved" && !sheet.archived && <ActionButtons action={actions.command} hidden={hidden} name="operation" buttons={[{ value: "reopen", label: "Reopen", describe: `Reopen ${name} timesheet`, confirm: { title: `Reopen ${name} timesheet?`, body: "It has to be submitted and approved again before it can be paid.", action: "Reopen timesheet" } }]} />}
      </div>
      {editable && sheet.running && <p className="pb-4 text-[13px] text-muted">{own ? "Clock out before submitting this week." : "A clock entry is running. Close it before submitting this week."}</p>}
      {canDecide && sheet.state === "submitted" && <div className="grid max-w-2xl gap-5 border-t border-line pt-4 pb-5">
        <ActionButtons action={actions.command} hidden={hidden} name="operation" buttons={[{ value: "approve", label: "Approve", describe: `Approve ${name} timesheet`, variant: "primary" }]} />
        <ActionForm action={actions.command} submit="Return" pending="Returning…" variant="secondary" hidden={{ ...hidden, operation: "return" }} inline><Field name="note" label="What needs to change" required maxLength={500} wrapperClass="w-full sm:w-96" /></ActionForm>
      </div>}
    </Section>
    {sheet.events.length > 0 && <details className="group mt-2 border-b border-line">
      <summary className="flex min-h-11 items-center gap-2 rounded text-sm font-medium focus-visible:outline-offset-[-2px]"><span className="flex-1">History</span><CaretDownIcon aria-hidden="true" size={13} className="text-hint group-open:rotate-180" /></summary>
      <ul className="divide-y divide-line border-t border-line">{sheet.events.map((event) => <li key={event.id} className="py-2 text-[13px]"><p><span className="font-medium">{eventLabels[event.kind]}</span> {formatWeekday(event.day)}{event.from ? `: ${event.from}, now ${event.to}` : `: ${event.to}`}</p>
        <p className="wrap-anywhere text-muted">{event.actor}, {formatDate(event.at.slice(0, 10))} {event.at.slice(11)}{event.reason ? `. ${event.reason}` : ""}</p></li>)}</ul>
    </details>}
    {!started && <Empty>This week hasn’t started.</Empty>}
  </>;
}
