/* GET /api/file/<key>: streams an R2 object after the session and the area's permission are checked.
   Nothing in R2 is public. Keys by area (standards A.4):
     notes/<project>/<note>.json      the project's members, its creator, admins
     maps/<map>/<image>.jpg|-thumb.jpg  readers of the map
   The token comes as ?t=<token> (pages open these in <img> and fetch). */
import type { Env } from "../env";
import { sessionUser, type Session } from "../auth";
import { HubError } from "../errors";
import { prProject } from "../lib/project";
import { mpRightsFor } from "./mp";

async function allowed(env: Env, s: Session, key: string): Promise<boolean> {
  const m = /^(notes|maps)\/([^/]+)\//.exec(key);
  if (!m) return false;
  if (m[1] === "notes") {
    try { await prProject(env, s, m[2]); return true; } catch { return false; }
  }
  const r = await mpRightsFor(env, s, m[2]);
  return r !== "none";
}

export async function serveFile(key: string, request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  try {
    const s = await sessionUser(env, url.searchParams.get("t") || "");
    if (!(await allowed(env, s, key))) return new Response("Not available.", { status: 403 });
  } catch (e) {
    return new Response(e instanceof HubError ? e.message : "Not available.", { status: 401 });
  }
  const obj = await env.FILES.get(key);
  if (!obj) return new Response("Not found.", { status: 404 });
  const h = new Headers();
  obj.writeHttpMetadata(h);
  h.set("etag", obj.httpEtag);
  h.set("Cache-Control", "private, max-age=3600");
  return new Response(obj.body, { headers: h });
}
