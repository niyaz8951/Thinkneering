/* The bindings named in wrangler.toml. Nothing here is an account id or a secret value. */
export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  VECTORS?: VectorizeIndex;
  AI?: Ai;
  ASSETS: Fetcher;
  ENV_NAME: string;
  AI_GATEWAY_ID?: string;
  AI_FAKE?: string;          // "1" on the offline local env: a stand-in model so the AI review flow can be tried without Workers AI
  SESSION_SECRET?: string;
  AI_GATEWAY_TOKEN?: string;
}

/* The JSON body of a POST /api/rpc/<name> call: the old function parameters, p_token first. */
export type Params = Record<string, unknown>;
