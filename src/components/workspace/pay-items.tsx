import { tableBody } from "@/components/ui";
import type { ItemKind } from "@/lib/domains/pay";
import { formatMoney } from "@/lib/operations";
import type { PayItem } from "@/lib/server/pay";

const groupLabels: Record<ItemKind, string> = { earning: "Earnings", pre_tax: "Pre-tax deductions", tax: "Taxes", post_tax: "Post-tax deductions", non_taxed: "Untaxed payments", employer: "Employer contributions" };
export const itemKinds = Object.keys(groupLabels) as ItemKind[];

export function itemGroup(kind: ItemKind) {
  return groupLabels[kind];
}

// Every component of one line, grouped the way net pay is worked out.
export function PayItems({ items, name, currency, netCents }: { items: PayItem[]; name: string; currency: string; netCents: number }) {
  return <table className="w-full">
    <caption className="sr-only">Components of pay for {name}</caption>
    <thead className="sr-only"><tr><th scope="col">Component</th><th scope="col">Amount</th></tr></thead>
    {itemKinds.filter((kind) => items.some((item) => item.kind === kind)).map((kind) => <tbody key={kind} className={`${tableBody} [&_td]:py-1.5 [&_th]:py-1.5`}>
      <tr><th scope="rowgroup" colSpan={2} className="pt-3! text-[13px] text-muted">{itemGroup(kind)}</th></tr>
      {items.filter((item) => item.kind === kind).map((item, index) => <tr key={index}><th scope="row" className="wrap-anywhere">{item.label}{item.detail && <span className="block text-[13px] text-muted">{item.detail}</span>}</th><td className="text-right align-top tabular-nums">{formatMoney(item.amountCents, currency)}</td></tr>)}
    </tbody>)}
    <tfoot className={tableBody}><tr className="border-t border-line-strong"><th scope="row" className="font-semibold!">Net pay</th><td className="text-right font-semibold tabular-nums">{formatMoney(netCents, currency)}</td></tr></tfoot>
  </table>;
}
