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

/* Why a model call failed, in words for the person, and whether trying more clauses is pointless. */
export const QUOTA = "The free Workers AI allowance for today is used up (10,000 neurons a day, about 140 clauses). It resets at 04:00 Dubai time (00:00 UTC). For whole specifications switch Workers to the Paid plan (USD 5 a month) in the Cloudflare dashboard.";
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
      console.warn("AI Gateway '" + env.AI_GATEWAY_ID + "' failed; calling Workers AI directly from now on.", e);
      gatewayBroken = true;
      out = (await ai.run(model, input)) as Out;
    }
  } else {
    out = (await ai.run(model, input)) as Out;
  }
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
