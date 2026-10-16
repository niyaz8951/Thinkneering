/* What the AI learns, written into its map. From ai_feedback (every save over a proposal or a draft), last 30 days:
     - the answer people put instead of the AI's, the same way 3 times or more in a section  -> a rule with Answer
     - the remark people wrote instead of the AI's, the same way 3 times or more              -> a rule with Remark
   Each becomes a branch under "Learned" of the factory's map (or the map for all factories), marked "to verify":
   it does nothing until a person verifies it in Maps. Each pattern is written once (app_audit "ai_learn"), so a
   learned branch someone deleted does not come back. Runs every night (jobs.ts) and on "Write to the map". */
import type { Env } from "../env";
import { all, now, sha256 } from "../lib/sql";
import { addSeed } from "./map";

export interface Learned { map: string; title: string }

interface Pattern { factory_id: string | null; part: number; section: string; suggested: string; final: string; final_remarks: string; n: number; kind: "answer" | "remark" }

export async function learnToMaps(env: Env, productId: string | null, userId: string | null, min = 3): Promise<Learned[]> {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const where = productId ? "AND product_id = ?" : "";
  const bind = (q: D1PreparedStatement) => (productId ? q.bind(since, productId) : q.bind(since));
  const answers = await all<Omit<Pattern, "kind"> & { product_id: string }>(bind(env.DB.prepare(
    `SELECT product_id, factory_id, part, section, suggested, final, count(*) AS n,
            (SELECT f2.final_remarks FROM ai_feedback f2 WHERE f2.product_id = f.product_id AND ifnull(f2.factory_id, '') = ifnull(f.factory_id, '')
               AND f2.section = f.section AND f2.final = f.final AND f2.outcome = 'replaced' AND f2.created_at >= ?1
             GROUP BY f2.final_remarks ORDER BY count(*) DESC LIMIT 1) AS final_remarks
       FROM ai_feedback f WHERE created_at >= ?1 ${where ? "AND product_id = ?2" : ""} AND outcome = 'replaced' AND final <> '' AND section <> ''
      GROUP BY product_id, factory_id, part, section, suggested, final HAVING count(*) >= ${min | 0} ORDER BY n DESC LIMIT 30`)));
  const remarks = await all<Omit<Pattern, "kind"> & { product_id: string }>(bind(env.DB.prepare(
    `SELECT product_id, factory_id, part, section, final AS suggested, final, final_remarks, count(*) AS n FROM ai_feedback
      WHERE created_at >= ?1 ${where ? "AND product_id = ?2" : ""} AND outcome = 'edited' AND final <> '' AND final_remarks <> '' AND section <> ''
      GROUP BY product_id, factory_id, part, section, final, final_remarks HAVING count(*) >= ${min | 0} ORDER BY n DESC LIMIT 30`)));
  const found = [...answers.map((x) => ({ ...x, kind: "answer" as const })), ...remarks.map((x) => ({ ...x, kind: "remark" as const }))];
  if (!found.length) return [];

  const out: Learned[] = [];
  const at = now();
  const touched = new Set<string>();
  const stmts: D1PreparedStatement[] = [];
  const learnedOf = new Map<string, string>();
  for (const p of found) {
    const key = await sha256(["learn", p.product_id, p.factory_id || "", p.part, p.section, p.kind, p.final, p.kind === "remark" ? p.final_remarks : ""].join("|"));
    if (await env.DB.prepare("SELECT 1 FROM app_audit WHERE action = 'ai_learn' AND target = ?").bind(key).first()) continue;
    // the factory's map, else the map for all factories of the product
    const link = await env.DB.prepare(
      `SELECT l.map_id, m.name FROM ai_map_links l JOIN mp_maps m ON m.id = l.map_id
        WHERE l.role = 'rulebook' AND l.product_id = ? AND (l.factory_id = ? OR l.factory_id IS NULL) ORDER BY l.factory_id IS NULL LIMIT 1`).bind(p.product_id, p.factory_id || "").first<{ map_id: string; name: string }>();
    if (!link) continue;
    let parent = learnedOf.get(link.map_id);
    if (!parent) {
      const root = await env.DB.prepare("SELECT id FROM mp_nodes WHERE map_id = ? AND parent_id IS NULL ORDER BY sort LIMIT 1").bind(link.map_id).first<{ id: string }>();
      if (!root) continue;
      const have = await env.DB.prepare("SELECT id FROM mp_nodes WHERE map_id = ? AND parent_id = ? AND lower(title) LIKE 'learned%' LIMIT 1").bind(link.map_id, root.id).first<{ id: string }>();
      parent = have ? have.id : addSeed(env, stmts, link.map_id, root.id, { title: "Learned", notes: "Rules the AI wrote from what people changed. Verify one to switch it on; delete the wrong ones (they are not written again)." }, 1000, userId, at);
      learnedOf.set(link.map_id, parent);
    }
    const sec = p.section.replace(/^[\d.\s]+/, "").trim() || p.section;
    const partLine = p.part ? [`Part: ${p.part}`] : [];
    const seed = p.kind === "answer"
      ? { title: `${sec}: ${p.final}`.slice(0, 120),
          notes: `People answered "${p.final}" instead of the AI's "${p.suggested}" ${p.n} times in the last 30 days, in sections called "${p.section}". Check it, narrow it with When if only some clauses of the section are meant, and mark it verified to switch it on.`,
          special: [...partLine, `Section: ${sec.toLowerCase()}`, `Answer: ${p.final}`, ...(p.final_remarks ? [`Remark: ${p.final_remarks}`] : []), `Learned: ${p.n} answers, ${at.slice(0, 10)}`] }
      : { title: `${sec}: remark for ${p.final}`.slice(0, 120),
          notes: `People kept "${p.final}" but wrote this remark instead of the AI's ${p.n} times in the last 30 days, in sections called "${p.section}". Check it and mark it verified to switch it on.`,
          special: [...partLine, `Section: ${sec.toLowerCase()}`, `Answer: ${p.final}`, `Remark: ${p.final_remarks}`, `Learned: ${p.n} answers, ${at.slice(0, 10)}`] };
    addSeed(env, stmts, link.map_id, parent, seed, 100 + out.length, userId, at, 0);
    stmts.push(env.DB.prepare("INSERT INTO app_audit (id, user_id, action, target, before, after, neurons) VALUES (NULL, ?, 'ai_learn', ?, '', ?, 0)")
      .bind(userId, key, JSON.stringify({ map: link.map_id, title: seed.title, n: p.n }).slice(0, 8000)));
    touched.add(link.map_id);
    out.push({ map: link.name, title: seed.title });
  }
  for (const m of touched) stmts.push(env.DB.prepare("UPDATE mp_maps SET updated_at = ? WHERE id = ?").bind(at, m));
  for (let i = 0; i < stmts.length; i += 400) await env.DB.batch(stmts.slice(i, i + 400));
  return out;
}
