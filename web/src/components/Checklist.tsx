import { Check, ChevronRight, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Progress, cn } from "./ui";

export interface ChecklistItem { id: string; label: string; hint: string; done: boolean; link: string }
const KEY = "finvara.checklist.hidden";

/** "Getting started" card: progress, the next few steps, and a way to dismiss it for good once the user is comfortable. */
export function Checklist({ items }: { items: ChecklistItem[] }) {
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } });
  const done = items.filter((i) => i.done).length;
  if (hidden || done === items.length) return null;
  const next = items.filter((i) => !i.done);
  return (
    <section className="rounded-2xl border border-brand/25 bg-gradient-to-br from-brand-soft/70 to-surface p-5" aria-label="Getting started">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5"><span className="grid size-9 place-items-center rounded-xl bg-brand text-white [[data-theme=dark]_&]:text-ink"><Sparkles className="size-[18px]" /></span>
          <div><h2 className="text-[0.95rem] font-semibold">Get the most out of Finvara</h2><p className="text-xs text-muted">{done} of {items.length} done · about {Math.max(1, next.length)} minute{next.length > 1 ? "s" : ""} to finish</p></div></div>
        <button onClick={() => { try { localStorage.setItem(KEY, "1"); } catch { /* ignore */ } setHidden(true); }} className="cursor-pointer rounded-md p-1.5 text-muted hover:bg-surface2 hover:text-text" aria-label="Hide getting started"><X className="size-4" /></button>
      </div>
      <Progress value={(done / items.length) * 100} className="mt-3" label="Getting started progress" />
      <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((i) => (
          <li key={i.id}>
            <Link to={i.link} className={cn("group flex items-center gap-3 rounded-xl border px-3 py-2.5 transition", i.done ? "border-transparent bg-surface/50 opacity-70" : "border-line bg-surface hover:border-brand hover:shadow-sm")}>
              <span className={cn("grid size-5 shrink-0 place-items-center rounded-full border", i.done ? "border-pos bg-pos text-white" : "border-line")}>{i.done && <Check className="size-3" />}</span>
              <span className="min-w-0 flex-1"><span className={cn("block text-sm font-medium", i.done && "line-through")}>{i.label}</span>{!i.done && <span className="block truncate text-xs text-muted">{i.hint}</span>}</span>
              {!i.done && <ChevronRight className="size-4 shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-brand" aria-hidden />}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
