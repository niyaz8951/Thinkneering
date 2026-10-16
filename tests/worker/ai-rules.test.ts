/* AI rules (Compliance review > AI rules), the "#" clause rules, the datasheet rows and the code checks on
   every model draft. Pure parts first, then the routes (allowed and refused), then the review end to end. */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { ok, refused, login, resetLogins, SPEC_LINES } from "./helpers";
import { splitComments, noteOnly, keywordList, ruleHit, pickRules, directRule, datasheetFields, unitValues, pickDatasheetRows, parentOf, type AiRule } from "../../worker/src/ai/rules";
import { measurements, groundRemarks, trimAnswerEcho, hedges } from "../../worker/src/ai/guard";
import { standardChoice, userPrompt, draftAnswer } from "../../worker/src/ai/draft";
import { choiceOf } from "../../worker/src/lib/cm";

const rule = (o: Partial<AiRule>): AiRule => ({ id: o.id || "r" + Math.random(), product_id: "ahu", factory_id: null, kind: "rule", title: "", keywords: "", part: 0,
  instruction: "", answer: "", remark: "", active: 1, sort: 0, ...o });

function fakeAi(reply: (user: string) => Record<string, unknown> | string) {
  const calls: { model: string; user: string }[] = [];
  const ai = { async run(model: string, input: any) {
    const user = String(input?.messages?.[1]?.content || "");
    calls.push({ model, user });
    const r = reply(user);
    return { response: typeof r === "string" ? r : JSON.stringify(r), usage: { prompt_tokens: 50, completion_tokens: 10 } };
  } };
  return { ai, calls };
}

describe("AI rules: pure parts", () => {
  it("'#' in Internal Comments: the note for users, the rules for the AI", () => {
    expect(splitComments("Check with factory. # value is in the datasheet next to Cooling coil load kW # answer Comply with Remarks"))
      .toEqual({ note: "Check with factory.", rules: ["value is in the datasheet next to Cooling coil load kW", "answer Comply with Remarks"] });
    expect(splitComments("")).toEqual({ note: "", rules: [] });
    expect(splitComments("# only a rule")).toEqual({ note: "", rules: ["only a rule"] });
    expect(noteOnly("Use rubber pads. # always Noted")).toBe("Use rubber pads.");
  });

  it("keywords: phrases, longer word forms, subject words, Part", () => {
    expect(keywordList("install, rigging ; start-up")).toEqual([["install"], ["rigging"], ["start", "up"]]);
    const site = rule({ keywords: "install, rigging, start-up", part: 3 });
    expect(ruleHit(site, "Installation shall be by the contractor.", "", 3)?.matched).toEqual(["install"]);
    expect(ruleHit(site, "The unit shall be started up.", "", 3)?.matched).toEqual(["start up"]);   // phrase, longer forms
    expect(ruleHit(site, "Start the fans before the coils are filled.", "", 3)).toBeNull();          // "start" alone is not "start-up"
    expect(ruleHit(site, "Start-up by the manufacturer.", "", 3)?.matched).toEqual(["start up"]);
    expect(ruleHit(site, "Installation of the fan in the factory.", "", 2)).toBeNull();     // a Part 3 rule, a Part 2 clause
    expect(ruleHit(site, "Installation of the fan in the factory.", "", 0)).toBeNull();     // Part not known: a Part rule waits
    const casing = rule({ keywords: "casing" });
    expect(ruleHit(casing, "Panels shall be double skin.", "", 2)?.matched).toEqual(["casing"]);   // casing ~ panel
    expect(ruleHit(rule({ keywords: "", part: 1 }), "Anything at all", "", 1)).toMatchObject({ score: 0 });
    expect(ruleHit(rule({ keywords: "fan", active: 0 }), "Fans shall be plug type", "", 2)).toBeNull();
  });

  it("best rule first; a rule answers by itself only when it has an answer and a remark and no equal rival", () => {
    const a = rule({ id: "a", keywords: "install", answer: "In Contractor's Scope", remark: "By others." });
    const b = rule({ id: "b", keywords: "factory installed", answer: "Comply", remark: "Factory fitted." });
    const fact = rule({ id: "f", kind: "fact", keywords: "fan", instruction: "Fans are EC plug fans." });
    const p = pickRules([a, b, fact], "Fans shall be factory installed.", "FANS", 2);
    expect(p.rules.map((h) => h.rule.id)).toEqual(["b", "a"]);                          // the two-word hit wins
    expect(p.facts.map((h) => h.rule.id)).toEqual(["f"]);
    expect(directRule(p.rules)?.rule.id).toBe("b");
    const c = rule({ id: "c", keywords: "install", answer: "Noted", remark: "Noted." });
    expect(directRule(pickRules([a, c], "Install the unit.", "", 3).rules)).toBeNull();      // same score, different answers
    expect(directRule(pickRules([rule({ keywords: "install", instruction: "Say by others." })], "Install it", "", 3).rules)).toBeNull();
    const own = rule({ id: "own", factory_id: "ahu-riyadh", keywords: "install", answer: "Comply", remark: "Mine." });
    expect(pickRules([a, own], "Install it", "", 3).rules[0].rule.id).toBe("own");             // the factory's own rule first
  });

  it("datasheet: sections carried down, values per unit, a casing clause never gets the coil's tube thickness", () => {
    const rows = [
      { section: "Casing", component: "Panel thickness", cells: ["62 mm", "62 mm", "50 mm"], kind: "row", key: "k1" },
      { section: "", component: "Insulation", cells: ["PU foam", "PU foam", "PU foam"], kind: "row", key: "k2" },
      { section: "Cooling coil", component: "Tube thickness", cells: ["0.4 mm", "0.4 mm", "0.4 mm"], kind: "row", key: "k3" },
      { section: "Cooling coil", component: "", cells: [], kind: "sub" },
      { section: "Unit", component: "Air flow", cells: ["5000 l/s", "5000 l/s", "3000 l/s"], kind: "row", key: "k4" }
    ];
    const f = datasheetFields(rows, ["FAHU-01", "FAHU-02", "FAHU-03"]);
    expect(f[0]).toEqual({ label: "Casing • Panel thickness", value: "62 mm (FAHU-01, FAHU-02), 50 mm (FAHU-03)", key: "k1" });
    expect(f[1].label).toBe("Casing • Insulation");
    expect(unitValues(["x", "x"], ["A", "B"])).toBe("x");
    const picked = pickDatasheetRows(f, "Casing panels shall be 50 mm thick.", "CASING");
    expect(picked.map((x) => x.key)).toContain("k1");
    expect(picked.map((x) => x.key)).not.toContain("k3");
    expect(pickDatasheetRows(f, "Coil tubes shall be copper, 0.4 mm thick.", "COILS").map((x) => x.key)).toContain("k3");
  });

  it("a list item is read with the clause it continues", () => {
    const rows = [
      { seq: 1, type: "section", sr: "1.01", spec: "DESCRIPTION OF WORK" },
      { seq: 2, type: "letter", sr: "A.", spec: "Extent of work shall include the following:" },
      { seq: 3, type: "number", sr: "1.", spec: "Vibration isolation." },
      { seq: 4, type: "letter", sr: "a.", spec: "Spring isolators." },
      { seq: 5, type: "letter", sr: "B.", spec: "Next clause." }
    ];
    expect(parentOf(rows, 3)).toBe("Extent of work shall include the following:");
    expect(parentOf(rows, 4)).toBe("Vibration isolation.");
    expect(parentOf(rows, 2)).toBe("");
    expect(parentOf(rows, 5)).toBe("");
  });

  it("checks on a model's remark: numbers need a source, no echo, no hedging", () => {
    expect(measurements("2 m/s, 62mm, 40 kg/m3, AHRI 430, 1000 hours").map((m) => m.raw)).toEqual(["2 m/s", "62mm", "40 kg/m3", "1000 hours"]);
    expect(groundRemarks("Offered with 62 mm panels at 2 m/s.", "Casing: 62mm double wall")).toEqual({ remarks: "Offered with 62 mm panels at [value].", unsupported: ["2 m/s"] });
    expect(trimAnswerEcho("In Contractor's Scope", "In contractors scope. Installation by others.")).toBe("Installation by others.");
    expect(trimAnswerEcho("Comply with Remarks", "Comply with Remarks | Offered with 62 mm.")).toBe("Offered with 62 mm.");
    expect(trimAnswerEcho("Comply", "Comply")).toBe("");
    expect(hedges("Panels should be 50 mm")).toBe(true);
    expect(hedges("Panels are 62 mm")).toBe(false);
  });

  it("the ways people write the six answers", () => {
    expect(choiceOf("By contractor")).toEqual({ choice: "In Contractor's Scope", known: true });
    expect(choiceOf("Complied").choice).toBe("Comply");
    expect(choiceOf("Comply as noted", "EC plug fans are provided").choice).toBe("Comply with Remarks");
    expect(choiceOf("Comply as noted", "").choice).toBe("Comply");
    expect(choiceOf("-")).toEqual({ choice: "", known: true });
    expect(choiceOf("Not applicable").choice).toBe("Not Applicable");
    expect(choiceOf("EC plug fan")).toEqual({ choice: "EC plug fan", known: false });
    expect(standardChoice("Complied")).toBe("Comply");
    expect(standardChoice("By Contractor")).toBe("In Contractor's Scope");
    expect(standardChoice("As noted")).toBe("Noted");
    expect(standardChoice("VFD Not Applicable")).toBe("Not Applicable");
  });

  it("the prompt carries rules, facts, datasheet rows and the parent clause", () => {
    const u = userPrompt({ clause: "Cooling coil section.", sr: "1.", part: 2, section: "GENERAL", parent: "The unit shall include:", product: "AHU", factory: "Riyadh",
      similar: [], comments: "Note. # say the coil is chilled water",
      rules: [{ rule: rule({ title: "Coils", instruction: "Coils are chilled water." }), score: 1, matched: ["coil"] }],
      facts: [{ rule: rule({ kind: "fact", title: "Fans", instruction: "EC plug fans." }), score: 1, matched: ["fan"] }],
      datasheet: [{ label: "Cooling coil • Rows", value: "6", key: "k" }], units: ["AHU-1"] });
    expect(u).toMatch(/Parent clause \(this clause continues it\):\nThe unit shall include:/);
    expect(u).toMatch(/AI rules for this clause \(library team, follow them\):\n1\. say the coil is chilled water/);
    expect(u).toMatch(/Site rules that apply to this clause:\n1\. Coils: Coils are chilled water\./);
    expect(u).toMatch(/Project datasheet rows \(units: AHU-1\):\n- Cooling coil • Rows: 6/);
    expect(u).toMatch(/Factory facts \(AHU, standard offering\):\n- Fans: EC plug fans\./);
  });
});

describe("AI rules: the drafting order and the checks", () => {
  afterEach(() => { delete (env as any).AI; });
  const base = { clause: "Rigging of the units shall be by the contractor.", sr: "A.", part: 3, section: "INSTALLATION", product: "AHU", factory: "Riyadh", similar: [], comments: "" };
  const site = rule({ id: "site", title: "Site work", keywords: "rigging", part: 3, answer: "In Contractor's Scope", remark: "Daikin scope is equipment supply only." });

  it("a rule with an answer and a remark answers without the model; a clause rule sends it to the model", async () => {
    const hits = pickRules([site], base.clause, base.section, 3);
    const d = await draftAnswer(env, { ...base, rules: hits.rules });
    expect(d).toMatchObject({ compliance: "In Contractor's Scope", remarks: "Daikin scope is equipment supply only.", source: "rule", confidence: "high", model: "" });
    expect(d.reason).toBe('Site rule "Site work" (clause mentions rigging).');
    const fake = fakeAi(() => ({ compliance: "Noted", remarks: "", reason: "Followed the rule.", confidence: "high" }));
    (env as any).AI = fake.ai;
    const own = await draftAnswer(env, { ...base, rules: hits.rules, comments: "# this client wants Noted" });
    expect(own).toMatchObject({ compliance: "Noted", source: "model", confidence: "high" });
    expect(own.reason).toMatch(/^Followed the clause's AI rule\./);
  });

  it("a library line with its own '#' rule is not copied blindly", async () => {
    const lib = { id: "L", factory_id: "ahu-riyadh", spec_text: "Filters shall be F7.", compliance: "Comply with Remarks", remarks: "Comply with MERV 13 as per IFC schedule.",
      comments: "# project-specific, do not reuse", status: "answered", section: "FILTERS", score: 0.97, how: "lexical" as const };
    const fake = fakeAi(() => ({ compliance: "Comply", remarks: "", reason: "Library rule says do not reuse.", confidence: "medium" }));
    (env as any).AI = fake.ai;
    const d = await draftAnswer(env, { ...base, clause: "Filters shall be F7.", part: 2, section: "FILTERS", similar: [lib] });
    expect(d.source).toBe("model");
    expect(fake.calls[0].user).toMatch(/AI rules: project-specific, do not reuse/);
    const plain = await draftAnswer(env, { ...base, clause: "Filters shall be F7.", part: 2, section: "FILTERS", similar: [{ ...lib, comments: "" }] });
    expect(plain.source).toBe("library-similar");
  });

  it("numbers from facts and datasheet rows may be quoted; others become [value]", async () => {
    (env as any).AI = fakeAi(() => ({ compliance: "Comply with Remarks", remarks: "Offered units are with 62 mm panels and 1000 hours salt spray.", reason: "Datasheet row.", confidence: "high" })).ai;
    const d = await draftAnswer(env, { ...base, clause: "Casing panels shall be 50 mm.", part: 2, section: "CASING",
      datasheet: [{ label: "Casing • Panel", value: "62 mm", key: "k" }] });
    expect(d.remarks).toBe("Offered units are with 62 mm panels and [value] salt spray.");
    expect(d.confidence).toBe("low");
    expect(d.reason).toMatch(/Check: no source gives 1000 hours/);
    expect(d.sources.map((x) => x.kind)).toEqual(["datasheet"]);
    const withFact = await draftAnswer(env, { ...base, clause: "Casing panels shall be 50 mm.", part: 2, section: "CASING",
      datasheet: [{ label: "Casing • Panel", value: "62 mm", key: "k" }],
      facts: [{ rule: rule({ kind: "fact", instruction: "Panels pass 1000 hours salt spray to ISO 9227." }), score: 1, matched: [] }] });
    expect(withFact.remarks).toBe("Offered units are with 62 mm panels and 1000 hours salt spray.");
    expect(withFact.confidence).toBe("medium");                     // the model said high; nothing in the library backs it
  });

  it("Not Comply needs a rule, a datasheet row or a library answer; an unusable reply gets one retry", async () => {
    const fake = fakeAi(() => ({ compliance: "Not Comply", remarks: "Not offered.", reason: "Guess.", confidence: "low" }));
    (env as any).AI = fake.ai;
    await expect(draftAnswer(env, { ...base, clause: "Units shall have a steam humidifier.", part: 2, section: "HUMIDIFIER" }))
      .rejects.toThrow(/Not Comply with no rule, datasheet row or library answer/);
    const backed = await draftAnswer(env, { ...base, clause: "Units shall have a steam humidifier.", part: 2, section: "HUMIDIFIER",
      rules: [{ rule: rule({ instruction: "Steam humidifiers are not offered; answer Not Comply." }), score: 1, matched: ["humidifier"] }] });
    expect(backed.compliance).toBe("Not Comply");
    let n = 0;
    const flaky = fakeAi(() => (n++ === 0 ? "I think it complies." : { compliance: "Noted", remarks: "", reason: "General.", confidence: "low" }));
    (env as any).AI = flaky.ai;
    const d = await draftAnswer(env, { ...base, clause: "The work includes the following.", part: 1, section: "SUMMARY" });
    expect(d.compliance).toBe("Noted");
    expect(flaky.calls).toHaveLength(2);
    expect(flaky.calls[1].user).toMatch(/Your previous reply could not be used: the reply was not one JSON object/);
  });
});

describe("AI rules: routes", () => {
  beforeEach(async () => { await resetLogins(); });
  afterEach(() => { delete (env as any).AI; });

  it("admins and the super user manage rules; Can-edit users, other users and strangers are refused", async () => {
    const t = await login("teamAdmin");
    const s = await ok("ai_rules_save", { p_token: t, p_product_id: "ahu", p_factory_id: "ahu-riyadh", p_kind: "rule", p_title: "Site work",
      p_keywords: "install, rigging", p_part: 3, p_instruction: "", p_answer: "by contractor", p_remark: "Daikin scope is equipment supply only." });
    await ok("ai_rules_save", { p_token: t, p_product_id: "ahu", p_kind: "fact", p_title: "Fans", p_keywords: "fan", p_instruction: "Direct-driven EC plug fans.", p_answer: "Comply", p_remark: "x" });
    const list = await ok("ai_rules_list", { p_token: t, p_product_id: "ahu", p_factory_id: "ahu-riyadh" });
    expect(list.rules.map((r: any) => [r.kind, r.title, r.answer, r.direct, r.factory])).toEqual([["rule", "Site work", "In Contractor's Scope", true, "Riyadh"], ["fact", "Fans", "", false, ""]]);
    // the Dubai view shows the product-wide fact, not Riyadh's own rule
    const dubai = await ok("ai_rules_list", { p_token: t, p_product_id: "ahu", p_factory_id: "ahu-dubai" });
    expect(dubai.rules.map((r: any) => r.title)).toEqual(["Fans"]);
    const tried = await ok("ai_rules_test", { p_token: t, p_product_id: "ahu", p_factory_id: "ahu-riyadh", p_clause: "Rigging and installation by the contractor.", p_part: 0 });
    expect(tried.direct).toMatchObject({ title: "Site work", matched: ["install", "rigging"] });
    await ok("ai_rules_save", { p_token: t, p_id: s.id, p_product_id: "ahu", p_factory_id: "ahu-riyadh", p_kind: "rule", p_title: "Site work", p_keywords: "rigging", p_part: 3, p_instruction: "Site work is by others.", p_active: false });
    expect((await ok("ai_rules_test", { p_token: t, p_product_id: "ahu", p_factory_id: "ahu-riyadh", p_clause: "Rigging.", p_part: 3 })).direct).toBeNull();
    const aud = await env.DB.prepare("SELECT action FROM app_audit WHERE action LIKE 'ai_rules%' ORDER BY id").all<any>();
    expect(aud.results.map((a) => a.action)).toEqual(["ai_rules_save", "ai_rules_save", "ai_rules_save"]);
    // refusals
    expect(await refused("ai_rules_save", { p_token: t, p_product_id: "ahu", p_kind: "rule", p_answer: "Comply", p_remark: "x" })).toMatch(/needs keywords or a Part/);
    expect(await refused("ai_rules_save", { p_token: t, p_product_id: "ahu", p_kind: "rule", p_instruction: "x", p_answer: "Maybe", p_keywords: "a" })).toMatch(/must be one of/);
    expect(await refused("ai_rules_save", { p_token: t, p_product_id: "ahu", p_factory_id: "fcu-riyadh", p_kind: "fact", p_instruction: "Something" })).toMatch(/does not make this product/);
    const sales = await login("sales");                    // may edit the library, may not steer the AI
    expect(await refused("ai_rules_list", { p_token: sales, p_product_id: "ahu" })).toMatch(/Only an admin or the super user/);
    expect(await refused("ai_rules_save", { p_token: sales, p_product_id: "ahu", p_kind: "fact", p_instruction: "x y z" })).toMatch(/Only an admin/);
    expect(await refused("ai_rules_delete", { p_token: sales, p_id: s.id })).toMatch(/Only an admin/);
    expect(await refused("ai_rules_test", { p_token: sales, p_product_id: "ahu", p_clause: "Rigging" })).toMatch(/Only an admin/);
    const sbu = await login("sbu");
    expect(await refused("ai_rules_list", { p_token: sbu, p_product_id: "ahu" })).toMatch(/Only an admin/);
    expect(await refused("ai_rules_list", { p_token: "nope", p_product_id: "ahu" })).toBe("SESSION_EXPIRED");
    const su = await login("admin");
    const del = await ok("ai_rules_delete", { p_token: su, p_id: s.id });
    expect(del.rule.title).toBe("Site work");
    expect(await refused("ai_rules_delete", { p_token: su, p_id: s.id })).toMatch(/no longer exists/);
  });

  it("the review uses the site rules and the project's datasheet; users never see '#' rules", async () => {
    const t = await login("admin");
    const p = await ok("pr_save", { p_token: t, p_name: "Tower B", p_client_type: "Consultant", p_client_name: "ACME", p_region: "UAE" });
    const lines = [...SPEC_LINES, { type: "part", sr: "", spec: "PART 3 - EXECUTION" }, { type: "section", sr: "3.01", spec: "INSTALLATION" },
      { type: "letter", sr: "A.", spec: "Rigging and setting of units in place shall be coordinated on site." }];
    const run = await ok("cm_save_run", { p_token: t, p_factory_id: "ahu-dubai", p_source: "pdf", p_file_name: "spec.pdf", p_lines: lines, p_project_id: p.id });
    await ok("pr_note_save", { p_token: t, p_project_id: p.id, p_product_id: "ahu", p_file_names: "sel.pdf", p_columns: ["AHU-01"],
      p_rows: [{ section: "Casing", component: "Panel thickness", cells: ["62 mm"], kind: "row", key: "c1" }, { section: "Fan", component: "Motor", cells: ["EC, 4 kW"], kind: "row", key: "f1" }] });
    await ok("ai_rules_save", { p_token: t, p_product_id: "ahu", p_kind: "rule", p_title: "Site work", p_keywords: "rigging", p_part: 3, p_answer: "In Contractor's Scope", p_remark: "Daikin scope is equipment supply only." });
    await ok("ai_rules_save", { p_token: t, p_product_id: "ahu", p_factory_id: "ahu-dubai", p_kind: "fact", p_title: "Fans", p_keywords: "fan", p_instruction: "Direct-driven EC plug fans." });
    // a clause rule on the polyurethane clause
    const pu = await env.DB.prepare("SELECT id FROM cm_lines WHERE spec_text LIKE 'Panels shall be insulated%'").first<any>();
    await ok("cm_admin_save_answer", { p_token: t, p_line_id: pu.id, p_compliance: "", p_remarks: "", p_comments: "Ask the factory. # quote the panel thickness from the datasheet" });
    const fake = fakeAi((u) => u.includes("polyurethane")
      ? { compliance: "Comply with Remarks", remarks: "Offered units are with 62 mm panels.", reason: "Datasheet panel thickness.", confidence: "high" }
      : { compliance: "Comply", remarks: "Standard construction.", reason: "General.", confidence: "medium" });
    (env as any).AI = fake.ai;
    const r = await ok("ai_review_run", { p_token: t, p_run_id: run.run_id, p_limit: 25 });
    expect(r).toMatchObject({ ruled: 1, failed: 0, remaining: 0 });
    const prompts = fake.calls.map((c) => c.user);
    expect(prompts.some((u) => /Rigging/.test(u))).toBe(false);                 // the rule answered it; no model call
    const puPrompt = prompts.find((u) => u.includes("polyurethane"))!;
    expect(puPrompt).toMatch(/Project datasheet rows \(units: AHU-01\):\n- Casing • Panel thickness: 62 mm/);
    expect(puPrompt).toMatch(/AI rules for this clause \(library team, follow them\):\n1\. quote the panel thickness from the datasheet/);
    expect(prompts.find((u) => u.includes("Fans shall be"))).toMatch(/Factory facts \(AHU, standard offering\):\n- Fans: Direct-driven EC plug fans\./);
    const rec = await ok("pr_run_get", { p_token: t, p_run_id: run.run_id });
    const rig = rec.lines.find((l: any) => /Rigging/.test(l.spec));
    expect(rig).toMatchObject({ ai_draft: true, compliance: "In Contractor's Scope", remarks: "Daikin scope is equipment supply only." });
    expect(rig.ai).toMatchObject({ source: "rule", confidence: "high" });
    const puRow = rec.lines.find((l: any) => /polyurethane/.test(l.spec));
    expect(puRow).toMatchObject({ compliance: "Comply with Remarks", remarks: "Offered units are with 62 mm panels." });
    expect(puRow.ai.confidence).toBe("high");                                   // a clause rule backs it
    expect(puRow.lib_comments).toBe("Ask the factory. # quote the panel thickness from the datasheet");   // an editor sees the rule
    const versions = await env.DB.prepare("SELECT DISTINCT prompt_version FROM ai_drafts ORDER BY 1").all<any>();
    expect(versions.results.map((v) => v.prompt_version)).toEqual(["draft-2026-10-16", "rule-2026-10-16"]);
    // a member who may not edit the library sees the note only
    await ok("pr_share_set", { p_token: t, p_id: p.id, p_user_ids: ["u5"] });
    const sbu = await login("sbu");
    const seen = await ok("pr_run_get", { p_token: sbu, p_run_id: run.run_id });
    expect(seen.lines.find((l: any) => /polyurethane/.test(l.spec)).lib_comments).toBe("Ask the factory.");
    const conv = await ok("cm_save_run", { p_token: sbu, p_factory_id: "ahu-dubai", p_source: "text", p_file_name: "", p_lines: lines.slice(3, 7) });
    expect(conv.answers.find((a: any) => a.comments).comments).toBe("Ask the factory.");
  });

  it("an uploaded library is written in the six standard answers", async () => {
    const t = await login("admin");
    const res = await ok("cm_admin_import", { p_token: t, p_factory_id: "ahu-riyadh", p_file_name: "lib.xlsx", p_rows: [
      { sr: "A.", type: "letter", spec: "Coordinate sizes and locations of concrete bases.", compliance: "By contractor", remarks: "" },
      { sr: "B.", type: "letter", spec: "Fans shall be plug type, direct driven.", compliance: "Comply as noted", remarks: "EC plug fans are provided" },
      { sr: "C.", type: "letter", spec: "Motor shall be IE3 or better efficiency.", compliance: "EC external rotor motors", remarks: "" },
      { sr: "D.", type: "letter", spec: "Units shall be delivered with crating.", compliance: "-", remarks: "Nylon wrapped, wooden crating." }
    ] });
    expect(res.standardised).toBe(3);
    const got = await env.DB.prepare("SELECT compliance FROM cm_lines WHERE factory_id = 'ahu-riyadh' ORDER BY spec_text").all<any>();
    expect(got.results.map((x) => x.compliance).sort()).toEqual(["", "Comply with Remarks", "EC external rotor motors", "In Contractor's Scope"]);
  });
});
