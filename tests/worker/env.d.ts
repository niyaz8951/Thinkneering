/* Types of the bindings in tests (Cloudflare.Env is what cloudflare:test's `env` is typed as). */
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    FILES: R2Bucket;
    VECTORS?: VectorizeIndex;
    AI?: Ai;
    ASSETS: Fetcher;
    ENV_NAME: string;
    AI_GATEWAY_ID?: string;
    TEST_MIGRATIONS: import("@cloudflare/vitest-plugin").D1Migration[];
  }
}
