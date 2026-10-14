import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { ok, refused, login, resetLogins, SPEC_LINES } from "./helpers";

describe("cm_* routes", () => {
  beforeEach(async () => { await resetLogins(); });

  it("cm_options lists products and factories for any approved user, refused without a session", async () => {
    const t = await login("sbu");
    const o = await ok("cm_options", { p_token: t });
    expect(o.products.map((p: any) => p.id)).toEqual(["ahu", "fcu", "chiller"]);
    expect(o.products[0].factories.map((f: any) => f.name)).toEqual(["Dubai", "Riyadh"]);
    expect(await refused("cm_options", { p_token: "nope" })).toBe("SESSION_EXPIRED");
  });

  it("cm_save_run stores every row, adds body rows to the library once, keeps Part and section", async () => {
    const t = await login("sbu");
    const r = await ok("cm_save_run", { p_token: t, p_factory_id: "ahu-dubai", p_source: "pdf", p_file_name: "AHU spec.pdf", p_lines: SPEC_LINES });
    expect(r.lines).toBe(10);
    expect(r.unique_lines).toBe(4);              // "Short." is too short; headings stay with the run
    expect(r.matched).toBe(0);
    expect(r.answers).toEqual([]);
    const rows = await env.DB.prepare("SELECT seq, type, line_id FROM cm_run_lines WHERE run_id = ? ORDER BY seq").bind(r.run_id).all();
    expect(rows.results.length).toBe(10);
    expect(rows.results.filter((x: any) => x.line_id).length).toBe(4);
    const lines = await env.DB.prepare("SELECT spec_text, part, section, section_sr, sr, row_type, home_seq, times_seen FROM cm_lines WHERE factory_id = 'ahu-dubai' ORDER BY home_seq").all();
    expect(lines.results.map((x: any) => [x.part, x.section, x.section_sr, x.sr, x.row_type, x.home_seq, x.times_seen])).toEqual([
      [1, "SUMMARY", "1.01", "A", "letter", 2, 1], [2, "CASING", "2.01", "A", "letter", 5, 1], [2, "CASING", "2.01", "B", "letter", 6, 1], [2, "FANS", "2.02", "A", "letter", 9, 1]
    ]);
    // a second conversion of the same text: times_seen grows, first-seen place is kept
    const r2 = await ok("cm_save_run", { p_token: t, p_factory_id: "ahu-dubai", p_source: "text", p_file_name: "", p_lines: SPEC_LINES.slice(3) });
    expect(r2.unique_lines).toBe(3);
    const l = await env.DB.prepare("SELECT times_seen, home_seq, part FROM cm_lines WHERE spec_text LIKE 'Casing shall%'").first<any>();
    expect(l.times_seen).toBe(2); expect(l.home_seq).toBe(5); expect(l.part).toBe(2);
    const jobs = await env.DB.prepare("SELECT count(*) AS n FROM ai_jobs WHERE kind = 'clause'").first<any>();
    expect(jobs.n).toBe(4);
  });

  it("answers never cross factories; a conversion comes back filled only from its own factory", async () => {
    const t = await login("admin");
    await ok("cm_save_run", { p_token: t, p_factory_id: "ahu-dubai", p_source: "pdf", p_file_name: "a.pdf", p_lines: SPEC_LINES });
    const line = await env.DB.prepare("SELECT id FROM cm_lines WHERE factory_id = 'ahu-dubai' AND spec_text LIKE 'Casing shall%'").first<any>();
    await ok("cm_admin_save_answer", { p_token: t, p_line_id: line.id, p_compliance: "Comply", p_remarks: "50 mm double skin panels.", p_comments: "Standard answer." });
    const again = await ok("cm_save_run", { p_token: t, p_factory_id: "ahu-dubai", p_source: "pdf", p_file_name: "b.pdf", p_lines: SPEC_LINES });
    expect(again.matched).toBe(1);
    expect(again.answers).toEqual([{ i: 5, answered: true, compliance: "Comply", remarks: "50 mm double skin panels.", comments: "Standard answer." }]);
    const other = await ok("cm_save_run", { p_token: t, p_factory_id: "ahu-riyadh", p_source: "pdf", p_file_name: "c.pdf", p_lines: SPEC_LINES });
    expect(other.matched).toBe(0);
  });

  it("cm_save_run refuses bad input and a project the user cannot open", async () => {
    const t = await login("sbu");
    expect(await refused("cm_save_run", { p_token: t, p_factory_id: "ahu-dubai", p_source: "pdf", p_lines: [] })).toMatch(/no lines/);
    expect(await refused("cm_save_run", { p_token: t, p_factory_id: "nope", p_source: "pdf", p_lines: SPEC_LINES })).toMatch(/Choose a product and factory/);
    expect(await refused("cm_save_run", { p_token: t, p_factory_id: "ahu-dubai", p_source: "pdf", p_lines: SPEC_LINES, p_project_id: "no-such-project" })).toMatch(/not available/);
  });

  it("the editor screen: allowed for editors, refused for plain users; filters, order and counts", async () => {
    const a = await login("admin");
    await ok("cm_save_run", { p_token: a, p_factory_id: "ahu-dubai", p_source: "pdf", p_file_name: "a.pdf", p_lines: SPEC_LINES });
    const sales = await login("sales");                  // "Can edit" for compliance-maker
    const page = await ok("cm_admin_lines", { p_token: sales, p_factory_id: "ahu-dubai", p_status: "all", p_limit: 100, p_offset: 0 });
    expect(page.total).toBe(4);
    expect(page.counts).toEqual({ all: 4, open: 4, answered: 0, review: 0 });
    expect(page.lines.map((l: any) => l.section)).toEqual(["SUMMARY", "CASING", "CASING", "FANS"]);
    expect(page.lines[1].topic).toBe("Casing and base");
    expect(page.groups.map((g: any) => g.part + ":" + g.topic)).toEqual(["1:General", "2:Casing and base", "2:Fans and drives"]);
    const part2 = await ok("cm_admin_lines", { p_token: sales, p_factory_id: "ahu-dubai", p_status: "open", p_part: 2, p_topic: "Fans and drives" });
    expect(part2.total).toBe(1);
    const q = await ok("cm_admin_lines", { p_token: sales, p_factory_id: "ahu-dubai", p_status: "all", p_search: "polyurethane" });
    expect(q.total).toBe(1);
    await ok("cm_admin_save_answer", { p_token: sales, p_line_id: page.lines[1].id, p_compliance: "Comply", p_remarks: "" });
    const after = await ok("cm_admin_lines", { p_token: sales, p_factory_id: "ahu-dubai", p_status: "answered" });
    expect(after.total).toBe(1);
    expect(after.lines[0].answered_by).toBe("Sales User");
    expect(after.lines[0].answer_source).toBe("admin");
    const sbu = await login("sbu");
    expect(await refused("cm_admin_lines", { p_token: sbu, p_factory_id: "ahu-dubai" })).toMatch(/Edit access/);
    expect(await refused("cm_admin_save_answer", { p_token: sbu, p_line_id: page.lines[1].id, p_compliance: "Comply", p_remarks: "" })).toMatch(/Edit access/);
    const log = await env.DB.prepare("SELECT count(*) AS n FROM cm_answer_log").first<any>();
    expect(log.n).toBe(1);
  });

  it("cm_admin_import: new lines in their place, open lines filled, answered lines replaced, comments taken", async () => {
    const a = await login("admin");
    await ok("cm_save_run", { p_token: a, p_factory_id: "ahu-dubai", p_source: "pdf", p_file_name: "a.pdf", p_lines: SPEC_LINES });
    const casing = await env.DB.prepare("SELECT id FROM cm_lines WHERE spec_text LIKE 'Casing shall%'").first<any>();
    await ok("cm_admin_save_answer", { p_token: a, p_line_id: casing.id, p_compliance: "Noted", p_remarks: "" });
    const rows = [
      { spec: "PART 2 - PRODUCTS", type: "part" },
      { spec: "CASING", type: "section", sr: "2.01" },
      { spec: "Casing shall be double skin construction with 50 mm thick panels and thermal break profiles.", compliance: "Comply", remarks: "Replaced by upload", comments: "From upload", type: "letter", sr: "A", part: 2, section: "CASING", section_sr: "2.01" },
      { spec: "Fans shall be plug type with backward curved blades, directly driven by EC motors.", compliance: "Comply", type: "letter", sr: "A", part: 2, section: "FANS", section_sr: "2.02" },
      { spec: "A brand new clause only the upload knows about.", compliance: "Comply with Remarks", remarks: "x", type: "letter", sr: "C", part: 2, section: "FANS", section_sr: "2.02" },
      { spec: "Comment only clause that is long enough.", comments: "just a note", type: "text" },
      { spec: "Nothing here", type: "text" }
    ];
    const r = await ok("cm_admin_import", { p_token: a, p_factory_id: "ahu-dubai", p_file_name: "lib.xlsx", p_rows: rows });
    expect(r).toMatchObject({ rows: 7, unique_lines: 3, added: 1, updated: 1, replaced: 1, unchanged: 0, skipped: 4 });
    const l = await env.DB.prepare("SELECT compliance, remarks, comments, answer_source FROM cm_lines WHERE id = ?").bind(casing.id).first<any>();
    expect(l).toEqual({ compliance: "Comply", remarks: "Replaced by upload", comments: "From upload", answer_source: "upload" });
    const c = await env.DB.prepare("SELECT status, comments, part FROM cm_lines WHERE spec_text LIKE 'Comment only%'").first<any>();
    expect(c).toEqual({ status: "open", comments: "just a note", part: 0 });
    const runs = await ok("cm_admin_runs", { p_token: a });
    expect(runs.runs[0].kind).toBe("library-upload");
    const exp = await ok("cm_admin_export", { p_token: a, p_factory_id: "ahu-dubai" });
    expect(exp.lines.length).toBe(6);
    expect(exp.lines.filter((x: any) => x.compliance).length).toBe(3);
  });

  it("cm_reset_library: super user only; clears answers, drops unused lines", async () => {
    const a = await login("admin");
    await ok("cm_save_run", { p_token: a, p_factory_id: "ahu-dubai", p_source: "pdf", p_file_name: "a.pdf", p_lines: SPEC_LINES });
    const line = await env.DB.prepare("SELECT id FROM cm_lines WHERE spec_text LIKE 'Casing shall%'").first<any>();
    await ok("cm_admin_save_answer", { p_token: a, p_line_id: line.id, p_compliance: "Comply", p_remarks: "" });
    const ta = await login("teamAdmin");
    expect(await refused("cm_reset_library", { p_token: ta, p_product_id: "ahu" })).toMatch(/super user/);
    const r = await ok("cm_reset_library", { p_token: a, p_product_id: "ahu", p_factory_id: "ahu-dubai" });
    expect(r).toMatchObject({ lines_removed: 4, lines_kept: 0, history_removed: 1, records_removed: 0 });
    expect(await refused("cm_reset_library", { p_token: a, p_product_id: "ahu", p_factory_id: "fcu-riyadh" })).toMatch(/does not belong/);
  });
});
