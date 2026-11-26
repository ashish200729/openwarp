"use client";

import { useEffect, useState } from "react";
import { ActionButtons, type FormAction } from "@/components/workspace/action-form";

type Running = { startedAt: string; breakStartedAt: string | null; breakMinutes: number; now: string };

const pad = (value: number) => String(value).padStart(2, "0");

function Elapsed({ running }: { running: Running }) {
  const [elapsed, setElapsed] = useState(0);
  // Counts from the server's clock, so a device with the wrong time still shows the right total.
  useEffect(() => {
    const begun = performance.now();
    const timer = setInterval(() => setElapsed(performance.now() - begun), 1000);
    return () => clearInterval(timer);
  }, [running.now]);
  const until = running.breakStartedAt ? Date.parse(running.breakStartedAt) : Date.parse(running.now) + elapsed;
  const seconds = Math.max(0, Math.floor((until - Date.parse(running.startedAt)) / 1000) - running.breakMinutes * 60);
  return <p role="timer" aria-label="Time worked" className="text-2xl leading-tight font-semibold tracking-[-0.02em] tabular-nums">{Math.floor(seconds / 3600)}:{pad(Math.floor(seconds / 60) % 60)}:{pad(seconds % 60)}</p>;
}

export function TimeClock({ running, since, action }: { running: Running | null; since: string; action: FormAction }) {
  const button = (value: string, label: string, variant: "primary" | "secondary" = "secondary") => ({ value, label, describe: label, variant });
  return <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-4">
    <div>
      {running ? <><Elapsed key={running.now} running={running} /><p className="text-[13px] text-muted">{since}</p></> : <p className="text-sm text-muted">You aren’t clocked in.</p>}
    </div>
    <ActionButtons action={action} hidden={{}} name="operation" buttons={!running ? [button("clock_in", "Clock in", "primary")] : [running.breakStartedAt ? button("break_end", "End break") : button("break_start", "Start break"), button("clock_out", "Clock out", "primary")]} />
  </div>;
}
