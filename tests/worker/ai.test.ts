import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { ok, refused, login, resetLogins, SPEC_LINES } from "./helpers";
import { lexicalScore } from "../../worker/src/ai/search";
import { standardChoice, userPrompt } from "../../worker/src/ai/draft";
import { firstJson } from "../../worker/src/ai/models";

/* A stand-in for Workers AI: answers every drafting call with a JSON the way the 70B model does,
   and records what it was asked. Embeddings are never asked for here (no Vectorize in tests). */
function fakeAi(reply: (user: string) => Record<string, unknown> | string) {
  const calls: { model: string; user: string }[] = [];
  const ai = { async run(model: string, input: any) {
    const user = String(input?.messages?.[1]?.content || "");
    calls.push({ model, user });
    if (model.includes("bge")) return { data: [new Array(1024).fill(0.01)] };
    const r = reply(user);
    // a model that keeps the contract cites the sources it was shown, unless the test says otherwise
    if (typeof r === "object" && !("cites" in r)) (r as Record<string, unknown>).cites = [...user.matchAll(/\[([A-Z]\d+)\]/g)].map((m) => m[1]);
    return { response: typeof r === "string" ? r : "Here you go:\n```json\n" + JSON.stringify(r) + "\n```", usage: { prompt_tokens: 100, completion_tokens: 20 } };
  } };
  return { ai, calls };
}

/* A minimal AI rule book with "Answer without a source: yes": for the tests of the review's mechanics (batches,
   failures, edits) on clauses that have nothing on file, which strict mode would leave for a person. */
async function relaxed(token: string) {
  const at = new Date().toISOString(), me = (await env.DB.prepare("SELECT user_id FROM app_sessions LIMIT 1").first<any>())?.user_id || null;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO mp_maps (id, name, share, kind, created_by, created_at, updated_by, updated_at) VALUES ('m-relaxed', 'Relaxed', 'private', 'rulebook', ?, ?, ?, ?)").bind(me, at, me, at),
    env.DB.prepare("INSERT INTO mp_nodes (id, map_id, parent_id, title, notes, special, sort, verified) VALUES ('r-root', 'm-relaxed', NULL, 'Relaxed', '', '[]', 0, 1)"),
    env.DB.prepare("INSERT INTO mp_nodes (id, map_id, parent_id, title, notes, special, sort, verified) VALUES ('r-set', 'm-relaxed', 'r-root', 'Settings', '', ?, 1, 1)").bind(JSON.stringify(["Answer without a source: yes"])),
    env.DB.prepare("INSERT INTO ai_map_links (product_id, factory_id, map_id, role, created_by) VALUES ('ahu', 'ahu-dubai', 'm-relaxed', 'rulebook', ?)").bind(me)
  ]);
  void token;
}

async function project(token: string) {
  const p = await ok("pr_save", { p_token: token, p_name: "Tower A", p_client_type: "Consultant", p_client_name: "ACME", p_region: "UAE" });
  const r = await ok("cm_save_run", { p_token: token, p_factory_id: "ahu-dubai", p_source: "pdf", p_file_name: "AHU spec.pdf", p_lines: SPEC_LINES, p_project_id: p.id });
  return { projectId: p.id, runId: r.run_id };
}

describe("AI review", () => {
  beforeEach(async () => { await resetLogins(); });
  afterEach(() => { delete (env as any).AI; });

  it("pure parts: lexical similarity, standard wording, JSON in prose", () => {
    expect(lexicalScore("Casing shall be double skin, 50 mm.", "Casing shall be double skin 50 mm")).toBe(1);
    expect(lexicalScore("Casing shall be double skin construction with 50 mm panels.", "Casing shall be double skin construction with 50mm panels.")).toBeGreaterThan(0.8);
    expect(lexicalScore("Fans shall be plug type.", "Filters shall be bag type with G4 class.")).toBeLessThan(0.3);
    expect(standardChoice("comply w/ remarks")).toBe("Comply with Remarks");
    expect(standardChoice("COMPLY")).toBe("Comply");
    expect(standardChoice("Not Comply")).toBe("Not Comply");
    expect(standardChoice("deviation")).toBe("Not Comply");
    expect(standardChoice("in contractor's scope")).toBe("In Contractor's Scope");
    expect(standardChoice("N/A")).toBe("Not Applicable");
    expect(standardChoice("noted")).toBe("Noted");
    expect(standardChoice("maybe")).toBe("");
    expect(firstJson('Sure! {"a": 1, "b": {"c": "}"}} trailing')).toEqual({ a: 1, b: { c: "}" } });
    expect(firstJson("no json")).toBeNull();
  });

  it("only admins of the Projects tile may run it; a record outside a project is refused", async () => {
    const t = await login("admin");
    const { runId } = await project(t);
    (env as any).AI = fakeAi(() => ({ compliance: "Noted", remarks: "", reason: "x", confidence: "low" })).ai;
    const u = await login("sales");
    expect(await refused("ai_review_status", { p_token: u, p_run_id: runId })).toMatch(/Only an admin/);
    expect(await refused("ai_review_run", { p_token: u, p_run_id: runId })).toMatch(/Only an admin/);
    expect(await refused("ai_review_run", { p_token: "nope", p_run_id: runId })).toBe("SESSION_EXPIRED");
    const loose = await ok("cm_save_run", { p_token: t, p_factory_id: "ahu-dubai", p_source: "text", p_file_name: "", p_lines: SPEC_LINES });
    expect(await refused("ai_review_run", { p_token: t, p_run_id: loose.run_id })).toMatch(/not in a project/);
  });

  it("switched off (no AI_WHOLE_REVIEW): the whole-record review is refused as coming soon, Focus mode proposals still work", async () => {
    const t = await login("admin");
    const { runId } = await project(t);
    (env as any).AI = fakeAi(() => ({ compliance: "Noted", remarks: "", reason: "x", confidence: "low" })).ai;
    const was = (env as any).AI_WHOLE_REVIEW;
    delete (env as any).AI_WHOLE_REVIEW;
    try {
      expect(await refused("ai_review_run", { p_token: t, p_run_id: runId })).toMatch(/coming soon/);
      expect((await ok("pr_run_get", { p_token: t, p_run_id: runId })).run.ai_whole).toBe(false);
      const sug = await ok("ai_suggest", { p_token: t, p_run_id: runId, p_seqs: [1] });
      expect(sug.ok).toBe(true);
      const n = await env.DB.prepare("SELECT count(*) AS n FROM cm_run_lines WHERE run_id = ? AND ai_draft = 1").bind(runId).first<any>();
      expect(n.n).toBe(0);
    } finally { (env as any).AI_WHOLE_REVIEW = was; }
  });

  it("without a model binding the status says so and the run is refused", async () => {
    const t = await login("admin");
    const { runId } = await project(t);
    const st = await ok("ai_review_status", { p_token: t, p_run_id: runId });
    expect(st.available).toBe(false);
    expect(st).toMatchObject({ total: 4, open: 4, drafts: 0, human: 0, library: 0 });
    expect(await refused("ai_review_run", { p_token: t, p_run_id: runId })).toMatch(/not available/);
  });

  it("drafts every open clause in batches, copies near-identical library answers without the model, keeps human and library answers", async () => {
    const t = await login("admin");
    const { runId } = await project(t);
    // the library already answers the FANS clause exactly, and a near-identical CASING clause from another spec
    const fans = await env.DB.prepare("SELECT id FROM cm_lines WHERE spec_text LIKE 'Fans shall%'").first<any>();
    await ok("cm_admin_save_answer", { p_token: t, p_line_id: fans.id, p_compliance: "Comply", p_remarks: "EC plug fans." });
    const other = await ok("cm_save_run", { p_token: t, p_factory_id: "ahu-dubai", p_source: "text", p_file_name: "other.txt",
      p_lines: [{ type: "letter", sr: "A.", spec: "Casing shall be double skin construction with 50 mm thick panels and thermal break profile." }] });
    const near = await env.DB.prepare("SELECT id FROM cm_lines WHERE spec_text LIKE '%thermal break profile.'").first<any>();
    await ok("cm_admin_save_answer", { p_token: t, p_line_id: near.id, p_compliance: "Comply with Remarks", p_remarks: "50 mm panels, thermal break frame." });
    // a related library answer (similar, not near-identical) is the source the model cites for the polyurethane clause
    await ok("cm_save_run", { p_token: t, p_factory_id: "ahu-dubai", p_source: "text", p_file_name: "third.txt",
      p_lines: [{ type: "letter", sr: "C.", spec: "Panels shall be insulated with injected polyurethane foam." }] });
    const pu = await env.DB.prepare("SELECT id FROM cm_lines WHERE spec_text = 'Panels shall be insulated with injected polyurethane foam.'").first<any>();
    await ok("cm_admin_save_answer", { p_token: t, p_line_id: pu.id, p_compliance: "Comply", p_remarks: "Injected PU foam panels." });
    // a person answered the SUMMARY clause in the project
    await ok("pr_run_save_line", { p_token: t, p_run_id: runId, p_seq: 2, p_compliance: "Noted", p_remarks: "" });
    const fake = fakeAi((user) => user.includes("polyurethane")
      ? { compliance: "comply with remarks", remarks: "Panels are injected with 42 kg/m3 PU foam.", reason: "Library answer 1 covers the panel insulation.", confidence: "medium" }
      : { compliance: "Noted", remarks: "", reason: "General statement.", confidence: "low" });
    (env as any).AI = fake.ai;
    const r1 = await ok("ai_review_run", { p_token: t, p_run_id: runId, p_limit: 1 });
    expect(r1).toMatchObject({ done: 1, remaining: 1, failed: 0 });
    const r2 = await ok("ai_review_run", { p_token: t, p_run_id: runId, p_limit: 10 });
    expect(r2).toMatchObject({ done: 1, remaining: 0, drafts: 2, human: 1, library: 1, open: 0 });
    expect(r1.copied + r2.copied).toBe(1);                 // the CASING clause was copied from the near-identical library line
    expect(r1.drafted + r2.drafted).toBe(1);               // the polyurethane clause went to the model
    expect(fake.calls.filter((c) => c.model.includes("llama")).length).toBe(1);
    expect(fake.calls.find((c) => c.model.includes("llama"))!.user).toMatch(/Library answers of this factory/);
    const rec = await ok("pr_run_get", { p_token: t, p_run_id: runId });
    const by = (seq: number) => rec.lines.find((l: any) => l.seq === seq);
    expect(by(5)).toMatchObject({ own: true, ai_draft: true, compliance: "Comply with Remarks", remarks: "50 mm panels, thermal break frame.", review: "" });
    expect(by(5).ai.source).toBe("library-similar");
    // (19 Oct 2026) the copied remark states 50 mm, which no datasheet of this project shows: a value from another
    // project, so it is copied but low confidence and RED (approved sheets give the wording, never the values)
    expect(by(5).ai).toMatchObject({ confidence: "low", priority: "red" });
    expect(by(5).ai.reason).toMatch(/Its remark states 50 mm, which this project's datasheet does not show/);
    // the model wrote a density no source gives (the clause asks for 40 kg/m3; nothing says what the panel IS):
    // code took the number out and marked the draft low
    expect(by(6)).toMatchObject({ own: true, ai_draft: true, compliance: "Comply with Remarks", remarks: "Panels are injected with [value] PU foam." });
    expect(by(6).ai.reason).toMatch(/^Library answer 1 covers the panel insulation\. Used: library answer \(0\.\d\d\)\. Check: no cited source gives 42 kg\/m3, check the value\.$/);
    expect(by(6).ai.confidence).toBe("low");
    expect(by(2)).toMatchObject({ own: true, ai_draft: false, compliance: "Noted" });        // the person's answer was kept
    expect(by(9)).toMatchObject({ own: false, ai_draft: false, lib_compliance: "Comply" });   // the library's answer was kept
    expect(rec.run.can_ai).toBe(true);
    // the library itself was never written by the AI
    const lib = await env.DB.prepare("SELECT count(*) AS n FROM cm_lines WHERE answer_source NOT IN ('admin', '')").first<any>();
    expect(lib.n).toBe(0);
    const drafts = await env.DB.prepare("SELECT status, source, confidence FROM ai_drafts ORDER BY seq").all<any>();
    expect(drafts.results.map((d) => [d.status, d.source, d.confidence])).toEqual([["draft", "library-similar", "low"], ["draft", "model", "low"]]);
    const aud = await env.DB.prepare("SELECT count(*) AS n FROM app_audit WHERE action = 'ai_review_run'").first<any>();
    expect(aud.n).toBe(2);
    // AI drafts never reach the review queue or the editor's project answers
    const review = await ok("pr_review_list", { p_token: t, p_status: "pending" });
    expect(review.items.map((x: any) => x.seq)).toEqual([2]);                              // only the person's answer waits
    const lines = await ok("cm_admin_lines", { p_token: t, p_factory_id: "ahu-dubai", p_status: "all" });
    expect(lines.lines.find((l: any) => l.id === near.id).project_answers).toEqual([]);
    // the project page counts the drafts apart from the answers people stand behind
    const { projectId } = { projectId: rec.run.project_id };
    const card = (await ok("pr_get", { p_token: t, p_id: projectId })).runs[0];
    expect(card).toMatchObject({ clauses: 4, filled: 4, answered: 1, drafts: 2 });
  });

  it("a person who edits a draft turns it into a project answer; keeping it accepts it; clear takes drafts off", async () => {
    const t = await login("admin");
    await relaxed(t);
    const { runId } = await project(t);
    (env as any).AI = fakeAi(() => ({ compliance: "Comply", remarks: "Standard construction.", reason: "r", confidence: "low" })).ai;
    await ok("ai_review_run", { p_token: t, p_run_id: runId, p_limit: 25 });
    // edited -> pending review, draft marked edited
    const e = await ok("pr_run_save_line", { p_token: t, p_run_id: runId, p_seq: 5, p_compliance: "Comply", p_remarks: "Changed by a person." });
    expect(e.review).toBe("pending");
    // kept as it is -> accepted, still a project answer in review (a person now stands behind it)
    const k = await ok("pr_run_save_line", { p_token: t, p_run_id: runId, p_seq: 6, p_compliance: "Comply", p_remarks: "Standard construction." });
    expect(k.review).toBe("pending");
    const st = await env.DB.prepare("SELECT seq, status FROM ai_drafts ORDER BY seq").all<any>();
    expect(st.results.map((x) => [x.seq, x.status])).toEqual([[2, "draft"], [5, "edited"], [6, "accepted"], [9, "draft"]]);
    const rec = await ok("pr_run_get", { p_token: t, p_run_id: runId });
    expect(rec.lines.filter((l: any) => l.ai_draft).map((l: any) => l.seq)).toEqual([2, 9]);
    const c = await ok("ai_review_clear", { p_token: t, p_run_id: runId });
    expect(c.removed).toBe(2);
    const after = await ok("pr_run_get", { p_token: t, p_run_id: runId });
    expect(after.lines.filter((l: any) => l.own).map((l: any) => l.seq)).toEqual([5, 6]);
    // a second run with replace redoes drafts but never touches the two human answers
    const again = await ok("ai_review_run", { p_token: t, p_run_id: runId, p_limit: 25, p_replace: true });
    expect(again).toMatchObject({ done: 2, human: 2, drafts: 2 });
  });

  it("a model that answers nonsense fails that clause only, and the loop ends", async () => {
    const t = await login("admin");
    await relaxed(t);
    const { runId } = await project(t);
    (env as any).AI = fakeAi((u) => u.includes("Fans") ? "I cannot help with that." : { compliance: "Noted", remarks: "", reason: "r", confidence: "low" }).ai;
    const r = await ok("ai_review_run", { p_token: t, p_run_id: runId, p_limit: 25 });
    expect(r).toMatchObject({ done: 3, failed: 1, remaining: 0 });
    expect(r.errors[0]).toMatch(/did not give a usable answer \(the reply was not one JSON object\)/);
    const again = await ok("ai_review_run", { p_token: t, p_run_id: runId, p_limit: 25 });
    expect(again).toMatchObject({ done: 0, failed: 1, remaining: 0, open: 1 });
  });

  it("the prompt shows the library answers and internal comments", () => {
    const u = userPrompt({ clause: "Panels 50 mm.", sr: "B.", part: 2, section: "CASING", product: "AHU", factory: "Dubai", comments: "Say 50 mm foam.",
      similar: [{ id: "x", factory_id: "f", spec_text: "Panels shall be 50 mm.", compliance: "Comply", remarks: "50 mm PU", comments: "", status: "answered", section: "CASING", score: 0.8, how: "lexical" }] });
    expect(u).toMatch(/Part 2 Products \/ CASING, label B\./);
    expect(u).toMatch(/similarity 0.80\) Clause: Panels shall be 50 mm\./);
    expect(u).toMatch(/Internal note for this clause \(library team, guidance, never quote it\): Say 50 mm foam\./);
    expect(u).toMatch(/\[L1\] \(similarity 0\.80\)/);
  });
});
