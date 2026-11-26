"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { MagnifyingGlassIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

const openEvent = "openwarp:search";

type Result = { key: string; label: string; detail: string; href: string };

const pages: (Result & { admin?: boolean; audience?: "employee" | "employeeOrAdmin" })[] = [
  { key: "home", label: "Home", detail: "Page", href: "/workspace" }, { key: "people", label: "People", detail: "Page", href: "/workspace/people" },
  { key: "add", label: "Add employee", detail: "Action", href: "/workspace/people/new", admin: true }, { key: "import", label: "Import employees", detail: "Action", href: "/workspace/people/import", admin: true },
  { key: "org", label: "Org chart", detail: "Page", href: "/workspace/org" }, { key: "teams", label: "Teams", detail: "Page", href: "/workspace/teams" },
  { key: "lifecycle", label: "Lifecycle", detail: "Page", href: "/workspace/lifecycle", admin: true }, { key: "request", audience: "employee", label: "Request time off", detail: "Action", href: "/workspace/time-off?new=1" },
  { key: "time-off", label: "Time off", detail: "Page", href: "/workspace/time-off" }, { key: "expense", audience: "employee", label: "Submit an expense", detail: "Action", href: "/workspace/expenses?new=1" },
  { key: "expenses", label: "Expenses", detail: "Page", href: "/workspace/expenses" }, { key: "pay-runs", label: "Pay runs", detail: "Page", href: "/workspace/pay-runs", admin: true },
  { key: "timesheets", label: "Timesheets", detail: "Page", href: "/workspace/timesheets" }, { key: "schedule", label: "Schedule", detail: "Page", href: "/workspace/schedule" },
  { key: "payslips", audience: "employee", label: "Payslips", detail: "Page", href: "/workspace/payslips" }, { key: "benefits", label: "Benefits", detail: "Page", href: "/workspace/benefits" },
  { key: "training", label: "Training", detail: "Page", href: "/workspace/training" }, { key: "devices", audience: "employeeOrAdmin", label: "Devices and apps", detail: "Page", href: "/workspace/devices" },
  { key: "compliance", label: "Compliance", detail: "Page", href: "/workspace/compliance", admin: true }, { key: "routines", label: "Routines", detail: "Page", href: "/workspace/routines", admin: true },
  { key: "announcements", label: "Announcements", detail: "Page", href: "/workspace/announcements" }, { key: "signatures", label: "Signatures", detail: "Page", href: "/workspace/documents/signatures" }, { key: "invoices", label: "Invoices", detail: "Page", href: "/workspace/invoices" }, { key: "notifications", label: "Notifications", detail: "Page", href: "/workspace/notifications" }, { key: "documents", label: "Documents", detail: "Page", href: "/workspace/documents" }, { key: "reports", label: "Reports", detail: "Page", href: "/workspace/reports", admin: true },
  { key: "activity", label: "Activity", detail: "Page", href: "/workspace/activity", admin: true }, { key: "settings", label: "Settings", detail: "Page", href: "/workspace/settings", admin: true },
  { key: "access", label: "Access", detail: "Settings", href: "/workspace/settings/access", admin: true }, { key: "account", label: "My account", detail: "Page", href: "/workspace/account" },
];

export function WorkspaceSearch({ canManage, linked }: { canManage: boolean; linked: boolean }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ query: string; results: Result[]; failed?: boolean }>({ query: "", results: [] });
  const [selected, setSelected] = useState(0);
  const term = query.trim().toLowerCase();
  const results = [
    ...(found.query === term ? found.results : []),
    ...pages.filter((page) => (canManage || !page.admin) && (!page.audience || linked || (page.audience === "employeeOrAdmin" && canManage)) && (!term || page.label.toLowerCase().includes(term))).slice(0, term ? 6 : 9),
  ];
  const current = Math.min(selected, results.length - 1);

  useEffect(() => {
    function open(event: globalThis.KeyboardEvent) {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      if (!dialog.current?.open) dialog.current?.showModal();
    }
    function show() { if (!dialog.current?.open) dialog.current?.showModal(); }
    document.addEventListener("keydown", open);
    document.addEventListener(openEvent, show);
    return () => {
      document.removeEventListener("keydown", open);
      document.removeEventListener(openEvent, show);
    };
  }, []);

  useEffect(() => {
    if (term.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/workspace/search?q=${encodeURIComponent(term)}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error();
        setFound({ query: term, results: await response.json() });
      } catch {
        if (!controller.signal.aborted) setFound({ query: term, results: [], failed: true });
      }
    }, 140);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [term]);

  function choose(result: Result | undefined) {
    if (!result) return;
    dialog.current?.close();
    router.push(result.href);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter") { event.preventDefault(); choose(results[current]); }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    if (results.length) setSelected((current + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length);
  }

  return (
    <dialog ref={dialog} aria-label="Search" onClose={() => { setQuery(""); setSelected(0); }} onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}
      className="mx-auto mt-[10dvh] mb-0 w-[min(36rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-line-strong bg-panel text-foreground shadow-float backdrop:bg-black/35">
      <div className="flex items-center gap-3 border-b border-line px-4">
        <MagnifyingGlassIcon aria-hidden="true" size={18} className="shrink-0 text-hint" />
        <input autoFocus role="combobox" aria-label="Search the workspace" aria-expanded="true" aria-controls={listId} aria-activedescendant={results[current] ? `${listId}-${current}` : undefined} autoComplete="off" spellCheck={false} maxLength={80}
          value={query} onChange={(event) => { setQuery(event.target.value); setSelected(0); }} onKeyDown={onKeyDown} placeholder="Find a person, team or page" className="min-h-13 w-full bg-transparent text-base outline-none placeholder:text-hint" />
      </div>
      <ul id={listId} role="listbox" aria-label="Results" className="max-h-[55dvh] overflow-y-auto p-1.5">
        {results.map((result, index) => <li key={`${result.key}-${result.href}`} id={`${listId}-${index}`} role="option" aria-selected={index === current} onPointerMove={() => setSelected(index)} onClick={() => choose(result)}
          className={cn("flex min-h-10 cursor-pointer items-center justify-between gap-4 rounded-[7px] px-3 py-1.5 text-sm", index === current && "bg-raised")}>
          <span className="min-w-0 font-medium wrap-anywhere">{result.label}</span><span className="shrink-0 text-[13px] text-muted">{result.detail}</span>
        </li>)}
      </ul>
      <p role="status" className={results.length ? "sr-only" : "px-4 pb-5 text-sm text-muted"}>{results.length ? `${results.length} results` : found.failed ? "Search is unavailable right now. Try again." : term.length < 2 ? "Type at least two characters." : found.query === term ? "Nothing matches that." : "Searching…"}</p>
    </dialog>
  );
}

// The sidebar and the mobile bar each have a button, and both open the one dialog.
export function SearchButton({ compact = false }: { compact?: boolean }) {
  return <button type="button" onClick={() => document.dispatchEvent(new Event(openEvent))} aria-label={compact ? "Open search" : undefined} className={compact
    ? "grid size-11 place-items-center rounded-[7px] text-muted hover:bg-raised hover:text-foreground"
    : "mb-4 flex h-9 w-full items-center gap-2 rounded-[7px] border border-line-strong bg-surface px-2.5 text-sm text-muted hover:border-control"}>
    <MagnifyingGlassIcon aria-hidden="true" size={17} />{!compact && <>Search<kbd aria-hidden="true" className="ml-auto font-sans text-xs text-hint">⌘K</kbd></>}
  </button>;
}
