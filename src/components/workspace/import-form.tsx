"use client";

import { useActionState, useState } from "react";
import { importAction, type ImportState } from "@/app/(workspace)/workspace/operations";
import { tableBody, tableHead } from "@/components/ui";
import { CsvInput } from "./csv-input";
import { FormError } from "./action-state";
import { SubmitButton } from "./buttons";

export function ImportForm() {
  const [state, run, pending] = useActionState<ImportState, FormData>(importAction, {});
  const [file, setFile] = useState<string>();
  const [checked, setChecked] = useState<string>();
  const plan = checked === file ? state.plan : undefined;
  const ready = plan && plan.problems.length === 0;

  return <form action={(data) => { setChecked(file); run(data); }} aria-busy={pending} className="grid max-w-2xl gap-5">
    <input type="hidden" name="csv" value={file ?? ""} />
    <CsvInput onFile={setFile} />
    <FormError error={state.error} />
    {plan && <div role="status" className="text-sm">{ready
      ? <p><span className="font-semibold">{plan.people} {plan.people === 1 ? "person is" : "people are"} ready to import.</span>{plan.newTeams.length > 0 && ` New teams: ${plan.newTeams.join(", ")}.`}</p>
      : <><p className="mb-3 font-semibold text-danger">Fix these rows, then choose the file again. Nothing was imported.</p>
        <table className="w-full"><caption className="sr-only">Problems in the file</caption><thead className={tableHead}><tr><th scope="col" className="w-20">Row</th><th scope="col">Problem</th></tr></thead><tbody className={tableBody}>{plan.problems.map((problem, index) => <tr key={index}><td className="align-top tabular-nums">{problem.row || "File"}</td><td className="wrap-anywhere">{problem.message}</td></tr>)}</tbody></table></>}</div>}
    <div className="flex flex-wrap gap-2">
      <SubmitButton name="operation" value="check" disabled={!file} variant={ready ? "secondary" : "primary"} pending="Checking…">Check file</SubmitButton>
      {ready && <SubmitButton name="operation" value="import" pending="Importing…">Import {plan.people} {plan.people === 1 ? "person" : "people"}</SubmitButton>}
    </div>
  </form>;
}
