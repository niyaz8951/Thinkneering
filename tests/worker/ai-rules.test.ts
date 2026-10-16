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

  it("AI maps are chosen per product and factory by admins; others are refused; the tab shows what a map gets wrong", async () => {
    const t = await login("teamAdmin");
    const made = await ok("ai_map_create", { p_token: t, p_product_id: "ahu" });
    expect(made.name).toBe("AI rules: AHU");
    let got = await ok("ai_map_get", { p_token: t, p_product_id: "ahu", p_factory_id: "ahu-riyadh" });
    expect(got.all).toMatchObject({ id: made.id, name: "AI rules: AHU" });
    expect(got.all.rules).toBeGreaterThan(8);
    expect(got.all.direct).toBeGreaterThanOrEqual(4);
    expect(got.own).toBeNull();
    expect(got.settings).toMatchObject({ copyAt: 0.9, useModel: true, budget: 9000 });
    expect(got.problems).toEqual([]);
    // a factory map of his own, named as he likes, linked by name
    const own = await ok("ai_map_create", { p_token: t, p_product_id: "ahu", p_factory_id: "ahu-riyadh", p_name: "AHU-Riyadh-AI notes" });
    const part3 = await env.DB.prepare("SELECT id FROM mp_nodes WHERE map_id = ? AND title = 'Part 3 Execution'").bind(own.id).first<any>();
    await env.DB.prepare("INSERT INTO mp_nodes (id, map_id, parent_id, title, notes, special, sort, verified) VALUES ('n-bad', ?, ?, 'Hoisting', 'Hoisting is by others.', ?, 9, 1)")
      .bind(own.id, part3.id, JSON.stringify(["When: hoisting", "Answer: By others please", "Remark: Hoisting by others."])).run();
    await env.DB.prepare("INSERT INTO mp_nodes (id, map_id, parent_id, title, notes, special, sort, verified) VALUES ('n-ok', ?, ?, 'Hoisting 2', '', ?, 10, 1)")
      .bind(own.id, part3.id, JSON.stringify(["When: hoisting", "Answer: In Contractor's Scope", "Remark: Hoisting is by the contractor."])).run();
    await env.DB.prepare("UPDATE mp_maps SET updated_at = ? WHERE id = ?").bind(new Date().toISOString(), own.id).run();
    const settings = await env.DB.prepare("SELECT id FROM mp_nodes WHERE map_id = ? AND title = 'Settings'").bind(own.id).first<any>();
    await env.DB.prepare("UPDATE mp_nodes SET special = ? WHERE id = ?").bind(JSON.stringify(["Copy from library at: 0.85", "Speed: fast"]), settings.id).run();
    got = await ok("ai_map_get", { p_token: t, p_product_id: "ahu", p_factory_id: "ahu-riyadh" });
    expect(got.own).toMatchObject({ name: "AHU-Riyadh-AI notes", direct: 1 });
    expect(got.settings.copyAt).toBe(0.85);                                     // the factory's map overrides the product's
    expect(got.problems.join("\n")).toMatch(/Answer "By others please" is not one of the six answers/);
    expect(got.problems.join("\n")).toMatch(/"Speed" is not a setting the AI knows/);
    expect(got.maps.map((m: any) => m.name)).toEqual(expect.arrayContaining(["AI rules: AHU", "AHU-Riyadh-AI notes"]));
    // try a clause: the factory's rule answers it, from its branch
    const tried = await ok("ai_try", { p_token: t, p_product_id: "ahu", p_factory_id: "ahu-riyadh", p_clause: "Hoisting of the sections to the roof.", p_part: 3 });
    expect(tried.direct).toMatchObject({ title: "Hoisting 2", answer: "In Contractor's Scope" });
    expect(tried.direct.where).toMatch(/AHU-Riyadh-AI notes.*Part 3 Execution.*Hoisting 2/);
    const scope = await ok("ai_try", { p_token: t, p_product_id: "ahu", p_factory_id: "ahu-dubai", p_clause: "This section includes air handling units.", p_section: "SECTION INCLUDES", p_part: 1 });
    expect(scope.direct).toMatchObject({ title: "Scope statements", answer: "Noted" });
    // the Riyadh map does not reach Dubai
    expect((await ok("ai_try", { p_token: t, p_product_id: "ahu", p_factory_id: "ahu-dubai", p_clause: "Hoisting of the sections.", p_part: 3 })).direct).toBeNull();
    // switched off ("to verify"): ignored
    await env.DB.prepare("UPDATE mp_nodes SET verified = 0 WHERE id = 'n-ok'").run();
    await env.DB.prepare("UPDATE mp_maps SET updated_at = ? WHERE id = ?").bind(new Date(Date.now() + 1000).toISOString(), own.id).run();
    expect((await ok("ai_try", { p_token: t, p_product_id: "ahu", p_factory_id: "ahu-riyadh", p_clause: "Hoisting of the sections.", p_part: 3 })).direct).toBeNull();
    // unlink
    await ok("ai_map_link", { p_token: t, p_product_id: "ahu", p_factory_id: "ahu-riyadh", p_map_id: null });
    expect((await ok("ai_map_get", { p_token: t, p_product_id: "ahu", p_factory_id: "ahu-riyadh" })).own).toBeNull();
    // refusals
    const su = await login("admin");
    expect(await refused("ai_map_link", { p_token: su, p_product_id: "ahu", p_factory_id: "ahu-riyadh", p_map_id: own.id })).toMatch(/not available to you/);   // private to its maker
    const sales = await login("sales");
    for (const r of ["ai_map_get", "ai_map_create", "ai_map_link", "ai_try", "ai_quality"])
      expect(await refused(r, { p_token: sales, p_product_id: "ahu", p_factory_id: "ahu-riyadh", p_clause: "x y z" })).toMatch(/Only an admin or the super user/);
    expect(await refused("ai_map_get", { p_token: (await login("sbu")), p_product_id: "ahu" })).toMatch(/Only an admin/);
    expect(await refused("ai_map_get", { p_token: "nope", p_product_id: "ahu" })).toBe("SESSION_EXPIRED");
  });

  it("the review: datasheet first by code, library reopened when the datasheet differs, map rules, the model last; suggestions and feedback; '#' rules hidden", async () => {
    const t = await login("admin");
    await env.DB.batch([
      env.DB.prepare("INSERT INTO dn_map (product_id, row_key, section, component, show, keywords, sort) VALUES ('ahu', 'unit data||panel', 'Unit Data', 'Panel', 1, 'double wall; double skin; panel thick', 1)"),
      env.DB.prepare("INSERT INTO dn_map (product_id, row_key, section, component, show, keywords, sort) VALUES ('ahu', 'unit data||insulation', 'Unit Data', 'Insulation', 1, 'insulation; injected foam; polyurethane', 2)")
    ]);
    await ok("ai_map_create", { p_token: t, p_product_id: "ahu" });
    const p = await ok("pr_save", { p_token: t, p_name: "Tower B", p_client_type: "Consultant", p_client_name: "ACME", p_region: "UAE" });
    const lines = [...SPEC_LINES, { type: "part", sr: "", spec: "PART 3 - EXECUTION" }, { type: "section", sr: "3.01", spec: "INSTALLATION" },
      { type: "letter", sr: "A.", spec: "Unloading of the units at site shall be coordinated with the contractor." }];
    // the library answers the CASING clause with 50 mm; this project's unit has 62 mm
    const casingRun = await ok("cm_save_run", { p_token: t, p_factory_id: "ahu-dubai", p_source: "text", p_file_name: "x", p_lines: [lines[5]] });
    void casingRun;
    const casing = await env.DB.prepare("SELECT id FROM cm_lines WHERE spec_text LIKE 'Casing shall be double skin%'").first<any>();
    await ok("cm_admin_save_answer", { p_token: t, p_line_id: casing.id, p_compliance: "Comply", p_remarks: "50 mm double skin panels.", p_comments: "Check the panel." });
    const fanLine = await env.DB.prepare("SELECT id FROM cm_lines WHERE spec_text LIKE 'Fans shall be plug%'").first<any>();
    const run = await ok("cm_save_run", { p_token: t, p_factory_id: "ahu-dubai", p_source: "pdf", p_file_name: "spec.pdf", p_lines: lines, p_project_id: p.id });
    const fans = await env.DB.prepare("SELECT id FROM cm_lines WHERE spec_text LIKE 'Fans shall be plug%'").first<any>();
    await env.DB.prepare("UPDATE cm_lines SET comments = 'Ask the factory. # say direct-driven EC plug fans' WHERE id = ?").bind(fans.id).run();
    void fanLine;
    await ok("pr_note_save", { p_token: t, p_project_id: p.id, p_product_id: "ahu", p_file_names: "sel.pdf", p_columns: ["AHU-01"],
      p_rows: [{ section: "Unit Data", component: "Panel", cells: ["62 mm"], kind: "row", key: "unit data||panel" }, { section: "", component: "Insulation", cells: ["PU foam 45 kg/m3"], kind: "row", key: "unit data||insulation" }] });
    const fake = fakeAi(() => ({ compliance: "Comply", remarks: "Direct-driven EC plug fans.", reason: "Plug fans are standard.", confidence: "medium" }));
    (env as any).AI = fake.ai;
    const r = await ok("ai_review_run", { p_token: t, p_run_id: run.run_id, p_limit: 25 });
    expect(r.by_source).toMatchObject({ datasheet: 2, rule: 2, model: 1 });
    expect(r).toMatchObject({ failed: 0, remaining: 0 });
    expect(fake.calls.filter((c) => c.model.includes("llama")).length).toBe(1);     // only the fan clause needed the model
    const rec = await ok("pr_run_get", { p_token: t, p_run_id: run.run_id });
    const by = (re: RegExp) => rec.lines.find((l: any) => re.test(l.spec));
    // casing: "50 mm" asked as is, the unit has 62 mm -> Comply with Remarks, the library's 50 mm answer reopened
    expect(by(/^Casing shall be double skin/)).toMatchObject({ ai_draft: true, compliance: "Comply with Remarks", remarks: "62 mm" });
    expect(by(/^Casing shall be double skin/).ai.reason).toMatch(/The library answer says 50 mm; this project's datasheet has 62 mm\. From the datasheet: 62 mm ≠ 50 mm asked/);
    // insulation: "not less than 40 kg/m3", the unit has 45 -> Comply, by code
    expect(by(/polyurethane/)).toMatchObject({ compliance: "Comply", remarks: "PU foam 45 kg/m3" });
    expect(by(/polyurethane/).ai).toMatchObject({ source: "datasheet", confidence: "high" });
    expect(by(/polyurethane/).ai.reason).toMatch(/45 kg\/m3 ≥ 40 kg\/m3 required/);
    // map rules: the scope statement and the unloading clause, no model
    expect(by(/^This section includes/)).toMatchObject({ compliance: "Noted", remarks: "Noted." });
    expect(by(/^Unloading/)).toMatchObject({ compliance: "In Contractor's Scope" });
    expect(by(/^Unloading/).ai.reason).toMatch(/Site rule "Unloading at site"/);
    // a member without library rights sees the note of Internal Comments, not the "#" rule
    await ok("pr_share_set", { p_token: t, p_id: p.id, p_user_ids: ["u5"] });
    const sbu = await login("sbu");
    const seen = await ok("pr_run_get", { p_token: sbu, p_run_id: run.run_id });
    expect(seen.lines.find((l: any) => /^Fans shall be plug/.test(l.spec)).lib_comments).toBe("Ask the factory.");
    expect(rec.lines.find((l: any) => /^Fans shall be plug/.test(l.spec)).lib_comments).toBe("Ask the factory. # say direct-driven EC plug fans");

    // focus mode, for everyone who can open the record: a second record, the fan clause answered by a person first
    const run2 = await ok("cm_save_run", { p_token: t, p_factory_id: "ahu-dubai", p_source: "text", p_file_name: "rev1", p_project_id: p.id,
      p_lines: [{ type: "part", sr: "", spec: "PART 2 - PRODUCTS" }, { type: "section", sr: "2.02", spec: "FANS" },
                { type: "letter", sr: "A.", spec: "Fan impellers shall be statically and dynamically balanced to grade G 6.3." },
                { type: "letter", sr: "B.", spec: "Fan impellers shall be statically and dynamically balanced to grade G 6.3." }] });
    const r2 = await ok("pr_run_get", { p_token: t, p_run_id: run2.run_id });
    const [a, b] = r2.lines.filter((l: any) => l.can).map((l: any) => l.seq);
    await ok("pr_run_save_line", { p_token: sbu, p_run_id: run2.run_id, p_seq: a, p_compliance: "Comply", p_remarks: "Balanced to ISO 21940 G 6.3." });
    fake.calls.length = 0;
    const sug = await ok("ai_suggest", { p_token: sbu, p_run_id: run2.run_id, p_seqs: [a, b] });
    expect(sug.suggestions.find((x: any) => x.seq === a)).toMatchObject({ none: true });          // answered already
    expect(sug.suggestions.find((x: any) => x.seq === b)).toMatchObject({ source: "record", compliance: "Comply", remarks: "Balanced to ISO 21940 G 6.3." });
    expect(fake.calls.length).toBe(0);
    // he keeps it: the save is the feedback the AI learns from
    await ok("pr_run_save_line", { p_token: sbu, p_run_id: run2.run_id, p_seq: b, p_compliance: "Comply", p_remarks: "Balanced to ISO 21940 G 6.3." });
    const fb = await env.DB.prepare("SELECT source, outcome, final FROM ai_feedback WHERE run_id = ?").bind(run2.run_id).all<any>();
    expect(fb.results).toEqual([{ source: "record", outcome: "kept", final: "Comply" }]);
    // the draft of the first record that a person corrects is feedback too
    const fan = by(/^Fans shall be plug/);
    await ok("pr_run_save_line", { p_token: t, p_run_id: run.run_id, p_seq: fan.seq, p_compliance: "Comply with Remarks", p_remarks: "EC plug fans." });
    const q = await ok("ai_quality", { p_token: t, p_product_id: "ahu" });
    expect(q.sources).toEqual(expect.arrayContaining([expect.objectContaining({ source: "record", n: 1, kept: 1 }), expect.objectContaining({ source: "model", n: 1, replaced: 1 })]));
    // with the model switched off in the map, free sources still answer and the model is never called
    const mapId = (await ok("ai_map_get", { p_token: t, p_product_id: "ahu" })).all.id;
    await env.DB.prepare("UPDATE mp_nodes SET special = ? WHERE map_id = ? AND title = 'Settings'").bind(JSON.stringify(["Use the AI model: no"]), mapId).run();
    await env.DB.prepare("UPDATE mp_maps SET updated_at = ? WHERE id = ?").bind(new Date(Date.now() + 5000).toISOString(), mapId).run();
    await ok("ai_review_clear", { p_token: t, p_run_id: run.run_id });
    fake.calls.length = 0;
    const off = await ok("ai_review_run", { p_token: t, p_run_id: run.run_id, p_limit: 25 });
    expect(off.by_source).toMatchObject({ datasheet: 2, rule: 2 });
    expect(off.by_source.model).toBeUndefined();
    expect(fake.calls.length).toBe(0);
    // a clause nothing free can answer waits, and the review says why
    await ok("pr_run_save_line", { p_token: t, p_run_id: run.run_id, p_seq: fan.seq, p_compliance: "", p_remarks: "" });
    const waits = await ok("ai_review_run", { p_token: t, p_run_id: run.run_id, p_limit: 25 });
    expect(waits).toMatchObject({ waiting: 1, done: 0 });
    expect(waits.stopped).toMatch(/switched off in the AI map/);
    expect(fake.calls.length).toBe(0);
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

describe("AI review: connection and allowance", () => {
  beforeEach(async () => { await resetLogins(); });
  afterEach(() => { delete (env as any).AI; delete (env as any).AI_GATEWAY_ID; });

  it("ai_check says in plain words when the AI cannot be reached; plain users are refused", async () => {
    const t = await login("admin");
    (env as any).AI = { async run() { throw new Error("AiError: 4006: you have used up your daily free allocation of 10,000 neurons, please upgrade to Cloudflare's Workers Paid plan"); } };
    const c = await ok("ai_check", { p_token: t });
    expect(c).toMatchObject({ working: false });
    expect(c.message).toMatch(/free Workers AI allowance for today is used up/);
    (env as any).AI = fakeAi(() => "OK").ai;
    expect(await ok("ai_check", { p_token: t })).toMatchObject({ working: true, reply: "OK" });
    const sbu = await login("sbu");
    expect(await refused("ai_check", { p_token: sbu })).toMatch(/Only an admin/);
  });

  it("a used-up allowance stops the batch at once; a broken gateway falls back to Workers AI; failed clauses are skipped", async () => {
    const t = await login("admin");
    const p = await ok("pr_save", { p_token: t, p_name: "Tower C", p_client_type: "Consultant", p_client_name: "ACME", p_region: "UAE" });
    const run = await ok("cm_save_run", { p_token: t, p_factory_id: "ahu-dubai", p_source: "pdf", p_file_name: "spec.pdf", p_lines: SPEC_LINES, p_project_id: p.id });
    let calls = 0;
    (env as any).AI = { async run() { calls++; throw new Error("4006: daily free allocation of 10,000 neurons used"); } };
    const r = await ok("ai_review_run", { p_token: t, p_run_id: run.run_id, p_limit: 25 });
    expect(r.stopped).toMatch(/allowance for today is used up/);
    expect(calls).toBeLessThanOrEqual(4);                                      // the calls in flight, not one per clause
    expect(r.remaining).toBe(4);
    // the gateway does not exist: the call goes straight to Workers AI
    (env as any).AI_GATEWAY_ID = "hub";
    const seen: string[] = [];
    (env as any).AI = { async run(_m: string, _i: any, opts?: any) {
      if (opts && opts.gateway) { seen.push("gateway"); throw new Error("Gateway 'hub' not found"); }
      seen.push("direct"); return { response: JSON.stringify({ compliance: "Noted", remarks: "", reason: "r", confidence: "low" }) };
    } };
    const r2 = await ok("ai_review_run", { p_token: t, p_run_id: run.run_id, p_limit: 2 });
    expect(r2).toMatchObject({ done: 2, failed: 0, stopped: "" });
    // the calls already on their way try the gateway once each; after the first refusal every call goes direct
    expect(seen.filter((x) => x === "gateway").length).toBeLessThanOrEqual(2);
    expect(seen.filter((x) => x === "direct").length).toBe(2);
    // a clause that fails is reported and not tried again in the same review
    (env as any).AI = fakeAi(() => "not json at all").ai;
    const r3 = await ok("ai_review_run", { p_token: t, p_run_id: run.run_id, p_limit: 25 });
    expect(r3.failed).toBe(2);
    const r4 = await ok("ai_review_run", { p_token: t, p_run_id: run.run_id, p_limit: 25, p_skip: r3.failed_seqs });
    expect(r4).toMatchObject({ done: 0, failed: 0, remaining: 0 });
  });
});
