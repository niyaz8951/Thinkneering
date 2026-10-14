import { applyD1Migrations, env } from "cloudflare:test";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
// Vectorize and Workers AI only exist remotely; the tests use the lexical fallback and a fake model
delete (env as { VECTORS?: unknown }).VECTORS;
delete (env as { AI?: unknown }).AI;
