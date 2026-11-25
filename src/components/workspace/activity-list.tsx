import Link from "next/link";
import { formatTime } from "@/lib/people";
import { activityLabels, type Activity } from "@/lib/server/directory";
import { panelStyle } from "@/components/ui";

export function ActivityList({ entries, includeSubject = true }: { entries: Activity[]; includeSubject?: boolean }) {
  return <ol className={`${panelStyle} divide-y divide-line`}>
    {entries.map((entry) => <li key={entry.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 px-4 py-3.5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:px-5">
      <span aria-hidden="true" className="pixel-fill mt-1.5 size-2.5 [--pixel-size:5px] [--pixel:var(--accent)]" />
      <div className="min-w-0">
        <p className="text-sm font-medium wrap-anywhere">{activityLabels[entry.event]}{includeSubject && entry.subject && <>
          <span className="mx-2 text-hint">/</span>
          {entry.employeeId ? <Link className="text-accent hover:underline" href={`/workspace/people/${entry.employeeId}`}>{entry.subject}</Link> : <span className="text-muted">{entry.subject}</span>}
        </>}</p>
        <p className="mt-1 text-xs wrap-anywhere text-muted">{entry.actor ?? "Workspace operator"}{entry.detail && ` · ${entry.detail}`}</p>
      </div>
      <time className="col-start-2 font-mono text-[11px] text-hint sm:col-start-3" dateTime={entry.at.toISOString()}>{formatTime(entry.at)} UTC</time>
    </li>)}
  </ol>;
}
