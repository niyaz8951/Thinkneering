/* po_* : Product Options, what each factory has offered so far (standards B.2e-3). A tree per product
   and factory: section > component > the values seen on datasheets, plus special options and notes
   typed by editors. FCU trees are kept per unit model (series > model). Same names, parameters and
   results as the DAME database functions. The pure helpers (po__skip, po__model, po__series,
   po__value) are exported and unit-tested. */
import type { Env } from "../env";
import type { Routes } from "../router";
import { fail } from "../errors";
import { sessionUser, uuid, audit, type Session } from "../auth";
import { cmFactory, factoriesOf, dnProduct } from "../lib/factory";
import { all, now, str, trimmed, tidy, bool, isArray, isObject, chunks, marks, batched } from "../lib/sql";

/* ---------- pure helpers (mirror po__skip, po__model, po__series, po__value) ---------- */

/* Rows that describe one project, not the product: never stored. */
export const PO_SKIP = ["project", "reference", "material name", "selection software", "report date", "product", "factory", "unit"];
export function poSkip(rowKey: string): boolean {
  return /^general\|\|/.test(rowKey) && PO_SKIP.includes(rowKey.slice(9));
}

/* The model a unit is filed under: the Unit Model without a trailing N, which marks a motor variant
   of the same model (FWW1600TAN is FWW1600TA, FWW600VAN is FWW600VA). */
export function poModel(model: unknown): string {
  return str(model).replace(/\s+/g, " ").trim().slice(0, 60).replace(/N$/i, "");
}

/* The series of a unit model: the model without its size figure (FWW600VA -> FWWVA, FWW700VA-D -> FWWVA-D). */
export function poSeries(model: unknown): string {
  return poModel(model).replace(/\d+/g, "");
}

/* A value as it is kept: spacing tidied, and the quantity in front of an option line removed
   ("2 x Inspection window" and "1 x Inspection window" are one option). */
export function poValue(rowKey: string, value: unknown): string {
  let v = str(value).replace(/\s+/g, " ");
  if (/\|options\|option$/.test(rowKey)) v = v.replace(/^\s*\d+\s*x\s+/i, "");
  return v.trim().slice(0, 300);
}

/* ---------- routes ---------- */

const MAX_VALUES = 300;   // distinct values kept per row, factory and model

/* Who approves a value read from a datasheet before it counts as a fact for the factory (19 Oct 2026, migration
   0007): the super user and the admins of the tile Product Options sits on. A wrong datasheet then cannot change
   what users see or what the AI reads. */
export function poApprover(s: Session): boolean {
  const t = s.tool("product-options");
  return s.isSuper || (!!t && s.isTileAdmin(t.category_id));
}

interface MapRow { row_key: string; section: string; sub: string; component: string; label: string; show: number; in_tree: number; sort: number }
interface ValueRow { row_key: string; model: string; value_key: string; value: string; times: number; hidden: number; approved: number; last_at: string }
interface ExtraRow { id: string; section: string; row_key: string; kind: string; body: string; created_at: string; updated_at: string; created_by: string | null; updated_by: string | null; by: string | null }

export const routes: Routes = {
  /* Called by Datasheet Notes after every datasheet, for any approved user.
       p_items: [{ factory: "Riyadh", key: "unit data||panel", value: "62 mm", model: "" }, ...]
     one item per unit and row. The factory is the NAME read from the datasheet, matched without regard
     to case among the product's factories; model is the unit model for FCUs and empty for AHUs.
     Items whose factory is not a factory of the product, whose row is not shown by the row mapping,
     that are left out of the tree, or that describe the project (po__skip) are ignored. At most 300
     different values are kept per row, factory and model; a value seen again counts once more. A value new to the
     factory waits for an admin's approval (approved = 0, poApprover) before users and the AI see it. */
  async po_collect(env, p) {
    await sessionUser(env, p.p_token);
    const prod = await dnProduct(env, p.p_product_id);
    if (!isArray(p.p_items)) fail("The values could not be read.");
    if (p.p_items.length > 20000) fail("Too many values to save in one go (more than 20000).");
    const facs = new Map<string, string>();                       // lower-case name -> factory id
    for (const f of await factoriesOf(env, prod.id)) facs.set(f.name.toLowerCase(), f.id);
    const mapped = new Map<string, MapRow>();
    for (const m of await all<MapRow>(env.DB.prepare("SELECT row_key, show, in_tree FROM dn_map WHERE product_id = ? AND show = 1 AND in_tree = 1").bind(prod.id))) {
      if (!poSkip(m.row_key)) mapped.set(m.row_key, m);
    }
    // group the items: (factory, row, model, value_key) -> value and count
    type G = { factory_id: string; row_key: string; model: string; value_key: string; value: string; n: number };
    const groups = new Map<string, G>();
    for (const raw of p.p_items) {
      const o = isObject(raw) ? raw : {};
      const fid = facs.get(trimmed(o.factory).toLowerCase());
      const key = trimmed(o.key);
      if (!fid || !mapped.has(key)) continue;
      const value = poValue(key, o.value), vk = value.toLowerCase();
      if (vk === "" || vk === "-") continue;
      const model = poModel(o.model);
      const gk = [fid, key, model, vk].join("\u0001");
      const g = groups.get(gk);
      if (g) { g.n++; if (value < g.value) g.value = value; }    // min(value), as the old statement kept it
      else groups.set(gk, { factory_id: fid, row_key: key, model, value_key: vk, value, n: 1 });
    }
    if (groups.size === 0) return { ok: true, saved: 0 };
    // what is already there for the rows touched: existing keys and the count per row and model
    const have = new Set<string>(), count = new Map<string, number>();
    const byFactory = new Map<string, Set<string>>();
    for (const g of groups.values()) (byFactory.get(g.factory_id) || byFactory.set(g.factory_id, new Set()).get(g.factory_id)!).add(g.row_key);
    for (const [fid, keys] of byFactory) {
      for (const part of chunks([...keys])) {
        const rows = await all<{ row_key: string; model: string; value_key: string }>(env.DB.prepare(
          `SELECT row_key, model, value_key FROM po_values WHERE factory_id = ? AND row_key IN (${marks(part.length)})`).bind(fid, ...part));
        for (const r of rows) {
          have.add([fid, r.row_key, r.model, r.value_key].join("\u0001"));
          const ck = [fid, r.row_key, r.model].join("\u0001");
          count.set(ck, (count.get(ck) || 0) + 1);
        }
      }
    }
    const at = now();
    const stmts: D1PreparedStatement[] = [];
    for (const g of groups.values()) {
      const hk = [g.factory_id, g.row_key, g.model, g.value_key].join("\u0001"), ck = [g.factory_id, g.row_key, g.model].join("\u0001");
      if (have.has(hk)) {
        stmts.push(env.DB.prepare("UPDATE po_values SET times = times + ?, last_at = ? WHERE factory_id = ? AND row_key = ? AND model = ? AND value_key = ?")
          .bind(g.n, at, g.factory_id, g.row_key, g.model, g.value_key));
      } else if ((count.get(ck) || 0) < MAX_VALUES) {
        count.set(ck, (count.get(ck) || 0) + 1);
        stmts.push(env.DB.prepare("INSERT INTO po_values (factory_id, row_key, model, value_key, value, times, first_at, last_at, approved) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)")
          .bind(g.factory_id, g.row_key, g.model, g.value_key, g.value, g.n, at, at));
      }
    }
    await batched(env.DB, stmts);
    return { ok: true, saved: stmts.length };
  },

  /* The tree of one factory. Any approved user.
     Rows: only rows of the row mapping with Show ticked that have a value or an editor's entry for
     this factory. Editors also get the rows and values taken out of the tree (marked hidden) and the
     list of section names, so they can bring a row back or add to any section. Every value carries
     its model ('' for AHUs); 'models' lists the models seen with their series and how many units each had. */
  async po_get_tree(env, p) {
    const s = await sessionUser(env, p.p_token);
    const f = await cmFactory(env, p.p_factory_id);
    const edit = s.canEdit("product-options"), approver = poApprover(s), seeWaiting = edit || approver;
    const [mapRes, valRes, extraRes] = await env.DB.batch([
      env.DB.prepare("SELECT row_key, section, sub, component, label, show, in_tree, sort FROM dn_map WHERE product_id = ? AND show = 1 ORDER BY sort, row_key").bind(f.product_id),
      env.DB.prepare("SELECT row_key, model, value_key, value, times, hidden, approved, last_at FROM po_values WHERE factory_id = ?").bind(f.id),
      env.DB.prepare(`SELECT x.id, x.section, x.row_key, x.kind, x.body, x.created_at, x.updated_at, x.created_by, x.updated_by, w.full_name AS by
                        FROM po_extras x LEFT JOIN app_users w ON w.id = coalesce(x.updated_by, x.created_by)
                       WHERE x.factory_id = ? ORDER BY x.created_at, x.id`).bind(f.id)
    ]);
    const map = mapRes.results as unknown as MapRow[], values = valRes.results as unknown as ValueRow[], extras = extraRes.results as unknown as ExtraRow[];
    let updated: string | null = null;
    const byRow = new Map<string, ValueRow[]>(), seen: ValueRow[] = [];
    let waiting = 0;
    for (const v of values) {
      if (!v.approved && !v.hidden) waiting++;
      if (!v.approved && !seeWaiting) continue;           // not a fact yet: only editors and approvers see it
      if (updated === null || v.last_at > updated) updated = v.last_at;
      if (!edit && v.hidden) continue;
      seen.push(v);
      (byRow.get(v.row_key) || byRow.set(v.row_key, []).get(v.row_key)!).push(v);
    }
    const extraKeys = new Set(extras.map((x) => x.row_key));
    const rows: Record<string, unknown>[] = [];
    for (const m of map) {
      if (poSkip(m.row_key) || (!edit && !m.in_tree)) continue;
      const list = (byRow.get(m.row_key) || []).slice()
        .sort((a, b) => a.model.localeCompare(b.model) || (b.times - a.times) || a.value_key.localeCompare(b.value_key));
      if (!list.length && !extraKeys.has(m.row_key)) continue;
      rows.push({ key: m.row_key, section: m.section, sub: m.sub, component: m.label !== "" ? m.label : m.component, hidden: !m.in_tree,
        values: list.map((v) => ({ k: v.value_key, v: v.value, n: v.times, hidden: !!v.hidden, model: v.model, wait: !v.approved })) });
    }
    // models: per model, the most units any one row counted (sum of times per row, max over rows)
    const perRow = new Map<string, number>();
    for (const v of seen) if (v.model !== "") { const k = v.model + "\u0001" + v.row_key; perRow.set(k, (perRow.get(k) || 0) + v.times); }
    const units = new Map<string, number>();
    for (const [k, n] of perRow) { const model = k.split("\u0001")[0]; units.set(model, Math.max(units.get(model) || 0, n)); }
    const models = [...units].map(([model, n]) => ({ model, series: poSeries(model), units: n }))
      .sort((a, b) => a.series.localeCompare(b.series) || (b.units - a.units) || a.model.localeCompare(b.model));
    // sections an editor may add to: shown rows, named, not General, in mapping order
    const sections: string[] = [];
    if (edit) {
      const first = new Map<string, number>();
      for (const m of map) if (m.section !== "" && m.section.toLowerCase() !== "general" && !first.has(m.section)) first.set(m.section, m.sort);
      sections.push(...[...first].sort((a, b) => a[1] - b[1]).map((x) => x[0]));
    }
    return {
      factory: { id: f.id, name: f.name, product_id: f.product_id, product: f.product },
      can_edit: edit,
      can_approve: approver,
      waiting: seeWaiting ? waiting : 0,                  // values read from datasheets that wait for an admin
      updated,
      rows,
      models,
      // AI notes are for the AI and the editors who write them; readers of the tree do not see them
      extras: extras.filter((x) => edit || x.kind !== "ai").map((x) => ({ id: x.id, section: x.section, key: x.row_key, kind: x.kind, body: x.body, at: x.updated_at, by: x.by })),
      sections
    };
  },

  /* Add (p_id null) or change a special option or a note. Editors of product-options.
       p_section: section name; p_row_key: '' = for the whole section, or the key of one row. */
  async po_admin_save_extra(env, p) {
    const s = (await sessionUser(env, p.p_token)).requireEditor("product-options");
    const f = await cmFactory(env, p.p_factory_id);
    const kind = str(p.p_kind), section = tidy(p.p_section), body = trimmed(p.p_body);
    // Product Options holds the datasheet values and the editors' special options and notes; facts for the AI are
    // branches of a knowledge map in Maps (19 Oct 2026; migration 0006 moved the old AI notes there)
    if (kind === "ai") fail("AI notes are kept in Maps now: add the fact as a branch of the knowledge map linked in Compliance review > AI rules.");
    if (kind !== "option" && kind !== "note") fail("Choose special option or note.");
    if (section.length < 1 || section.length > 120) fail("Give the section a name of up to 120 characters.");
    if (body.length === 0) fail("Type the text first.");
    if (body.length > 1000) fail("The text is longer than 1000 characters.");
    const at = now();
    if (p.p_id == null || p.p_id === "") {
      const id = uuid();
      await env.DB.prepare("INSERT INTO po_extras (id, factory_id, section, row_key, kind, body, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, f.id, section, trimmed(p.p_row_key), kind, body, s.id, at, s.id, at).run();
      return { ok: true, id };
    }
    const id = str(p.p_id);
    const r = await env.DB.prepare("UPDATE po_extras SET kind = ?, body = ?, updated_by = ?, updated_at = ? WHERE id = ? AND factory_id = ?").bind(kind, body, s.id, at, id, f.id).run();
    if (!r.meta.changes) fail("That entry no longer exists. Refresh the page.");
    return { ok: true, id };
  },

  async po_admin_delete_extra(env, p) {
    (await sessionUser(env, p.p_token)).requireEditor("product-options");
    await env.DB.prepare("DELETE FROM po_extras WHERE id = ?").bind(str(p.p_id)).run();
    return { ok: true };
  },

  /* Take a value or a whole row out of the tree, or bring it back. Editors of product-options.
       p_value_key '' = the whole row, for every factory of the product (dn_map.in_tree);
       otherwise that one value for this factory (and model, '' for AHUs). */
  async po_admin_set_hidden(env, p) {
    (await sessionUser(env, p.p_token)).requireEditor("product-options");
    const f = await cmFactory(env, p.p_factory_id);
    const rowKey = str(p.p_row_key), valueKey = str(p.p_value_key), hidden = bool(p.p_hidden) ? 1 : 0;
    const r = valueKey === ""
      ? await env.DB.prepare("UPDATE dn_map SET in_tree = ? WHERE product_id = ? AND row_key = ?").bind(hidden ? 0 : 1, f.product_id, rowKey).run()
      : await env.DB.prepare("UPDATE po_values SET hidden = ? WHERE factory_id = ? AND row_key = ? AND model = ? AND value_key = ?").bind(hidden, f.id, rowKey, str(p.p_model), valueKey).run();
    if (!r.meta.changes) fail("That row no longer exists. Refresh the page.");
    return { ok: true };
  },

  /* Approve values read from datasheets (they become facts for the factory: users, the Excel download and the AI see
     them) or reject them (deleted; seen again on a later datasheet, a value waits again). The super user and the
     admins of the tile Product Options sits on.
       p_items: [{ key, model, value_key }] the values; or p_all: true = every value of the factory that waits. */
  async po_admin_approve(env, p) {
    const s = await sessionUser(env, p.p_token);
    if (!poApprover(s)) fail("Only the super user or an admin of the tile Product Options sits on approves values.");
    const f = await cmFactory(env, p.p_factory_id);
    const approve = bool(p.p_approve), at = now();
    let n = 0;
    if (bool(p.p_all)) {
      const r = approve
        ? await env.DB.prepare("UPDATE po_values SET approved = 1, approved_by = ?, approved_at = ? WHERE factory_id = ? AND approved = 0").bind(s.id, at, f.id).run()
        : await env.DB.prepare("DELETE FROM po_values WHERE factory_id = ? AND approved = 0").bind(f.id).run();
      n = r.meta.changes || 0;
    } else {
      if (!isArray(p.p_items) || !p.p_items.length) fail("Choose the values first.");
      if (p.p_items.length > 500) fail("Approve up to 500 values at a time.");
      const stmts = p.p_items.map((raw) => {
        const o = isObject(raw) ? raw : {};
        return approve
          ? env.DB.prepare("UPDATE po_values SET approved = 1, approved_by = ?, approved_at = ? WHERE factory_id = ? AND row_key = ? AND model = ? AND value_key = ? AND approved = 0")
              .bind(s.id, at, f.id, str(o.key), str(o.model), str(o.value_key))
          : env.DB.prepare("DELETE FROM po_values WHERE factory_id = ? AND row_key = ? AND model = ? AND value_key = ? AND approved = 0")
              .bind(f.id, str(o.key), str(o.model), str(o.value_key));
      });
      const res = await env.DB.batch(stmts);
      n = res.reduce((a, r) => a + (r.meta.changes || 0), 0);
    }
    if (!n) fail("Nothing waits for approval there any more. Refresh the page.");
    await audit(env, s.id, approve ? "po_approve" : "po_reject", f.id, "", { values: n, all: bool(p.p_all), items: bool(p.p_all) ? [] : p.p_items });
    return { ok: true, changed: n };
  }

};
