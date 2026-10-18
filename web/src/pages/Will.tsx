import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, Download, FileText, Plus, Printer, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Callout, Card, Field, Input, NumInput, PageHeader, PageLoader, Select, Textarea, cn, useToast } from "../components/ui";
import { api, ApiError, download } from "../lib/api";
import { money } from "../lib/format";
import { useDebounced } from "../lib/hooks";

interface Person { name: string; relationship: string }
interface WillState {
  testator: { fullName: string; dateOfBirth: string; address: string; jurisdiction: string; maritalStatus: string; spouseName: string };
  executor: Person & { address: string };
  alternateExecutor: Person;
  children: { name: string; dateOfBirth: string }[];
  guardian: Person;
  alternateGuardian: Person;
  assets: { id: string; type: string; description: string; estimatedValue?: number }[];
  beneficiaries: { id: string; name: string; relationship: string; sharePct: number }[];
  specificBequests: { assetId: string; description: string; beneficiary: string }[];
  funeral: { preference: string; notes: string };
  digitalAssetsInstructions: string; petCare: string; additionalWishes: string;
}
const EMPTY: WillState = {
  testator: { fullName: "", dateOfBirth: "", address: "", jurisdiction: "", maritalStatus: "single", spouseName: "" },
  executor: { name: "", relationship: "", address: "" }, alternateExecutor: { name: "", relationship: "" },
  children: [], guardian: { name: "", relationship: "" }, alternateGuardian: { name: "", relationship: "" },
  assets: [], beneficiaries: [], specificBequests: [], funeral: { preference: "no_preference", notes: "" },
  digitalAssetsInstructions: "", petCare: "", additionalWishes: "",
};
const STEPS = ["About you", "People", "Assets", "Beneficiaries", "Final wishes", "Review & generate"];
const ASSET_TYPES = ["property", "bank", "investment", "retirement", "vehicle", "business", "personal", "digital", "other"];
const stepOfPath = (p: string) => (p.startsWith("testator") ? 0 : /^(executor|alternateExecutor|children|guardian|alternateGuardian)/.test(p) ? 1 : p.startsWith("assets") ? 2 : /^(beneficiaries|specificBequests)/.test(p) ? 3 : 4);
const uid = () => Math.random().toString(36).slice(2, 9);
const merge = (draft: any): WillState => ({
  ...EMPTY, ...draft,
  testator: { ...EMPTY.testator, ...draft?.testator }, executor: { ...EMPTY.executor, ...draft?.executor },
  alternateExecutor: { ...EMPTY.alternateExecutor, ...draft?.alternateExecutor }, guardian: { ...EMPTY.guardian, ...draft?.guardian },
  alternateGuardian: { ...EMPTY.alternateGuardian, ...draft?.alternateGuardian }, funeral: { ...EMPTY.funeral, ...draft?.funeral },
});

/** Strip empty optional people so the server schema's optional objects validate. */
function toPayload(w: WillState) {
  const person = (p: Person) => (p.name.trim() ? p : undefined);
  return { ...w, alternateExecutor: person(w.alternateExecutor), guardian: person(w.guardian), alternateGuardian: person(w.alternateGuardian) };
}

export default function Will() {
  const { toast, error } = useToast();
  const draftQ = useQuery({ queryKey: ["will"], queryFn: () => api.get<{ draft: any; status: string; generatedAt: string | null }>("/will"), staleTime: 0 });
  const [w, setW] = useState<WillState>(EMPTY);
  const [step, setStep] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");
  const [doc, setDoc] = useState<{ html: string; markdown: string } | null>(null);
  const dirty = useRef(false);

  useEffect(() => {
    if (draftQ.data && !loaded) { if (draftQ.data.draft) setW(merge(draftQ.data.draft)); setLoaded(true); }
  }, [draftQ.data, loaded]);

  const patch = (fn: (s: WillState) => WillState) => { dirty.current = true; setSaved("idle"); setW(fn); };
  const debounced = useDebounced(w, 1500);
  useEffect(() => {
    if (!loaded || !dirty.current) return;
    setSaved("saving");
    api.put("/will", debounced).then(() => setSaved("saved")).catch(() => setSaved("idle"));
  }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps

  const validate = useMutation({ mutationFn: () => api.post<{ valid: boolean; errors: { path: string; message: string }[]; checks: { level: string; message: string }[] }>("/will/validate", toPayload(w)) });
  useEffect(() => { if (step === 5) validate.mutate(); }, [step]); // eslint-disable-line react-hooks/exhaustive-deps
  const generate = useMutation({
    mutationFn: () => api.post<{ html: string; markdown: string; checks: any[] }>("/will/generate", toPayload(w)),
    onSuccess: (r) => { setDoc(r); toast("Your will has been generated"); },
    onError: (e) => error(e instanceof ApiError && e.status === 422 ? new Error(e.message) : e),
  });

  const shares = useMemo(() => w.beneficiaries.reduce((a, b) => a + (b.sharePct || 0), 0), [w.beneficiaries]);
  if (draftQ.isLoading || !loaded) return <PageLoader />;
  const T = w.testator;
  const setT = (k: keyof WillState["testator"], v: string) => patch((s) => ({ ...s, testator: { ...s.testator, [k]: v } }));

  const printDoc = () => {
    if (!doc) return;
    const url = URL.createObjectURL(new Blob([doc.html], { type: "text/html" }));
    window.open(url, "_blank");
    toast("Use your browser's Print → Save as PDF", "info");
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Will writing" subtitle="Answer a few questions and Finvara drafts a plain-language will you can review, sign, and have witnessed or notarised."
        actions={<>{saved === "saving" && <span className="text-xs text-muted">Saving…</span>}{saved === "saved" && <span className="flex items-center gap-1 text-xs text-pos"><Check className="size-3.5" />Draft saved</span>}{draftQ.data?.status === "generated" && <Badge tone="brand">Generated before</Badge>}</>} />
      <Callout tone="warn" title="Template, not legal advice">Wills must meet local signing and witnessing rules. Have an attorney in your jurisdiction review the document before you sign it.</Callout>

      <nav aria-label="Will steps" className="flex gap-1 overflow-x-auto pb-1">
        {STEPS.map((s, i) => (
          <button key={s} onClick={() => setStep(i)} aria-current={i === step ? "step" : undefined}
            className={cn("flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition", i === step ? "bg-brand text-white [[data-theme=dark]_&]:text-ink" : "text-muted hover:bg-surface2")}>
            <span className={cn("grid size-5 place-items-center rounded-full text-[0.65rem]", i === step ? "bg-white/25" : "bg-surface2")}>{i + 1}</span>{s}
          </button>
        ))}
      </nav>

      <Card>
        {step === 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full legal name"><Input value={T.fullName} onChange={(e) => setT("fullName", e.target.value)} autoComplete="name" /></Field>
            <Field label="Date of birth"><Input type="date" value={T.dateOfBirth} onChange={(e) => setT("dateOfBirth", e.target.value)} /></Field>
            <Field label="Home address" className="sm:col-span-2"><Input value={T.address} onChange={(e) => setT("address", e.target.value)} autoComplete="street-address" /></Field>
            <Field label="Governing jurisdiction" hint="State/country whose law applies, e.g. “State of Illinois, USA”"><Input value={T.jurisdiction} onChange={(e) => setT("jurisdiction", e.target.value)} /></Field>
            <Field label="Marital status"><Select value={T.maritalStatus} onChange={(e) => setT("maritalStatus", e.target.value)}>{["single", "married", "partnered", "divorced", "widowed"].map((m) => <option key={m} value={m}>{m[0].toUpperCase() + m.slice(1)}</option>)}</Select></Field>
            {(T.maritalStatus === "married" || T.maritalStatus === "partnered") && <Field label="Spouse / partner name"><Input value={T.spouseName} onChange={(e) => setT("spouseName", e.target.value)} /></Field>}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-6">
            <section><h3 className="mb-3 font-semibold">Executor</h3><p className="mb-3 text-sm text-muted">The person who carries out your will and settles your estate.</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Name"><Input value={w.executor.name} onChange={(e) => patch((s) => ({ ...s, executor: { ...s.executor, name: e.target.value } }))} /></Field>
                <Field label="Relationship"><Input value={w.executor.relationship} onChange={(e) => patch((s) => ({ ...s, executor: { ...s.executor, relationship: e.target.value } }))} placeholder="spouse, sibling…" /></Field>
                <Field label="Alternate executor"><Input value={w.alternateExecutor.name} onChange={(e) => patch((s) => ({ ...s, alternateExecutor: { ...s.alternateExecutor, name: e.target.value } }))} placeholder="optional" /></Field>
              </div></section>
            <section><div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">Children</h3><Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => patch((s) => ({ ...s, children: [...s.children, { name: "", dateOfBirth: "" }] }))}>Add child</Button></div>
              {w.children.length === 0 && <p className="text-sm text-muted">No children added.</p>}
              {w.children.map((c, i) => (
                <div key={i} className="mb-2 grid grid-cols-[1fr_9rem_auto] items-end gap-3">
                  <Field label={i === 0 ? "Name" : undefined}><Input aria-label={`Child ${i + 1} name`} value={c.name} onChange={(e) => patch((s) => ({ ...s, children: s.children.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) }))} /></Field>
                  <Field label={i === 0 ? "Date of birth" : undefined}><Input aria-label={`Child ${i + 1} birth date`} type="date" value={c.dateOfBirth} onChange={(e) => patch((s) => ({ ...s, children: s.children.map((x, j) => (j === i ? { ...x, dateOfBirth: e.target.value } : x)) }))} /></Field>
                  <Button variant="ghost" size="sm" aria-label="Remove child" onClick={() => patch((s) => ({ ...s, children: s.children.filter((_, j) => j !== i) }))}><Trash2 className="size-4" /></Button>
                </div>
              ))}</section>
            {w.children.length > 0 && <section><h3 className="mb-3 font-semibold">Guardian for minor children</h3>
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label="Guardian"><Input value={w.guardian.name} onChange={(e) => patch((s) => ({ ...s, guardian: { ...s.guardian, name: e.target.value } }))} /></Field>
                <Field label="Relationship"><Input value={w.guardian.relationship} onChange={(e) => patch((s) => ({ ...s, guardian: { ...s.guardian, relationship: e.target.value } }))} /></Field>
                <Field label="Alternate guardian"><Input value={w.alternateGuardian.name} onChange={(e) => patch((s) => ({ ...s, alternateGuardian: { ...s.alternateGuardian, name: e.target.value } }))} /></Field>
                <Field label="Relationship"><Input value={w.alternateGuardian.relationship} onChange={(e) => patch((s) => ({ ...s, alternateGuardian: { ...s.alternateGuardian, relationship: e.target.value } }))} /></Field>
              </div></section>}
          </div>
        )}

        {step === 2 && (
          <div>
            <div className="mb-3 flex items-center justify-between"><div><h3 className="font-semibold">Your assets</h3><p className="text-sm text-muted">Homes, accounts, vehicles, businesses and keepsakes. Total listed: <b className="text-text">{money(w.assets.reduce((a, x) => a + (x.estimatedValue ?? 0), 0))}</b></p></div>
              <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => patch((s) => ({ ...s, assets: [...s.assets, { id: uid(), type: "bank", description: "" }] }))}>Add asset</Button></div>
            {w.assets.length === 0 && <p className="py-6 text-center text-sm text-muted">No assets listed yet.</p>}
            {w.assets.map((a, i) => (
              <div key={a.id} className="mb-2 grid gap-3 sm:grid-cols-[9rem_1fr_9rem_auto] sm:items-end">
                <Field label={i === 0 ? "Type" : undefined}><Select aria-label="Asset type" value={a.type} onChange={(e) => patch((s) => ({ ...s, assets: s.assets.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)) }))}>{ASSET_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
                <Field label={i === 0 ? "Description" : undefined}><Input aria-label="Asset description" value={a.description} placeholder="e.g. Family home at 12 Oak St" onChange={(e) => patch((s) => ({ ...s, assets: s.assets.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) }))} /></Field>
                <Field label={i === 0 ? "Approx. value" : undefined}><NumInput prefix="$" value={a.estimatedValue} min={0} onChange={(v) => patch((s) => ({ ...s, assets: s.assets.map((x, j) => (j === i ? { ...x, estimatedValue: v } : x)) }))} /></Field>
                <Button variant="ghost" size="sm" aria-label="Remove asset" onClick={() => patch((s) => ({ ...s, assets: s.assets.filter((_, j) => j !== i) }))}><Trash2 className="size-4" /></Button>
              </div>
            ))}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-8">
            <section>
              <div className="mb-1 flex items-center justify-between"><h3 className="font-semibold">Who inherits the rest of your estate?</h3>
                <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => patch((s) => ({ ...s, beneficiaries: [...s.beneficiaries, { id: uid(), name: "", relationship: "", sharePct: Math.max(0, 100 - s.beneficiaries.reduce((a, b) => a + b.sharePct, 0)) }] }))}>Add beneficiary</Button></div>
              <p className="mb-3 text-sm text-muted">Shares apply to everything not given away as a specific gift, and must total 100%.</p>
              {w.beneficiaries.map((b, i) => (
                <div key={b.id} className="mb-2 grid gap-3 sm:grid-cols-[1fr_1fr_7rem_auto] sm:items-end">
                  <Field label={i === 0 ? "Name" : undefined}><Input aria-label="Beneficiary name" value={b.name} onChange={(e) => patch((s) => ({ ...s, beneficiaries: s.beneficiaries.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) }))} /></Field>
                  <Field label={i === 0 ? "Relationship" : undefined}><Input aria-label="Relationship" value={b.relationship} onChange={(e) => patch((s) => ({ ...s, beneficiaries: s.beneficiaries.map((x, j) => (j === i ? { ...x, relationship: e.target.value } : x)) }))} /></Field>
                  <Field label={i === 0 ? "Share" : undefined}><NumInput suffix="%" value={b.sharePct} min={0} max={100} onChange={(v) => patch((s) => ({ ...s, beneficiaries: s.beneficiaries.map((x, j) => (j === i ? { ...x, sharePct: v ?? 0 } : x)) }))} /></Field>
                  <Button variant="ghost" size="sm" aria-label="Remove beneficiary" onClick={() => patch((s) => ({ ...s, beneficiaries: s.beneficiaries.filter((_, j) => j !== i) }))}><Trash2 className="size-4" /></Button>
                </div>
              ))}
              {w.beneficiaries.length > 0 && (
                <div className="mt-3"><div className="flex justify-between text-sm"><span className="text-muted">Allocated</span><span className={cn("tabular font-semibold", Math.abs(shares - 100) < 0.01 ? "text-pos" : "text-neg")}>{shares}%{Math.abs(shares - 100) >= 0.01 && ` (${shares < 100 ? "remaining " + (100 - shares) : "over by " + (shares - 100)}%)`}</span></div>
                  <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-surface2"><div className={cn("h-full transition-all", shares > 100 ? "bg-neg" : Math.abs(shares - 100) < 0.01 ? "bg-pos" : "bg-brand")} style={{ width: `${Math.min(100, shares)}%` }} /></div></div>
              )}
            </section>
            <section>
              <div className="mb-3 flex items-center justify-between"><div><h3 className="font-semibold">Specific gifts <span className="font-normal text-muted">(optional)</span></h3><p className="text-sm text-muted">A particular item or sum to a particular person.</p></div>
                <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => patch((s) => ({ ...s, specificBequests: [...s.specificBequests, { assetId: "", description: "", beneficiary: "" }] }))}>Add gift</Button></div>
              {w.specificBequests.map((b, i) => (
                <div key={i} className="mb-2 grid gap-3 sm:grid-cols-[1fr_14rem_auto] sm:items-end">
                  <Field label={i === 0 ? "What" : undefined}><Input aria-label="Gift" value={b.description} placeholder="e.g. my grandfather's watch" onChange={(e) => patch((s) => ({ ...s, specificBequests: s.specificBequests.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) }))} /></Field>
                  <Field label={i === 0 ? "Goes to" : undefined}><Input aria-label="Recipient" value={b.beneficiary} list="ben-names" onChange={(e) => patch((s) => ({ ...s, specificBequests: s.specificBequests.map((x, j) => (j === i ? { ...x, beneficiary: e.target.value } : x)) }))} /></Field>
                  <Button variant="ghost" size="sm" aria-label="Remove gift" onClick={() => patch((s) => ({ ...s, specificBequests: s.specificBequests.filter((_, j) => j !== i) }))}><Trash2 className="size-4" /></Button>
                </div>
              ))}
              <datalist id="ben-names">{w.beneficiaries.filter((b) => b.name).map((b) => <option key={b.id} value={b.name} />)}</datalist>
            </section>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Funeral preference"><Select value={w.funeral.preference} onChange={(e) => patch((s) => ({ ...s, funeral: { ...s.funeral, preference: e.target.value } }))}><option value="no_preference">No preference</option><option value="burial">Burial</option><option value="cremation">Cremation</option><option value="other">Other</option></Select></Field>
              <Field label="Funeral notes"><Input value={w.funeral.notes} onChange={(e) => patch((s) => ({ ...s, funeral: { ...s.funeral, notes: e.target.value } }))} /></Field>
            </div>
            <Field label="Digital assets & accounts" hint="Where to find passwords, who should manage social media, crypto, etc."><Textarea value={w.digitalAssetsInstructions} onChange={(e) => patch((s) => ({ ...s, digitalAssetsInstructions: e.target.value }))} /></Field>
            <Field label="Pet care"><Textarea value={w.petCare} onChange={(e) => patch((s) => ({ ...s, petCare: e.target.value }))} /></Field>
            <Field label="Anything else you'd like to say"><Textarea value={w.additionalWishes} onChange={(e) => patch((s) => ({ ...s, additionalWishes: e.target.value }))} /></Field>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-5">
            <h3 className="font-semibold">Review</h3>
            {validate.isPending && <PageLoader />}
            {validate.data && !validate.data.valid && (
              <Callout tone="danger" title="A few things are missing">
                <ul className="mt-1 space-y-1">{validate.data.errors.map((e, i) => <li key={i}><button className="cursor-pointer text-left underline decoration-dotted" onClick={() => setStep(stepOfPath(e.path))}>{e.message}</button></li>)}</ul>
              </Callout>
            )}
            {validate.data?.valid && (
              <div className="space-y-2">{validate.data.checks.length === 0 ? <Callout tone="good" title="Everything looks complete" /> : validate.data.checks.map((c, i) => <Callout key={i} tone={c.level === "error" ? "danger" : c.level === "warning" ? "warn" : "info"} title={c.message} />)}</div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button size="lg" icon={<FileText className="size-5" />} loading={generate.isPending} disabled={!validate.data?.valid || validate.data.checks.some((c) => c.level === "error")} onClick={() => generate.mutate()}>{doc ? "Regenerate will" : "Generate my will"}</Button>
              {doc && <><Button variant="secondary" icon={<Download className="size-4" />} onClick={() => download("/will/download?format=html", "last-will-and-testament.html").catch(error)}>Download HTML</Button>
                <Button variant="secondary" icon={<Download className="size-4" />} onClick={() => download("/will/download?format=md", "last-will-and-testament.md").catch(error)}>Download Markdown</Button>
                <Button variant="secondary" icon={<Printer className="size-4" />} onClick={printDoc}>Open to print / PDF</Button></>}
            </div>
            {doc && (
              <div>
                <iframe title="Generated will preview" srcDoc={doc.html} sandbox="" className="h-[640px] w-full rounded-xl border border-line bg-white" />
                <Callout tone="warn" title="Next steps">Print the document, sign it in front of the required number of witnesses, and have it notarised if your jurisdiction allows a self-proving affidavit. Store the original somewhere safe and tell your executor where it is.</Callout>
              </div>
            )}
          </div>
        )}

        <div className="mt-7 flex items-center justify-between border-t border-line pt-4">
          <Button variant="ghost" disabled={step === 0} onClick={() => setStep(step - 1)} icon={<ArrowLeft className="size-4" />}>Back</Button>
          <span className="text-xs text-muted">Step {step + 1} of {STEPS.length}</span>
          <Button disabled={step === STEPS.length - 1} onClick={() => setStep(step + 1)} icon={<ArrowRight className="size-4" />} className="flex-row-reverse">Next</Button>
        </div>
      </Card>
    </div>
  );
}
