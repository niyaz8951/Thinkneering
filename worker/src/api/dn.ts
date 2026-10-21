/* dn_* : the row mapping of the Datasheet Notes tool, kept per PRODUCT (one list for all factories)
   and edited by Product Options editors (standards B.2e). Same names, parameters and results as the
   DAME database functions dn_get_rules, dn_add_rows and dn_admin_save_rules. */
import type { Env } from "../env";
import type { Routes } from "../router";
import { fail } from "../errors";
import { sessionUser } from "../auth";
import { dnProduct } from "../lib/factory";
import { poAutoKind, PO_KIND_OVERRIDES } from "../lib/po-kind";
import { all, now, str, trimmed, bool, isArray, isObject, chunks, marks, batched } from "../lib/sql";

export interface MapRow {
  product_id: string; row_key: string; section: string; sub: string; component: string; show: number;
  label: string; strip: string; response: string; keywords: string; sort: number; reviewed: number; in_tree: number;
  updated_by: string | null; updated_at: string; kind?: string;
}

/* The "rows not in the list yet" setting of a product (true when never saved). */
export async function showUnmapped(env: Env, productId: string): Promise<boolean> {
  const s = await env.DB.prepare("SELECT show_unmapped FROM dn_map_settings WHERE product_id = ?").bind(productId).first<{ show_unmapped: number }>();
  return s ? !!s.show_unmapped : true;
}

/* Starter keywords and "Remove text" for AHU rows (dn_starter_keywords). A row new to the mapping has had no
   decision yet, so it always gets them (since 19 Oct 2026; before, only while no AHU row carried keywords). When
   the editors save the mapping, rows new to it get them only while no row of the list carries keywords (once:
   anyKeywords = false), as the one-time update of the old schema did. Returns key -> { keywords, strip }. */
async function starterKeywords(env: Env, productId: string, keys: string[], once = false): Promise<Map<string, { keywords: string; strip: string }>> {
  const out = new Map<string, { keywords: string; strip: string }>();
  if (productId !== "ahu" || keys.length === 0) return out;
  if (once) {
    const has = await env.DB.prepare("SELECT 1 AS x FROM dn_map WHERE product_id = 'ahu' AND keywords <> '' LIMIT 1").first();
    if (has) return out;
  }
  for (const part of chunks(keys)) {
    const rows = await all<{ row_key: string; keywords: string; strip: string }>(env.DB.prepare(`SELECT row_key, keywords, strip FROM dn_starter_keywords WHERE row_key IN (${marks(part.length)})`).bind(...part));
    rows.forEach((r) => out.set(r.row_key, { keywords: r.keywords, strip: r.strip || "" }));
  }
  return out;
}

/* The keys of a product that are already in the mapping, among the keys given. */
async function existingKeys(env: Env, productId: string, keys: string[]): Promise<Map<string, MapRow>> {
  const out = new Map<string, MapRow>();
  for (const part of chunks(keys)) {
    const rows = await all<MapRow>(env.DB.prepare(`SELECT * FROM dn_map WHERE product_id = ? AND row_key IN (${marks(part.length)})`).bind(productId, ...part));
    rows.forEach((r) => out.set(r.row_key, r));
  }
  return out;
}

interface InRow { key: string; section: string; sub: string; component: string; ord: number; raw: Record<string, unknown> }

/* Rows as the pages send them: trimmed key, first of a repeated key wins, document order kept (ord is 1-based). */
function readRows(list: unknown[], keepBadKeys: boolean): InRow[] {
  const seen = new Set<string>(), out: InRow[] = [];
  list.forEach((raw, i) => {
    const o = isObject(raw) ? raw : {};
    const key = trimmed(o.key);
    if (key.length < 1 || key.length > 300) {
      if (keepBadKeys) fail("A row has no name and cannot be saved.");
      return;
    }
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ key, section: trimmed(o.section, 200), sub: trimmed(o.sub, 200), component: trimmed(o.component, 200), ord: i + 1, raw: o });
  });
  return out;
}

export const routes: Routes = {
  /* The mapping for one product. Any approved user: the tool needs it to build the table. */
  async dn_get_rules(env, p) {
    await sessionUser(env, p.p_token);
    const prod = await dnProduct(env, p.p_product_id);
    const rows = await all<MapRow>(env.DB.prepare("SELECT * FROM dn_map WHERE product_id = ? ORDER BY sort, row_key").bind(prod.id));
    return {
      show_unmapped: await showUnmapped(env, prod.id),
      rules: rows.map((r) => ({
        key: r.row_key, section: r.section, sub: r.sub, component: r.component, show: !!r.show, label: r.label, strip: r.strip,
        response: r.response, keywords: r.keywords, new: !r.reviewed, in_tree: !!r.in_tree,
        // Product Options: the editor's choice ('' = by name) and what the name gives (lib/po-kind.ts)
        kind: r.kind || "", auto_kind: poAutoKind(r.row_key)
      }))
    };
  },

  /* Called by the tool after every datasheet it reads, for any approved user. Adds the rows this
     product's mapping has not seen before; rows already there are not touched.
       p_rows: [{ key, section, sub, component }, ...] in datasheet order
     A new row is shown or left out according to the product's "rows not in the list yet" setting
     and is marked for the editors to review (reviewed = 0, "New" on the mapping screen). */
  async dn_add_rows(env, p) {
    await sessionUser(env, p.p_token);
    const prod = await dnProduct(env, p.p_product_id);
    if (!isArray(p.p_rows)) fail("The rows could not be read.");
    if (p.p_rows.length > 3000) fail("Too many rows to add in one go (more than 3000).");
    const rows = readRows(p.p_rows, false);
    if (rows.length === 0) return { ok: true, added: 0 };
    const show = (await showUnmapped(env, prod.id)) ? 1 : 0;
    const base = (await env.DB.prepare("SELECT coalesce(max(sort), 0) AS n FROM dn_map WHERE product_id = ?").bind(prod.id).first<{ n: number }>())?.n ?? 0;
    const have = await existingKeys(env, prod.id, rows.map((r) => r.key));
    const fresh = rows.filter((r) => !have.has(r.key));
    const starter = await starterKeywords(env, prod.id, fresh.map((r) => r.key));
    const stmts = fresh.map((r) =>
      env.DB.prepare("INSERT OR IGNORE INTO dn_map (product_id, row_key, section, sub, component, show, keywords, strip, sort, reviewed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)")
        .bind(prod.id, r.key, r.section, r.sub, r.component, show, starter.get(r.key)?.keywords || "", starter.get(r.key)?.strip || "", base + r.ord));
    await batched(env.DB, stmts);
    return { ok: true, added: fresh.length };
  },

  /* Save the mapping for one product (editors of Product Options: the mapping is one list per
     product, the same for every factory and every user).
       p_rules:  [{ key, section, sub, component, show, label, strip, response, keywords }, ...] in display order.
                 Rows already stored and not in the list are kept as they are. A saved row is reviewed;
                 its "left out of the tree" flag (in_tree) is kept.
       p_remove: ["key", ...] rules to delete.
     A rule may carry kind: '' (by its name), 'option' or 'duty' (Product Options, 21 Oct 2026, migration 0011);
     a rule without kind keeps the one stored. */
  async dn_admin_save_rules(env, p) {
    const s = (await sessionUser(env, p.p_token)).requireEditor("product-options");
    const prod = await dnProduct(env, p.p_product_id);
    const rulesIn = p.p_rules == null ? [] : p.p_rules, removeIn = p.p_remove == null ? [] : p.p_remove;
    if (!isArray(rulesIn) || !isArray(removeIn)) fail("The mapping could not be read.");
    if (rulesIn.length > 3000) fail("Too many rows to save in one go (more than 3000).");
    for (const raw of rulesIn) {
      const o = isObject(raw) ? raw : {};
      const key = trimmed(o.key);
      if (o.kind !== undefined && o.kind !== null && !(PO_KIND_OVERRIDES as readonly string[]).includes(str(o.kind))) fail("A row has an unknown kind. Choose Auto, Option or Duty.");
      if (key.length < 1 || key.length > 300) fail("A row has no name and cannot be saved.");
      if (str(o.label).length > 120 || str(o.response).length > 1000 || str(o.strip).length > 300 || str(o.keywords).length > 600) {
        fail('A name is longer than 120 characters, a "remove text" is longer than 300, the keywords are longer than 600, or a response is longer than 1000.');
      }
    }
    const rules = readRows(rulesIn, true);
    const remove = [...new Set(removeIn.map((k) => str(k)).filter((k) => k !== ""))];
    const at = now();
    const stmts: D1PreparedStatement[] = [];

    let removed = 0;
    for (const part of chunks(remove)) {
      const r = await env.DB.prepare(`DELETE FROM dn_map WHERE product_id = ? AND row_key IN (${marks(part.length)})`).bind(prod.id, ...part).run();
      removed += r.meta.changes;
    }

    const have = await existingKeys(env, prod.id, rules.map((r) => r.key));
    const anyKeywords = rules.some((r) => trimmed(r.raw.keywords) !== "");
    const starter = anyKeywords ? new Map<string, { keywords: string; strip: string }>() : await starterKeywords(env, prod.id, rules.filter((r) => !have.has(r.key)).map((r) => r.key), true);
    for (const r of rules) {
      const o = r.raw;
      const show = o.show == null ? 1 : (bool(o.show) ? 1 : 0);
      const label = trimmed(o.label), strip = trimmed(o.strip), response = trimmed(o.response);
      const keywords = trimmed(o.keywords) || (have.has(r.key) ? "" : (starter.get(r.key)?.keywords || ""));
      stmts.push(env.DB.prepare(
        `INSERT INTO dn_map (product_id, row_key, section, sub, component, show, label, strip, response, keywords, sort, updated_by, updated_at, reviewed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT (product_id, row_key) DO UPDATE SET
           section = excluded.section, sub = excluded.sub, component = excluded.component, sort = excluded.sort,
           updated_by = CASE WHEN dn_map.show <> excluded.show OR dn_map.label <> excluded.label OR dn_map.strip <> excluded.strip
                                  OR dn_map.response <> excluded.response OR dn_map.keywords <> excluded.keywords
                             THEN excluded.updated_by ELSE dn_map.updated_by END,
           updated_at = CASE WHEN dn_map.show <> excluded.show OR dn_map.label <> excluded.label OR dn_map.strip <> excluded.strip
                                  OR dn_map.response <> excluded.response OR dn_map.keywords <> excluded.keywords
                             THEN excluded.updated_at ELSE dn_map.updated_at END,
           show = excluded.show, label = excluded.label, strip = excluded.strip, response = excluded.response,
           keywords = excluded.keywords, reviewed = 1`)
        .bind(prod.id, r.key, r.section, r.sub, r.component, show, label, strip, response, keywords, r.ord, s.id, at));
      if (o.kind !== undefined && o.kind !== null) stmts.push(env.DB.prepare("UPDATE dn_map SET kind = ? WHERE product_id = ? AND row_key = ?").bind(str(o.kind), prod.id, r.key));
    }
    stmts.push(env.DB.prepare(
      `INSERT INTO dn_map_settings (product_id, show_unmapped, updated_by, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (product_id) DO UPDATE SET show_unmapped = excluded.show_unmapped, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
      .bind(prod.id, p.p_show_unmapped == null ? 1 : (bool(p.p_show_unmapped) ? 1 : 0), s.id, at));
    await batched(env.DB, stmts);
    return { ok: true, saved: rules.length, removed };
  }
};

export { dnProduct };
