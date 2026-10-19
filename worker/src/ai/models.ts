/* The models the site uses, in one place (standards A.5), and the one function that calls them.
   Every call goes through AI Gateway when AI_GATEWAY_ID is set, so it is logged and can be re-routed
   to another provider later without touching the site. */
import type { Env } from "../env";
import { fail } from "../errors";

/* Drafting uses the small model (owner, 16 Oct 2026): code does the comparing, the rules and the source checks, so
   the model only picks one of six answers from cited sources and writes a short remark. The small model is about
   8 times cheaper in neurons and several times faster; the old Thinkneering v3 site ran on it. The rule book can
   choose another per product ("AI model: large", or a model id) and "Check the AI" shows which does better. */
export const MODELS = {
  embed: "@cf/baai/bge-m3",                               // 1024 dims, cosine, Vectorize index hub-vectors
  rerank: "@cf/baai/bge-reranker-base",
  draft: "@cf/meta/llama-3.1-8b-instruct-fast",           // drafting answers (small: the default)
  large: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",      // "AI model: large" in the rule book
  extract: "@cf/meta/llama-3.1-8b-instruct-fast"          // requirement extraction (the plain 8B id is retired)
} as const;

/* The model a rule book asks for: "small" / "large" / a Workers AI id ("@cf/..."); anything else = the default. */
export function draftModel(setting?: string): string {
  const v = String(setting || "").trim();
  if (/^large$/i.test(v)) return MODELS.large;
  if (/^@(cf|hf)\/[\w.\-\/]{3,80}$/.test(v)) return v;
  return MODELS.draft;
}

/* Workers AI neurons per 1,000 tokens (in, out), from Cloudflare's price list (Oct 2026; USD 0.011 per 1,000
   neurons above the free 10,000 a day). An estimate kept per call; the dashboard has the real figure. A model not
   listed is counted at the large model's rate, so the daily budget errs on the safe side. */
const RATES: Record<string, [number, number]> = {
  "@cf/meta/llama-3.1-8b-instruct-fast": [4.119, 34.868],
  "@cf/meta/llama-3.1-8b-instruct-fp8-fast": [4.119, 34.868],
  "@cf/meta/llama-3.1-8b-instruct-fp8": [13.778, 26.128],
  "@cf/meta/llama-3.1-8b-instruct": [25.608, 75.147],
  "@cf/meta/llama-3.2-3b-instruct": [4.625, 30.475],
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": [26.668, 204.805],
  "@cf/baai/bge-m3": [1.075, 0]
};
export function neuronRate(model: string): [number, number] { return RATES[model] || RATES["@cf/meta/llama-3.3-70b-instruct-fp8-fast"]; }

export const NOT_AVAILABLE = "AI review is not available on this environment (no Workers AI binding). On the live site it is; locally run `npm run dev` with a Cloudflare login.";

/* The AI review of a whole record (ai_review_run) is off unless AI_WHOLE_REVIEW = "1" (owner, 19 Oct 2026): people read
   the specification clause by clause in Focus mode, where the AI proposes an answer for the clause on screen. */
export function wholeReview(env: Env): boolean {
  return env.AI_WHOLE_REVIEW === "1";
}
export const WHOLE_REVIEW_OFF = "The AI review of a whole specification is coming soon: its database is being built. Meanwhile, Focus mode proposes an answer for each clause as you read it.";

export function aiAvailable(env: Env): boolean {
  return !!env.AI || env.AI_FAKE === "1";
}

/* The offline stand-in (AI_FAKE = "1", env.local only): no model, every draft is a low-confidence "Noted"
   that says so in its reason. Lets the flow be tried on a laptop without a Cloudflare login. */
async function fakeRun(model: string, input: Record<string, unknown>): Promise<unknown> {
  if (model === MODELS.embed) return { data: ((input.text as string[]) || []).map(() => new Array(1024).fill(0)) };
  return { response: JSON.stringify({ compliance: "Noted", remarks: "", confidence: "low",
    reason: "Offline stand-in: this copy of the site has no AI model, so the clause was only marked Noted." }) };
}

export interface AiUsage { prompt: number; completion: number; neurons?: number }

/* Why a model call failed, in words for the person, and whether trying more clauses is pointless. */
export const QUOTA = "The free Workers AI allowance for today is used up (10,000 neurons a day: about 1,000 clauses with the small model, about 120 with the large one). It resets at 04:00 Dubai time (00:00 UTC). For whole specifications switch Workers to the Paid plan (USD 5 a month) in the Cloudflare dashboard.";
export function aiErrorText(e: unknown): { text: string; stop: boolean } {
  const m = e instanceof Error ? e.message : String(e);
  if (/4006|neuron|daily free|allocation|upgrade to/i.test(m)) return { text: QUOTA, stop: true };
  if (/\b429\b|rate limit|too many requests|capacity/i.test(m)) return { text: "Workers AI is busy or rate-limited right now (" + m.slice(0, 120) + "). Wait a minute and run the review again.", stop: true };
  if (/5007|no such model|model not found|invalid model/i.test(m)) return { text: "The AI model name is not known to Workers AI (" + m.slice(0, 120) + "). Tell the developer: worker/src/ai/models.ts.", stop: true };
  if (/authentication|not authorized|unauthorized|10000|binding/i.test(m)) return { text: "The Worker is not allowed to call Workers AI (" + m.slice(0, 120) + "). Check that the AI binding is on the Worker (Settings > Bindings).", stop: true };
  return { text: m.slice(0, 200), stop: false };
}

/* A gateway that does not exist or refuses the call is skipped for the life of this Worker instance:
   the call goes to Workers AI directly (it is still Workers AI, it is only not logged in the gateway). */
let gatewayBroken = false;

/* env.AI.run (through the gateway when one is named), plus the token usage the model reports. */
export async function aiRun<T = unknown>(env: Env, model: string, input: Record<string, unknown>, usage?: AiUsage): Promise<T> {
  if (!env.AI) {
    if (env.AI_FAKE === "1") return (await fakeRun(model, input)) as T;
    fail(NOT_AVAILABLE, 503);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ai = env.AI as any;
  type Out = T & { usage?: { prompt_tokens?: number; completion_tokens?: number } };
  let out: Out;
  if (env.AI_GATEWAY_ID && !gatewayBroken) {
    const opts = { gateway: { id: env.AI_GATEWAY_ID, skipCache: false, cacheTtl: 3600, ...(env.AI_GATEWAY_TOKEN ? { authorization: "Bearer " + env.AI_GATEWAY_TOKEN } : {}) } };
    try {
      out = (await ai.run(model, input, opts)) as Out;
    } catch (e) {
      if (aiErrorText(e).stop && !/gateway/i.test(String(e))) throw e;          // the model refused: no point in a second call
      if (/json mode|response_format|json_schema/i.test(String(e))) throw e;     // the request, not the gateway: complete() asks again
      console.warn("AI Gateway '" + env.AI_GATEWAY_ID + "' failed; calling Workers AI directly from now on.", e);
      gatewayBroken = true;
      out = (await ai.run(model, input)) as Out;
    }
  } else {
    out = (await ai.run(model, input)) as Out;
  }
  if (usage && out && typeof out === "object" && out.usage) {
    const pt = out.usage.prompt_tokens || 0, ct = out.usage.completion_tokens || 0, [ri, ro] = neuronRate(model);
    usage.prompt += pt;
    usage.completion += ct;
    usage.neurons = (usage.neurons || 0) + (pt * ri + ct * ro) / 1000;
  }
  return out;
}

/* One embedding per text (bge-m3). */
export async function embed(env: Env, texts: string[], usage?: AiUsage): Promise<number[][]> {
  if (!texts.length) return [];
  const out = await aiRun<{ data?: number[][] }>(env, MODELS.embed, { text: texts }, usage);
  const data = out && Array.isArray(out.data) ? out.data : [];
  if (data.length !== texts.length) fail("The embedding model gave an unexpected answer. Try again.", 502);
  return data;
}

/* Models that refused a JSON schema once (JSON mode is not on every model): asked without one from then on. */
const noJsonMode = new Set<string>();

/* A chat completion as plain text. With a schema, the reply's shape is held to it by Workers AI (JSON mode): a small
   model then cannot answer outside the six answers or forget a field. A model that does not support it is asked
   again without, and not asked with one again for the life of this Worker instance. */
export async function complete(env: Env, model: string, system: string, user: string, usage?: AiUsage, maxTokens = 600, schema?: Record<string, unknown>): Promise<string> {
  const input: Record<string, unknown> = {
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    max_tokens: maxTokens, temperature: 0.1
  };
  let out: { response?: unknown };
  if (schema && !noJsonMode.has(model)) {
    try {
      out = await aiRun<{ response?: unknown }>(env, model, { ...input, response_format: { type: "json_schema", json_schema: schema } }, usage);
    } catch (e) {
      if (aiErrorText(e).stop) throw e;
      console.warn("JSON mode refused by " + model + "; asking without it.", e);
      noJsonMode.add(model);
      out = await aiRun<{ response?: unknown }>(env, model, input, usage);
    }
  } else {
    out = await aiRun<{ response?: unknown }>(env, model, input, usage);
  }
  const r = out && out.response;
  // some models hand back already-parsed JSON
  return r && typeof r === "object" ? JSON.stringify(r) : String(r ?? "");
}

/* The first JSON object in a model reply (models like to wrap JSON in prose or code fences). */
export function firstJson<T = Record<string, unknown>>(text: string): T | null {
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  for (let end = e; end > s; end = text.lastIndexOf("}", end - 1)) {
    try { return JSON.parse(text.slice(s, end + 1)) as T; } catch { /* try a shorter slice */ }
  }
  return null;
}
