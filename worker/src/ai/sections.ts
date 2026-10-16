/* What kind of question a specification section asks, learned from the library's confirmed answers
   (Thinkneering v3, functions/_compliance.js "spec topics", 16 Oct 2026):
     contractor  site execution (installation, rigging, commissioning ...): a scope answer, never a datasheet check
     reference   standards, certification, submittals: answered from the library and facts; a datasheet dimension
                 does not say whether something is certified
     product     a requirement about the equipment: datasheet first, then the library
   "shall be 50 mm" means a value to check in a product section and somebody else's job in an installation section.
   Learned from people's answers only (cm_lines holds no AI draft): a section is classified once 5 answered clauses
   agree, so one odd answer cannot move it. v3's rule for reference (60% of clauses cite a standard) is kept but
   made stricter here, because casing and coil sections cite EN 1886 / AHRI 410 on most lines and are still product
   sections: reference needs the section title to say so, or 80% citing standards with few figures. */
import type { Env } from "../env";
import { standardChoice } from "./draft";
import { measurements } from "./guard";

export type SectionKind = "product" | "contractor" | "reference";
export interface SectionInfo { kind: SectionKind; n: number }

export const TRUST_AT = 5;
const SHARE = 0.6;
const STANDARD_WORD = /\b(ahri|ashrae|eurovent|iso\s?\d|astm|nfpa|smacna|amca|bs\s?en|en\s?\d{3,5}|ul\s?\d{2,4}|din\s?\d)/i;
const STANDARD_ACRONYM = /\b(UL|DIN|IEC|ARI|SASO|ISO)\b/;   // short ones count only in capitals
const cites = (t: string) => STANDARD_WORD.test(t) || STANDARD_ACRONYM.test(t);
const REFERENCE_TITLE = /\b(references?|standards?|codes?|quality|submittals?|certific\w*|warrant\w*|regulat\w*|approvals?)\b/i;

export function sectionKey(title: string): string {
  return String(title || "").toLowerCase().replace(/^[\d.\s]+/, "").replace(/[^a-z]+/g, " ").trim();
}

export function classifySection(title: string, rows: { compliance: string; spec_text: string }[]): SectionInfo | null {
  const n = rows.length;
  if (n < TRUST_AT) return null;
  const contractor = rows.filter((r) => standardChoice(r.compliance) === "In Contractor's Scope").length;
  if (contractor / n >= SHARE) return { kind: "contractor", n };
  const citing = rows.filter((r) => cites(r.spec_text)).length / n;
  const figures = rows.filter((r) => measurements(r.spec_text).length > 0).length / n;
  if ((REFERENCE_TITLE.test(title) && citing >= SHARE) || (citing >= 0.8 && figures < 0.2)) return { kind: "reference", n };
  return { kind: "product", n };
}

export const SECTION_GUIDANCE: Record<SectionKind, string> = {
  contractor: "This section is site execution work, not a question about the equipment: answer In Contractor's Scope with the scope wording, and do not check any figure in it against the datasheet.",
  reference: "This section is about standards, certification or submittals: answer from the library answers, rules and facts. A datasheet dimension does not say whether something is certified; do not use one here.",
  product: "This section is a requirement about the equipment: check it against the datasheet rows of this clause first, then the library answers."
};

/* Per factory, kept between requests while the library has not changed. */
const memo = new Map<string, { stamp: string; kinds: Map<string, SectionInfo> }>();

export async function sectionKinds(env: Env, factoryId: string): Promise<Map<string, SectionInfo>> {
  const st = await env.DB.prepare("SELECT count(*) AS n, coalesce(max(answered_at), '') AS at FROM cm_lines WHERE factory_id = ? AND status = 'answered'")
    .bind(factoryId).first<{ n: number; at: string }>();
  const stamp = `${st?.n || 0}|${st?.at || ""}`;
  const m = memo.get(factoryId);
  if (m && m.stamp === stamp) return m.kinds;
  const rows = (await env.DB.prepare("SELECT section, compliance, spec_text FROM cm_lines WHERE factory_id = ? AND status = 'answered' AND section <> ''")
    .bind(factoryId).all<{ section: string; compliance: string; spec_text: string }>()).results || [];
  const groups = new Map<string, { title: string; rows: { compliance: string; spec_text: string }[] }>();
  for (const r of rows) {
    const k = sectionKey(r.section); if (!k) continue;
    const g = groups.get(k) || { title: r.section, rows: [] }; g.rows.push(r); groups.set(k, g);
  }
  const kinds = new Map<string, SectionInfo>();
  for (const [k, g] of groups) { const c = classifySection(g.title, g.rows); if (c) kinds.set(k, c); }
  if (memo.size > 50) memo.clear();
  memo.set(factoryId, { stamp, kinds });
  return kinds;
}
