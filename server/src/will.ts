import { z } from "zod";

const text = (max = 200) => z.string().trim().max(max);
const req = (max = 200) => z.string().trim().min(1, "Required").max(max);

export const WillSchema = z.object({
  testator: z.object({
    fullName: req(),
    dateOfBirth: req(20),
    address: req(300),
    jurisdiction: req(120), // e.g. "State of California, USA"
    maritalStatus: z.enum(["single", "married", "divorced", "widowed", "partnered"]),
    spouseName: text().optional().default(""),
  }),
  executor: z.object({ name: req(), relationship: text(80).default(""), address: text(300).default("") }),
  alternateExecutor: z.object({ name: text(), relationship: text(80).default("") }).optional(),
  children: z.array(z.object({ name: req(), dateOfBirth: text(20).default("") })).max(20).default([]),
  guardian: z.object({ name: text(), relationship: text(80).default("") }).optional(),
  alternateGuardian: z.object({ name: text(), relationship: text(80).default("") }).optional(),
  assets: z
    .array(
      z.object({
        id: req(40),
        type: z.enum(["property", "bank", "investment", "retirement", "vehicle", "business", "personal", "digital", "other"]),
        description: req(300),
        estimatedValue: z.number().min(0).max(1e12).optional(),
      }),
    )
    .max(100)
    .default([]),
  specificBequests: z
    .array(z.object({ assetId: text(40).default(""), description: req(300), beneficiary: req() }))
    .max(100)
    .default([]),
  beneficiaries: z
    .array(z.object({ id: req(40), name: req(), relationship: text(80).default(""), sharePct: z.number().min(0).max(100) }))
    .max(50)
    .default([]),
  funeral: z.object({ preference: z.enum(["burial", "cremation", "no_preference", "other"]).default("no_preference"), notes: text(500).default("") }).default({ preference: "no_preference", notes: "" }),
  digitalAssetsInstructions: text(1000).default(""),
  petCare: text(500).default(""),
  additionalWishes: text(2000).default(""),
});
export type WillInput = z.infer<typeof WillSchema>;

export interface WillCheck { level: "error" | "warning" | "info"; message: string }

export function checkWill(w: WillInput): WillCheck[] {
  const out: WillCheck[] = [];
  const total = w.beneficiaries.reduce((a, b) => a + b.sharePct, 0);
  if (w.beneficiaries.length === 0) out.push({ level: "error", message: "Add at least one beneficiary for the residuary estate." });
  else if (Math.abs(total - 100) > 0.01) out.push({ level: "error", message: `Residuary shares total ${total}% — they must add up to exactly 100%.` });
  const names = new Set(w.beneficiaries.map((b) => b.name.toLowerCase()));
  for (const b of w.specificBequests) if (!names.has(b.beneficiary.toLowerCase())) out.push({ level: "info", message: `"${b.beneficiary}" receives a specific gift but is not in the residuary list (that is fine).` });
  const minors = w.children.filter((c) => {
    if (!c.dateOfBirth) return true;
    const age = (Date.now() - new Date(c.dateOfBirth).getTime()) / (365.25 * 86400000);
    return age < 18;
  });
  if (minors.length && !w.guardian?.name) out.push({ level: "warning", message: "You have children who may be minors but no guardian is named." });
  if (w.testator.maritalStatus === "married" && !w.testator.spouseName) out.push({ level: "warning", message: "Add your spouse's name so the document refers to them correctly." });
  if (w.testator.maritalStatus === "married" && w.testator.spouseName && !names.has(w.testator.spouseName.toLowerCase()))
    out.push({ level: "info", message: "Your spouse is not a residuary beneficiary. Some jurisdictions give a spouse statutory rights regardless of the will." });
  if (!w.alternateExecutor?.name) out.push({ level: "info", message: "Naming an alternate executor avoids delays if your first choice cannot serve." });
  return out;
}

const money = (n?: number) => (n == null ? "" : ` (approx. value ${n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })})`);
const pctStr = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2)}%`;

export interface GeneratedWill { title: string; markdown: string; html: string; generatedAt: string }

/** Assemble a plain-language last will & testament. Template only — not legal advice. */
export function generateWill(w: WillInput): GeneratedWill {
  const t = w.testator;
  const name = t.fullName.toUpperCase();
  const s: string[] = [];
  const art: string[][] = [];
  let n = 0;
  const add = (title: string, ...paras: string[]) => art.push([`ARTICLE ${++n} — ${title}`, ...paras]);

  add("REVOCATION", `I, ${t.fullName}, born ${t.dateOfBirth}, residing at ${t.address}, being of sound mind, declare this to be my Last Will and Testament. I revoke all wills and codicils I have previously made.`);

  add("FAMILY",
    t.maritalStatus === "married" && t.spouseName ? `I am married to ${t.spouseName}.` : `My marital status is ${t.maritalStatus}${t.spouseName ? ` (${t.spouseName})` : ""}.`,
    w.children.length ? `I have the following children: ${w.children.map((c) => c.name + (c.dateOfBirth ? ` (born ${c.dateOfBirth})` : "")).join("; ")}.` : "I have no children at the date of this Will.");

  add("EXECUTOR",
    `I appoint ${w.executor.name}${w.executor.relationship ? `, my ${w.executor.relationship},` : ""} as Executor of this Will.` + (w.alternateExecutor?.name ? ` If ${w.executor.name} is unable or unwilling to act, I appoint ${w.alternateExecutor.name}${w.alternateExecutor.relationship ? `, my ${w.alternateExecutor.relationship},` : ""} as alternate Executor.` : ""),
    "My Executor shall pay my lawful debts, funeral expenses and the costs of administering my estate, and may sell or otherwise dispose of estate property where needed for that purpose.");

  if (w.guardian?.name)
    add("GUARDIAN OF MINOR CHILDREN",
      `If any of my children are minors at my death and have no surviving parent able to care for them, I appoint ${w.guardian.name}${w.guardian.relationship ? `, my ${w.guardian.relationship},` : ""} as their guardian.` + (w.alternateGuardian?.name ? ` If ${w.guardian.name} cannot serve, I appoint ${w.alternateGuardian.name} as alternate guardian.` : ""));

  if (w.assets.length)
    add("SCHEDULE OF ASSETS", "This list is for identification and does not limit what my Will disposes of:", ...w.assets.map((a, i) => `${i + 1}. [${a.type}] ${a.description}${money(a.estimatedValue)}`));

  if (w.specificBequests.length)
    add("SPECIFIC GIFTS", ...w.specificBequests.map((b) => `I give ${b.description} to ${b.beneficiary}. If ${b.beneficiary} does not survive me by 30 days, this gift lapses and falls into my residuary estate.`));

  if (w.beneficiaries.length)
    add("RESIDUARY ESTATE",
      "I give the rest and residue of my estate — everything not otherwise validly disposed of — in the following shares:",
      ...w.beneficiaries.map((b) => `• ${b.name}${b.relationship ? ` (${b.relationship})` : ""}: ${pctStr(b.sharePct)}`),
      "If a beneficiary named above does not survive me by 30 days, their share shall be divided among the surviving beneficiaries in proportion to their shares.");

  if (w.digitalAssetsInstructions || w.assets.some((a) => a.type === "digital"))
    add("DIGITAL ASSETS", "My Executor may access, manage, transfer or close my digital accounts and assets." + (w.digitalAssetsInstructions ? ` ${w.digitalAssetsInstructions}` : ""));

  if (w.petCare) add("PETS", w.petCare);

  const f = w.funeral;
  if (f.preference !== "no_preference" || f.notes)
    add("FUNERAL WISHES", `${f.preference === "burial" ? "I wish to be buried." : f.preference === "cremation" ? "I wish to be cremated." : f.preference === "other" ? "I have specific funeral wishes." : ""} ${f.notes}`.trim());

  if (w.additionalWishes) add("ADDITIONAL WISHES", w.additionalWishes);

  add("GENERAL PROVISIONS",
    `This Will shall be interpreted under the laws of ${t.jurisdiction}. If any provision is held invalid, the remaining provisions continue in effect. Headings are for convenience only.`);

  const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const attest = [
    "ATTESTATION",
    `Signed by ${t.fullName} as their Last Will and Testament in our presence, and signed by us in their presence and in the presence of each other as witnesses:`,
    "Testator: ______________________________    Date: ______________",
    "Witness 1: _____________________________    Printed name: ______________________    Address: ______________________",
    "Witness 2: _____________________________    Printed name: ______________________    Address: ______________________",
    "NOTARY / SELF-PROVING AFFIDAVIT (where your jurisdiction allows it)",
    "Subscribed, sworn to and acknowledged before me by the Testator and the witnesses on ____________________.",
    "Notary Public: ______________________________    Commission expires: ______________",
  ];

  const disclaimer =
    "IMPORTANT: This document was produced by an automated template and is not legal advice. Wills must satisfy local formalities (signing, witnesses, notarisation). Have it reviewed by a qualified attorney in your jurisdiction before signing.";

  const md = [
    `# LAST WILL AND TESTAMENT OF ${name}`,
    ...art.flatMap(([h, ...p]) => ["", `## ${h}`, "", ...p.flatMap((x) => [x, ""])]),
    `## ${attest[0]}`, "", ...attest.slice(1).map((x) => x + "\n"),
    `---\n\nDrafted ${date} · ${disclaimer}`,
  ].join("\n");

  const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Last Will and Testament of ${esc(t.fullName)}</title>
<style>
body{font-family:Georgia,'Times New Roman',serif;max-width:760px;margin:40px auto;padding:0 24px;color:#111;line-height:1.65}
h1{text-align:center;font-size:22px;letter-spacing:.06em;margin-bottom:32px}
h2{font-size:14px;letter-spacing:.08em;margin:28px 0 8px;border-bottom:1px solid #999;padding-bottom:4px}
p{margin:6px 0;font-size:15px}.sig{margin:22px 0}.disc{margin-top:36px;font-size:12px;color:#555;border-top:1px solid #aaa;padding-top:10px}
@media print{body{margin:0}}
</style></head><body>
<h1>LAST WILL AND TESTAMENT<br>OF ${esc(name)}</h1>
${art.map(([h, ...p]) => `<h2>${esc(h)}</h2>${p.map((x) => `<p>${esc(x)}</p>`).join("")}`).join("\n")}
<h2>${attest[0]}</h2>${attest.slice(1).map((x) => `<p class="sig">${esc(x)}</p>`).join("")}
<p class="disc">Drafted ${date}. ${esc(disclaimer)}</p></body></html>`;

  void s;
  return { title: `Last Will and Testament of ${t.fullName}`, markdown: md, html, generatedAt: new Date().toISOString() };
}
