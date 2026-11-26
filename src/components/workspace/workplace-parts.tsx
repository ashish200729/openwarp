import Link from "next/link";
import type { ReactNode } from "react";
import { DownloadSimpleIcon } from "@/components/icons";
import { inputStyle, secondaryButton, tableBody, tableHead, textLink } from "@/components/ui";
import { cn } from "@/lib/utils";
import { Empty } from "./presentation";

export type Tone = "muted" | "positive" | "amber" | "danger" | "accent";
const tones: Record<Tone, string> = { muted: "text-muted", positive: "text-positive", amber: "text-amber", danger: "text-danger", accent: "text-accent" };

export function StatusText({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={cn("text-[13px] font-medium whitespace-nowrap", tones[tone])}>{children}</span>;
}

export function SubNav({ label, links, current }: { label: string; links: { href: string; label: string; count?: number }[]; current: string }) {
  return <nav aria-label={label} className="mb-7 flex gap-x-5 overflow-x-auto border-b border-line">
    {links.map((link) => <Link key={link.href} href={link.href} aria-current={link.href === current ? "page" : undefined} className={cn("-mb-px flex min-h-11 items-center gap-1.5 border-b-2 text-sm whitespace-nowrap focus-visible:outline-offset-[-2px]", link.href === current ? "border-foreground font-medium" : "border-transparent text-muted hover:text-foreground")}>{link.label}{link.count ? <span className="tabular-nums">{link.count}<span className="sr-only"> waiting</span></span> : null}</Link>)}
  </nav>;
}

type FilterField = { name: string; label: string; value: string; options?: { value: string; label: string }[]; type?: "search" | "date"; className?: string };

export function Filters({ action, fields, hidden = {}, clear, label }: { action: string; fields: FilterField[]; hidden?: Record<string, string>; clear?: string | false; label: string }) {
  return <form key={JSON.stringify([fields.map((field) => field.value), hidden])} method="get" action={action} role="search" aria-label={label} className="mb-5 flex flex-wrap items-end gap-3">
    {Object.entries(hidden).filter(([, value]) => value).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
    {fields.map((field) => {
      const id = `filter-${field.name}`;
      return <div key={field.name} className={cn("w-full min-w-0 sm:w-auto sm:grow sm:max-w-48", field.type === "search" && "sm:max-w-none sm:min-w-48 sm:flex-1", field.className)}>
        <label htmlFor={id} className="mb-2 block text-[13px] font-medium text-muted">{field.label}</label>
        {field.options ? <select id={id} name={field.name} defaultValue={field.value} className={inputStyle}>{field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
          : <input id={id} name={field.name} type={field.type} defaultValue={field.value} maxLength={field.type === "search" ? 120 : undefined} {...(field.type === "date" ? { min: "1900-01-01", max: "9999-12-31" } : {})} className={inputStyle} />}
      </div>;
    })}
    <button type="submit" className={secondaryButton}>Apply filters</button>
    {clear && <Link href={clear} className="inline-flex min-h-11 items-center rounded text-sm text-accent underline-offset-4 hover:underline">Clear filters</Link>}
  </form>;
}

export function Scroll({ label, children }: { label: string; children: ReactNode }) {
  return <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={label}>{children}</div>;
}

export function DataTable({ caption, columns, rows, numeric = [], empty = "Nothing to show." }: { caption: string; columns: string[]; rows: ReactNode[][]; numeric?: number[]; empty?: string }) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  return <Scroll label={caption}><table className="w-full">
    <caption className="sr-only">{caption}</caption>
    <thead className={tableHead}><tr>{columns.map((column, index) => <th key={column} scope="col" className={cn("whitespace-nowrap", numeric.includes(index) && "text-right")}>{column}</th>)}</tr></thead>
    <tbody className={tableBody}>{rows.map((row, position) => <tr key={position}>{row.map((cell, index) => index ? <td key={index} className={cn("align-top", numeric.includes(index) && "text-right tabular-nums")}>{cell}</td> : <th key={index} scope="row" className="min-w-40 align-top wrap-anywhere">{cell}</th>)}</tr>)}</tbody>
  </table></Scroll>;
}

export function ExportLink({ href, label }: { href: string; label: string }) {
  return <a href={href} aria-label={`Export CSV: ${label}`} className={`${textLink} inline-flex min-h-8 items-center gap-1.5 text-[13px]`}><DownloadSimpleIcon aria-hidden="true" size={14} />Export CSV</a>;
}

export function Details({ items }: { items: [string, ReactNode][] }) {
  return <dl className="grid gap-x-6 gap-y-4 py-3 sm:grid-cols-2 lg:grid-cols-3">{items.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-[13px] text-muted">{label}</dt><dd className="mt-0.5 text-sm wrap-anywhere">{value}</dd></div>)}</dl>;
}
