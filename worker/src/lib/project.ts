/* Project helpers shared by cm.ts, pr.ts, ai.ts and files.ts (pr__project, pr__log, pr__can_share). */
import type { Env } from "../env";
import type { Session } from "../auth";
import { fail } from "../errors";
import { now } from "./sql";

export interface ProjectRow {
  id: string; name: string; client_type: string; client_name: string; region: string;
  created_by: string | null; created_at: string; updated_by: string | null; updated_at: string;
}

/* The project, if this user may open it: its creator, someone it is shared with, an admin or the
   super user. Raises otherwise (never says whether the project exists). */
export async function prProject(env: Env, s: Session, id: unknown): Promise<ProjectRow> {
  const pid = typeof id === "string" ? id : "";
  const p = pid ? await env.DB.prepare("SELECT * FROM pr_projects WHERE id = ?").bind(pid).first<ProjectRow>() : null;
  if (!p) fail("That project is not available. Choose a project first.");
  if (s.prAdmin || p.created_by === s.id) return p;
  const m = await env.DB.prepare("SELECT 1 AS x FROM pr_members WHERE project_id = ? AND user_id = ?").bind(p.id, s.id).first();
  if (!m) fail("That project is not available. Choose a project first.");
  return p;
}

/* Who may share: an admin (any project), or the creator when he has "Can edit" for at least one tool. */
export function prCanShare(s: Session, p: ProjectRow): boolean {
  return s.prAdmin || (p.created_by === s.id && s.editGrants.size > 0);
}

export function prLogStmt(env: Env, projectId: string, userId: string | null, action: string, detail = ""): D1PreparedStatement {
  return env.DB.prepare("INSERT INTO pr_log (project_id, user_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(projectId, userId, action, String(detail || "").slice(0, 400), now());
}

export async function prLog(env: Env, projectId: string, userId: string | null, action: string, detail = ""): Promise<void> {
  await prLogStmt(env, projectId, userId, action, detail).run();
}

/* One history line an hour for repeated actions ("Compliance filled online", "Rows split or joined"). */
export async function prLogHourly(env: Env, projectId: string, userId: string, action: string, detail: string): Promise<void> {
  const hour = new Date(Date.now() - 3600000).toISOString();
  const seen = await env.DB.prepare("SELECT 1 AS x FROM pr_log WHERE project_id = ? AND user_id = ? AND action = ? AND detail = ? AND created_at > ? LIMIT 1")
    .bind(projectId, userId, action, detail.slice(0, 400), hour).first();
  if (!seen) await prLog(env, projectId, userId, action, detail);
}
