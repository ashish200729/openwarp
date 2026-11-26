import { SubNav } from "@/components/workspace/workplace-parts";

export function ComplianceNav({ current }: { current: "" | "/register" | "/notices" | "/jurisdictions" }) {
  const base = "/workspace/compliance";
  return <SubNav label="Compliance" current={`${base}${current}`} links={[{ href: base, label: "Calendar" }, { href: `${base}/register`, label: "Register" }, { href: `${base}/notices`, label: "Notices" }, { href: `${base}/jurisdictions`, label: "Jurisdictions" }]} />;
}

export const complianceDescription = "Keep track of filings, registrations and notices. OpenWarp reminds you. It doesn’t file anything or watch for new rules.";
