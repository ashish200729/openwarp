import Link from "next/link";
import { formatTime } from "@/lib/people";
import { Avatar } from "./presentation";
import { activityLabels, type Activity } from "@/lib/server/directory";

export function ActivityList({ entries, includeSubject = true }: { entries: Activity[]; includeSubject?: boolean }) {
  return <ol className="divide-y divide-line border-t border-line">
    {entries.map((entry) => <li key={entry.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
      <Avatar name={entry.actor ?? "Workspace operator"} size="small" />
      <div className="min-w-0">
        <p className="text-sm font-medium wrap-anywhere">{activityLabels[entry.event]}{includeSubject && entry.subject && <>
          <span className="mx-2 text-hint">·</span>
          {entry.employeeId ? <Link className="text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-current" href={`/workspace/people/${entry.employeeId}`}>{entry.subject}</Link> : <span className="text-muted">{entry.subject}</span>}
        </>}</p>
        <p className="mt-0.5 text-[13px] wrap-anywhere text-muted">{entry.actor ?? "Workspace operator"}{entry.detail && ` · ${entry.detail}`}</p>
      </div>
      <time className="col-start-2 text-[13px] text-muted tabular-nums sm:col-start-3" dateTime={entry.at.toISOString()}>{formatTime(entry.at)} UTC</time>
    </li>)}
  </ol>;
}
