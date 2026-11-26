import type { Metadata } from "next";
import Link from "next/link";
import { CaretDownIcon } from "@/components/icons";
import { ActionForm, Field } from "@/components/workspace/action-form";
import { EmptyState, PageHeader, Section } from "@/components/workspace/presentation";
import { StatusText } from "@/components/workspace/workplace-parts";
import { listJurisdictions } from "@/lib/server/compliance";
import { requireAdmin } from "@/lib/server/member";
import { mapJurisdictionAction } from "../actions";
import { complianceDescription, ComplianceNav } from "../nav";

export const metadata: Metadata = { title: "Jurisdictions" };

export default async function JurisdictionsPage() {
  await requireAdmin();
  const places = await listJurisdictions();
  const gaps = places.filter((place) => !place.obligations).length;
  return <>
    <PageHeader title="Jurisdictions" description={complianceDescription} />
    <ComplianceNav current="/jurisdictions" />
    {places.length ? <Section title="Where people work" action={gaps > 0 && <StatusText tone="amber">{gaps} with no obligation recorded</StatusText>}>
      <p className="pt-2 text-[13px] text-muted">Taken from employee locations. A location counts as its own jurisdiction until you say which one it belongs to. No obligation recorded means only that nothing is in the register. Check with an adviser about what applies.</p>
      <ul className="divide-y divide-line">{places.map((place) => <li key={place.location}><details className="group">
        <summary className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 rounded py-3 text-sm focus-visible:outline-offset-[-2px]"><span className="min-w-0"><span className="block font-medium wrap-anywhere">{place.location}</span><span className="block text-[13px] wrap-anywhere text-muted">{place.people} {place.people === 1 ? "person" : "people"}{place.mapped && `, jurisdiction ${place.jurisdiction}`}</span></span><span className="flex items-center gap-3"><StatusText tone={place.obligations ? "positive" : "amber"}>{place.obligations ? `${place.obligations} ${place.obligations === 1 ? "obligation" : "obligations"}` : "No obligation recorded"}</StatusText><CaretDownIcon aria-hidden="true" size={13} className="text-hint group-open:rotate-180" /></span></summary>
        <ActionForm key={place.jurisdiction} action={mapJurisdictionAction} submit="Save jurisdiction" variant="secondary" hidden={{ location: place.location }} inline className="pb-5"><Field name="jurisdiction" label="Jurisdiction" maxLength={100} defaultValue={place.mapped ? place.jurisdiction : ""} wrapperClass="w-full sm:w-64" hint="Leave empty to use the location itself." /></ActionForm>
      </details>{!place.obligations && <p className="pb-3 text-[13px]"><Link href="/workspace/compliance/register?new=1" className="inline-flex min-h-6 items-center text-accent underline underline-offset-3">Add an obligation<span className="sr-only"> for {place.jurisdiction}</span></Link></p>}</li>)}</ul>
    </Section> : <EmptyState title="No locations yet" description="Add work locations to employee profiles to see where people work." />}
  </>;
}
