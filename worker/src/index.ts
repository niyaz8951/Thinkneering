/* Thinkneering Hub - the Worker.
     POST /api/rpc/<name>   the old database functions, same names and parameters (JSON body)
     GET  /api/file/<key>   a file from R2, after the session and the area's permission are checked
     GET  /api/ping         health
   Everything else is the static site (public/), served by the assets binding. */
import type { Env, Params } from "./env";
import { HubError } from "./errors";
import type { Routes } from "./router";
import { routes as app } from "./api/app";
import { routes as cm } from "./api/cm";
import { routes as dn } from "./api/dn";
import { routes as po } from "./api/po";
import { routes as pr } from "./api/pr";
import { routes as mp } from "./api/mp";
import { routes as ai } from "./api/ai";
import { serveFile } from "./api/files";
import { scheduled } from "./jobs";

export const routes: Routes = { ...app, ...cm, ...dn, ...po, ...pr, ...mp, ...ai };

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body ?? null), { status, headers: JSON_HEADERS });
}

export async function handleRpc(name: string, request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const route = Object.prototype.hasOwnProperty.call(routes, name) ? routes[name] : null;
  if (!route) return reply({ ok: false, error: "Unknown request: " + name.slice(0, 60) }, 404);
  let params: Params = {};
  if (request.method !== "POST") return reply({ ok: false, error: "Method not allowed." }, 405);
  try {
    const text = await request.text();
    params = text ? (JSON.parse(text) as Params) : {};
    if (!params || typeof params !== "object" || Array.isArray(params)) params = {};
  } catch {
    return reply({ ok: false, error: "The request body is not valid JSON." }, 400);
  }
  try {
    const out = await route(env, params, ctx);
    return reply(out);
  } catch (e) {
    if (e instanceof HubError) return reply({ ok: false, error: e.message }, e.status);
    console.error("rpc " + name, e);
    return reply({ ok: false, error: "Something went wrong on the server. Try again; if it keeps happening tell the admin." }, 500);
  }
}

const OLD_WORKERS = ["/sw.js", "/service-worker.js", "/serviceworker.js", "/sw-v1.js", "/worker.js", "/offline-sw.js", "/pwa-sw.js"];
const KILL_SW = `self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) await caches.delete(k);
  await self.registration.unregister();
  for (const c of await self.clients.matchAll({ type: "window" })) c.navigate(c.url);
})()));`;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    let path = url.pathname;
    try { path = decodeURIComponent(path); } catch { return reply({ ok: false, error: "Not found." }, 404); }
    // the site that lived on thinkneering.com before installed a service worker; browsers that still have it
    // ask for its script now and then and get this one, which empties its caches and removes itself
    if (OLD_WORKERS.includes(path)) return new Response(KILL_SW, { headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store" } });
    if (path === "/api/ping") return reply({ ok: true, env: env.ENV_NAME, at: new Date().toISOString() });
    if (path.startsWith("/api/rpc/")) return handleRpc(path.slice("/api/rpc/".length), request, env, ctx);
    if (path.startsWith("/api/file/")) return serveFile(path.slice("/api/file/".length), request, env);
    if (path.startsWith("/api/")) return reply({ ok: false, error: "Not found." }, 404);
    // page addresses stay exactly as on the DAME site (dashboard.html, tools/projects/record.html?run=...);
    // the site root is the sign-in page
    // a folder address (tools/projects/) opens its index.html, as GitHub Pages did
    if (path.endsWith("/")) return env.ASSETS.fetch(new Request(url.origin + path + "index.html" + url.search, request));
    return env.ASSETS.fetch(request);
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(scheduled(event, env));
  }
} satisfies ExportedHandler<Env>;
