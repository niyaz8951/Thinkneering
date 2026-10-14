/* Small helpers over D1. Keep SQL in the route files; keep the mechanics here. */

export function uuid(): string {
  return crypto.randomUUID();
}

export function now(): string {
  return new Date().toISOString();
}

export function plus(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* The match key of a clause: a hash of its normalised text, as md5(norm) was on Postgres. */
export async function normHash(norm: string): Promise<string> {
  return (await sha256(norm)).slice(0, 32);
}

export function str(v: unknown, max = 1 << 20): string {
  if (v == null) return "";
  return String(v).slice(0, max);
}

export function trimmed(v: unknown, max = 1 << 20): string {
  return str(v).trim().slice(0, max);
}

/* Whitespace runs collapsed to one space, then trimmed and cut. */
export function tidy(v: unknown, max = 1 << 20): string {
  return str(v).replace(/\s+/g, " ").trim().slice(0, max);
}

export function int(v: unknown, dflt = 0): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : dflt;
}

export function bool(v: unknown): boolean {
  return v === true || v === 1 || v === "true" || v === "1";
}

export function json<T>(text: unknown, dflt: T): T {
  if (text == null || text === "") return dflt;
  try { return JSON.parse(String(text)) as T; } catch { return dflt; }
}

export function isArray(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/* One row or null. */
export async function one<T = Record<string, unknown>>(stmt: D1PreparedStatement): Promise<T | null> {
  const r = await stmt.first<T>();
  return r ?? null;
}

export async function all<T = Record<string, unknown>>(stmt: D1PreparedStatement): Promise<T[]> {
  const r = await stmt.all<T>();
  return r.results ?? [];
}

/* Send statements in atomic batches of at most `size` (D1: 100 bound parameters a statement, so
   callers keep statements small; 500 statements a batch is well inside the limits). */
export async function batched(db: D1Database, stmts: D1PreparedStatement[], size = 500): Promise<void> {
  for (let i = 0; i < stmts.length; i += size) {
    await db.batch(stmts.slice(i, i + size));
  }
}

/* `?,?,?` for an IN list, and the list itself chunked so no statement passes 90 parameters. */
export function marks(n: number): string {
  return new Array(n).fill("?").join(",");
}

export function chunks<T>(list: T[], size = 90): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/* A LIKE pattern for "contains", with the user's %, _ and \ escaped (use ... LIKE ? ESCAPE '\'). */
export function like(q: string): string {
  return "%" + q.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
}
