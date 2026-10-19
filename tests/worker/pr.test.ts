import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { ok, refused, login, resetLogins, SPEC_LINES, USERS } from "./helpers";
import { rowKey } from "../../worker/src/lib/cm";

const PROJECT = { p_name: "Kifaf Tower", p_client_type: "Consultant", p_client_name: "Dar", p_region: "UAE" };
const CASING = "Casing shall be double skin construction with 50 mm thick panels and thermal break profiles.";

async function project(t: string, name = PROJECT.p_name): Promise<string> {
  return (await ok("pr_save", { p_token: t, p_id: null, ...PROJECT, p_name: name })).id;
}
/* A converted specification saved under the project (cm_save_run is already ported). */
async function convert(t: string, pid: string, lines: unknown[] = SPEC_LINES, file = "AHU spec.pdf"): Promise<string> {
  return (await ok("cm_save_run", { p_token: t, p_factory_id: "ahu-dubai", p_source: "pdf", p_file_name: file, p_lines: lines, p_project_id: pid })).run_id;
}
async function row(run: string, seq: number): Promise<any> {
  return env.DB.prepare("SELECT * FROM cm_run_lines WHERE run_id = ? AND seq = ?").bind(run, seq).first();
}
async function lineId(spec: string): Promise<string> {
  return (await env.DB.prepare("SELECT id FROM cm_lines WHERE factory_id = 'ahu-dubai' AND spec_text = ?").bind(spec).first<any>()).id;
}
async function logActions(pid: string): Promise<string[]> {
  return (await env.DB.prepare("SELECT action FROM pr_log WHERE project_id = ? ORDER BY id").bind(pid).all()).results.map((x: any) => x.action);
}
/* An AI draft on one row, as ai.ts will write it. */
async function draftOn(run: string, seq: number, compliance: string, remarks: string): Promise<string> {
  const id = "d-" + seq + "-" + Math.random().toString(36).slice(2, 8);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO ai_drafts (id, run_id, seq, compliance, remarks, reason, source) VALUES (?, ?, ?, ?, ?, 'test', 'model')").bind(id, run, seq, compliance, remarks),
    env.DB.prepare("UPDATE cm_run_lines SET compliance = ?, remarks = ?, ai_draft = 1 WHERE run_id = ? AND seq = ?").bind(compliance, remarks, run, seq)
  ]);
  return id;
}

describe("pr_* routes", () => {
  beforeEach(async () => { await resetLogins(); });

  it("pr_note_save keeps the datasheet's factory and replaces an earlier table of the same units (19 Oct 2026)", async () => {
    const sbu = await login("sbu"), sales = await login("sales");
    const pid = await project(sbu);
    const rows = (v: string) => [{ section: "General", component: "Factory", cells: ["Riyadh", "Riyadh"], key: "general||factory" }, { section: "Unit Data", component: "Panel", cells: [v, v], key: "unit data||panel" }];
    const first = await ok("pr_note_save", { p_token: sbu, p_project_id: pid, p_product_id: "ahu", p_file_names: "a.pdf", p_columns: ["U1", "U2"], p_rows: rows("50 mm"), p_factory: "Riyadh" });
    expect(first).toMatchObject({ replaced: 0, factory: "ahu-riyadh" });
    // another product, and a table of other units, stay
    await ok("pr_note_save", { p_token: sbu, p_project_id: pid, p_product_id: "fcu", p_file_names: "f.pdf", p_columns: ["U1"], p_rows: [{ component: "x", cells: ["1"] }] });
    await ok("pr_note_save", { p_token: sbu, p_project_id: pid, p_product_id: "ahu", p_file_names: "b.pdf", p_columns: ["U9"], p_rows: rows("62 mm").map((r) => ({ ...r, cells: [r.cells[0]] })) });
    // the same datasheet read again (plus a unit): replaces the first, its file goes from R2
    const again = await ok("pr_note_save", { p_token: sbu, p_project_id: pid, p_product_id: "ahu", p_file_names: "a.pdf", p_columns: ["U1", "U2", "U3"], p_rows: rows("62 mm"), p_factory: "riyadh" });
    expect(again.replaced).toBe(1);
    expect(await env.FILES.get(`notes/${pid}/${first.id}.json`)).toBeNull();
    const g = await ok("pr_get", { p_token: sbu, p_id: pid });
    expect(g.notes.map((n: any) => n.file_names + " " + n.product + " " + n.factory).sort()).toEqual(["a.pdf AHU Riyadh", "b.pdf AHU ", "f.pdf FCU "]);
    expect(g.log[0]).toMatchObject({ action: "Datasheet notes replaced" });
    // a factory the product does not have is not kept; another user's project is refused
    expect((await ok("pr_note_save", { p_token: sbu, p_project_id: pid, p_product_id: "ahu", p_file_names: "c.pdf", p_columns: ["U7"], p_rows: rows("1"), p_factory: "Mars" })).factory).toBe("");
    expect(await refused("pr_note_save", { p_token: sales, p_project_id: pid, p_product_id: "ahu", p_file_names: "a.pdf", p_columns: ["U1"], p_rows: rows("1"), p_factory: "Riyadh" })).toMatch(/not available/);
  });

  it("pr_options lists the two dropdowns; refused without a session", async () => {
    const t = await login("sbu");
    const o = await ok("pr_options", { p_token: t });
    expect(o.client_types[0]).toBe("Consultant");
    expect(o.regions).toContain("Saudi Arabia");
    expect(await refused("pr_options", {})).toBe("SESSION_EXPIRED");
  });

  it("pr_save needs the four fields, refuses a duplicate name, changes details with a history line", async () => {
    const t = await login("sbu");
    expect(await refused("pr_save", { p_token: t, ...PROJECT, p_name: " " })).toMatch(/Project name is required/);
    expect(await refused("pr_save", { p_token: t, ...PROJECT, p_client_type: "Nope" })).toMatch(/Choose the client type/);
    expect(await refused("pr_save", { p_token: t, ...PROJECT, p_client_name: "" })).toMatch(/Client name is required/);
    expect(await refused("pr_save", { p_token: t, ...PROJECT, p_region: "Mars" })).toMatch(/Choose the region/);
    const id = await project(t, "  Kifaf   Tower ");
    const saved = await env.DB.prepare("SELECT name, created_by FROM pr_projects WHERE id = ?").bind(id).first<any>();
    expect(saved).toEqual({ name: "Kifaf Tower", created_by: USERS.sbu.id });
    expect(await refused("pr_save", { p_token: t, ...PROJECT, p_name: "kifaf tower" })).toMatch(/already have a project with this name/);
    await ok("pr_save", { p_token: t, p_id: id, ...PROJECT, p_name: "Kifaf Tower 2", p_region: "Qatar" });
    expect(await logActions(id)).toEqual(["Project created", "Project details changed"]);
    const detail = await env.DB.prepare("SELECT detail FROM pr_log WHERE project_id = ? ORDER BY id DESC LIMIT 1").bind(id).first<any>();
    expect(detail.detail).toBe("Name: Kifaf Tower -> Kifaf Tower 2");
    // another user cannot change it; signed out cannot create
    const s = await login("sales");
    expect(await refused("pr_save", { p_token: s, p_id: id, ...PROJECT })).toMatch(/not available/);
    expect(await refused("pr_save", { p_token: "x", ...PROJECT })).toBe("SESSION_EXPIRED");
  });

  it("pr_list: a user sees his own and shared projects, an admin sees all", async () => {
    const sbu = await login("sbu"), sales = await login("sales"), admin = await login("teamAdmin");
    const a = await project(sbu, "Alpha");
    const b = await project(sales, "Bravo");
    await convert(sbu, a);
    expect((await ok("pr_list", { p_token: sbu })).projects.map((p: any) => p.name)).toEqual(["Alpha"]);
    const mine = await ok("pr_list", { p_token: sales });
    expect(mine.all).toBe(false);
    expect(mine.projects.map((p: any) => [p.name, p.mine, p.shared_with_me, p.compliance, p.members])).toEqual([["Bravo", true, false, 0, 0]]);
    const all = await ok("pr_list", { p_token: admin });
    expect(all.all).toBe(true);
    expect(all.projects.map((p: any) => p.name)).toEqual(["Alpha", "Bravo"]);          // A had the latest activity (the conversion)
    expect(all.projects[0]).toMatchObject({ compliance: 1, notes: 0, pending: 0, created_by: "SBU User", mine: false });
    // shared with the sales user: it appears in his list as shared
    await ok("pr_share_set", { p_token: admin, p_id: a, p_user_ids: [USERS.sales.id] });
    const shared = await ok("pr_list", { p_token: sales });
    expect(shared.projects.map((p: any) => [p.name, p.shared_with_me, p.members])).toEqual([["Alpha", true, 1], ["Bravo", false, 0]]);
    expect(await refused("pr_list", { p_token: "nope" })).toBe("SESSION_EXPIRED");
  });

  it("sharing: a plain user cannot share, a key user shares his own, a member cannot re-share or delete", async () => {
    const sbu = await login("sbu"), sales = await login("sales"), admin = await login("admin");
    const own = await project(sbu, "Plain");
    const g = await ok("pr_share_get", { p_token: sbu, p_id: own });
    expect(g).toMatchObject({ can_share: false, owner: "SBU User", members: [], users: [] });
    expect(await refused("pr_share_set", { p_token: sbu, p_id: own, p_user_ids: [USERS.sales.id] })).toMatch(/Sharing a project needs an admin/);
    // sales.user has "Can edit" for a tool: he may share what he created
    const key = await project(sales, "Key");
    const sg = await ok("pr_share_get", { p_token: sales, p_id: key });
    expect(sg.can_share).toBe(true);
    expect(sg.users.map((u: any) => u.username).sort()).toEqual(["admin", "sbu.user", "team.admin"]);     // approved people, not the creator
    const set = await ok("pr_share_set", { p_token: sales, p_id: key, p_user_ids: [USERS.sbu.id, USERS.joiner.id, "ghost"] });
    expect(set.members).toBe(1);                                                                           // pending and unknown users are dropped
    const after = await ok("pr_share_get", { p_token: sales, p_id: key });
    expect(after.members.map((m: any) => [m.name, m.added_by])).toEqual([["SBU User", "Sales User"]]);
    // the member works in the project but cannot share it on or delete it
    expect((await ok("pr_get", { p_token: sbu, p_id: key })).access).toMatchObject({ owner: false, can_share: false, can_delete: false, members: ["SBU User"] });
    expect(await refused("pr_share_set", { p_token: sbu, p_id: key, p_user_ids: [] })).toMatch(/Sharing a project needs/);
    expect(await refused("pr_delete", { p_token: sbu, p_id: key })).toMatch(/Only the person who created this project/);
    // taking the member off again logs it; an admin may share any project
    await ok("pr_share_set", { p_token: sales, p_id: key, p_user_ids: [] });
    expect(await logActions(key)).toEqual(["Project created", "Shared with", "Sharing ended for"]);
    expect(await refused("pr_get", { p_token: sbu, p_id: key })).toMatch(/not available/);
    await ok("pr_share_set", { p_token: admin, p_id: own, p_user_ids: [USERS.sales.id] });
    expect((await ok("pr_share_get", { p_token: admin, p_id: own })).members.length).toBe(1);
  });

  it("pr_get: details, records with their counts, history; refused for a stranger", async () => {
    const sbu = await login("sbu"), sales = await login("sales");
    const pid = await project(sbu);
    const run = await convert(sbu, pid);
    const g = await ok("pr_get", { p_token: sbu, p_id: pid });
    expect(g.project).toMatchObject({ name: "Kifaf Tower", client_type: "Consultant", client_name: "Dar", region: "UAE", created_by: "SBU User", updated_by: "SBU User" });
    expect(g.access).toEqual({ owner: true, can_share: false, can_delete: true, members: [] });
    expect(g.runs.length).toBe(1);
    expect(g.runs[0]).toMatchObject({ id: run, user: "SBU User", product_id: "ahu", product: "AHU", factory: "Dubai", source: "pdf", file_name: "AHU spec.pdf",
      lines: 10, from_library: 0, clauses: 4, filled: 0, answered: 0, pending: 0, approved: 0, rejected: 0 });
    expect(g.notes).toEqual([]);
    expect(g.log.map((x: any) => x.action)).toEqual(["Specification converted", "Project created"]);
    expect(await refused("pr_get", { p_token: sales, p_id: pid })).toMatch(/not available/);
    expect(await refused("pr_get", { p_token: sbu, p_id: "no-such" })).toMatch(/not available/);
  });

  it("pr_run_get: every row in order with the project's and the library's answer; rights flags per user", async () => {
    const admin = await login("admin"), sbu = await login("sbu"), sales = await login("sales");
    const pid = await project(sbu);
    const run = await convert(sbu, pid);
    await ok("cm_admin_save_answer", { p_token: admin, p_line_id: await lineId(CASING), p_compliance: "Comply", p_remarks: "50 mm panels.", p_comments: "Standard." });
    const g = await ok("pr_run_get", { p_token: sbu, p_run_id: run });
    expect(g.run).toMatchObject({ id: run, file_name: "AHU spec.pdf", user: "SBU User", product: "AHU", product_id: "ahu", factory: "Dubai", project_id: pid, project: "Kifaf Tower", client: "Dar", can_comment: false, can_review: false });
    expect(g.lines.length).toBe(10);
    expect(g.lines.map((l: any) => l.can)).toEqual([false, false, true, false, false, true, true, false, false, true]);
    expect(g.lines[5]).toEqual({ seq: 5, type: "letter", sr: "A.", spec: CASING, can: true, own: false, compliance: "", remarks: "", review: "", by: "",
      lib_compliance: "Comply", lib_remarks: "50 mm panels.", lib_comments: "Standard.", tl_review: "", ai_draft: false, ai: null });
    expect(g.lines[6].lib_compliance).toBe("");
    // an admin may write TL Review; a Compliance Maker editor who is a member may write comments
    await ok("pr_share_set", { p_token: admin, p_id: pid, p_user_ids: [USERS.sales.id] });
    expect((await ok("pr_run_get", { p_token: admin, p_run_id: run })).run).toMatchObject({ can_comment: true, can_review: true });
    expect((await ok("pr_run_get", { p_token: sales, p_run_id: run })).run).toMatchObject({ can_comment: true, can_review: false });
    // a record outside any project, a stranger, no session
    const loose = (await ok("cm_save_run", { p_token: admin, p_factory_id: "ahu-dubai", p_source: "text", p_file_name: "", p_lines: SPEC_LINES })).run_id;
    expect(await refused("pr_run_get", { p_token: admin, p_run_id: loose })).toMatch(/not in a project/);
    const other = await login("joiner").catch(() => null);
    expect(other).toBeNull();
    await ok("pr_share_set", { p_token: admin, p_id: pid, p_user_ids: [] });
    expect(await refused("pr_run_get", { p_token: sales, p_run_id: run })).toMatch(/not available/);
    expect(await refused("pr_run_get", { p_token: "", p_run_id: run })).toBe("SESSION_EXPIRED");
  });

  it("pr_run_save_line: same as the library = no review, anything else pending, both empty = library again; p_check guards the row", async () => {
    const admin = await login("admin"), sbu = await login("sbu");
    const pid = await project(sbu);
    const run = await convert(sbu, pid);
    await ok("cm_admin_save_answer", { p_token: admin, p_line_id: await lineId(CASING), p_compliance: "Comply", p_remarks: "50 mm panels." });
    const same = await ok("pr_run_save_line", { p_token: sbu, p_run_id: run, p_seq: 5, p_compliance: "Comply", p_remarks: "50 mm panels.", p_check: rowKey(CASING) });
    expect(same.review).toBe("");
    const diff = await ok("pr_run_save_line", { p_token: sbu, p_run_id: run, p_seq: 5, p_compliance: "Comply with Remarks", p_remarks: "", p_check: null });
    expect(diff.review).toBe("pending");
    expect(await row(run, 5)).toMatchObject({ compliance: "Comply with Remarks", remarks: "", review: "pending", answered_by: USERS.sbu.id });
    const cleared = await ok("pr_run_save_line", { p_token: sbu, p_run_id: run, p_seq: 5, p_compliance: "", p_remarks: "" });
    expect(cleared.review).toBe("");
    expect(await row(run, 5)).toMatchObject({ compliance: "", remarks: "", review: "", answered_by: null, answered_at: null });
    const g = await ok("pr_run_get", { p_token: sbu, p_run_id: run });
    expect(g.lines[5]).toMatchObject({ own: false, lib_compliance: "Comply" });
    // one history line an hour
    expect((await logActions(pid)).filter((a) => a === "Compliance filled online").length).toBe(1);
    // a stale page: the row with that number is another clause now
    expect(await refused("pr_run_save_line", { p_token: sbu, p_run_id: run, p_seq: 5, p_compliance: "Noted", p_remarks: "", p_check: rowKey("Something else entirely") }))
      .toBe("The rows of this record were changed since you opened it. Reload the page; nothing was saved on this row.");
    expect((await row(run, 5)).compliance).toBe("");
    // a row without a library line, a stranger, an outsider project
    expect(await refused("pr_run_save_line", { p_token: sbu, p_run_id: run, p_seq: 7, p_compliance: "Noted", p_remarks: "" })).toMatch(/cannot be answered/);
    expect(await refused("pr_run_save_line", { p_token: sbu, p_run_id: run, p_seq: 1, p_compliance: "Noted", p_remarks: "" })).toMatch(/cannot be answered/);
    const sales = await login("sales");
    expect(await refused("pr_run_save_line", { p_token: sales, p_run_id: run, p_seq: 5, p_compliance: "Noted", p_remarks: "" })).toMatch(/not available/);
  });

  it("pr_run_fill_section: keep or replace, empty clears, only clauses of that section", async () => {
    const admin = await login("admin"), sbu = await login("sbu");
    const pid = await project(sbu);
    const run = await convert(sbu, pid);
    await ok("cm_admin_save_answer", { p_token: admin, p_line_id: await lineId(CASING), p_compliance: "Comply", p_remarks: "Library remark" });
    expect(await refused("pr_run_fill_section", { p_token: sbu, p_run_id: run, p_seq: 5, p_compliance: "Comply" })).toMatch(/not a section heading/);
    expect(await refused("pr_run_fill_section", { p_token: sbu, p_run_id: run, p_seq: 4, p_compliance: "Comply", p_check: "nope" })).toMatch(/Reload the page; nothing was saved/);
    // keep: the row with a library answer is skipped, the open one is filled
    const keep = await ok("pr_run_fill_section", { p_token: sbu, p_run_id: run, p_seq: 4, p_compliance: "Noted", p_replace: false, p_check: rowKey("CASING") });
    expect(keep).toMatchObject({ ok: true, filled: 1, kept: 1 });
    expect(await row(run, 5)).toMatchObject({ compliance: "", review: "" });
    expect(await row(run, 6)).toMatchObject({ compliance: "Noted", remarks: "", review: "pending" });
    expect((await row(run, 9)).compliance).toBe("");                                                    // FANS is another section
    // replace: the library remark stays with the row; equal to the library = no review
    const rep = await ok("pr_run_fill_section", { p_token: sbu, p_run_id: run, p_seq: 4, p_compliance: "Comply", p_replace: true });
    expect(rep).toMatchObject({ ok: true, filled: 2, kept: 0 });
    expect(await row(run, 5)).toMatchObject({ compliance: "Comply", remarks: "Library remark", review: "" });
    expect(await row(run, 6)).toMatchObject({ compliance: "Comply", remarks: "", review: "pending" });
    // '' takes the typed answers off again
    const clear = await ok("pr_run_fill_section", { p_token: sbu, p_run_id: run, p_seq: 4, p_compliance: "" });
    expect(clear).toMatchObject({ ok: true, filled: 2, kept: 0 });
    expect(await row(run, 5)).toMatchObject({ compliance: "", review: "", answered_by: null });
    const sales = await login("sales");
    expect(await refused("pr_run_fill_section", { p_token: sales, p_run_id: run, p_seq: 4, p_compliance: "Comply" })).toMatch(/not available/);
  });

  it("pr_run_split: the words never change; new library lines in their place; rows renumbered; the old line dropped", async () => {
    const sbu = await login("sbu");
    const pid = await project(sbu);
    const run = await convert(sbu, pid);
    const oldLine = await lineId(CASING);
    await ok("pr_run_save_line", { p_token: sbu, p_run_id: run, p_seq: 5, p_compliance: "Comply", p_remarks: "" });
    const parts = [{ type: "letter", sr: "A.", spec: "Casing shall be double skin construction" }, { type: "text", sr: "", spec: "with 50 mm thick panels and thermal break profiles." }];
    expect(await refused("pr_run_split", { p_token: sbu, p_run_id: run, p_seq: 5, p_rows: [parts[0]] })).toMatch(/Press Enter/);
    expect(await refused("pr_run_split", { p_token: sbu, p_run_id: run, p_seq: 5, p_rows: [parts[0], { type: "text", sr: "", spec: "" }] })).toMatch(/cannot be empty/);
    expect(await refused("pr_run_split", { p_token: sbu, p_run_id: run, p_seq: 5, p_rows: [parts[0], { type: "text", sr: "", spec: "with 60 mm thick panels and thermal break profiles." }] })).toMatch(/The words were changed/);
    expect(await refused("pr_run_split", { p_token: sbu, p_run_id: run, p_seq: 5, p_rows: parts, p_check: "stale" })).toMatch(/Reload the page/);
    expect(await refused("pr_run_split", { p_token: sbu, p_run_id: run, p_seq: 99, p_rows: parts })).toMatch(/no longer exists/);
    const r = await ok("pr_run_split", { p_token: sbu, p_run_id: run, p_seq: 5, p_rows: parts, p_check: rowKey(CASING) });
    expect(r).toMatchObject({ ok: true, rows: 2 });
    const rows = (await env.DB.prepare("SELECT seq, type, sr, spec_text, line_id, compliance, review FROM cm_run_lines WHERE run_id = ? ORDER BY seq").bind(run).all()).results as any[];
    expect(rows.length).toBe(11);
    expect(rows.map((x) => x.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(rows[5]).toMatchObject({ type: "letter", sr: "A.", spec_text: parts[0].spec, compliance: "Comply", review: "pending" });   // kept its label and answer, reviewed again
    expect(rows[6]).toMatchObject({ type: "text", sr: "", spec_text: parts[1].spec, compliance: "", review: "" });
    expect(rows[7].spec_text).toMatch(/^Panels shall/);
    expect(rows[5].line_id).not.toBeNull(); expect(rows[6].line_id).not.toBeNull();
    // the library: the old line is gone, the two new ones sit under Part 2 / CASING in reading order
    expect(await env.DB.prepare("SELECT id FROM cm_lines WHERE id = ?").bind(oldLine).first()).toBeNull();
    const lines = (await env.DB.prepare("SELECT part, section, section_sr, home_run, home_seq, row_type FROM cm_lines WHERE id IN (?, ?) ORDER BY home_seq").bind(rows[5].line_id, rows[6].line_id).all()).results;
    expect(lines).toEqual([{ part: 2, section: "CASING", section_sr: "2.01", home_run: run, home_seq: 5, row_type: "letter" }, { part: 2, section: "CASING", section_sr: "2.01", home_run: run, home_seq: 6, row_type: "text" }]);
    const fans = await env.DB.prepare("SELECT home_seq FROM cm_lines WHERE spec_text LIKE 'Fans shall%'").first<any>();
    expect(fans.home_seq).toBe(10);
    const runRow = await env.DB.prepare("SELECT line_count, unique_count FROM cm_runs WHERE id = ?").bind(run).first<any>();
    expect(runRow).toEqual({ line_count: 11, unique_count: 5 });
    expect((await logActions(pid)).filter((a) => a === "Rows split or joined").length).toBe(1);
    const sales = await login("sales");
    expect(await refused("pr_run_split", { p_token: sales, p_run_id: run, p_seq: 6, p_rows: parts })).toMatch(/not available/);
  });

  it("pr_run_join: joins to the row above, keeps the answer that applies, refuses PART rows and a heading taking an answer", async () => {
    const sbu = await login("sbu");
    const pid = await project(sbu);
    const run = await convert(sbu, pid);
    expect(await refused("pr_run_join", { p_token: sbu, p_run_id: run, p_seq: 0 })).toMatch(/no row above/);
    expect(await refused("pr_run_join", { p_token: sbu, p_run_id: run, p_seq: 3 })).toMatch(/PART row cannot be joined/);
    expect(await refused("pr_run_join", { p_token: sbu, p_run_id: run, p_seq: 4 })).toMatch(/PART row cannot be joined/);
    expect(await refused("pr_run_join", { p_token: sbu, p_run_id: run, p_seq: 6, p_check: "stale" })).toMatch(/Reload the page; nothing was saved/);
    // the row below has an answer, the row above none: the answer moves up and is reviewed again
    await ok("pr_run_save_line", { p_token: sbu, p_run_id: run, p_seq: 6, p_compliance: "Noted", p_remarks: "ok" });
    const oldA = (await row(run, 5)).line_id, oldB = (await row(run, 6)).line_id;
    await ok("pr_run_join", { p_token: sbu, p_run_id: run, p_seq: 6, p_check: rowKey(SPEC_LINES[6].spec) });
    const joined = await row(run, 5);
    expect(joined.spec_text).toBe(CASING + " B. Panels shall be insulated with 50 mm injected polyurethane foam of density not less than 40 kg/m3.");
    expect(joined).toMatchObject({ type: "letter", sr: "A.", compliance: "Noted", remarks: "ok", review: "pending", answered_by: USERS.sbu.id });
    const rows = (await env.DB.prepare("SELECT seq, spec_text FROM cm_run_lines WHERE run_id = ? ORDER BY seq").bind(run).all()).results as any[];
    expect(rows.map((x) => x.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(rows[6].spec_text).toBe("Short.");
    for (const id of [oldA, oldB]) expect(await env.DB.prepare("SELECT id FROM cm_lines WHERE id = ?").bind(id).first()).toBeNull();
    const l = await env.DB.prepare("SELECT part, section, home_seq FROM cm_lines WHERE id = ?").bind(joined.line_id).first();
    expect(l).toEqual({ part: 2, section: "CASING", home_seq: 5 });
    expect((await env.DB.prepare("SELECT line_count FROM cm_runs WHERE id = ?").bind(run).first<any>()).line_count).toBe(9);
    // a heading cannot take a row that carries an answer or a TL review
    const admin = await login("admin");
    await ok("pr_run_save_review", { p_token: admin, p_run_id: run, p_seq: 2, p_text: "check this" });
    expect(await refused("pr_run_join", { p_token: sbu, p_run_id: run, p_seq: 2 })).toMatch(/row above is a heading/);
    await ok("pr_run_save_review", { p_token: admin, p_run_id: run, p_seq: 2, p_text: "" });
    await ok("pr_run_join", { p_token: sbu, p_run_id: run, p_seq: 2 });
    expect(await row(run, 1)).toMatchObject({ type: "section", line_id: null, compliance: "" });
    expect(await row(run, 2)).toMatchObject({ type: "part" });
    const sales = await login("sales");
    expect(await refused("pr_run_join", { p_token: sales, p_run_id: run, p_seq: 4 })).toMatch(/not available/);
  });

  it("pr_submit_answers: rows matched by their text; stored and pending counts; the last of a repeated clause wins", async () => {
    const admin = await login("admin"), sbu = await login("sbu");
    const pid = await project(sbu);
    const run = await convert(sbu, pid);
    await ok("cm_admin_save_answer", { p_token: admin, p_line_id: await lineId(CASING), p_compliance: "Comply", p_remarks: "" });
    expect(await refused("pr_submit_answers", { p_token: sbu, p_run_id: run, p_rows: [] })).toMatch(/No rows were found/);
    const r = await ok("pr_submit_answers", { p_token: sbu, p_run_id: run, p_rows: [
      { spec: "CASING", compliance: "Comply", remarks: "" },                                              // a heading: ignored
      { spec: "casing shall be double skin construction with 50 mm thick panels and thermal break profiles", compliance: "Comply", remarks: "" },   // same as the library
      { spec: SPEC_LINES[6].spec, compliance: "Not Comply", remarks: "first" },
      { spec: SPEC_LINES[6].spec, compliance: "Not Comply", remarks: "last" },
      { spec: SPEC_LINES[9].spec, compliance: "", remarks: "" },                                            // empty: nothing to store
      { spec: "Unknown clause nobody converted.", compliance: "Comply", remarks: "" }
    ] });
    expect(r).toMatchObject({ ok: true, rows: 6, stored: 2, pending: 1 });
    expect(await row(run, 5)).toMatchObject({ compliance: "Comply", review: "" });
    expect(await row(run, 6)).toMatchObject({ compliance: "Not Comply", remarks: "last", review: "pending" });
    expect((await row(run, 9)).compliance).toBe("");
    const log = await env.DB.prepare("SELECT detail FROM pr_log WHERE project_id = ? AND action = 'Filled compliance uploaded'").bind(pid).first<any>();
    expect(log.detail).toBe("2 answers saved, 1 sent for review (AHU spec.pdf)");
    const sales = await login("sales");
    expect(await refused("pr_submit_answers", { p_token: sales, p_run_id: run, p_rows: [{ spec: CASING, compliance: "Noted" }] })).toMatch(/not available/);
  });

  it("review: editors list and decide; approve writes the library and settles the same answer elsewhere; an answered line is kept", async () => {
    const sbu = await login("sbu"), sales = await login("sales"), admin = await login("admin");
    const p1 = await project(sbu, "One"), p2 = await project(sbu, "Two");
    const run1 = await convert(sbu, p1), run2 = await convert(sbu, p2, SPEC_LINES, "second.pdf");
    await ok("pr_run_save_line", { p_token: sbu, p_run_id: run1, p_seq: 5, p_compliance: "Comply", p_remarks: "50 mm" });
    await ok("pr_run_save_line", { p_token: sbu, p_run_id: run2, p_seq: 5, p_compliance: "Comply", p_remarks: "50 mm" });
    await ok("pr_run_save_line", { p_token: sbu, p_run_id: run2, p_seq: 6, p_compliance: "Noted", p_remarks: "" });
    expect(await refused("pr_review_list", { p_token: sbu })).toMatch(/Edit access/);
    const list = await ok("pr_review_list", { p_token: sales, p_status: "pending" });
    expect(list.counts).toEqual({ pending: 3, approved: 0, rejected: 0, all: 3 });
    expect(list.total).toBe(3);
    expect(list.items.map((x: any) => [x.project, x.seq])).toEqual([["One", 5], ["Two", 5], ["Two", 6]]);
    expect(list.items[0]).toMatchObject({ run: run1, sr: "A.", spec: CASING, compliance: "Comply", remarks: "50 mm", review: "pending", by: "SBU User", client: "Dar", region: "UAE",
      product: "AHU", factory: "Dubai", file_name: "AHU spec.pdf", lib_compliance: "", lib_remarks: "", lib_answered: false, reviewed_by: "", reviewed_at: null });
    const page = await ok("pr_review_list", { p_token: sales, p_status: "pending", p_limit: 1, p_offset: 1 });
    expect(page.items.map((x: any) => x.run)).toEqual([run2]);
    // the reviewer's line check
    expect(await refused("pr_review_decide", { p_token: sales, p_run_id: run1, p_seq: 5, p_decision: "approve", p_line_id: "other-line" })).toMatch(/Reload the page and decide again/);
    expect(await refused("pr_review_decide", { p_token: sales, p_run_id: run1, p_seq: 5, p_decision: "approve", p_compliance: "", p_remarks: "" })).toMatch(/cannot be empty/);
    expect(await refused("pr_review_decide", { p_token: sales, p_run_id: run1, p_seq: 5, p_decision: "maybe" })).toMatch(/Unknown decision/);
    expect(await refused("pr_review_decide", { p_token: sbu, p_run_id: run1, p_seq: 5, p_decision: "approve" })).toMatch(/Edit access/);
    // approve as corrected here: the library gets it, the other project's identical answer is approved with it
    await ok("pr_review_decide", { p_token: sales, p_run_id: run1, p_seq: 5, p_decision: "approve", p_compliance: "Comply", p_remarks: "50 mm", p_line_id: await lineId(CASING) });
    const l = await env.DB.prepare("SELECT status, compliance, remarks, answer_source, answered_by FROM cm_lines WHERE id = ?").bind(await lineId(CASING)).first();
    expect(l).toEqual({ status: "answered", compliance: "Comply", remarks: "50 mm", answer_source: "approved", answered_by: USERS.sales.id });
    expect((await env.DB.prepare("SELECT source, run_id FROM cm_answer_log").first<any>())).toEqual({ source: "approved", run_id: run1 });
    expect(await row(run1, 5)).toMatchObject({ review: "approved", reviewed_by: USERS.sales.id });
    expect(await row(run2, 5)).toMatchObject({ review: "approved" });
    expect((await logActions(p1)).pop()).toBe("Answer approved for the library");
    // the library already has an answer: a different one from a project is refused, the same one passes
    await ok("pr_run_save_line", { p_token: sbu, p_run_id: run2, p_seq: 5, p_compliance: "Not Comply", p_remarks: "" });
    expect(await refused("pr_review_decide", { p_token: admin, p_run_id: run2, p_seq: 5, p_decision: "approve" }))
      .toBe("The library already has an answer for this clause, so it was kept. Change it in the Compliance and Remarks boxes if it needs correcting.");
    await ok("pr_review_decide", { p_token: admin, p_run_id: run2, p_seq: 5, p_decision: "approve", p_compliance: "Comply", p_remarks: "50 mm" });
    // reject stays in the project only
    await ok("pr_review_decide", { p_token: sales, p_run_id: run2, p_seq: 6, p_decision: "reject" });
    expect(await row(run2, 6)).toMatchObject({ review: "rejected", compliance: "Noted" });
    expect((await env.DB.prepare("SELECT status FROM cm_lines WHERE spec_text = ?").bind(SPEC_LINES[6].spec).first<any>()).status).toBe("open");
    expect(await refused("pr_review_decide", { p_token: sales, p_run_id: run2, p_seq: 9, p_decision: "reject" })).toMatch(/no longer waiting/);
    const done = await ok("pr_review_list", { p_token: sales, p_status: "all" });
    expect(done.counts).toEqual({ pending: 0, approved: 2, rejected: 1, all: 3 });
    expect(done.total).toBe(3);
    const g = await ok("pr_get", { p_token: sbu, p_id: p2 });
    expect(g.runs[0]).toMatchObject({ answered: 2, filled: 2, pending: 0, approved: 1, rejected: 1 });
  });

  it("TL Review is written by admins only; Internal Comments by Compliance Maker editors only", async () => {
    const sbu = await login("sbu"), sales = await login("sales"), admin = await login("teamAdmin");
    const pid = await project(sbu);
    const run = await convert(sbu, pid);
    await ok("pr_share_set", { p_token: admin, p_id: pid, p_user_ids: [USERS.sales.id] });
    expect(await refused("pr_run_save_review", { p_token: sbu, p_run_id: run, p_seq: 5, p_text: "x" })).toMatch(/Only an admin or the super user/);
    expect(await refused("pr_run_save_review", { p_token: sales, p_run_id: run, p_seq: 5, p_text: "x" })).toMatch(/Only an admin or the super user/);
    expect(await refused("pr_run_save_review", { p_token: admin, p_run_id: run, p_seq: 4, p_text: "x" })).toMatch(/cannot carry a review/);
    expect(await refused("pr_run_save_review", { p_token: admin, p_run_id: run, p_seq: 5, p_text: "x", p_check: "stale" })).toMatch(/Reload the page; nothing was saved/);
    await ok("pr_run_save_review", { p_token: admin, p_run_id: run, p_seq: 5, p_text: "  Check the thickness. ", p_check: rowKey(CASING) });
    expect((await row(run, 5)).tl_review).toBe("Check the thickness.");
    expect(await refused("pr_run_save_comment", { p_token: sbu, p_run_id: run, p_seq: 5, p_comments: "x" })).toMatch(/Edit access/);
    expect(await refused("pr_run_save_comment", { p_token: sales, p_run_id: run, p_seq: 4, p_comments: "x" })).toMatch(/cannot carry a comment/);
    await ok("pr_run_save_comment", { p_token: sales, p_run_id: run, p_seq: 5, p_comments: "Ask the factory.", p_check: rowKey(CASING) });
    const g = await ok("pr_run_get", { p_token: sbu, p_run_id: run });
    expect(g.lines[5]).toMatchObject({ tl_review: "Check the thickness.", lib_comments: "Ask the factory." });
    expect((await env.DB.prepare("SELECT comments FROM cm_lines WHERE id = ?").bind(await lineId(CASING)).first<any>()).comments).toBe("Ask the factory.");
    // an editor who is not in the project cannot comment there
    await ok("pr_share_set", { p_token: admin, p_id: pid, p_user_ids: [] });
    expect(await refused("pr_run_save_comment", { p_token: sales, p_run_id: run, p_seq: 5, p_comments: "x" })).toMatch(/not available/);
  });

  it("datasheet notes: the rows go to R2, the table comes back whole, deleting removes the file", async () => {
    const sbu = await login("sbu"), sales = await login("sales");
    const pid = await project(sbu);
    const columns = ["FAHU-01", "FAHU-02"], rows = [{ kind: "section", section: "Unit data" }, { section: "Unit data", component: "Panel", cells: ["50 mm", "50 mm"] }, { kind: "row", section: "Unit data", component: "Roof", cells: ["Yes", "No"] }];
    expect(await refused("pr_note_save", { p_token: sbu, p_project_id: pid, p_product_id: "ahu", p_file_names: "x.pdf", p_columns: columns, p_rows: [] })).toMatch(/no table to save/);
    expect(await refused("pr_note_save", { p_token: sbu, p_project_id: pid, p_product_id: "nope", p_file_names: "x.pdf", p_columns: columns, p_rows: rows })).toMatch(/Choose a product first/);
    expect(await refused("pr_note_save", { p_token: sales, p_project_id: pid, p_product_id: "ahu", p_file_names: "x.pdf", p_columns: columns, p_rows: rows })).toMatch(/not available/);
    const saved = await ok("pr_note_save", { p_token: sbu, p_project_id: pid, p_product_id: "ahu", p_file_names: "FAHU-01.pdf, FAHU-02.pdf", p_columns: columns, p_rows: rows });
    const key = `notes/${pid}/${saved.id}.json`;
    const meta = await env.DB.prepare("SELECT units, row_count, columns, file_key, bytes FROM pr_notes WHERE id = ?").bind(saved.id).first<any>();
    expect(meta).toMatchObject({ units: 2, row_count: 2, columns: JSON.stringify(columns), file_key: key });
    expect(meta.bytes).toBeGreaterThan(0);
    expect(await (await env.FILES.get(key))!.json()).toEqual({ rows });
    const got = await ok("pr_note_get", { p_token: sbu, p_note_id: saved.id });
    expect(got).toMatchObject({ id: saved.id, file_names: "FAHU-01.pdf, FAHU-02.pdf", columns, rows, user: "SBU User", project_id: pid, project: "Kifaf Tower", product: "AHU" });
    expect(await refused("pr_note_get", { p_token: sales, p_note_id: saved.id })).toMatch(/not available/);
    expect(await refused("pr_note_get", { p_token: sbu, p_note_id: "nope" })).toMatch(/no longer exists/);
    const g = await ok("pr_get", { p_token: sbu, p_id: pid });
    expect(g.notes[0]).toMatchObject({ id: saved.id, product: "AHU", units: 2, rows: 2, user: "SBU User" });
    expect(g.log[0]).toMatchObject({ action: "Datasheet notes saved", detail: "2 units, FAHU-01.pdf, FAHU-02.pdf" });
    // delete the record: the file goes too
    expect(await refused("pr_delete_record", { p_token: sales, p_kind: "note", p_id: saved.id })).toMatch(/not available/);
    expect(await refused("pr_delete_record", { p_token: sbu, p_kind: "thing", p_id: saved.id })).toMatch(/Unknown record type/);
    await ok("pr_delete_record", { p_token: sbu, p_kind: "note", p_id: saved.id });
    expect(await env.FILES.get(key)).toBeNull();
    expect(await refused("pr_delete_record", { p_token: sbu, p_kind: "note", p_id: saved.id })).toMatch(/no longer exists/);
    expect((await logActions(pid)).pop()).toBe("Datasheet notes deleted");
  });

  it("pr_export: details plus every compliance line with the answer that applies, and the tables", async () => {
    const admin = await login("admin"), sbu = await login("sbu");
    const pid = await project(sbu);
    const run = await convert(sbu, pid);
    await ok("cm_admin_save_answer", { p_token: admin, p_line_id: await lineId(CASING), p_compliance: "Comply", p_remarks: "lib", p_comments: "note" });
    await ok("pr_run_save_line", { p_token: sbu, p_run_id: run, p_seq: 6, p_compliance: "Noted", p_remarks: "own" });
    await ok("pr_note_save", { p_token: sbu, p_project_id: pid, p_product_id: "fcu", p_file_names: "f.pdf", p_columns: ["U1"], p_rows: [{ component: "x", cells: ["1"] }] });
    const e = await ok("pr_export", { p_token: sbu, p_id: pid });
    expect(e.project.name).toBe("Kifaf Tower");
    expect(e.runs.length).toBe(1);
    expect(e.compliance.length).toBe(10);
    expect(e.compliance[5]).toEqual({ run, seq: 5, type: "letter", sr: "A.", spec: CASING, compliance: "Comply", remarks: "lib", source: "From the library", comments: "note", by: "" });
    expect(e.compliance[6]).toMatchObject({ compliance: "Noted", remarks: "own", source: "Project answer, waiting for review", by: "SBU User" });
    expect(e.compliance[7]).toMatchObject({ spec: "Short.", compliance: "", remarks: "", source: "", comments: "", by: "" });
    expect(e.tables.length).toBe(1);
    expect(e.tables[0]).toMatchObject({ product: "FCU", file_names: "f.pdf", columns: ["U1"], rows: [{ component: "x", cells: ["1"] }] });
    expect((await logActions(pid)).pop()).toBe("Project downloaded");
    const sales = await login("sales");
    expect(await refused("pr_export", { p_token: sales, p_id: pid })).toMatch(/not available/);
  });

  it("pr_delete_record 'run' and pr_delete: records leave the project, pending reviews are withdrawn, files are removed", async () => {
    const sbu = await login("sbu"), admin = await login("teamAdmin");
    const pid = await project(sbu);
    const run1 = await convert(sbu, pid), run2 = await convert(sbu, pid, SPEC_LINES, "b.pdf");
    await ok("pr_run_save_line", { p_token: sbu, p_run_id: run1, p_seq: 5, p_compliance: "Noted", p_remarks: "" });
    await ok("pr_run_save_line", { p_token: sbu, p_run_id: run2, p_seq: 5, p_compliance: "Noted", p_remarks: "" });
    const note = (await ok("pr_note_save", { p_token: sbu, p_project_id: pid, p_product_id: "ahu", p_file_names: "n.pdf", p_columns: ["U1"], p_rows: [{ cells: ["1"] }] })).id;
    await ok("pr_share_set", { p_token: admin, p_id: pid, p_user_ids: [USERS.sales.id] });
    await ok("pr_delete_record", { p_token: sbu, p_kind: "run", p_id: run1 });
    expect(await env.DB.prepare("SELECT project_id FROM cm_runs WHERE id = ?").bind(run1).first()).toEqual({ project_id: null });
    expect(await row(run1, 5)).toMatchObject({ compliance: "Noted", review: "" });
    expect(await refused("pr_delete_record", { p_token: sbu, p_kind: "run", p_id: run1 })).toMatch(/no longer exists/);
    expect((await logActions(pid)).pop()).toBe("Compliance record removed");
    // the whole project: a member cannot; the creator can; conversions stay in the library's history
    const sales = await login("sales");
    expect(await refused("pr_delete", { p_token: sales, p_id: pid })).toMatch(/Only the person who created/);
    await ok("pr_delete", { p_token: sbu, p_id: pid });
    expect(await env.DB.prepare("SELECT 1 AS x FROM pr_projects WHERE id = ?").bind(pid).first()).toBeNull();
    expect(await env.DB.prepare("SELECT count(*) AS n FROM pr_notes").first<any>()).toEqual({ n: 0 });
    expect(await env.DB.prepare("SELECT count(*) AS n FROM pr_members").first<any>()).toEqual({ n: 0 });
    expect(await env.DB.prepare("SELECT count(*) AS n FROM pr_log").first<any>()).toEqual({ n: 0 });
    expect(await env.FILES.get(`notes/${pid}/${note}.json`)).toBeNull();
    expect(await env.DB.prepare("SELECT project_id FROM cm_runs WHERE id = ?").bind(run2).first()).toEqual({ project_id: null });
    expect(await row(run2, 5)).toMatchObject({ review: "" });
    expect(await env.DB.prepare("SELECT count(*) AS n FROM cm_lines").first<any>()).toEqual({ n: 4 });
    expect(await refused("pr_delete", { p_token: sbu, p_id: pid })).toMatch(/not available/);
    // an admin may delete another person's project
    const other = await project(sbu, "Other");
    await ok("pr_delete", { p_token: admin, p_id: other });
    expect((await ok("pr_list", { p_token: sbu })).projects).toEqual([]);
  });

  it("pr_admin_summary: full numbers for Projects-tile admins, a limited result for other admins, refused for users", async () => {
    const admin = await login("admin"), sbu = await login("sbu"), sales = await login("sales");
    const pid = await project(sbu);
    const run = await convert(sbu, pid);
    await project(sales, "Saudi job").then((id) => ok("pr_save", { p_token: sales, p_id: id, ...PROJECT, p_name: "Saudi job", p_region: "Saudi Arabia" }));
    await ok("pr_run_save_line", { p_token: sbu, p_run_id: run, p_seq: 5, p_compliance: "Noted", p_remarks: "" });
    await ok("pr_note_save", { p_token: sbu, p_project_id: pid, p_product_id: "fcu", p_file_names: "f.pdf", p_columns: ["U1"], p_rows: [{ cells: ["1"] }] });
    await env.DB.prepare("INSERT INTO dn_map (product_id, row_key, reviewed) VALUES ('ahu', 'unit data||panel', 0), ('ahu', 'unit data||roof', 1)").run();
    expect(await refused("pr_admin_summary", { p_token: sbu })).toMatch(/Admin access required/);
    const full = await ok("pr_admin_summary", { p_token: admin });
    expect(full).toMatchObject({ pending_users: 1, pending_answers: 1, new_rows: 1, projects: 2,
      by_region: [{ name: "Saudi Arabia", n: 1 }, { name: "UAE", n: 1 }], by_client_type: [{ name: "Consultant", n: 2 }], by_product: [{ name: "AHU", n: 1 }, { name: "FCU", n: 1 }] });
    // an admin of the SBU tile only is not an admin for Projects (on the General tile)
    await ok("app_admin_set_user", { p_token: admin, p_user_id: USERS.joiner.id, p_status: "approved", p_role: "admin", p_categories: [], p_admin_categories: ["sbu"] });
    const j = await login("joiner");
    const limited = await ok("pr_admin_summary", { p_token: j });
    expect(limited).toMatchObject({ pending_users: 0, pending_answers: 0, new_rows: 0, projects: 0, limited: true, by_region: [], by_client_type: [], by_product: [] });
    expect((await ok("pr_list", { p_token: j })).all).toBe(false);
  });

  it("AI drafts: shown as drafts, not counted as answers, decided by the person's save", async () => {
    const admin = await login("admin"), sbu = await login("sbu"), sales = await login("sales");
    const pid = await project(sbu);
    const run = await convert(sbu, pid);
    const d5 = await draftOn(run, 5, "Comply", "Drafted 50 mm");
    const d6 = await draftOn(run, 6, "Comply", "Drafted foam");
    const d9 = await draftOn(run, 9, "Noted", "");
    const g = await ok("pr_run_get", { p_token: sbu, p_run_id: run });
    expect(g.lines[5]).toMatchObject({ own: true, compliance: "Comply", remarks: "Drafted 50 mm", review: "", ai_draft: true });
    expect(g.lines[2].ai_draft).toBe(false);
    expect((await ok("pr_get", { p_token: sbu, p_id: pid })).runs[0]).toMatchObject({ clauses: 4, filled: 3, answered: 0, pending: 0 });
    const e = await ok("pr_export", { p_token: sbu, p_id: pid });
    expect(e.compliance[5]).toMatchObject({ compliance: "Comply", remarks: "Drafted 50 mm", source: "AI draft, not checked", by: "" });
    expect((await ok("pr_review_list", { p_token: sales, p_status: "all" })).counts).toEqual({ pending: 0, approved: 0, rejected: 0, all: 0 });
    // saved as drafted = accepted; changed = edited; emptied = rejected
    await ok("pr_run_save_line", { p_token: sbu, p_run_id: run, p_seq: 5, p_compliance: "Comply", p_remarks: "Drafted 50 mm" });
    await ok("pr_run_save_line", { p_token: sbu, p_run_id: run, p_seq: 6, p_compliance: "Comply with Remarks", p_remarks: "Drafted foam" });
    await ok("pr_run_save_line", { p_token: sbu, p_run_id: run, p_seq: 9, p_compliance: "", p_remarks: "" });
    const st = async (id: string) => env.DB.prepare("SELECT status, decided_by FROM ai_drafts WHERE id = ?").bind(id).first();
    expect(await st(d5)).toEqual({ status: "accepted", decided_by: USERS.sbu.id });
    expect(await st(d6)).toEqual({ status: "edited", decided_by: USERS.sbu.id });
    expect(await st(d9)).toEqual({ status: "rejected", decided_by: USERS.sbu.id });
    expect(await row(run, 5)).toMatchObject({ ai_draft: 0, review: "pending", answered_by: USERS.sbu.id });
    expect(await row(run, 9)).toMatchObject({ ai_draft: 0, compliance: "", review: "" });
    expect((await ok("pr_review_list", { p_token: sales })).total).toBe(2);
    // fill section and the filled Excel decide drafts the same way
    const d9b = await draftOn(run, 9, "Noted", "");
    await ok("pr_run_fill_section", { p_token: sbu, p_run_id: run, p_seq: 8, p_compliance: "Noted", p_replace: true });
    expect(await st(d9b)).toMatchObject({ status: "accepted" });
    const d2 = await draftOn(run, 2, "Comply", "");
    await ok("pr_submit_answers", { p_token: sbu, p_run_id: run, p_rows: [{ spec: SPEC_LINES[2].spec, compliance: "Not Comply", remarks: "" }] });
    expect(await st(d2)).toMatchObject({ status: "edited" });
    expect((await ok("pr_get", { p_token: admin, p_id: pid })).runs[0]).toMatchObject({ answered: 4, pending: 4 });
  });
});
