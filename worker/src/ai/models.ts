/* The models the site uses, in one place (standards A.5), and the one function that calls them.
   Every call goes through AI Gateway when AI_GATEWAY_ID is set, so it is logged and can be re-routed
   to another provider later without touching the site. */
import type { Env } from "../env";
import { fail } from "../errors";

export const MODELS = {
  embed: "@cf/baai/bge-m3",                               // 1024 dims, cosine, Vectorize index hub-vectors
  rerank: "@cf/baai/bge-reranker-base",
  draft: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",      // drafting answers, chat
  extract: "@cf/meta/llama-3.1-8b-instruct"               // requirement extraction
} as const;

export const NOT_AVAILABLE = "AI review is not available on this environment (no Workers AI binding). On the live site it is; locally run `npm run dev` with a Cloudflare login.";

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

export interface AiUsage { prompt: number; completion: number }

/* env.AI.run with the gateway, plus the token usage the model reports (when it does). */
export async function aiRun<T = unknown>(env: Env, model: string, input: Record<string, unknown>, usage?: AiUsage): Promise<T> {
  if (!env.AI) {
    if (env.AI_FAKE === "1") return (await fakeRun(model, input)) as T;
    fail(NOT_AVAILABLE, 503);
  }
  const opts: Record<string, unknown> = {};
  if (env.AI_GATEWAY_ID) opts.gateway = { id: env.AI_GATEWAY_ID, skipCache: false, cacheTtl: 3600, ...(env.AI_GATEWAY_TOKEN ? { authorization: "Bearer " + env.AI_GATEWAY_TOKEN } : {}) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out = (await (env.AI as any).run(model, input, opts)) as T & { usage?: { prompt_tokens?: number; completion_tokens?: number } };
  if (usage && out && typeof out === "object" && out.usage) {
    usage.prompt += out.usage.prompt_tokens || 0;
    usage.completion += out.usage.completion_tokens || 0;
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

/* A chat completion as plain text. */
export async function complete(env: Env, model: string, system: string, user: string, usage?: AiUsage, maxTokens = 600): Promise<string> {
  const out = await aiRun<{ response?: unknown }>(env, model, {
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    max_tokens: maxTokens, temperature: 0.1
  }, usage);
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
