import type { Metadata } from "next";
import { BackLink, PageHeader, Section } from "@/components/workspace/presentation";
import { DeviceImportForm } from "@/components/workspace/workplace-import";
import { DataTable } from "@/components/workspace/workplace-parts";
import { deviceConditions, deviceKinds } from "@/lib/domains/workplace";
import { currencies } from "@/lib/operations";
import { requireAdmin } from "@/lib/server/member";

export const metadata: Metadata = { title: "Import devices" };

export default async function ImportDevicesPage() {
  await requireAdmin();
  return <>
    <BackLink href="/workspace/devices">Devices</BackLink>
    <PageHeader title="Import devices" description="Add up to 1,000 devices from a CSV file. The whole file is checked before anything is saved. Imported devices start in stock." />
    <DeviceImportForm />
    <Section title="Columns" className="mt-10 max-w-3xl"><DataTable caption="Accepted columns" columns={["Column", "Needed", "Notes"]} rows={[
      ["asset_tag", "Required", "Must be unique."], ["type", "Required", deviceKinds.join(", ")], ["model", "Required", "Up to 120 characters."], ["make, serial, notes", "Optional", "Text."], ["purchase_date, warranty_end", "Optional", "YYYY-MM-DD"],
      ["cost", "Optional", "Such as 1250.00"], ["currency", "Optional", `${currencies.join(", ")}. Defaults to the company currency.`], ["condition", "Optional", `${deviceConditions.join(", ")}. Defaults to good.`],
    ]} /></Section>
  </>;
}
