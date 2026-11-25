import { Activity, CircleDot, LayoutGrid, Network, UsersRound } from "lucide-react";

const people = [
  { initials: "AL", name: "Alex Lee", job: "Product designer", team: "Design", status: "Active", color: "text-accent bg-accent/12" },
  { initials: "SC", name: "Sam Carter", job: "Platform engineer", team: "Engineering", status: "Onboarding", color: "text-peach bg-peach/12" },
  { initials: "RN", name: "Riley Nguyen", job: "People operations", team: "Operations", status: "Active", color: "text-positive bg-positive/12" },
];
const navigation = [
  { label: "Overview", icon: LayoutGrid }, { label: "People", icon: UsersRound }, { label: "Teams", icon: Network },
  { label: "Lifecycle", icon: CircleDot }, { label: "Activity", icon: Activity },
];

export function DirectoryPreview() {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-panel">
      <div className="flex min-h-11 items-center justify-between gap-2 border-b border-line bg-background/60 px-4 sm:px-5">
        <span className="flex items-center gap-2 font-mono text-[11px] tracking-wide text-muted uppercase"><span className="pixel-fill size-2.5 [--pixel-size:6px] [--pixel:var(--accent)]" aria-hidden="true" /> Workspace preview</span>
        <span className="text-xs text-hint">Sample data</span>
      </div>
      <div className="grid min-w-0 md:grid-cols-[180px_minmax(0,1fr)]">
        <div className="hidden border-r border-line py-6 pl-4 pr-3 md:block" aria-hidden="true">
          <div className="px-3 pb-3 font-mono text-[10px] tracking-[0.16em] text-hint uppercase">Workspace</div>
          {navigation.map(({ label, icon: Icon }) => (
            <div key={label} className={`my-0.5 flex min-h-9 items-center gap-2.5 rounded-md px-3 text-sm ${label === "People" ? "bg-accent/10 text-accent" : "text-muted"}`}>
              <Icon size={15} /> {label}
            </div>
          ))}
        </div>
        <div className="min-w-0 p-4 sm:px-8 sm:py-7">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-2xl font-medium tracking-[-0.05em] sm:text-3xl">People directory</h2>
              <p className="mt-1.5 text-sm text-muted">A shared view of your workforce.</p>
            </div>
            <span className="font-mono text-xs text-muted">40 people</span>
          </div>
          <div className="mt-5 rounded-lg border border-line bg-background sm:mt-6">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-b border-line px-3.5 py-2.5 font-mono text-[10px] tracking-[0.12em] uppercase text-muted sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_110px] sm:px-4">
              <span>Employee</span><span className="hidden sm:block">Team</span><span>Status</span>
            </div>
            {people.map((person) => (
              <div key={person.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-line px-3.5 py-3 last:border-b-0 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_110px] sm:px-4">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span aria-hidden="true" className={`grid size-8 shrink-0 place-items-center rounded-md font-mono text-[10px] ${person.color}`}>{person.initials}</span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{person.name}</div>
                    <div className="text-xs text-muted">{person.job}</div>
                  </div>
                </div>
                <span className="hidden text-sm text-muted sm:block">{person.team}</span>
                <span className={`inline-flex items-center gap-1.5 text-xs ${person.status === "Active" ? "text-positive" : "text-peach"}`}><span aria-hidden="true" className="size-1.5 bg-current" />{person.status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
