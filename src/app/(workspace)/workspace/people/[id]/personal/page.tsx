import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Meter, panelStyle, textButton, textLink } from "@/components/ui";
import { ActionButtons, ActionForm, Checkbox, Field } from "@/components/workspace/action-form";
import { Empty, Notice, Section } from "@/components/workspace/presentation";
import { ProfileHeader } from "@/components/workspace/profile-header";
import { Detail } from "@/components/workspace/record-fields";
import { RevealValue } from "@/components/workspace/record-reveal";
import { addressKeys, addressLabels, authorizationLabels, changeKinds, changeLabels, changePhrases, workAuthorizations, type ChangeKind, type WorkAuthorization } from "@/lib/domains/records";
import { formatDate, formatTime } from "@/lib/people";
import { customValues, editableFields, formatCustomValue, type CustomValue } from "@/lib/server/custom-fields";
import { onboardingSteps } from "@/lib/server/onboarding";
import { readPersonal, type ChangeRequest } from "@/lib/server/personal";
import { privateProfile } from "../profile";
import { cancelChangeAction, decideChangeAction, removeContactAction, revealAction, saveContactAction, saveCustomValuesAction, saveIdentityAction, savePersonalAction, submitChangeAction } from "./actions";

export const metadata: Metadata = { title: "Personal" };

const notices: Record<string, string> = { details: "Personal details saved.", contact: "Emergency contact saved.", identity: "Identity details saved.", requested: "Request sent. An administrator will decide.", fields: "Details saved." };
const sources = { self: "by the person", admin: "by an administrator", request: "through an approved request" };
const authorizationOptions = workAuthorizations.map((value) => ({ value, label: authorizationLabels[value] }));

function FormPanel({ title, children }: { title: string; children: ReactNode }) {
  return <section className={`${panelStyle} mb-8 max-w-2xl p-5`}><h2 className="mb-4 text-[15px] font-semibold">{title}</h2>{children}</section>;
}

function CustomInput({ field }: { field: CustomValue }) {
  const shared = { name: `field_${field.id}`, label: field.label, defaultValue: field.value, hint: field.requiredForOnboarding ? "Needed for onboarding." : undefined };
  if (field.kind === "long_text") return <Field {...shared} multiline maxLength={2_000} />;
  if (field.kind === "choice") return <Field {...shared} options={[{ value: "", label: "No answer" }, ...field.options.map((value) => ({ value, label: value }))]} />;
  if (field.kind === "boolean") return <Field {...shared} options={[{ value: "", label: "No answer" }, { value: "yes", label: "Yes" }, { value: "no", label: "No" }]} />;
  return <Field {...shared} type={field.kind === "date" ? "date" : "text"} inputMode={field.kind === "number" ? "decimal" : undefined} maxLength={field.kind === "text" ? 200 : undefined} />;
}

function proposedValue(request: ChangeRequest) {
  if (request.kind !== "work_authorization" || !request.proposed) return request.proposed;
  return `${authorizationLabels[request.proposed as WorkAuthorization]}${request.proposedExpiry ? `, expires ${formatDate(request.proposedExpiry)}` : ""}`;
}

export default async function PersonalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string; contact?: string; change?: string; saved?: string }> }) {
  const { member, employee, canManage } = await privateProfile(params);
  const query = await searchParams;
  const [personal, fields, onboarding] = await Promise.all([readPersonal(member, employee.id), customValues(member, employee.id), employee.status === "onboarding" ? onboardingSteps(member, employee.id) : null]);
  if (!personal) notFound();
  const base = `/workspace/people/${employee.id}/personal`;
  const editable = employee.status !== "archived";
  const own = member.employeeId === employee.id;
  const mayRequest = editable && own && !canManage;
  const editing = editable ? query.edit : undefined;
  const contact = personal.contacts.find((entry) => entry.id === query.contact);
  const change: ChangeKind | undefined = mayRequest ? changeKinds.find((kind) => kind === query.change) : undefined;
  const answerable = editableFields(member, fields);
  const pending = personal.requests.filter((request) => request.state === "pending");
  const decided = personal.requests.filter((request) => request.state !== "pending");
  const close = <Link href={base} className={textButton}>Close</Link>;
  const edit = (what: string, label: string) => editable && <Link href={`${base}?edit=${what}`} className={`${textLink} text-[13px]`}>{label}</Link>;
  const ask = (kind: ChangeKind) => mayRequest && !pending.some((request) => request.kind === kind) && <Link href={`${base}?change=${kind}`} className={`${textLink} text-[13px]`}>Request a change<span className="sr-only"> to {changePhrases[kind]}</span></Link>;
  const current: Record<ChangeKind, ReactNode> = {
    legal_name: `${employee.firstName} ${employee.lastName}`, national_id: personal.maskedId || "Not added",
    work_authorization: personal.workAuthorization ? `${authorizationLabels[personal.workAuthorization]}${personal.workAuthorizationExpiresOn ? `, expires ${formatDate(personal.workAuthorizationExpiresOn)}` : ""}` : "Not added",
  };
  return <>
    <ProfileHeader employee={employee} current="personal" canSeePrivate />
    {typeof query.saved === "string" && Object.hasOwn(notices, query.saved) && <Notice>{notices[query.saved]}</Notice>}
    {editing === "details" && <FormPanel title="Edit personal details"><ActionForm action={savePersonalAction} submit="Save details" secondary={close} hidden={{ employeeId: employee.id, version: personal.version }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="preferredName" label="Preferred name" maxLength={80} defaultValue={personal.preferredName} /><Field name="pronouns" label="Pronouns" maxLength={40} defaultValue={personal.pronouns} />
        <Field name="personalEmail" label="Personal email" type="email" maxLength={254} defaultValue={personal.personalEmail} /><Field name="phone" label="Phone" type="tel" maxLength={30} defaultValue={personal.phone} />
        <Field name="dateOfBirth" label="Date of birth" type="date" defaultValue={personal.dateOfBirth} />
      </div>
      <fieldset><legend className="mb-3 text-sm font-semibold">Home address</legend><div className="grid gap-4 sm:grid-cols-2">{addressKeys.map((key) => <Field key={key} name={key} label={addressLabels[key]} maxLength={key === "postalCode" ? 20 : 120} defaultValue={personal.address[key] ?? ""} />)}</div></fieldset>
    </ActionForm></FormPanel>}
    {editing === "contact" && <FormPanel title={contact ? "Edit emergency contact" : "Add an emergency contact"}><ActionForm key={contact?.id ?? "new"} action={saveContactAction} submit="Save contact" secondary={close} hidden={{ employeeId: employee.id, id: contact?.id ?? "" }}>
      <div className="grid gap-4 sm:grid-cols-2"><Field name="name" label="Full name" required maxLength={120} defaultValue={contact?.name} /><Field name="relationship" label="Relationship" required maxLength={60} defaultValue={contact?.relationship} /><Field name="phone" label="Phone" type="tel" required maxLength={30} defaultValue={contact?.phone} /><Field name="email" label="Email" type="email" maxLength={254} defaultValue={contact?.email} /></div>
    </ActionForm></FormPanel>}
    {editing === "identity" && canManage && <FormPanel title="Edit identity and work authorization"><ActionForm action={saveIdentityAction} submit="Save identity" secondary={close} hidden={{ employeeId: employee.id, version: personal.version }}>
      <Field name="nationalId" label="National or tax ID" maxLength={40} autoComplete="off" hint={personal.maskedId ? "Leave empty to keep the one on record." : "Stored encrypted."} />
      {personal.maskedId && <Checkbox name="removeNationalId" label="Remove the ID on record" />}
      <div className="grid gap-4 sm:grid-cols-2"><Field name="workAuthorization" label="Work authorization" required defaultValue={personal.workAuthorization ?? ""} options={[{ value: "", label: "Not recorded" }, ...authorizationOptions]} /><Field name="expiresOn" label="Expires on" type="date" defaultValue={personal.workAuthorizationExpiresOn ?? ""} /></div>
    </ActionForm></FormPanel>}
    {editing === "fields" && answerable.length > 0 && <FormPanel title="Edit other details"><ActionForm action={saveCustomValuesAction} submit="Save details" secondary={close} hidden={{ employeeId: employee.id }}>{answerable.map((field) => <CustomInput key={field.id} field={field} />)}</ActionForm></FormPanel>}
    {change && <FormPanel title={`Request a change: ${changePhrases[change]}`}><ActionForm action={submitChangeAction} submit="Send request" pending="Sending…" secondary={close} hidden={{ employeeId: employee.id, kind: change }}>
      {change === "legal_name" && <div className="grid gap-4 sm:grid-cols-2"><Field name="firstName" label="First name" required maxLength={80} defaultValue={employee.firstName} /><Field name="lastName" label="Last name" required maxLength={80} defaultValue={employee.lastName} /></div>}
      {change === "national_id" && <Field name="nationalId" label="National or tax ID" required maxLength={40} autoComplete="off" hint="Stored encrypted. Only you and administrators can see part of it." />}
      {change === "work_authorization" && <div className="grid gap-4 sm:grid-cols-2"><Field name="workAuthorization" label="Work authorization" required defaultValue={personal.workAuthorization ?? undefined} options={authorizationOptions} /><Field name="expiresOn" label="Expires on" type="date" defaultValue={personal.workAuthorizationExpiresOn ?? ""} /></div>}
      <p className="text-[13px] text-muted">An administrator checks this before your record changes.</p>
    </ActionForm></FormPanel>}

    {canManage && pending.length > 0 && <Section title="Requested changes" className="mb-9"><ul className="divide-y divide-line">{pending.map((request) => <li key={request.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-3 text-sm">
      <div className="min-w-0"><p className="font-medium">{changeLabels[request.kind]}</p><dl className="mt-0.5 grid gap-0.5 text-[13px]"><div><dt className="inline text-muted">Now: </dt><dd className="inline wrap-anywhere">{current[request.kind]}</dd></div><div className="flex flex-wrap items-center gap-x-1"><dt className="text-muted">Requested: </dt><dd className="wrap-anywhere">{request.kind === "national_id" ? <RevealValue action={revealAction} hidden={{ employeeId: employee.id, requestId: request.id }} masked={request.proposed ?? ""} label="Show the requested national ID" /> : proposedValue(request)}</dd></div></dl><p className="text-[13px] text-muted">By {request.requestedBy}, {formatDate(request.createdAt)}</p></div>
      <ActionButtons action={decideChangeAction} hidden={{ id: request.id, version: request.kind === "legal_name" ? employee.version : personal.version }} name="decision" buttons={[{ value: "approved", label: "Approve", describe: `Approve the ${changePhrases[request.kind]} change`, variant: "primary" }, { value: "declined", label: "Decline", describe: `Decline the ${changePhrases[request.kind]} change` }]} />
    </li>)}</ul></Section>}

    <div className="grid gap-x-12 gap-y-9 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div className="grid content-start gap-9">
        <Section title="Personal details" action={edit("details", "Edit details")}><dl className="grid gap-x-5 gap-y-4 pt-3 sm:grid-cols-2">
          <Detail label="Preferred name">{personal.preferredName}</Detail><Detail label="Pronouns">{personal.pronouns}</Detail><Detail label="Personal email">{personal.personalEmail}</Detail><Detail label="Phone">{personal.phone}</Detail>
          <Detail label="Date of birth">{personal.dateOfBirth && formatDate(personal.dateOfBirth)}</Detail>
          <Detail label="Home address">{addressKeys.flatMap((key) => personal.address[key] ?? []).join("\n")}</Detail>
        </dl></Section>
        <Section title="Emergency contacts" action={personal.contacts.length < 5 && edit("contact", "Add contact")}>{personal.contacts.length ? <ul className="divide-y divide-line">{personal.contacts.map((entry) => <li key={entry.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3 text-sm">
          <div className="min-w-0"><p className="font-medium wrap-anywhere">{entry.name} <span className="font-normal text-muted">· {entry.relationship}</span></p><p className="text-muted wrap-anywhere"><a href={`tel:${entry.phone.replaceAll(/[^+\d]/g, "")}`} className={textLink}>{entry.phone}</a>{entry.email && `, ${entry.email}`}</p></div>
          {editable && <div className="flex items-center gap-1.5"><Link href={`${base}?edit=contact&contact=${entry.id}`} className={`${textButton} min-h-10! text-[13px] pointer-fine:min-h-8!`}>Edit<span className="sr-only"> {entry.name}</span></Link><ActionButtons action={removeContactAction} hidden={{ employeeId: employee.id, id: entry.id }} name="operation" buttons={[{ value: "remove", label: "Remove", describe: `Remove ${entry.name}`, variant: "text", confirm: { title: `Remove ${entry.name}?`, body: "They won’t be listed as an emergency contact any more.", action: "Remove contact", danger: true } }]} /></div>}
        </li>)}</ul> : <Empty>No emergency contacts yet.</Empty>}</Section>
        {fields.length > 0 && <Section title="Other details" action={answerable.length > 0 && edit("fields", "Edit other details")}><dl className="grid gap-x-5 gap-y-4 pt-3 sm:grid-cols-2">{fields.map((field) => <Detail key={field.id} label={field.visibility === "admin" ? `${field.label} (administrators only)` : field.label}>{formatCustomValue(field)}</Detail>)}</dl></Section>}
      </div>
      <div className="grid content-start gap-9">
        {onboarding && <Section title="Onboarding" action={<Link href={own ? "/workspace/onboarding" : `/workspace/onboarding?employee=${employee.id}`} className={`${textLink} text-[13px]`}>Open the steps</Link>}><p className="pt-3 pb-2 text-sm">{onboarding.done} of {onboarding.steps.length} steps done</p><Meter value={onboarding.done / onboarding.steps.length * 100} label="Onboarding steps completed" /></Section>}
        <Section title="Identity and work authorization" action={canManage && edit("identity", "Edit identity")}><dl className="grid gap-4 pt-3">
          <div><dt className="text-[13px] text-muted">Legal name</dt><dd className="mt-0.5 text-sm wrap-anywhere">{current.legal_name}</dd><dd>{ask("legal_name")}</dd></div>
          <div><dt className="text-[13px] text-muted">National or tax ID</dt><dd className="mt-0.5 text-sm">{personal.maskedId ? canManage ? <RevealValue action={revealAction} hidden={{ employeeId: employee.id, requestId: "" }} masked={personal.maskedId} label="Show the national ID" /> : personal.maskedId : <span className="text-muted">Not added</span>}</dd><dd>{ask("national_id")}</dd></div>
          <div><dt className="text-[13px] text-muted">Work authorization</dt><dd className="mt-0.5 text-sm">{current.work_authorization}</dd><dd>{ask("work_authorization")}</dd></div>
        </dl></Section>
        {!canManage && pending.length > 0 && <Section title="Waiting for approval"><ul className="divide-y divide-line">{pending.map((request) => <li key={request.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3 text-sm"><div className="min-w-0"><p className="font-medium">{changeLabels[request.kind]}</p><p className="text-[13px] wrap-anywhere text-muted">{proposedValue(request)}, sent {formatDate(request.createdAt)}</p></div><ActionButtons action={cancelChangeAction} hidden={{ id: request.id }} name="operation" buttons={[{ value: "cancel", label: "Cancel", describe: `Cancel the ${changePhrases[request.kind]} request`, variant: "text", confirm: { title: "Cancel this request?", body: "Your record stays as it is.", action: "Cancel request", danger: true } }]} /></li>)}</ul></Section>}
        {decided.length > 0 && <Section title="Earlier requests"><ul className="divide-y divide-line">{decided.map((request) => <li key={request.id} className="flex flex-wrap justify-between gap-x-6 gap-y-1 py-2 text-sm"><span>{changeLabels[request.kind]}</span><span className={request.state === "approved" ? "text-positive" : request.state === "declined" ? "text-danger" : "text-muted"}>{request.state === "approved" ? "Approved" : request.state === "declined" ? "Declined" : "Cancelled"}{request.decidedAt && ` ${formatDate(request.decidedAt)}`}</span></li>)}</ul></Section>}
        <Section title="Change history">{personal.history.length ? <ol className="divide-y divide-line">{personal.history.map((entry) => <li key={entry.id} className="py-2 text-sm"><p className="wrap-anywhere">{entry.field}</p><p className="text-[13px] text-muted">{entry.by}, {sources[entry.source]}, <time dateTime={entry.at.toISOString()}>{formatTime(entry.at)} UTC</time></p></li>)}</ol> : <Empty>No changes recorded yet.</Empty>}</Section>
      </div>
    </div>
  </>;
}
