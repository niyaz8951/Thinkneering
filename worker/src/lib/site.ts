/* Does the datasheet fit the project's site? (22 Oct 2026, Arcadis 237413 test run: a KSA project's datasheet was
   selected at ROMA URBE, Italy, 400 V / 50 Hz.) Code compares the selection location's country and the power supply
   frequency of the saved datasheet table with the project's region. A warning only: nothing is refused or changed.
   Regions are the project form's list (pr_lookups, kind "region"); a region with no single country ("Other Middle
   East", "Africa", "Other") is not checked. */

type Site = { country: RegExp; hz: number };
const SITES: Record<string, Site> = {
  "uae": { country: /\b(united arab emirates|u\.?a\.?e\.?|dubai|abu dhabi|sharjah)\b/i, hz: 50 },
  "saudi arabia": { country: /\b(saudi arabia|k\.?s\.?a\.?|saudi)\b/i, hz: 60 },
  "qatar": { country: /\bqatar\b/i, hz: 50 },
  "kuwait": { country: /\bkuwait\b/i, hz: 50 },
  "bahrain": { country: /\bbahrain\b/i, hz: 50 },
  "oman": { country: /\boman\b/i, hz: 50 },
  "egypt": { country: /\begypt\b/i, hz: 50 }
};

type Row = { section?: unknown; component?: unknown; cells?: unknown[] };

function norm(s: unknown): string { return String(s ?? "").replace(/\s+/g, " ").trim(); }
function sectionOf(s: string): string { return norm(s).replace(/^\d+\)\s*/, "").replace(/\s*\(\d+\)$/, "").toLowerCase(); }

/* the distinct values of one row (section name + component) over every unit of the table */
export function tableValues(rows: Row[], section: string, component: string): string[] {
  const out: string[] = [];
  let sec = "";
  for (const r of rows || []) {
    if (r && r.section) sec = norm(r.section);
    if (!r || sectionOf(sec) !== section || norm(r.component).toLowerCase() !== component) continue;
    for (const c of r.cells || []) { const v = norm(c); if (v && v !== "-" && !out.includes(v)) out.push(v); }
  }
  return out;
}

function hzOf(power: string): number { const m = /(\d{2})\s*hz\b/i.exec(power); return m ? Number(m[1]) : 0; }

/* plain warnings for one project region and the locations / power supplies the datasheet names */
export function siteWarnings(region: unknown, locations: string[], powers: string[]): string[] {
  const name = norm(region), site = SITES[name.toLowerCase()];
  if (!site) return [];
  const out: string[] = [];
  const away = locations.filter((l) => l && !site.country.test(l));
  if (away.length) out.push(`The datasheet was selected at ${away.join("; ")}, but the project is in ${name}. Outdoor conditions, air density and coil capacities may not fit the site: check the selection before answering from it.`);
  const wrongHz = powers.filter((p) => { const hz = hzOf(p); return hz && hz !== site.hz; });
  if (wrongHz.length) out.push(`The datasheet's power supply is ${wrongHz.join("; ")}, but ${name} uses ${site.hz} Hz. Check the motors and electrical data.`);
  return out;
}

/* the same, read from a saved Datasheet Notes table (Unit Data > Location, General > Power Supply) */
export function tableSiteWarnings(region: unknown, rows: Row[]): string[] {
  return siteWarnings(region, tableValues(rows, "unit data", "location"), tableValues(rows, "general", "power supply"));
}
