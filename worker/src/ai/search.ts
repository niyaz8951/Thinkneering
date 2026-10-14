/* Similar library clauses for a clause of a specification (Feature B, search part).
   Two ways, same result shape:
     1. Vectorize (hub-vectors): the clause is embedded with bge-m3 and the index is asked for the nearest
        library clauses of the same factory (metadata filter), then every hit is re-read from D1.
     2. Lexical fallback, used when there is no Vectorize binding (local dev, tests) or the index is
        empty: word and word-pair overlap (Dice) against the answered clauses of the factory, loaded
        once per request. Deterministic, good enough for near-identical wording.
   Scores are 0..1; 1 = the same text. Answers never cross factories: the caller asks per factory. */
import type { Env } from "../env";
import { cmNorm } from "../lib/cm";
import { all, chunks, marks } from "../lib/sql";
import { embed, type AiUsage } from "./models";

export interface Similar {
  id: string; factory_id: string; spec_text: string; compliance: string; remarks: string; comments: string;
  status: string; section: string; score: number; how: "vector" | "lexical";
}

interface LibLine { id: string; factory_id: string; spec_text: string; norm_text: string; compliance: string; remarks: string; comments: string; status: string; section: string }

function grams(norm: string): { words: Set<string>; pairs: Set<string> } {
  // "50mm" and "50 mm" are the same words here (the library key keeps them apart on purpose)
  const w = norm.replace(/(\d)([a-z])/g, "$1 $2").replace(/([a-z])(\d)/g, "$1 $2").split(" ").filter(Boolean);
  const pairs = new Set<string>();
  for (let i = 0; i + 1 < w.length; i++) pairs.add(w[i] + " " + w[i + 1]);
  return { words: new Set(w), pairs };
}

function dice(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return (2 * n) / (a.size + b.size);
}

/* Word-set and word-pair similarity of two clauses (0..1). Exported for the unit tests. */
export function lexicalScore(a: string, b: string): number {
  const ga = grams(cmNorm(a)), gb = grams(cmNorm(b));
  return Math.round((0.4 * dice(ga.words, gb.words) + 0.6 * dice(ga.pairs, gb.pairs)) * 1000) / 1000;
}

/* One searcher per request: loads the factory's answered clauses once for the lexical way. */
export class ClauseSearch {
  private lib: Map<string, Promise<LibLine[]>> = new Map();
  private vectorOk: boolean | null = null;

  constructor(private env: Env, private usage?: AiUsage) {}

  private async library(factoryId: string): Promise<LibLine[]> {
    let p = this.lib.get(factoryId);
    if (!p) {
      p = all<LibLine>(this.env.DB.prepare(
        "SELECT id, factory_id, spec_text, norm_text, compliance, remarks, comments, status, section FROM cm_lines WHERE factory_id = ? AND (status = 'answered' OR comments <> '')").bind(factoryId));
      this.lib.set(factoryId, p);
    }
    return p;
  }

  /* The k nearest answered clauses of the factory, best first, excluding the clause itself. */
  async similar(factoryId: string, clause: string, k = 5, excludeId: string | null = null): Promise<Similar[]> {
    const v = await this.byVector(factoryId, clause, k, excludeId);
    if (v) return v;
    return this.byWords(factoryId, clause, k, excludeId);
  }

  private async byVector(factoryId: string, clause: string, k: number, excludeId: string | null): Promise<Similar[] | null> {
    const env = this.env;
    if (!env.VECTORS || !env.AI || this.vectorOk === false) return null;
    try {
      const [vec] = await embed(env, [clause.slice(0, 2000)], this.usage);
      const res = await env.VECTORS.query(vec, { topK: Math.min(k + 2, 20), filter: { kind: "clause", factory_id: factoryId }, returnMetadata: "none" });
      const hits = (res.matches || []).filter((m) => m.id !== excludeId);
      if (!hits.length) return null;                               // nothing indexed yet: fall back to words
      this.vectorOk = true;
      const rows = new Map<string, LibLine>();
      for (const part of chunks(hits.map((h) => h.id))) {
        const got = await all<LibLine>(env.DB.prepare(`SELECT id, factory_id, spec_text, norm_text, compliance, remarks, comments, status, section FROM cm_lines WHERE factory_id = ? AND id IN (${marks(part.length)})`).bind(factoryId, ...part));
        got.forEach((r) => rows.set(r.id, r));
      }
      return hits.map((h) => { const r = rows.get(h.id); return r ? toSimilar(r, h.score, "vector") : null; })
        .filter((x): x is Similar => !!x && (x.status === "answered" || x.comments !== "")).slice(0, k);
    } catch (e) {
      console.warn("vector search failed, using words", e);
      this.vectorOk = false;
      return null;
    }
  }

  private async byWords(factoryId: string, clause: string, k: number, excludeId: string | null): Promise<Similar[]> {
    const lib = await this.library(factoryId);
    const g = grams(cmNorm(clause));
    const scored: Similar[] = [];
    for (const l of lib) {
      if (l.id === excludeId) continue;
      const gl = grams(l.norm_text);
      const score = Math.round((0.4 * dice(g.words, gl.words) + 0.6 * dice(g.pairs, gl.pairs)) * 1000) / 1000;
      if (score >= 0.2) scored.push(toSimilar(l, score, "lexical"));
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, k);
  }
}

function toSimilar(l: LibLine, score: number, how: "vector" | "lexical"): Similar {
  return { id: l.id, factory_id: l.factory_id, spec_text: l.spec_text, compliance: l.compliance, remarks: l.remarks, comments: l.comments, status: l.status, section: l.section, score, how };
}
