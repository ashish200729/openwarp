import type { Metadata } from "next";
import Link from "next/link";
import { CaretDownIcon, CaretRightIcon } from "@/components/icons";
import { ActionButtons, ActionForm, Checkbox, Field } from "@/components/workspace/action-form";
import { Empty, PageHeader, Section } from "@/components/workspace/presentation";
import { currencies, formatDays, paySchedules, scheduleLabels, today } from "@/lib/operations";
import { formatDate, statusLabels, workflowKinds } from "@/lib/people";
import { requireAdmin } from "@/lib/server/member";
import { listHolidays, listTemplates, listTimeOffTypes, readCompany } from "@/lib/server/settings";
import { addHolidayAction, addTemplateAction, removeHolidayAction, removeTemplateAction, saveCompanyAction, saveTimeOffTypeAction } from "../operations";

export const metadata: Metadata = { title: "Settings" };

const areas = [
  { title: "People and access", links: [
    { label: "Accounts and roles", detail: "Create sign-ins, change roles and link accounts to people.", href: "/workspace/settings/access" },
    { label: "Security", detail: "Two-factor, sessions and password rules.", href: "/workspace/settings/security" },
    { label: "Custom fields", detail: "Add your own fields to profiles.", href: "/workspace/settings/fields" },
    { label: "Templates and new hires", detail: "Letters, agreements and what each new hire receives.", href: "/workspace/settings/templates" },
    { label: "Workplace", detail: "Default apps, device checks and training for new hires.", href: "/workspace/settings/workplace" },
  ] },
  { title: "Time and pay", links: [
    { label: "Time tracking and leave policies", detail: "Overtime, who tracks time, accrual and carryover.", href: "/workspace/settings/time" },
    { label: "Pay", detail: "Deductions, taxes, bank file and accounting setup.", href: "/workspace/settings/pay" },
    { label: "Benefits", detail: "Plans, costs and enrollment windows.", href: "/workspace/settings/benefits" },
  ] },
  { title: "Connections", links: [
    { label: "Email", detail: "Delivery status and a test message.", href: "/workspace/settings/email" },
    { label: "API and MCP", detail: "Tokens, scopes and reference.", href: "/workspace/settings/api" },
    { label: "Webhooks", detail: "Send events to other systems.", href: "/workspace/settings/webhooks" },
  ] },
];

export default async function SettingsPage() {
  await requireAdmin();
  const [company, types, holidays, templates] = await Promise.all([readCompany(), listTimeOffTypes(true), listHolidays(`${today().slice(0, 4)}-01-01`), listTemplates()]);
  return <>
    <PageHeader title="Settings" />
    <div className="grid max-w-3xl gap-10">
      {areas.map((area) => <Section key={area.title} title={area.title}><ul className="divide-y divide-line">{area.links.map((link) => <li key={link.href}><Link href={link.href} className="group flex min-h-13 items-center justify-between gap-4 py-2 text-sm"><span><span className="block font-medium group-hover:underline">{link.label}</span><span className="block text-[13px] text-muted">{link.detail}</span></span><CaretRightIcon aria-hidden="true" size={14} className="shrink-0 text-hint" /></Link></li>)}</ul></Section>)}
      <Section title="Currency and schedule"><div className="pt-3"><ActionForm key={company.version} action={saveCompanyAction} submit="Save" hidden={{ version: company.version }} inline>
        <Field name="currency" label="Currency" required defaultValue={company.currency} options={currencies.map((value) => ({ value, label: value }))} wrapperClass="w-32" />
        <Field name="schedule" label="Pay schedule" required defaultValue={company.schedule} options={paySchedules.map((value) => ({ value, label: scheduleLabels[value] }))} wrapperClass="w-full sm:w-52" />
      </ActionForm></div></Section>
      <Section title="Time off types">
        <ul className="divide-y divide-line">{types.map((type) => <li key={type.id}><details className="group">
          <summary className="flex min-h-12 items-center gap-4 rounded text-sm focus-visible:outline-offset-[-2px]"><span className="flex-1 font-medium">{type.name}{!type.active && <span className="font-normal text-muted"> · Not offered</span>}</span><span className="text-muted">{type.annualDays === null ? "No limit" : `${formatDays(type.annualDays)} a year`}</span><CaretDownIcon aria-hidden="true" size={13} className="text-hint group-open:rotate-180" /></summary>
          <ActionForm key={`${type.name}-${type.annualDays}-${type.active}`} action={saveTimeOffTypeAction} submit="Save type" hidden={{ id: type.id }} variant="secondary" className="pt-1 pb-5">
            <div className="grid gap-4 sm:grid-cols-2"><Field name="name" label="Name" required maxLength={60} defaultValue={type.name} /><Field name="annualDays" label="Days a year" type="number" min={0} max={366} defaultValue={type.annualDays ?? ""} hint="Leave empty for no limit." /></div>
            <Checkbox name="active" label="Offer this type" defaultChecked={type.active} />
          </ActionForm>
        </details></li>)}</ul>
        <div className="border-t border-line pt-4"><ActionForm action={saveTimeOffTypeAction} submit="Add type" variant="secondary" hidden={{ active: "on" }} inline><Field name="name" label="New type" required maxLength={60} wrapperClass="w-full sm:w-56" /><Field name="annualDays" label="Days a year" type="number" min={0} max={366} wrapperClass="w-full sm:w-36" /></ActionForm></div>
      </Section>
      <Section title="Company holidays">
        {holidays.length ? <ul className="divide-y divide-line">{holidays.map((holiday) => <li key={holiday.day} className="flex min-h-12 items-center gap-4 text-sm"><span className="w-28 shrink-0 text-muted tabular-nums">{formatDate(holiday.day)}</span><span className="min-w-0 flex-1 font-medium wrap-anywhere">{holiday.name}</span><ActionButtons action={removeHolidayAction} hidden={{ day: holiday.day }} name="operation" buttons={[{ value: "remove", label: "Remove", describe: `Remove ${holiday.name}`, variant: "text", confirm: { title: `Remove ${holiday.name}?`, body: "New time off requests will count that day. Requests already sent keep their day count.", action: "Remove holiday", danger: true } }]} /></li>)}</ul> : <Empty>No holidays set. Time off requests count every weekday.</Empty>}
        <div className="border-t border-line pt-4"><ActionForm action={addHolidayAction} submit="Add holiday" variant="secondary" inline><Field name="day" label="Date" type="date" required wrapperClass="w-full sm:w-44" /><Field name="name" label="Holiday" required maxLength={80} wrapperClass="w-full sm:w-56" /></ActionForm></div>
      </Section>
      {workflowKinds.map((kind) => {
        const tasks = templates.filter((task) => task.kind === kind);
        return <Section key={kind} title={`${statusLabels[kind]} checklist`}>
          <ol className="divide-y divide-line">{tasks.map((task, index) => <li key={task.id} className="flex min-h-12 items-center gap-4 text-sm"><span className="w-5 text-right text-muted tabular-nums">{index + 1}</span><span className="min-w-0 flex-1 wrap-anywhere">{task.title}</span>{tasks.length > 1 && <ActionButtons action={removeTemplateAction} hidden={{ id: task.id }} name="operation" buttons={[{ value: "remove", label: "Remove", describe: `Remove ${task.title}`, variant: "text", confirm: { title: "Remove this task?", body: "New checklists won’t include it. Open checklists keep it.", action: "Remove task", danger: true } }]} />}</li>)}</ol>
          <div className="border-t border-line pt-4"><ActionForm action={addTemplateAction} submit="Add task" variant="secondary" hidden={{ kind }} inline><Field name="title" label={`New ${kind} task`} required maxLength={180} wrapperClass="w-full sm:w-96" /></ActionForm></div>
        </Section>;
      })}
      <p className="text-[13px] text-muted">Checklist changes apply to new checklists. Open ones keep their tasks.</p>
    </div>
  </>;
}
