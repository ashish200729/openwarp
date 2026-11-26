import { formatPercent, planKindLabels, tierLabels } from "@/lib/domains/pay";
import { formatMoney } from "@/lib/operations";
import type { Election, Plan, Rate } from "@/lib/server/benefits";

export function rateText(plan: Pick<Plan, "percent" | "employeeChooses">, rate: Rate, currency: string) {
  if (plan.percent) return `${plan.employeeChooses ? "you choose your percent" : `${formatPercent(rate.employeeBp)} of pay`}, employer adds ${formatPercent(rate.employerBp)}`;
  return `${plan.employeeChooses ? "you choose your amount" : `${formatMoney(rate.employeeCents, currency)} a month`}, employer pays ${formatMoney(rate.employerCents, currency)}`;
}

export function electionText(election: Election, currency: string) {
  const chosen = election.chosenBp !== null ? `, ${formatPercent(election.chosenBp)} of pay` : election.chosenCents !== null ? `, ${formatMoney(election.chosenCents, currency)} a month` : "";
  return election.planName ? `${planKindLabels[election.planKind]}: ${election.planName}, ${tierLabels[election.tier!].toLowerCase()}${chosen}` : `${planKindLabels[election.planKind]}: waived`;
}
