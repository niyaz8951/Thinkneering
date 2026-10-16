/* The small model (8B) for drafting, its cost counted per model, JSON mode with a fallback, and Check the AI
   (answers people gave, replayed with the answer hidden). Owner, 16 Oct 2026. */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { ok, refused, login, resetLogins } from "./helpers";
import { draftModel, neuronRate, complete, MODELS, type AiUsage } from "../../worker/src/ai/models";
import { neuronsOf } from "../../worker/src/ai/decide";
import { parseMap, applySettings, DEFAULT_SETTINGS, type MapNode } from "../../worker/src/ai/map";
import { draftAnswer, userPrompt, REPLY_SCHEMA } from "../../worker/src/ai/draft";
import { rowsFor } from "../../worker/src/ai/eval";
import { placeRows } from "../../worker/src/lib/cm";

const SMALL = "@cf/meta/llama-3.1-8b-instruct-fast", LARGE = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/* A model that answers by what the prompt holds, and records what it was asked. */
function fakeModel(answer: (user: string) => Record<string, unknown> = () => ({ cites: ["O1"], reason: "Options.", compliance: "Comply", remarks: "", confidence: "medium" })) {
  const calls: { model: string; user: string; schema: unknown }[] = [];
  const ai = { async run(model: string, input: any) {
    const user = String(input?.messages?.[1]?.content || "");
    calls.push({ model, user, schema: input?.response_format });
    return { response: answer(user), usage: { prompt_tokens: 1000, completion_tokens: 100 } };
  } };
  return { ai, calls };
}

describe("Which model drafts", () => {
  it("the small model by default; the rule book may ask for the large one or a model id", () => {
    expect(MODELS.draft).toBe(SMALL);
    expect(draftModel("")).toBe(SMALL);
    expect(draftModel("small")).toBe(SMALL);
    expect(draftModel("large")).toBe(LARGE);
    expect(draftModel("@cf/qwen/qwen3-30b-a3b-fp8")).toBe("@cf/qwen/qwen3-30b-a3b-fp8");
    expect(draftModel("gpt-5")).toBe(SMALL);
  });

  it("'AI model:' is a setting of the rule book; a value it cannot use is reported", () => {
    const map = (v: string): MapNode[] => [
      { id: "root", parent_id: null, title: "AI rules", notes: "", special: "[]", sort: 0, verified: 1 },
      { id: "st", parent_id: "root", title: "Settings", notes: "", special: JSON.stringify(["AI model: " + v]), sort: 0, verified: 1 }];
    const read = (v: string) => { const p = parseMap(map(v), null), problems: string[] = []; return { s: applySettings(DEFAULT_SETTINGS, p.settingsLines, problems), problems }; };
    expect(read("large").s.model).toBe("large");
    expect(read("small").s.model).toBe("");
    const bad = read("the clever one");
    expect(bad.s.model).toBe("");
    expect(bad.problems.join(" ")).toMatch(/AI model: the clever one/);
  });

  it("neurons are counted at each model's own rate (the small one is about 8 times cheaper per clause)", async () => {
    const fake = fakeModel();
    (env as any).AI = fake.ai;
    const small: AiUsage = { prompt: 0, completion: 0 }, large: AiUsage = { prompt: 0, completion: 0 };
    await complete(env as any, SMALL, "s", "u", small);
    await complete(env as any, LARGE, "s", "u", large);
    expect(neuronsOf(small)).toBeCloseTo((1000 * neuronRate(SMALL)[0] + 100 * neuronRate(SMALL)[1]) / 1000, 1);   // 7.6
    expect(neuronsOf(large)).toBeCloseTo(47.1, 1);
    expect(neuronsOf(large) / neuronsOf(small)).toBeGreaterThan(6);
    expect(neuronsOf({ prompt: 1000, completion: 100 })).toBe(47);                                          // old usage rows: the large rate
    delete (env as any).AI;
  });
});

describe("Drafting with the small model", () => {
  afterEach(() => { delete (env as any).AI; });
  const base = { clause: "Fans shall be plug type, directly driven by EC motors.", sr: "A", part: 2, section: "FANS", product: "AHU", factory: "Riyadh", similar: [], comments: "",
    options: ["Seen on datasheets: Fan Supply • Fan type: EC plug fan"] };

  it("asks the small model with the reply held to the six answers (JSON mode), sources first", async () => {
    const fake = fakeModel();
    (env as any).AI = fake.ai;
    const d = await draftAnswer(env as any, base);
    expect(d).toMatchObject({ compliance: "Comply", model: SMALL });
    expect(fake.calls[0].model).toBe(SMALL);
    expect(fake.calls[0].schema).toEqual({ type: "json_schema", json_schema: REPLY_SCHEMA });
    const props = (REPLY_SCHEMA as any).properties;
    expect(Object.keys(props)[0]).toBe("cites");
    expect(props.compliance.enum).toEqual(["Comply", "Comply with Remarks", "Noted", "Not Comply", "Not Applicable", "In Contractor's Scope", ""]);
  });

  it("the rule book's 'AI model: large' is used for the draft and recorded on it", async () => {
    const fake = fakeModel();
    (env as any).AI = fake.ai;
    const d = await draftAnswer(env as any, { ...base, model: "large" });
    expect(fake.calls[0].model).toBe(LARGE);
    expect(d.model).toBe(LARGE);
  });

  it("a model without JSON mode is asked again without it, and not asked with it again", async () => {
    const calls: unknown[] = [];
    (env as any).AI = { async run(_m: string, input: any) {
      calls.push(input.response_format);
      if (input.response_format) throw new Error("AiError: JSON Mode couldn't be met");
      return { response: JSON.stringify({ cites: ["O1"], reason: "Options.", compliance: "Comply", remarks: "", confidence: "medium" }) };
    } };
    const m = "@cf/test/no-json-mode";
    expect((await draftAnswer(env as any, { ...base, model: m })).compliance).toBe("Comply");
    expect((await draftAnswer(env as any, { ...base, model: m })).compliance).toBe("Comply");
    expect(calls.map((c) => !!c)).toEqual([true, false, false]);
  });

  it("the prompt leaves out empty blocks (a small model reads every '(none)' as something)", () => {
    const u = userPrompt(base);
    expect(u).not.toMatch(/\(none\)/);
    expect(u).not.toMatch(/Internal note/);
    expect(u).toMatch(/\[O1\] Seen on datasheets/);
  });
});

describe("Check the AI", () => {
  beforeEach(async () => { await resetLogins(); });
  afterEach(() => { delete (env as any).AI; });

  it("rows of a check sit under their own Part and section", () => {
    const line = (id: string, part: number, section: string) => ({ id, spec_text: "Clause " + id + " with enough words to be a clause.", compliance: "Comply", remarks: "", part, section, section_sr: "", sr: "A", row_type: "letter" });
    const { rows, tested } = rowsFor([line("b", 3, "INSTALLATION"), line("a", 0, ""), line("c", 2, "FANS")]);
    const place = placeRows(rows.map((r) => ({ seq: r.seq, type: r.type, sr: r.sr, spec: r.spec_text })));
    expect(tested.map((t) => [t.line.id, place.get(t.x.seq)!.part, place.get(t.x.seq)!.section])).toEqual([["a", 0, ""], ["c", 2, "FANS"], ["b", 3, "INSTALLATION"]]);
    expect(tested.every((t) => t.x.compliance === "" && t.x.l_status === null && t.x.l_comments === null)).toBe(true);
  });

  it("replays people's answers with the answer hidden, compares, and keeps the result per model and prompt", async () => {
    const t = await login("admin");
    await ok("cm_admin_import", { p_token: t, p_factory_id: "ahu-riyadh", p_file_name: "lib.xlsx", p_rows: [
      { sr: "A", type: "letter", part: 2, section: "FANS", spec: "Fans shall be plug type, directly driven by EC motors with integral speed control.", compliance: "Comply", remarks: "" },
      { sr: "B", type: "letter", part: 2, section: "FANS", spec: "Fans shall be plug type, directly driven by EC motors with integral speed controls.", compliance: "Comply", remarks: "" },
      { sr: "A", type: "letter", part: 1, section: "COORDINATION", spec: "Coordinate size and location of concrete housekeeping bases with the structural engineer.", compliance: "In Contractor's Scope", remarks: "" },
      { sr: "C", type: "letter", part: 2, section: "DELIVERY", spec: "Units shall be delivered with factory-fitted lifting lugs and wooden crating on every section.", compliance: "Comply with Remarks", remarks: "Nylon wrapped." }
    ] });
    const fake = fakeModel((u) => /Coordinate size/.test(u)
      ? { cites: ["I"], reason: "Site coordination.", compliance: "In Contractor's Scope", remarks: "", confidence: "medium" }
      : { cites: ["L1"], reason: "Same as the library.", compliance: "Comply", remarks: "", confidence: "high" });
    (env as any).AI = fake.ai;
    const a = await login("teamAdmin");
    const r = await ok("ai_eval", { p_token: a, p_product_id: "ahu", p_factory_id: "ahu-riyadh", p_check: "check-0001", p_n: 8, p_seen: [] });
    expect(r.results).toHaveLength(4);
    expect(r.remaining).toBe(0);
    expect(r.model).toBe(SMALL);
    const v = (re: RegExp) => r.results.find((x: any) => re.test(x.spec));
    expect(v(/integral speed control\./)).toMatchObject({ verdict: "agree" });
    expect(v(/Coordinate size/)).toMatchObject({ verdict: "agree", person: { compliance: "In Contractor's Scope" } });
    // its own library line is hidden: nothing else on file answers it, so it waits for a person (not copied from itself)
    expect(v(/lifting lugs/)).toMatchObject({ verdict: "left", ai: null });
    expect(v(/lifting lugs/).why).toMatch(/No source on file/);
    expect(fake.calls.every((c) => c.model === SMALL)).toBe(true);
    // asked again with the ids already checked: nothing left
    expect((await ok("ai_eval", { p_token: a, p_product_id: "ahu", p_factory_id: "ahu-riyadh", p_check: "check-0001", p_n: 8, p_seen: r.results.map((x: any) => x.id) })).results).toEqual([]);
    const h = await ok("ai_eval_history", { p_token: a, p_product_id: "ahu", p_factory_id: "ahu-riyadh" });
    expect(h.checks[0]).toMatchObject({ check: "check-0001", model: SMALL, tested: 4, agree: 3, differ: 0, left: 1 });
    // the check costs neurons and they count against the daily budget
    expect((await ok("ai_map_get", { p_token: a, p_product_id: "ahu", p_factory_id: "ahu-riyadh" })).used_today).toBeGreaterThan(0);
  });

  it("is for admins of the tile and the super user only", async () => {
    (env as any).AI = fakeModel().ai;
    expect(await refused("ai_eval", { p_token: await login("sales"), p_product_id: "ahu", p_factory_id: "ahu-riyadh" })).toMatch(/Only an admin/);
    expect(await refused("ai_eval_history", { p_token: await login("sales"), p_product_id: "ahu", p_factory_id: "ahu-riyadh" })).toMatch(/Only an admin/);
    expect(await refused("ai_eval", { p_product_id: "ahu", p_factory_id: "ahu-riyadh" })).toBeTruthy();
    expect(await refused("ai_eval", { p_token: await login("admin"), p_product_id: "ahu" })).toMatch(/Choose a factory/);
  });
});
