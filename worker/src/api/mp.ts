/* mp_* : Maps - product knowledge as a growing tree (DAME db/schema.sql, part "MAPS").
   Same names, parameters and results as the DAME database functions.

   Who may do what (mp__rights, one function, used by every route and by /api/file):
     - every user who can open the tile the Maps tool sits on makes his own maps;
     - a map is 'private' (its owner only), 'team_read' (everyone with the tool reads it) or
       'team_edit' (everyone with the tool changes it). The owner decides;
     - map managers (the admin of the tile, and users with "Can edit" for Maps) own every shared
       map and every map whose owner was deleted. A private map is its owner's alone, also for
       the super user.
   Verifying (19 Oct 2026, owner): a branch is a fact for the AI only once it is verified, and only the super user or
   an admin of the Maps tile verifies. A branch anyone else adds or imports starts "to verify"; an edit by anyone else
   to a verified branch puts it back to "to verify". Anyone who can edit may mark a branch "to verify".

   Images: the pages still send and expect JPEG data: URLs. The bytes live in R2
   (maps/<map>/<image>.jpg and -thumb.jpg); D1 keeps the keys and the caption. Decoded on write,
   re-encoded on read; deleting a branch, a map or an image deletes its R2 objects in the same request. */
import { WIRING_TEMPLATES, wiringStatements, PRODUCT_TEMPLATES, productStatements } from "./mp-wiring";
import { seedTree, addSeed } from "../ai/map";
import { vocabSeed } from "../ai/vocab";
import type { Env, Params } from "../env";
import type { Routes } from "../router";
import { fail } from "../errors";
import { sessionUser, namesOf, type Session } from "../auth";
import { all, now, uuid, str, tidy, int, isArray, isObject, chunks, marks, like, batched } from "../lib/sql";

export type Rights = "own" | "edit" | "read" | "none";

export interface MapRow {
  id: string; name: string; share: "private" | "team_read" | "team_edit"; kind?: "knowledge" | "rulebook"; purpose?: string;
  created_by: string | null; created_at: string; updated_by: string | null; updated_at: string;
}
export interface NodeRow {
  id: string; map_id: string; parent_id: string | null; title: string; notes: string; special: string; links: string;
  sort: number; verified: number; verified_by: string | null; verified_at: string | null;
  created_by: string | null; created_at: string; updated_by: string | null; updated_at: string;
}
export interface ImageRow {
  id: string; map_id: string; node_id: string; caption: string; file_key: string; thumb_key: string; bytes: number;
  created_by: string | null; created_at: string;
}

const SHARES = ["private", "team_read", "team_edit"];
const NOT_AVAILABLE = "That map is not available. It was deleted or is no longer shared with you.";
const JPEG_PREFIX = "data:image/jpeg;base64,";

/* ---------- helpers (the mp__* functions) ---------- */

/* mp__user: the signed-in user, if his account can open the tile the Maps tool sits on. */
function hasMaps(s: Session): boolean {
  const t = s.tool("maps");
  return !!t && t.status !== "hidden" && s.canOpen(t.category_id);
}

/* Who may verify a branch: the super user and the admins of the tile the Maps tool sits on. */
export function canVerify(s: Session): boolean {
  const t = s.tool("maps");
  return s.isSuper || (!!t && s.isTileAdmin(t.category_id));
}

async function mpUser(env: Env, token: unknown): Promise<Session> {
  const s = await sessionUser(env, token);
  if (!hasMaps(s)) fail("Maps is not available for your account.");
  return s;
}

/* mp__rights: own (everything), edit (change branches), read, none. The only place rights are decided. */
export function mpRights(s: Session, m: MapRow): Rights {
  if (m.created_by === s.id) return "own";
  if ((m.share !== "private" || m.created_by == null) && s.canEdit("maps")) return "own";
  if (m.share === "team_edit") return "edit";
  if (m.share === "team_read") return "read";
  return "none";
}

/* For /api/file/<key>: the caller's rights on a map by id ("none" when it does not exist or the
   account has no Maps tool). */
export async function mpRightsFor(env: Env, s: Session, mapId: string): Promise<Rights> {
  if (!hasMaps(s)) return "none";
  const m = await env.DB.prepare("SELECT * FROM mp_maps WHERE id = ?").bind(mapId).first<MapRow>();
  return m ? mpRights(s, m) : "none";
}

/* mp__map: the map, if the user has at least the right asked for (read | edit | own). */
async function mpMap(env: Env, s: Session, id: unknown, need: "read" | "edit" | "own"): Promise<MapRow> {
  const m = await env.DB.prepare("SELECT * FROM mp_maps WHERE id = ?").bind(str(id, 64)).first<MapRow>();
  const r = m ? mpRights(s, m) : "none";
  if (!m || r === "none") fail(NOT_AVAILABLE);
  if (need === "own" && r !== "own") fail("Only the owner of this map can do this.");
  if (need === "edit" && r === "read") fail("You can read this map but not change it.");
  return m;
}

/* mp__node: the branch, if the user has the right asked for on its map. */
async function mpNode(env: Env, s: Session, id: unknown, need: "read" | "edit" | "own"): Promise<NodeRow> {
  const n = await env.DB.prepare("SELECT * FROM mp_nodes WHERE id = ?").bind(str(id, 64)).first<NodeRow>();
  if (!n) fail("That branch no longer exists. Reload the map.");
  await mpMap(env, s, n.map_id, need);
  return n;
}

function touch(env: Env, mapId: string, userId: string): D1PreparedStatement {
  return env.DB.prepare("UPDATE mp_maps SET updated_at = ?, updated_by = ? WHERE id = ?").bind(now(), userId, mapId);
}

function mpTitle(v: unknown): string {
  const t = tidy(v);
  if (!t) fail("Give the branch a name.");
  if (t.length > 120) fail("A branch name is at most 120 characters.");
  return t;
}

function mpNotes(v: unknown): string {
  const t = str(v).replace(/\r/g, "").replace(/^[ \n\t]+|[ \n\t]+$/g, "");
  if (t.length > 8000) fail("The notes of one branch are at most 8000 characters. Split them over branches.");
  return t;
}

/* Special notes as kept: short lines, empty ones dropped. */
function mpSpecial(v: unknown): string[] {
  const out = (isArray(v) ? v : []).map((x) => tidy(x)).filter(Boolean);
  if (out.length > 20) fail("A branch holds up to 20 special notes.");
  if (out.some((x) => x.length > 200)) fail("A special note is at most 200 characters. Put longer text in the notes.");
  return out;
}

/* What a link between two branches means (23 Oct 2026, owner: "interlinking branches, each line style a meaning").
   One fixed list for every map, so a line means the same everywhere; the map draws each kind in its own style.
   A link saved without one (before 23 Oct 2026) is "see" (See also). */
export const MP_RELS = ["requires", "equivalent", "excludes", "replaced", "part", "see",
  // wires of a wiring map (23 Oct 2026): power, control supply, analog signal, digital / volt-free contact, bus, earth
  "w-power", "w-control", "w-analog", "w-digital", "w-bus", "w-earth"];
/* What a wire carries besides its kind: the terminal at each end, the cable, the signal, who wires it. */
const WIRE_FIELDS = ["from_t", "to_t", "cable", "signal"];

/* Links as kept. A link leads to another branch (of a map the writer can open), to a page of the
   Standards tool, to a tool of the site, or to a web address. A link to a branch that is gone is dropped. */
async function mpLinks(env: Env, s: Session, v: unknown): Promise<Record<string, string>[]> {
  const out: Record<string, string>[] = [];
  if (!isArray(v)) return out;
  if (v.length > 12) fail("A branch holds up to 12 links.");
  for (const raw of v) {
    const x = isObject(raw) ? raw : {};
    const lbl = tidy(x.label).slice(0, 120);
    if (x.kind === "node") {
      const id = str(x.node, 64);
      if (!/^[0-9a-fA-F-]{36}$/.test(id)) fail("Choose the branch to link to.");
      const n = await env.DB.prepare("SELECT id, map_id, title FROM mp_nodes WHERE id = ?").bind(id).first<{ id: string; map_id: string; title: string }>();
      if (!n) continue;
      const m = await env.DB.prepare("SELECT * FROM mp_maps WHERE id = ?").bind(n.map_id).first<MapRow>();
      if (!m || mpRights(s, m) === "none") fail("You cannot link to a branch of a map you cannot open.");
      const rel = str(x.rel, 20).trim();
      if (rel && !MP_RELS.includes(rel)) fail("Choose what the link between the two branches means.");
      const extra: Record<string, string> = {};
      for (const f of WIRE_FIELDS) { const v = tidy(x[f]); if (v.length > 80) fail("A terminal, cable or signal is at most 80 characters."); if (v) extra[f] = v; }
      const by = str(x.by, 10).trim();
      if (by && by !== "daikin" && by !== "others") fail("Choose who wires it: Daikin (factory) or others (site).");
      if (by) extra.by = by;
      out.push({ kind: "node", node: n.id, map: n.map_id, label: lbl || n.title, ...(rel ? { rel } : {}), ...extra });
    } else if (x.kind === "standard") {
      const id = str(x.id, 80);
      if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(id)) fail("Choose the standard to link to.");
      out.push({ kind: "standard", id, label: lbl || id });
    } else if (x.kind === "tool") {
      const t = s.tool(str(x.id, 80));
      if (!t) fail("Choose the tool to link to.");
      out.push({ kind: "tool", id: t.id, label: lbl || t.name });
    } else if (x.kind === "web") {
      const url = str(x.url, 1000).trim();
      if (!/^https?:\/\/[^\s<>"]+$/i.test(url) || url.length < 11 || url.length > 500) fail("A web link starts with https:// and has no spaces.");
      out.push({ kind: "web", url, label: lbl || url });
    } else {
      fail("Choose what the link leads to.");
    }
  }
  return out;
}

function parseList<T>(text: string): T[] {
  try { const v = JSON.parse(text); return Array.isArray(v) ? (v as T[]) : []; } catch { return []; }
}

/* mp__node_json: one branch as the page receives it. `name(id)` gives full names; `images` the count. */
function nodeJson(n: NodeRow, name: (id: string | null | undefined) => string, images: number): Record<string, unknown> {
  return {
    id: n.id, parent: n.parent_id, title: n.title, notes: n.notes, special: parseList<string>(n.special), links: parseList<Record<string, string>>(n.links),
    sort: n.sort, verified: !!n.verified,
    verified_by: n.verified && n.verified_by ? name(n.verified_by) : null,
    verified_at: n.verified_at,
    updated_by: n.updated_by ? name(n.updated_by) : null,
    updated_at: n.updated_at,
    images
  };
}

async function imageCount(env: Env, nodeId: string): Promise<number> {
  const r = await env.DB.prepare("SELECT count(*) AS n FROM mp_images WHERE node_id = ?").bind(nodeId).first<{ n: number }>();
  return r ? r.n : 0;
}

async function oneNodeJson(env: Env, nodeId: string): Promise<Record<string, unknown>> {
  const n = await env.DB.prepare("SELECT * FROM mp_nodes WHERE id = ?").bind(nodeId).first<NodeRow>();
  if (!n) fail("That branch no longer exists. Reload the map.");
  const name = await namesOf(env, [n.verified_by, n.updated_by]);
  return nodeJson(n, name, await imageCount(env, nodeId));
}

/* What a map is for: knowledge, rulebook or vocabulary (a vocabulary map is kind knowledge + purpose vocabulary:
   migration 0010). */
export function kindOf(m: { kind?: string | null; purpose?: string | null }): "knowledge" | "rulebook" | "vocabulary" | "wiring" {
  return m.purpose === "vocabulary" ? "vocabulary" : m.purpose === "wiring" ? "wiring" : m.kind === "rulebook" ? "rulebook" : "knowledge";
}
/* the purpose column for a kind: vocabulary and wiring maps are kind knowledge with a purpose (no migration of the CHECK on kind) */
function purposeOf(kind: string): string { return kind === "vocabulary" || kind === "wiring" ? kind : ""; }
function mapJson(s: Session, m: MapRow, name: (id: string | null | undefined) => string): Record<string, unknown> {
  return { id: m.id, name: m.name, share: m.share, kind: kindOf(m), rights: mpRights(s, m), mine: m.created_by === s.id, owner: name(m.created_by), updated_at: m.updated_at };
}
const KINDS = ["knowledge", "rulebook", "vocabulary", "wiring"];

/* The name of a map as kept: tidy, 1 to 80 characters, unique (case-blind) among the owner's maps. */
async function mapName(env: Env, v: unknown, ownerId: string | null, exceptId: string | null, emptyMsg: string, dupMsg: string): Promise<string> {
  const t = tidy(v);
  if (!t) fail(emptyMsg);
  if (t.length > 80) fail("A map name is at most 80 characters.");
  const dup = ownerId == null
    ? await env.DB.prepare("SELECT 1 AS x FROM mp_maps WHERE created_by IS NULL AND lower(name) = lower(?) AND id <> ? LIMIT 1").bind(t, exceptId || "").first()
    : await env.DB.prepare("SELECT 1 AS x FROM mp_maps WHERE created_by = ? AND lower(name) = lower(?) AND id <> ? LIMIT 1").bind(ownerId, t, exceptId || "").first();
  if (dup) fail(dupMsg);
  return t;
}

/* The branch and everything under it (ids), nearest first. */
async function subtree(env: Env, nodeId: string): Promise<string[]> {
  const rows = await all<{ id: string }>(env.DB.prepare(
    "WITH RECURSIVE t(id) AS (SELECT id FROM mp_nodes WHERE id = ? UNION ALL SELECT c.id FROM mp_nodes c JOIN t ON c.parent_id = t.id) SELECT id FROM t").bind(nodeId));
  return rows.map((r) => r.id);
}

/* ---------- images in R2 ---------- */

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

function isJpegUrl(v: unknown): v is string {
  return typeof v === "string" && v.startsWith(JPEG_PREFIX) && B64.test(v.slice(JPEG_PREFIX.length));
}

function decodeJpeg(dataUrl: string): Uint8Array {
  const bin = atob(dataUrl.slice(JPEG_PREFIX.length));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function encodeJpeg(bytes: ArrayBuffer): string {
  const u = new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < u.length; i += 8192) bin += String.fromCharCode.apply(null, u.subarray(i, i + 8192) as unknown as number[]);
  return JPEG_PREFIX + btoa(bin);
}

async function readJpeg(env: Env, key: string): Promise<string> {
  const obj = await env.FILES.get(key);
  if (!obj) return "";
  return encodeJpeg(await obj.arrayBuffer());
}

async function deleteObjects(env: Env, keys: string[]): Promise<void> {
  for (const part of chunks(keys, 500)) if (part.length) await env.FILES.delete(part);
}

async function imageKeys(env: Env, where: "map_id" | "node_id", ids: string[]): Promise<string[]> {
  const keys: string[] = [];
  for (const part of chunks(ids)) {
    const rows = await all<{ file_key: string; thumb_key: string }>(env.DB.prepare(`SELECT file_key, thumb_key FROM mp_images WHERE ${where} IN (${marks(part.length)})`).bind(...part));
    rows.forEach((r) => keys.push(r.file_key, r.thumb_key));
  }
  return keys;
}

async function imageRow(env: Env, id: unknown): Promise<ImageRow | null> {
  return env.DB.prepare("SELECT * FROM mp_images WHERE id = ?").bind(str(id, 64)).first<ImageRow>();
}

/* ---------- routes ---------- */

export const routes: Routes = {
  /* The maps this user can open, newest change first, with what each holds. */
  async mp_list(env, p) {
    const s = await mpUser(env, p.p_token);
    const maps = (await all<MapRow>(env.DB.prepare("SELECT * FROM mp_maps ORDER BY updated_at DESC, id"))).filter((m) => mpRights(s, m) !== "none");
    const name = await namesOf(env, maps.map((m) => m.created_by));
    const stats = new Map<string, { n: number; sp: number; tv: number }>();
    const imgs = new Map<string, number>();
    for (const part of chunks(maps.map((m) => m.id))) {
      const rows = await all<{ map_id: string; n: number; sp: number; tv: number }>(env.DB.prepare(
        `SELECT map_id, count(*) AS n, coalesce(sum(json_array_length(special)), 0) AS sp, sum(CASE WHEN verified = 0 THEN 1 ELSE 0 END) AS tv
           FROM mp_nodes WHERE map_id IN (${marks(part.length)}) GROUP BY map_id`).bind(...part));
      rows.forEach((r) => stats.set(r.map_id, r));
      const ir = await all<{ map_id: string; n: number }>(env.DB.prepare(`SELECT map_id, count(*) AS n FROM mp_images WHERE map_id IN (${marks(part.length)}) GROUP BY map_id`).bind(...part));
      ir.forEach((r) => imgs.set(r.map_id, r.n));
    }
    return {
      me: s.id, can_manage: s.canEdit("maps"), can_verify: canVerify(s),
      maps: maps.map((m) => {
        const st = stats.get(m.id) || { n: 1, sp: 0, tv: 0 };
        return { id: m.id, name: m.name, share: m.share, kind: kindOf(m), rights: mpRights(s, m), mine: m.created_by === s.id, owner: name(m.created_by), updated_at: m.updated_at,
                 branches: Math.max(st.n - 1, 0), special: st.sp, to_verify: st.tv, images: imgs.get(m.id) || 0 };
      })
    };
  },

  /* A new map. p_share: private | team_read | team_edit. p_kind: knowledge (default) | vocabulary | rulebook (an AI rule book,
     started from the template of ai/map.ts). The root branch carries the map's name. */
  async mp_create(env, p) {
    const s = await mpUser(env, p.p_token);
    const share = str(p.p_share, 20) || "private";
    const kind = str(p.p_kind, 20) || "knowledge";
    if (!KINDS.includes(kind)) fail("Choose what the map is for.");
    const name = await mapName(env, p.p_name, s.id, null, "Give the map a name, usually the product.", "You already have a map with that name.");
    if (!SHARES.includes(share)) fail("Choose who the map is shared with.");
    const c = await env.DB.prepare("SELECT count(*) AS n FROM mp_maps WHERE created_by = ?").bind(s.id).first<{ n: number }>();
    if ((c?.n || 0) >= 200) fail("You have 200 maps. Delete one you no longer need first.");
    const id = uuid(), at = now(), rootId = uuid();
    const stmts: D1PreparedStatement[] = [
      env.DB.prepare("INSERT INTO mp_maps (id, name, share, kind, purpose, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, name, share, kind === "rulebook" ? "rulebook" : "knowledge", purposeOf(kind), s.id, at, s.id, at),
      env.DB.prepare(`INSERT INTO mp_nodes (id, map_id, parent_id, title, notes, sort, verified, verified_by, verified_at, created_by, created_at, updated_by, updated_at)
                      VALUES (?, ?, NULL, ?, ?, 0, 1, ?, ?, ?, ?, ?, ?)`).bind(rootId, id, name,
        kind === "rulebook" ? "An AI rule book. Link it in Compliance review > AI rules. Instructions = what the AI reads before every answer; Decision steps = the order it goes through; the Parts hold the rules; Learned = what it learned, to verify."
          : kind === "vocabulary" ? "A vocabulary: what specifications of one product ask, in their own words (one branch per component, one per requirement type under it). Link it in Compliance review > AI rules; Create from template there gives a full one."
          : kind === "wiring" ? "Wiring: the electrical connections of a unit. Branches are equipment; the lines between them are wires, each with its terminals, cable, signal and who wires it." : "",
        s.id, at, s.id, at, s.id, at)
    ];
    // an AI rule book starts from the template (instructions, decision steps, starter rules)
    // (its branches are verified only when the maker may verify; otherwise they wait for an admin)
    if (kind === "rulebook") seedTree("{product}", null).forEach((x, i) => addSeed(env, stmts, id, rootId, x, i, s.id, at, canVerify(s) ? 1 : 0));
    // a vocabulary made here starts with its guide and the standards (Create from template in AI rules gives a full one)
    if (kind === "vocabulary") vocabSeed("").forEach((x, i) => addSeed(env, stmts, id, rootId, x, i, s.id, at, canVerify(s) ? 1 : 0));
    // a wiring map may start from the Electricity template (a building's supply to its chillers, AHUs and FCUs), all "to verify"
    const template = str(p.p_template, 20);
    if (template) {
      if (kind !== "wiring" || !WIRING_TEMPLATES.includes(template)) fail("Start a wiring map blank or from the Electricity template.");
      stmts.push(...wiringStatements(env, id, rootId, template, s.id, at, canVerify(s)));
    }
    for (let i = 0; i < stmts.length; i += 400) await env.DB.batch(stmts.slice(i, i + 400));
    return { ok: true, id };
  },

  /* One map with all its branches (no image data: images are fetched per branch). */
  async mp_get(env, p) {
    const s = await mpUser(env, p.p_token);
    const m = await mpMap(env, s, p.p_map_id, "read");
    const nodes = await all<NodeRow>(env.DB.prepare("SELECT * FROM mp_nodes WHERE map_id = ? ORDER BY sort, created_at, id").bind(m.id));
    const counts = await all<{ node_id: string; n: number }>(env.DB.prepare("SELECT node_id, count(*) AS n FROM mp_images WHERE map_id = ? GROUP BY node_id").bind(m.id));
    const imgs = new Map(counts.map((c) => [c.node_id, c.n]));
    const name = await namesOf(env, [m.created_by, ...nodes.map((n) => n.verified_by), ...nodes.map((n) => n.updated_by)]);
    return { map: { ...mapJson(s, m, name), can_verify: canVerify(s) }, nodes: nodes.map((n) => nodeJson(n, name, imgs.get(n.id) || 0)) };
  },

  /* Rename a map, change who it is shared with or what it is for (p_kind) (its owner, or a map manager for a shared map).
     A null leaves that part as it is. */
  async mp_map_save(env, p) {
    const s = await mpUser(env, p.p_token);
    const m = await mpMap(env, s, p.p_map_id, "own");
    const stmts: D1PreparedStatement[] = [];
    if (p.p_name != null) {
      const name = await mapName(env, p.p_name, m.created_by, m.id, "Give the map a name, usually the product.", "There is already a map with that name.");
      stmts.push(env.DB.prepare("UPDATE mp_maps SET name = ? WHERE id = ?").bind(name, m.id));
      stmts.push(env.DB.prepare("UPDATE mp_nodes SET title = ?, updated_by = ?, updated_at = ? WHERE map_id = ? AND parent_id IS NULL").bind(name, s.id, now(), m.id));
    }
    if (p.p_share != null) {
      const share = str(p.p_share, 20);
      if (!SHARES.includes(share)) fail("Choose who the map is shared with.");
      stmts.push(env.DB.prepare("UPDATE mp_maps SET share = ? WHERE id = ?").bind(share, m.id));
    }
    if (p.p_kind != null) {
      const kind = str(p.p_kind, 20);
      if (!KINDS.includes(kind)) fail("Choose what the map is for.");
      // the AI reads a linked map as what it is linked for: a change of type takes it off those links
      if (kind !== kindOf(m)) {
        stmts.push(env.DB.prepare("DELETE FROM ai_map_links WHERE map_id = ? AND role <> ?").bind(m.id, kind));
        if (kind !== "vocabulary") stmts.push(env.DB.prepare("DELETE FROM ai_vocab_links WHERE map_id = ?").bind(m.id));
      }
      stmts.push(env.DB.prepare("UPDATE mp_maps SET kind = ?, purpose = ? WHERE id = ?").bind(kind === "rulebook" ? "rulebook" : "knowledge", purposeOf(kind), m.id));
    }
    stmts.push(touch(env, m.id, s.id));
    await env.DB.batch(stmts);
    return { ok: true };
  },

  /* Delete a map with all its branches and images (R2 objects included). */
  async mp_delete(env, p) {
    const s = await mpUser(env, p.p_token);
    const m = await mpMap(env, s, p.p_map_id, "own");
    const keys = await imageKeys(env, "map_id", [m.id]);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM mp_images WHERE map_id = ?").bind(m.id),
      env.DB.prepare("DELETE FROM mp_nodes WHERE map_id = ?").bind(m.id),
      env.DB.prepare("DELETE FROM mp_maps WHERE id = ?").bind(m.id)
    ]);
    await deleteObjects(env, keys);
    return { ok: true };
  },

  /* ---------- branches ---------- */

  /* A new branch under p_parent_id, placed last. Typed by hand, so it counts as verified by its writer. */
  async mp_node_add(env, p) {
    const s = await mpUser(env, p.p_token);
    const par = await mpNode(env, s, p.p_parent_id, "edit");
    const title = mpTitle(p.p_title);
    const c = await env.DB.prepare("SELECT count(*) AS n FROM mp_nodes WHERE map_id = ?").bind(par.map_id).first<{ n: number }>();
    if ((c?.n || 0) >= 2000) fail("A map holds up to 2000 branches. Start a second map for the rest.");
    const mx = await env.DB.prepare("SELECT max(sort) AS m FROM mp_nodes WHERE parent_id = ?").bind(par.id).first<{ m: number | null }>();
    const sort = mx && mx.m != null ? mx.m + 1 : 0;
    const id = uuid(), at = now(), v = canVerify(s);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO mp_nodes (id, map_id, parent_id, title, sort, verified, verified_by, verified_at, created_by, created_at, updated_by, updated_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, par.map_id, par.id, title, sort, v ? 1 : 0, v ? s.id : null, v ? at : null, s.id, at, s.id, at),
      touch(env, par.map_id, s.id)
    ]);
    return { ok: true, node: await oneNodeJson(env, id) };
  },

  /* Change a branch. p_patch holds only what changed: { title, notes, special: [...], links: [...] }.
     Renaming the root renames the map, which only its owner may do. */
  async mp_node_save(env, p) {
    const s = await mpUser(env, p.p_token);
    const n = await mpNode(env, s, p.p_node_id, "edit");
    const patch = p.p_patch;
    if (!isObject(patch)) fail("Nothing to save.");
    const stmts: D1PreparedStatement[] = [];
    let title = n.title, notes = n.notes, special = n.special, links = n.links;
    if ("title" in patch) {
      title = mpTitle(patch.title);
      if (n.parent_id == null && title !== n.title) {
        const m = await mpMap(env, s, n.map_id, "own");
        title = await mapName(env, title, m.created_by, m.id, "Give the branch a name.", "There is already a map with that name.");
        stmts.push(env.DB.prepare("UPDATE mp_maps SET name = ? WHERE id = ?").bind(title, m.id));
      }
    }
    if ("notes" in patch) notes = mpNotes(patch.notes);
    if ("special" in patch) special = JSON.stringify(mpSpecial(patch.special));
    if ("links" in patch) links = JSON.stringify(await mpLinks(env, s, patch.links));
    stmts.push(env.DB.prepare("UPDATE mp_nodes SET title = ?, notes = ?, special = ?, links = ?, updated_by = ?, updated_at = ? WHERE id = ?")
      .bind(title, notes, special, links, s.id, now(), n.id));
    // a verified branch changed by someone who may not verify goes back to "to verify" (the root is the map's name)
    const changed = title !== n.title || notes !== n.notes || special !== n.special || links !== n.links;
    if (changed && n.verified && n.parent_id != null && !canVerify(s))
      stmts.push(env.DB.prepare("UPDATE mp_nodes SET verified = 0, verified_by = NULL, verified_at = NULL WHERE id = ?").bind(n.id));
    stmts.push(touch(env, n.map_id, s.id));
    await env.DB.batch(stmts);
    return { ok: true, node: await oneNodeJson(env, n.id) };
  },

  /* Mark a branch verified or to verify. p_deep: the branch and everything under it. */
  async mp_node_verify(env, p) {
    const s = await mpUser(env, p.p_token);
    const n = await mpNode(env, s, p.p_node_id, "edit");
    const on = p.p_verified == null ? true : (p.p_verified === true || p.p_verified === "true" || p.p_verified === 1);
    if (on && !canVerify(s)) fail("Only the super user or an admin of the Maps tile can verify a branch. Ask one of them to check it.");
    const deep = p.p_deep === true || p.p_deep === "true" || p.p_deep === 1;
    const ids = deep ? await subtree(env, n.id) : [n.id];
    let changed = 0;
    for (const part of chunks(ids)) {
      const r = await env.DB.prepare(`UPDATE mp_nodes SET verified = ?, verified_by = ?, verified_at = ? WHERE id IN (${marks(part.length)}) AND verified <> ?`)
        .bind(on ? 1 : 0, on ? s.id : null, on ? now() : null, ...part, on ? 1 : 0).run();
      changed += r.meta.changes || 0;
    }
    await touch(env, n.map_id, s.id).run();
    return { ok: true, changed };
  },

  /* Move a branch one place up (p_dir -1) or down (+1) among the branches of its parent. */
  async mp_node_move(env, p) {
    const s = await mpUser(env, p.p_token);
    const n = await mpNode(env, s, p.p_node_id, "edit");
    if (n.parent_id == null) fail("The first branch of a map cannot be moved.");
    const ids = (await all<{ id: string }>(env.DB.prepare("SELECT id FROM mp_nodes WHERE parent_id = ? ORDER BY sort, created_at, id").bind(n.parent_id))).map((r) => r.id);
    const i = ids.indexOf(n.id);
    const j = i + (int(p.p_dir, 0) < 0 ? -1 : 1);
    if (i >= 0 && j >= 0 && j < ids.length) {
      [ids[i], ids[j]] = [ids[j], ids[i]];
      const stmts = ids.map((id, k) => env.DB.prepare("UPDATE mp_nodes SET sort = ? WHERE id = ?").bind(k, id));
      stmts.push(touch(env, n.map_id, s.id));
      await batched(env.DB, stmts);
    }
    return { ok: true, order: ids };
  },

  /* Delete a branch with everything under it and their images. The root goes only with its map. */
  async mp_node_delete(env, p) {
    const s = await mpUser(env, p.p_token);
    const n = await mpNode(env, s, p.p_node_id, "edit");
    if (n.parent_id == null) fail("This is the map itself. Delete the map instead.");
    const ids = await subtree(env, n.id);
    const keys = await imageKeys(env, "node_id", ids);
    const stmts: D1PreparedStatement[] = [];
    for (const part of chunks(ids)) {
      stmts.push(env.DB.prepare(`DELETE FROM mp_images WHERE node_id IN (${marks(part.length)})`).bind(...part));
    }
    // children before parents, so the delete is clean even with foreign keys enforced
    for (const part of chunks(ids.slice().reverse())) {
      stmts.push(env.DB.prepare(`DELETE FROM mp_nodes WHERE id IN (${marks(part.length)})`).bind(...part));
    }
    stmts.push(touch(env, n.map_id, s.id));
    await batched(env.DB, stmts);
    await deleteObjects(env, keys);
    return { ok: true };
  },

  /* Add an outline under a branch. p_items, in reading order:
       [{ depth: 0, title, notes, special: [...] }, ...]
     depth 0 = directly under p_parent_id; a line can be at most one level deeper than the line before it.
     Everything imported starts as "to verify". */
  /* A product's wiring diagram under an equipment branch of a wiring map (23 Oct 2026): p_template one of
     PRODUCT_TEMPLATES. The branch must have nothing under it yet; it gets "Layout: columns", the unit's columns (all to
     verify) and a Power wire on to the unit's incoming isolator or terminal block. Map editors only. */
  async mp_wiring_add(env, p) {
    const s = await mpUser(env, p.p_token);
    const n = await mpNode(env, s, p.p_node_id, "edit");
    const m = await env.DB.prepare("SELECT * FROM mp_maps WHERE id = ?").bind(n.map_id).first<MapRow>();
    if (!m || kindOf(m) !== "wiring") fail("A wiring diagram goes into a wiring map.");
    if (!n.parent_id) fail("Choose the equipment branch the diagram is for.");
    const template = str(p.p_template, 20);
    if (!PRODUCT_TEMPLATES[template]) fail("Choose the unit: AHU, FCU or chiller.");
    const under = await env.DB.prepare("SELECT count(*) AS n FROM mp_nodes WHERE parent_id = ?").bind(n.id).first<{ n: number }>();
    if ((under?.n || 0) > 0) fail("That branch has branches under it already. Add the diagram to an equipment branch with nothing under it.");
    const own = parseList<Record<string, string>>(n.links);
    if (own.length >= 12) fail("That branch holds 12 links already. Remove one first.");
    const c = await env.DB.prepare("SELECT count(*) AS n FROM mp_nodes WHERE map_id = ?").bind(n.map_id).first<{ n: number }>();
    const at = now();
    const built = productStatements(env, n.map_id, { id: n.id, links: own }, template, s.id, at, 0);
    if ((c?.n || 0) + built.count > 2000) fail("A map holds up to 2000 branches. Start a second map for the rest.");
    const special = parseList<string>(n.special);
    if (!special.some((x) => /^\s*layout\s*:\s*columns?\s*$/i.test(x))) special.push("Layout: columns");
    const v = canVerify(s);
    await env.DB.batch([...built.stmts,
      env.DB.prepare("UPDATE mp_nodes SET special = ?, links = ?, verified = CASE WHEN ? THEN verified ELSE 0 END, updated_by = ?, updated_at = ? WHERE id = ?")
        .bind(JSON.stringify(special), JSON.stringify(built.links), v ? 1 : 0, s.id, at, n.id),
      touch(env, n.map_id, s.id)]);
    return { ok: true, added: built.count };
  },

  async mp_import(env, p) {
    const s = await mpUser(env, p.p_token);
    const par = await mpNode(env, s, p.p_parent_id, "edit");
    const items = p.p_items;
    if (!isArray(items) || items.length === 0) fail("Nothing to add. Paste an outline with one branch name per line.");
    if (items.length > 500) fail("One import holds up to 500 branches. Import the outline in parts.");
    const c = await env.DB.prepare("SELECT count(*) AS n FROM mp_nodes WHERE map_id = ?").bind(par.map_id).first<{ n: number }>();
    if ((c?.n || 0) + items.length > 2000) fail("A map holds up to 2000 branches. Start a second map for the rest.");
    // check everything first, then write once
    const clean = items.map((raw) => {
      const x = isObject(raw) ? raw : {};
      return { depth: int(x.depth, 0), title: mpTitle(x.title), notes: mpNotes(x.notes), special: JSON.stringify(mpSpecial(x.special)) };
    });
    const mx = await env.DB.prepare("SELECT max(sort) AS m FROM mp_nodes WHERE parent_id = ?").bind(par.id).first<{ m: number | null }>();
    const nextSort = new Map<string, number>([[par.id, mx && mx.m != null ? mx.m + 1 : 0]]);
    const stmts: D1PreparedStatement[] = [];
    const stack: string[] = [];
    let prev = -1, first: string | null = null;
    const base = Date.now();
    clean.forEach((x, k) => {
      const d = Math.min(Math.max(x.depth, 0), prev + 1);
      const parent = d === 0 ? par.id : stack[d - 1];
      const sort = nextSort.get(parent) || 0;
      nextSort.set(parent, sort + 1);
      const id = uuid(), at = new Date(base + k).toISOString();
      stmts.push(env.DB.prepare(`INSERT INTO mp_nodes (id, map_id, parent_id, title, notes, special, sort, verified, created_by, created_at, updated_by, updated_at)
                                 VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`).bind(id, par.map_id, parent, x.title, x.notes, x.special, sort, s.id, at, s.id, at));
      stack.length = d; stack.push(id);
      prev = d;
      if (first == null) first = id;
    });
    stmts.push(touch(env, par.map_id, s.id));
    await batched(env.DB, stmts);
    return { ok: true, added: clean.length, first };
  },

  /* ---------- images ---------- */

  /* The images of one branch: caption and small picture. The picture itself comes from mp_image_get. */
  async mp_node_images(env, p) {
    const s = await mpUser(env, p.p_token);
    const n = await mpNode(env, s, p.p_node_id, "read");
    const rows = await all<ImageRow>(env.DB.prepare("SELECT * FROM mp_images WHERE node_id = ? ORDER BY created_at, id").bind(n.id));
    const name = await namesOf(env, rows.map((r) => r.created_by));
    const images: Record<string, unknown>[] = [];
    for (const r of rows) images.push({ id: r.id, caption: r.caption, thumb: await readJpeg(env, r.thumb_key), by: name(r.created_by), at: r.created_at });
    return { images };
  },

  async mp_image_get(env, p) {
    const s = await mpUser(env, p.p_token);
    const i = await imageRow(env, p.p_image_id);
    if (!i) fail("That image no longer exists. Reload the map.");
    await mpMap(env, s, i.map_id, "read");
    return { id: i.id, caption: i.caption, data: await readJpeg(env, i.file_key) };
  },

  /* Add an image to a branch. The page shrinks it first: p_data a JPEG data: URL of at most about
     500 KB, p_thumb a small one for the panel. Up to 8 images on a branch and 300 on a map. */
  async mp_image_add(env, p) {
    const s = await mpUser(env, p.p_token);
    const n = await mpNode(env, s, p.p_node_id, "edit");
    const data = p.p_data, thumb = p.p_thumb;
    if (!isJpegUrl(data) || !isJpegUrl(thumb)) fail("That image could not be read. Try saving it as JPG or PNG.");
    if (data.length > 700000 || thumb.length > 60000) fail("That image is still too large after shrinking. Crop it or use a smaller one.");
    const onNode = await imageCount(env, n.id);
    if (onNode >= 8) fail("A branch holds up to 8 images. Remove one first.");
    const onMap = await env.DB.prepare("SELECT count(*) AS n FROM mp_images WHERE map_id = ?").bind(n.map_id).first<{ n: number }>();
    if ((onMap?.n || 0) >= 300) fail("A map holds up to 300 images. Remove some first.");
    const id = uuid();
    const fileKey = `maps/${n.map_id}/${id}.jpg`, thumbKey = `maps/${n.map_id}/${id}-thumb.jpg`;
    const bytes = decodeJpeg(data);
    await env.FILES.put(fileKey, bytes, { httpMetadata: { contentType: "image/jpeg" } });
    await env.FILES.put(thumbKey, decodeJpeg(thumb), { httpMetadata: { contentType: "image/jpeg" } });
    await env.DB.batch([
      env.DB.prepare("INSERT INTO mp_images (id, map_id, node_id, caption, file_key, thumb_key, bytes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, n.map_id, n.id, tidy(p.p_caption).slice(0, 120), fileKey, thumbKey, bytes.length, s.id, now()),
      touch(env, n.map_id, s.id)
    ]);
    return { ok: true, id };
  },

  async mp_image_save(env, p) {
    const s = await mpUser(env, p.p_token);
    const i = await imageRow(env, p.p_image_id);
    if (!i) fail("That image no longer exists. Reload the map.");
    await mpMap(env, s, i.map_id, "edit");
    await env.DB.batch([
      env.DB.prepare("UPDATE mp_images SET caption = ? WHERE id = ?").bind(tidy(p.p_caption).slice(0, 120), i.id),
      touch(env, i.map_id, s.id)
    ]);
    return { ok: true };
  },

  async mp_image_delete(env, p) {
    const s = await mpUser(env, p.p_token);
    const i = await imageRow(env, p.p_image_id);
    if (!i) return { ok: true };
    await mpMap(env, s, i.map_id, "edit");
    await env.DB.batch([
      env.DB.prepare("DELETE FROM mp_images WHERE id = ?").bind(i.id),
      touch(env, i.map_id, s.id)
    ]);
    await deleteObjects(env, [i.file_key, i.thumb_key]);
    return { ok: true };
  },

  /* ---------- search ---------- */

  /* Find words in every map this user can open: branch names, notes, special notes, image captions.
     Plain text match; names first, then special notes, notes, captions. At most 60 branches. */
  async mp_search(env, p) {
    const s = await mpUser(env, p.p_token);
    const q = tidy(p.p_q).toLowerCase();
    if (q.length < 2) return { hits: [] };
    const maps = (await all<MapRow>(env.DB.prepare("SELECT * FROM mp_maps"))).filter((m) => mpRights(s, m) !== "none");
    const mapName = new Map(maps.map((m) => [m.id, m.name]));
    const has = (t: string) => t.toLowerCase().includes(q);
    type Hit = { rank: number; map_id: string; map: string; node_id: string; title: string; in: string; text: string };
    const hits: Hit[] = [];
    const pat = like(q);
    for (const part of chunks(maps.map((m) => m.id))) {
      // LIKE is a coarse first pass (case-blind for ASCII); the exact check is made below
      const nodes = await all<NodeRow>(env.DB.prepare(
        `SELECT n.* FROM mp_nodes n WHERE n.map_id IN (${marks(part.length)})
            AND (n.title LIKE ? ESCAPE '\\' OR n.notes LIKE ? ESCAPE '\\' OR n.special LIKE ? ESCAPE '\\'
                 OR EXISTS (SELECT 1 FROM mp_images i WHERE i.node_id = n.id AND i.caption LIKE ? ESCAPE '\\'))`).bind(...part, pat, pat, pat, pat));
      for (const n of nodes) {
        const h: Hit = { rank: 0, map_id: n.map_id, map: mapName.get(n.map_id) || "", node_id: n.id, title: n.title, in: "", text: "" };
        const sp = parseList<string>(n.special).find((x) => has(String(x)));
        if (has(n.title)) { h.rank = 1; h.in = "name"; h.text = ""; }
        else if (has(n.special)) { h.rank = 2; h.in = "special note"; h.text = sp || ""; }
        else if (has(n.notes)) { const at = n.notes.toLowerCase().indexOf(q); h.rank = 3; h.in = "notes"; h.text = n.notes.substr(Math.max(at - 40, 0), 140).replace(/\s+/g, " "); }
        else {
          const cap = (await all<{ caption: string }>(env.DB.prepare("SELECT caption FROM mp_images WHERE node_id = ? ORDER BY created_at, id").bind(n.id))).find((c) => has(c.caption));
          if (!cap) continue;
          h.rank = 4; h.in = "image caption"; h.text = cap.caption;
        }
        hits.push(h);
      }
    }
    hits.sort((a, b) => (a.rank - b.rank) || a.map.localeCompare(b.map) || a.title.localeCompare(b.title));
    return { hits: hits.slice(0, 60).map(({ rank: _r, ...h }) => h) };
  }
};
