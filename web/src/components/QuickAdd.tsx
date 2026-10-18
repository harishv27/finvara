import { Bot, FilePlus2, Plus, Receipt, Target } from "lucide-react";
import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDismiss } from "../lib/hooks";
import { Button } from "./ui";

const ACTIONS = [
  { label: "Add transaction", hint: "Record spending or income", to: "/budget?add=1", icon: Receipt },
  { label: "Import from CSV", hint: "Bring in a bank export", to: "/budget?import=1", icon: FilePlus2 },
  { label: "Plan a goal", hint: "Home, education, anything", to: "/planner?new=1", icon: Target },
  { label: "Ask an advisor", hint: "Get guidance on your numbers", to: "/chat", icon: Bot },
];

export function QuickAdd() {
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss<HTMLDivElement>(open, close);
  return (
    <div ref={ref} className="relative">
      <Button size="sm" onClick={() => setOpen((o) => !o)} icon={<Plus className="size-4" />} aria-haspopup="menu" aria-expanded={open}><span className="hidden sm:inline">Quick add</span><span className="sr-only sm:hidden">Quick add</span></Button>
      {open && (
        <div role="menu" className="fade-up absolute right-0 top-10 z-50 w-64 overflow-hidden rounded-xl border border-line bg-surface p-1.5 shadow-2xl">
          {ACTIONS.map((a) => (
            <button key={a.label} role="menuitem" onClick={() => { setOpen(false); nav(a.to); }} className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-surface2">
              <span className="grid size-8 place-items-center rounded-lg bg-brand-soft text-brand"><a.icon className="size-4" /></span>
              <span><span className="block text-sm font-medium">{a.label}</span><span className="block text-xs text-muted">{a.hint}</span></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
