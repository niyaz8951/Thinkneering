import type { Env } from "../env";
import { fail } from "../errors";

export interface Factory { id: string; name: string; product_id: string; product: string; sort: number }
export interface Product { id: string; name: string; sort: number }

/* cm__factory: an active factory of an active product, or "Choose a product and factory first." */
export async function cmFactory(env: Env, id: unknown): Promise<Factory> {
  const f = typeof id === "string" && id ? await env.DB.prepare(
    "SELECT f.id, f.name, f.product_id, p.name AS product, f.sort FROM cm_factories f JOIN cm_products p ON p.id = f.product_id WHERE f.id = ? AND f.active = 1 AND p.active = 1")
    .bind(id).first<Factory>() : null;
  if (!f) fail("Choose a product and factory first.");
  return f;
}

/* dn__product: an active product, or "Choose a product first." */
export async function dnProduct(env: Env, id: unknown): Promise<Product> {
  const p = typeof id === "string" && id ? await env.DB.prepare("SELECT id, name, sort FROM cm_products WHERE id = ? AND active = 1").bind(id).first<Product>() : null;
  if (!p) fail("Choose a product first.");
  return p;
}

export async function factoriesOf(env: Env, productId: string): Promise<Factory[]> {
  const r = await env.DB.prepare("SELECT f.id, f.name, f.product_id, p.name AS product, f.sort FROM cm_factories f JOIN cm_products p ON p.id = f.product_id WHERE f.product_id = ? AND f.active = 1 ORDER BY f.sort, f.name")
    .bind(productId).all<Factory>();
  return r.results;
}
