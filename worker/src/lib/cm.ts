/* Pure Compliance Maker logic, ported from the plpgsql helpers of db/schema.sql (cm__norm, cm__part_no,
   cm__topic, cm__library_order, pr__check_row). Unit-tested in tests/worker/lib-cm.test.ts with the same
   examples that were used on Postgres. The browser never re-implements these. */

/* The one place text is normalised for matching: lower case, punctuation and spacing ignored. */
export function cmNorm(t: unknown): string {
  return String(t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/* Body rows enter the library: letter / number / text, 8+ characters after normalising, not a contents line. */
export const BODY_TYPES = ["letter", "number", "text"];
export function isBody(type: string): boolean { return BODY_TYPES.includes(type); }
export function isContents(spec: string): boolean { return /\.{5,}/.test(spec); }
export function libraryKey(type: string, spec: string): string | null {
  if (!isBody(type)) return null;
  const n = cmNorm(spec);
  if (n.length < 8 || isContents(spec)) return null;
  return n;
}

/* "PART 2 - PRODUCTS" -> 2. Anything else -> 0. */
export function cmPartNo(t: unknown): number {
  const m = /^\s*PART\s+([0-9]{1,2}|I{1,3})\b/i.exec(String(t ?? ""));
  if (!m) return 0;
  const r: Record<string, number> = { I: 1, II: 2, III: 3 };
  if (r[m[1].toUpperCase()]) return r[m[1].toUpperCase()];
  return Math.min(parseInt(m[1], 10) || 0, 9);
}

const TOPICS: [string, RegExp][] = [
  ["Installation and testing", /\b(field quality|install|examin|prepar|adjust|clean|demonstrat|commission|start.?up|testing|connection|training)/],
  ["Submittals", /\b(submittal|shop drawing|closeout)/],
  ["Standards and quality", /\b(quality|warrant|regulat|certif|standard|reference|performance|health|safety|code)/],
  ["Filters", /\b(filter)/],
  ["Humidifier", /\b(humidif|dehumidif)/],
  ["Heat recovery", /\b(heat recovery|recovery wheel|heat wheel|heat pipe|recuperator|run.?around)/],
  ["Coils", /\b(coil|heat exchanger|eliminator|drain pan)/],
  ["Dampers and mixing", /\b(damper|mixing|plenum|louv|economi)/],
  ["Sound and vibration", /\b(sound|noise|acoustic|attenuat|silencer|vibration)/],
  ["Fans and drives", /\b(fan|blower|motor|drive|bearing|belt)/],
  ["Controls and electrical", /\b(control|electric|wiring|starter|variable frequency|vfd|instrument|sensor)/],
  ["Casing and base", /\b(casing|cabinet|enclosure|panel|housing|construction|gasket|door|insulat|base|frame|support|roof)/],
  ["Delivery and spares", /\b(deliver|storage|extra material|spare|maintenance)/],
  ["General", /\b(general|summary|description|scope|includes|related|definition|coordination|manufacturer|material)/]
];

/* Section title -> topic. First match wins. */
export function cmTopic(section: unknown): string {
  const s = String(section ?? "").toLowerCase();
  if (!s) return "";
  for (const [name, re] of TOPICS) if (re.test(s)) return name;
  return "Other";
}

export interface OrderLine {
  id: string; part: number; section: string; section_sr: string;
  home_run: string | null; home_seq: number | null; first_seen_at?: string; run_at?: string | null;
}

/* cm__library_order: Part 1, 2, 3 (0 last); sections by title, groups by their lowest section number;
   inside a title one block per conversion (oldest first); then the order in that specification. */
export function cmLibraryOrder<T extends OrderLine>(lines: T[]): T[] {
  const num = (sr: string) => { const m = /^(\d{1,2})\.(\d{1,2})$/.exec(sr || ""); return m ? +m[1] * 1000 + +m[2] : 99999; };
  const gsort = new Map<string, number>();
  for (const x of lines) {
    const k = (x.part || 0) + "|" + String(x.section || "").toLowerCase();
    gsort.set(k, Math.min(gsort.get(k) ?? 99999, num(x.section_sr)));
  }
  return lines.slice().sort((a, b) => {
    const pa = a.part || 0, pb = b.part || 0, sa = String(a.section || "").toLowerCase(), sb = String(b.section || "").toLowerCase();
    return ((pa === 0 ? 1 : 0) - (pb === 0 ? 1 : 0)) || pa - pb
      || (gsort.get(pa + "|" + sa)! - gsort.get(pb + "|" + sb)!) || sa.localeCompare(sb)
      || String(a.run_at || "~").localeCompare(String(b.run_at || "~"))
      || String(a.home_run || "~").localeCompare(String(b.home_run || "~"))
      || ((a.home_seq == null ? 1e9 : a.home_seq) - (b.home_seq == null ? 1e9 : b.home_seq))
      || String(a.first_seen_at || "").localeCompare(String(b.first_seen_at || ""))
      || a.id.localeCompare(b.id);
  });
}

/* pr__check_row: the first 40 letters and digits of the clause as the page shows it. */
export function rowKey(spec: unknown): string {
  return String(spec ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 40);
}

/* The standard answers (record page datalist, focus mode, AI drafts). */
export const CHOICES = ["Comply", "Comply with Remarks", "Noted", "Not Comply", "Not Applicable", "In Contractor's Scope"];

/* Structure of a converted specification: for every row, the Part and section it sits under
   (cm__fill_structure, but worked out in the Worker from the rows of one conversion). */
export interface SpecRow { seq: number; type: string; sr: string; spec: string }
export interface RowPlace { part: number; section: string; section_sr: string }
export function placeRows(rows: SpecRow[]): Map<number, RowPlace> {
  const out = new Map<number, RowPlace>();
  let part = 0, section = "", sectionSr = "";
  for (const r of rows.slice().sort((a, b) => a.seq - b.seq)) {
    if (r.type === "part") {
      const pn = cmPartNo(r.spec);
      if (pn > 0) { part = pn; section = ""; sectionSr = ""; }
      continue;
    }
    if (r.type === "section") {
      if (!isContents(r.spec) && !/^0\./.test(r.sr || "")) { section = r.spec.trim().slice(0, 120); sectionSr = (r.sr || "").trim().slice(0, 12); }
      continue;
    }
    out.set(r.seq, { part, section, section_sr: sectionSr });
  }
  return out;
}
