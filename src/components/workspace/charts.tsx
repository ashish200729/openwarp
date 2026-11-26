// Single-series columns. The values sit in an adjacent table for anyone who can't read the picture.
export function HeadcountColumns({ data, label }: { data: { month: string; people: number }[]; label: string }) {
  const peak = Math.max(1, ...data.map((entry) => entry.people));
  const month = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" });
  const long = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" });
  const dense = data.length > 12;
  return <figure>
    <div aria-hidden="true" className={`flex h-36 items-end border-b border-line-strong ${dense ? "gap-[3px] overflow-hidden" : "gap-1.5"}`}>
      {data.map((entry, index) => <div key={entry.month} title={`${long.format(new Date(`${entry.month}T00:00:00Z`))}: ${entry.people}`} className="group flex h-full min-w-0 flex-1 flex-col justify-end text-center">
        <span className={`mb-1 text-xs tabular-nums ${index === data.length - 1 || index === 0 ? "text-foreground" : "text-muted opacity-0 group-hover:opacity-100"}`}>{entry.people}</span>
        <span className={`mx-auto w-full max-w-7 rounded-t-[3px] ${index === data.length - 1 ? "bg-signal" : "bg-signal/35 group-hover:bg-signal/60"}`} style={{ height: `${entry.people / peak * 82}%` }} />
      </div>)}
    </div>
    <div aria-hidden="true" className={`mt-1.5 flex overflow-hidden text-center text-xs text-muted ${dense ? "gap-[3px]" : "gap-1.5"}`}>{data.map((entry, index) => <span key={entry.month} className={`min-w-0 flex-1 ${dense ? index % 4 ? "invisible" : "whitespace-nowrap" : index % 2 ? "max-sm:invisible" : ""}`}>{month.format(new Date(`${entry.month}T00:00:00Z`))}</span>)}</div>
    <figcaption className="sr-only">{label} <span>{data.map((entry) => `${long.format(new Date(`${entry.month}T00:00:00Z`))}, ${entry.people}`).join("; ")}.</span></figcaption>
  </figure>;
}

export function Bars({ rows, total }: { rows: { label: string; value: number }[]; total: number }) {
  const peak = Math.max(1, ...rows.map((row) => row.value));
  return <ul className="grid gap-2.5 py-3">
    {rows.map((row) => <li key={row.label} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_5.5rem] items-center gap-3 text-sm">
      <span className="wrap-anywhere">{row.label}</span>
      <span aria-hidden="true" className="h-2 rounded-[3px] bg-signal/80" style={{ width: `${row.value / peak * 100}%` }} />
      <span className="text-right tabular-nums">{row.value} <span className="text-muted">({total ? Math.round(row.value / total * 100) : 0}%)</span></span>
    </li>)}
  </ul>;
}
