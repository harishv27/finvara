import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileUp } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { guessDateOrder, guessMapping, normalise, parseCsv, type DateOrder, type Mapping } from "../lib/csv";
import { money } from "../lib/format";
import { Badge, Button, Callout, Field, Modal, Select, Td, Th, useToast } from "./ui";

/** Bring in a bank/credit-card CSV: pick the file, confirm the column mapping, preview, import. Dupes are skipped server-side. */
export function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast, error } = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [table, setTable] = useState<string[][]>([]);
  const [map, setMap] = useState<Mapping>({ date: -1, amount: -1, note: -1, category: -1, type: -1 });
  const [order, setOrder] = useState<DateOrder>("ymd");
  const [negExpense, setNegExpense] = useState(true);
  const [err, setErr] = useState<string>();
  const [result, setResult] = useState<any>(null);

  const reset = () => { setName(""); setTable([]); setErr(undefined); setResult(null); if (file.current) file.current.value = ""; };
  const headers = table[0] ?? [];
  const body = table.slice(1);
  const parsed = useMemo(() => (body.length && map.date >= 0 && map.amount >= 0 ? normalise(body, map, { order, negativeIsExpense: negExpense }) : null), [body, map, order, negExpense]);

  const onFile = async (f?: File) => {
    if (!f) return;
    setErr(undefined); setResult(null);
    if (f.size > 2_000_000) return setErr("That file is over 2 MB — export a shorter date range.");
    const rows = parseCsv(await f.text());
    if (rows.length < 2) return setErr("We couldn't find any rows. Check that the first line is a header.");
    setName(f.name); setTable(rows);
    const g = guessMapping(rows[0]);
    setMap(g);
    setOrder(g.date >= 0 ? guessDateOrder(rows.slice(1, 40).map((r) => r[g.date] ?? "")) : "ymd");
  };

  const run = useMutation({
    mutationFn: async () => {
      let imported = 0, skipped = 0, errorCount = 0;
      const created = new Set<string>();
      for (let i = 0; i < parsed!.good.length; i += 1000) {
        const r = await api.post<any>("/budget/transactions/import", { rows: parsed!.good.slice(i, i + 1000) });
        imported += r.imported; skipped += r.skipped; errorCount += r.errorCount; r.createdCategories.forEach((c: string) => created.add(c));
      }
      return { imported, skipped, errorCount, created: [...created] };
    },
    onSuccess: (r) => { setResult(r); qc.invalidateQueries({ queryKey: ["budget"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); toast(`Imported ${r.imported} transaction${r.imported === 1 ? "" : "s"}`); },
    onError: error,
  });

  const col = (key: keyof Mapping, label: string, required = false) => (
    <Field label={`${label}${required ? " *" : ""}`} key={key}>
      <Select value={map[key]} onChange={(e) => setMap({ ...map, [key]: Number(e.target.value) })}>
        <option value={-1}>{required ? "Choose a column…" : "— none —"}</option>
        {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
      </Select>
    </Field>
  );

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} wide title="Import transactions from CSV"
      footer={result ? <Button onClick={() => { reset(); onClose(); }}>Done</Button> : <><Button variant="secondary" onClick={() => { reset(); onClose(); }}>Cancel</Button><Button loading={run.isPending} disabled={!parsed || parsed.good.length === 0} onClick={() => run.mutate()}>Import {parsed ? parsed.good.length : ""} transactions</Button></>}>
      {result ? (
        <div className="space-y-3">
          <Callout tone="good" title={`Imported ${result.imported} transaction${result.imported === 1 ? "" : "s"}`}>{result.skipped > 0 && `${result.skipped} duplicate${result.skipped === 1 ? " was" : "s were"} skipped. `}{result.created.length > 0 && `New categories created: ${result.created.join(", ")} — set their type and budget under Categories.`}</Callout>
          {result.errorCount > 0 && <Callout tone="warn" title={`${result.errorCount} row${result.errorCount === 1 ? "" : "s"} couldn't be imported`} />}
        </div>
      ) : (
        <div className="space-y-5">
          <div className="rounded-xl border-2 border-dashed border-line p-5 text-center">
            <FileUp className="mx-auto size-8 text-muted" aria-hidden />
            <p className="mt-2 text-sm"><b>{name || "Choose a CSV file"}</b></p>
            <p className="mt-0.5 text-xs text-muted">Export from your bank or card. Needs a header row with at least a date and an amount column. Nothing leaves your account.</p>
            <input ref={file} type="file" accept=".csv,text/csv" className="sr-only" id="csv-file" onChange={(e) => void onFile(e.target.files?.[0])} />
            <label htmlFor="csv-file" className="mt-3 inline-flex cursor-pointer items-center rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-medium hover:bg-surface2">{name ? "Choose a different file" : "Browse files"}</label>
          </div>
          {err && <Callout tone="danger" title={err} />}
          {headers.length > 0 && (
            <>
              <div><h3 className="mb-2 text-sm font-semibold">Match your columns</h3>
                <div className="grid gap-3 sm:grid-cols-3">{col("date", "Date", true)}{col("amount", "Amount", true)}{col("note", "Description")}{col("category", "Category")}{col("type", "Type (income/expense)")}
                  <Field label="Date format"><Select value={order} onChange={(e) => setOrder(e.target.value as DateOrder)}><option value="ymd">2026-09-30</option><option value="mdy">09/30/2026 (US)</option><option value="dmy">30/09/2026</option></Select></Field></div>
                {map.type < 0 && <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={negExpense} onChange={(e) => setNegExpense(e.target.checked)} className="size-4 accent-[var(--c-brand)]" />Negative amounts are expenses <span className="text-muted">(untick if your bank shows spending as positive)</span></label>}
              </div>
              {parsed && (
                <div>
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-sm"><h3 className="font-semibold">Preview</h3><Badge tone="pos">{parsed.good.length} ready</Badge>{parsed.bad.length > 0 && <Badge tone="warn">{parsed.bad.length} skipped: {[...new Set(parsed.bad.map((b) => b.reason))].join(", ")}</Badge>}</div>
                  <div className="overflow-x-auto rounded-xl border border-line"><table className="w-full"><thead className="border-b border-line"><tr><Th>Date</Th><Th>Type</Th><Th>Category</Th><Th>Description</Th><Th className="text-right">Amount</Th></tr></thead>
                    <tbody>{parsed.good.slice(0, 6).map((r, i) => <tr key={i} className="border-b border-line last:border-0"><Td className="whitespace-nowrap">{r.date}</Td><Td><Badge tone={r.kind === "income" ? "pos" : "neutral"}>{r.kind}</Badge></Td><Td>{r.category}</Td><Td className="max-w-[14rem] truncate text-muted">{r.note}</Td><Td className="tabular text-right">{money(r.amount, 2)}</Td></tr>)}</tbody></table></div>
                  {parsed.good.length > 6 && <p className="mt-1.5 text-xs text-muted">…and {parsed.good.length - 6} more.</p>}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
