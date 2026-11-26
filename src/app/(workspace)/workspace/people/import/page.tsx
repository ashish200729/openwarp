import type { Metadata } from "next";
import { tableBody, tableHead } from "@/components/ui";
import { ImportForm } from "@/components/workspace/import-form";
import { BackLink, PageHeader, Section } from "@/components/workspace/presentation";
import { employmentTypes } from "@/lib/people";
import { requireAdmin } from "@/lib/server/member";

export const metadata: Metadata = { title: "Import employees" };

const columns = [
  ["first_name, last_name, email, title", "Required", "Emails must be unique."], ["start_date", "Required", "YYYY-MM-DD"], ["team", "Optional", "Missing ones are created."],
  ["manager_email", "Optional", "Someone active in the directory, or another row in the file."], ["employment_type", "Optional", `${employmentTypes.join(", ")}. Defaults to full_time.`],
  ["location", "Optional", "Up to 100 characters."], ["status", "Optional", "active or onboarding. Defaults to active."],
];

export default async function ImportPage() {
  await requireAdmin();
  return <>
    <BackLink href="/workspace/people">People directory</BackLink>
    <PageHeader title="Import employees" description="Add up to 500 people from a CSV file. The whole file is checked before anything is saved." />
    <ImportForm />
    <Section title="Columns" className="mt-10 max-w-3xl"><table className="w-full"><caption className="sr-only">Accepted columns</caption><thead className={tableHead}><tr><th scope="col">Column</th><th scope="col">Needed</th><th scope="col">Notes</th></tr></thead><tbody className={tableBody}>{columns.map(([name, needed, notes]) => <tr key={name}><th scope="row" className="align-top font-mono text-[13px] wrap-anywhere">{name}</th><td className="align-top text-muted">{needed}</td><td className="align-top text-muted wrap-anywhere">{notes}</td></tr>)}</tbody></table></Section>
  </>;
}
