"use client";

import { useId, useState } from "react";
import { FormError } from "./action-state";

export function CsvInput({ onFile }: { onFile: (text?: string) => void }) {
  const id = useId();
  const [error, setError] = useState("");
  return <div>
    <label htmlFor={id} className="mb-1.5 block text-sm font-medium">CSV file</label>
    <input id={id} type="file" accept=".csv,text/csv" className="block w-full rounded-[7px] border border-control bg-surface p-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-raised file:px-2.5 file:py-1 file:text-foreground" onChange={async (event) => {
      const input = event.currentTarget;
      const selected = input.files?.[0];
      onFile();
      setError("");
      if (!selected) return;
      if (selected.size > 1_000_000) {
        setError("Choose a file of 1 MB or less.");
        return;
      }
      try {
        const text = await selected.text();
        if (input.files?.[0] === selected) onFile(text);
      } catch {
        if (input.files?.[0] === selected) setError("This file could not be read. Choose it again.");
      }
    }} />
    <FormError error={error} />
  </div>;
}
