/* Passwords: PBKDF2-SHA256 through Web Crypto, stored as pbkdf2$<iterations>$<salt>$<hash> (hex).
   Users imported from the DAME site carry bcrypt$<hash>; bcryptjs checks those once and the
   caller re-hashes with PBKDF2 (see app_login). The rules of app__check_password stay. */
import { fail } from "../errors";

export const PBKDF2_ITERATIONS = 600000;

export function checkPassword(p: unknown): string {
  const s = typeof p === "string" ? p : "";
  if (s.length < 8) fail("Password must be at least 8 characters.");
  if (s.length > 72) fail("Password must be 72 characters or fewer.");
  if (!/\S/.test(s)) fail("Password cannot be only spaces.");
  return s;
}

function hex(buf: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function unhex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, key, 256);
  return hex(bits);
}

export async function hashPassword(password: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${iterations}$${hex(salt)}$${await pbkdf2(password, salt, iterations)}`;
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/* true when the password matches the stored hash (pbkdf2$... or bcrypt$...). */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (stored.startsWith("pbkdf2$")) {
    const [, iter, salt, hash] = stored.split("$");
    const got = await pbkdf2(password, unhex(salt), parseInt(iter, 10));
    return same(got, hash);
  }
  if (stored.startsWith("bcrypt$")) {
    const bcrypt = await import("bcryptjs");
    return bcrypt.compareSync(password, stored.slice("bcrypt$".length));
  }
  return false;
}

/* An imported hash is re-hashed with PBKDF2 at the first successful login. */
export function needsRehash(stored: string): boolean {
  if (!stored.startsWith("pbkdf2$")) return true;
  return parseInt(stored.split("$")[1], 10) < PBKDF2_ITERATIONS;
}
