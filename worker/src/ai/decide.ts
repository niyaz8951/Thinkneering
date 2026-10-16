/* One clause from evidence to a draft, the daily budget, and a small pool so model calls run side by side. */
import type { Env } from "../env";
import { draftAnswer, NoFreeAnswer, type Draft } from "./draft";
import { evidenceFor, type Context, type RunRowFull, type ClauseEvidence } from "./evidence";
import type { AiUsage } from "./models";

/* Workers AI neurons of llama-3.3-70b-instruct-fp8-fast (Cloudflare price list: USD 0.29 / M input tokens,
   USD 2.25 / M output tokens, USD 0.011 per 1,000 neurons). An estimate; the dashboard has the real figure. */
export function neuronsOf(u: AiUsage): number { return Math.round(u.prompt * 26.668 / 1000 + u.completion * 204.805 / 1000); }

/* Neurons spent today (UTC day, as Workers AI counts it) by the review and the suggestions. */
export async function neuronsToday(env: Env): Promise<number> {
  const day = new Date().toISOString().slice(0, 10) + "T00:00:00.000Z";
  const r = await env.DB.prepare("SELECT coalesce(sum(neurons), 0) AS n FROM app_audit WHERE created_at >= ? AND action IN ('ai_review_run', 'ai_suggest', 'ai_check')").bind(day).first<{ n: number }>();
  return r?.n || 0;
}

export async function modelAllowed(env: Env, ctx: Context): Promise<{ ok: boolean; why: string; used: number }> {
  if (!ctx.settings.useModel) return { ok: false, why: "The AI model is switched off in the AI map (Settings).", used: 0 };
  const used = await neuronsToday(env);
  if (ctx.settings.budget > 0 && used >= ctx.settings.budget)
    return { ok: false, why: `Today's AI budget is used up (${used} of ${ctx.settings.budget} neurons, AI map > Settings). Free sources still answer; the model is back after 04:00 Dubai time.`, used };
  return { ok: true, why: "", used };
}

export function inputFor(ctx: Context, x: RunRowFull, ev: ClauseEvidence, allowModel: boolean) {
  const s = ctx.settings;
  const cmp = ev.cmp;
  // a library-answered clause is only reopened when this project's datasheet contradicts it (and the map allows)
  return {
    clause: x.spec_text, sr: x.sr, part: ev.part, section: ev.section, parent: ev.parent, product: ctx.run.product, factory: ctx.run.factory,
    similar: ev.similar, comments: x.l_comments || "", rules: ev.rules,
    datasheet: ev.sheet.map((h) => ({ label: h.label, value: h.value, key: h.key })), units: ctx.columns,
    datasheetDecision: cmp ? { compliance: cmp.compliance, remarks: cmp.remarks, reason: cmp.reason, keys: cmp.rows.map((r) => r.key) } : null,
    conflict: s.datasheetWins ? ev.conflict : "",
    options: [...ev.options.values.map((v) => "Seen on datasheets: " + v), ...ev.options.specials.map((v) => "Special option: " + v), ...ev.options.notes.map((v) => "Note: " + v)],
    notes: ev.notes, record: ev.record, inSection: ev.inSection, project: s.projectAnswers ? ev.project : [],
    copyAt: s.copyAt, allowModel
  };
}

export async function decideClause(env: Env, ctx: Context, x: RunRowFull, allowModel: boolean, usage: AiUsage): Promise<{ draft: Draft | null; why: string; ev: ClauseEvidence }> {
  const ev = await evidenceFor(ctx, x);
  try {
    return { draft: await draftAnswer(env, inputFor(ctx, x, ev, allowModel), usage), why: "", ev };
  } catch (e) {
    if (e instanceof NoFreeAnswer) return { draft: null, why: e.message, ev };
    throw e;
  }
}

/* Run fn over items, at most n at a time, keeping the order of the results. */
export async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}
