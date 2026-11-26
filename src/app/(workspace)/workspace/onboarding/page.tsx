import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CaretRightIcon, CheckCircleIcon, CircleIcon } from "@/components/icons";
import { Meter, secondaryButton } from "@/components/ui";
import { BackLink, Callout, EmptyState, PageHeader } from "@/components/workspace/presentation";
import { formatDate } from "@/lib/people";
import { requireMember } from "@/lib/server/member";
import { onboardingSteps } from "@/lib/server/onboarding";

export const metadata: Metadata = { title: "Onboarding" };

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ employee?: string }> }) {
  const member = await requireMember();
  const { employee } = await searchParams;
  const preview = member.role === "admin" && employee !== undefined && employee !== member.employeeId;
  if (employee !== undefined && (!z.uuid().safeParse(employee).success || member.role !== "admin" && employee !== member.employeeId)) notFound();
  const id = employee ?? member.employeeId;
  if (!id) return <EmptyState level={1} title="No onboarding to show" description="Your account isn’t linked to an employee record. Ask an administrator to link it." />;
  const onboarding = await onboardingSteps(member, id);
  if (!onboarding) notFound();
  const { person, steps, done } = onboarding;
  if (person.status !== "onboarding") return <EmptyState level={1} title="Onboarding is finished" description={preview ? `${person.name} isn’t being onboarded at the moment.` : "Everything you need is in the menu and on your profile."} action={<Link href={preview ? `/workspace/people/${id}` : "/workspace"} className={secondaryButton}>{preview ? "Open profile" : "Go to home"}</Link>} />;
  return <div className="max-w-3xl">
    {preview && <BackLink href={`/workspace/people/${id}/personal`}>{person.name}</BackLink>}
    <PageHeader title={preview ? `Onboarding for ${person.name}` : "Get set up"} description={`${preview ? "Starts" : "You start"} on ${formatDate(person.hireDate)}. Steps complete on their own as the details are added.`} />
    {preview && <Callout>You’re looking at {person.name}’s steps. Each link opens their record.</Callout>}
    <p className="mb-2 text-sm font-medium tabular-nums">{done} of {steps.length} steps done</p>
    <Meter value={done / steps.length * 100} label="Onboarding steps completed" />
    <ol className="mt-6 divide-y divide-line border-y border-line">{steps.map((step) => <li key={step.key}><Link href={step.href} className="group flex min-h-16 items-center gap-3.5 py-3 text-sm focus-visible:outline-offset-[-2px]">
      {step.done ? <CheckCircleIcon aria-hidden="true" size={20} weight="fill" className="shrink-0 text-positive" /> : <CircleIcon aria-hidden="true" size={20} className="shrink-0 text-hint" />}
      <span className="min-w-0 flex-1"><span className="block font-medium group-hover:underline">{step.title}</span><span className="block text-[13px] wrap-anywhere text-muted">{step.detail}</span></span>
      <span className={`shrink-0 text-[13px] ${step.done ? "text-positive" : "text-muted"}`}>{step.done ? "Done" : "To do"}</span><CaretRightIcon aria-hidden="true" size={13} className="shrink-0 text-hint" />
    </Link></li>)}</ol>
    {done === steps.length && <p className="mt-5 text-sm">{preview ? "Every step is done." : "You’ve finished every step. Your administrator takes it from here."}</p>}
  </div>;
}
