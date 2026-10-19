-- 0005 (19 Oct 2026): base fixes from the Qiddiya base test (docs: Base-Flow-Test-2026-10-19, Rollout-Plan-2026-10-19).
-- Never edit after it has been applied; a correction is 0006.
--
-- 1. pr_notes.factory_id: the factory the datasheet names (Material Name ...9 Riyadh, ...5 Dubai), saved with the table,
--    so a specification of another factory is flagged and the AI does not compare a datasheet of another factory.
ALTER TABLE pr_notes ADD COLUMN factory_id TEXT NOT NULL DEFAULT '';

-- 2. Starter "Remove text" beside the starter keywords (the power supply loses "+ PE").
ALTER TABLE dn_starter_keywords ADD COLUMN strip TEXT NOT NULL DEFAULT '';

-- 3. Starter keywords: some fixed (roof, door, profile, airflow, insulation, power supply matched the wrong clauses), some
--    added (chilled-water coil, heat wheel, humidifier, electric heater, return fan, filter size, MERV, EN 1886, EN 13053).
--    A mapping row takes the new keywords only when nobody changed its keywords (they are empty or still the old starter);
--    its "Remove text" only when it is empty.
CREATE TABLE dn_starter_new (row_key TEXT PRIMARY KEY, keywords TEXT NOT NULL, strip TEXT NOT NULL);
INSERT INTO dn_starter_new (row_key, keywords, strip) VALUES
  ('general||power supply', 'power supply; electrical characteristic; electrical supply; supply voltage; main power; electrical power', '+ PE'),
  ('unit data||panel', 'double wall; double skin; panel thick; casing thick; wall thick; panel construction', ''),
  ('unit data||insulation', 'insulation; insulated panel; mineral wool; rockwool; polyurethane; injected foam; thermal conductance', ''),
  ('unit data||panel inner skin', 'inner panel; inside casing; inner skin; inner sheet; interior panel', ''),
  ('unit data||panel outer skin', 'outer panel; outside casing; outer skin; outer sheet; exterior panel', ''),
  ('unit data||profile', 'thermal break; frame profile; aluminium profile; aluminum profile; casing frame', ''),
  ('unit data||ahu base', 'base rail; base frame; steel base; channel base; mounting frame; unit base; skid', ''),
  ('unit data||roof', 'outdoor installation; outdoor unit; weatherproof; weather proof; weather resistant; rain hood; canopy; roof curb', ''),
  ('unit data||door', 'access side; door side; handing', ''),
  ('unit data||supply air flow', 'design air flow; supply air flow; supply airflow; air flow rate; air quantity', ''),
  ('unit data||external pressure drop', 'external static; external pressure', ''),
  ('unit data||sfpv (clean filters)', 'specific fan power; sfp', ''),
  ('unit data||erp compliant', 'erp; ecodesign', ''),
  ('mixing box supply|damper one supply|material', 'damper blade; damper galvan; damper alumin; blade damper; damper frame', ''),
  ('filter supply||filter class', 'filter efficien; filter class; panel filter; bag filter; hepa; extended surface; dust spot; merv; arrestance; iso 16890', ''),
  ('filter supply||material', 'filter media; media material', ''),
  ('filter supply||dimensions', 'thickness; filter depth; filter size; bag length; pocket length; deep cells', ''),
  ('filter supply||clean pressure drop', 'initial resistance; clean filter; initial pressure drop', ''),
  ('filter supply||dirty pressure drop', 'final resistance; dirty filter; final pressure drop; filter pressure drop', ''),
  ('filter supply||air velocity', 'filter face velocity; face velocity', ''),
  ('coil cooling water supply|geometry|rows', 'rows deep; coil rows; row coil; number of rows', ''),
  ('coil cooling water supply|geometry|frame', 'coil frame; coil casing; channel frame', ''),
  ('coil cooling water supply|geometry|tube material', 'copper tube; tube material; seamless copper', ''),
  ('coil cooling water supply|geometry|tube thickness', 'tube wall thick; tube thick', ''),
  ('coil cooling water supply|geometry|fin material', 'fin alumin; fin copper; fin material; fin coated', ''),
  ('coil cooling water supply|geometry|fin space', 'fins per; fin spac; fpi', ''),
  ('coil cooling water supply|geometry|air velocity', 'face velocity; coil velocity', ''),
  ('coil cooling water supply|geometry|drain pan', 'drain pan; condensate pan', ''),
  ('coil cooling water supply|geometry|moisture eliminator', 'moisture eliminator; eliminator', ''),
  ('coil cooling water supply|geometry|connection diam', 'coil connection; header connection', ''),
  ('coil cooling water supply|cooling air side|total capacity', 'cooling capacity; total capacity', ''),
  ('coil cooling water supply|cooling fluid side|pressure drop', 'water pressure drop; water side pressure', ''),
  ('fan supply||quantity', 'fan array; number of fans; multiple fans', ''),
  ('fan return||type', 'centrifugal fan; plug fan; plenum fan; ec fan; backward curved; forward curved; fan type', ''),
  ('fan return||efficiency', 'fan efficien; static efficien', ''),
  ('fan return|motor data|efficiency class', 'motor efficien; ie2; ie3; ie4; ie5; premium efficien', ''),
  ('recuperator heat wheel supply||type', 'heat wheel; energy wheel; rotary wheel; enthalpy wheel; sorption', ''),
  ('recuperator heat wheel supply||dry efficiency (en308)', 'sensible effectiveness; effectiveness; recovery efficien', ''),
  ('recuperator heat wheel supply||diameter', 'wheel diameter', ''),
  ('recuperator heat wheel supply||energy class (en13053)', 'energy recovery class; heat recovery class', ''),
  ('isothermal steam humidifier supply||type', 'humidifier; steam humidifier; steam grid; electrode', ''),
  ('isothermal steam humidifier supply||steam', 'steam capacity; humidification capacity; steam output', ''),
  ('isothermal steam humidifier supply||distributor', 'steam distributor; dispersion tube; steam grid', ''),
  ('electric heater supply||nominal capacity', 'heating capacity; heater capacity; electric heat', ''),
  ('electric heater supply||steps number', 'heating stages; heater steps; step control', ''),
  ('electric heater supply||material', 'heating element; sheathed element; open element', ''),
  ('electric heater supply||electrical protection', 'thermal cutout; high limit; overheat protection; airflow switch', ''),
  ('mechanical characteristic (en1886)||casing strength', 'casing strength; deflection; structural performance; mechanical strength', ''),
  ('mechanical characteristic (en1886)||casing leakage', 'casing leakage; air leakage; leakage class', ''),
  ('mechanical characteristic (en1886)||thermal transmit', 'thermal transmittance; thermal transmit; u value; heat transfer coefficient', ''),
  ('mechanical characteristic (en1886)||thermal bridging', 'thermal bridging; thermal bridge; tb class', ''),
  ('en 13053||supply velocity class', 'velocity class; face velocity class', ''),
  ('en 13053||supply power class', 'power class; fan power class', ''),
  ('unit data||total supply filters eff. epm1', 'epm1; iso epm1', '');

UPDATE dn_map SET keywords = (SELECT n.keywords FROM dn_starter_new n WHERE n.row_key = dn_map.row_key)
 WHERE product_id = 'ahu' AND row_key IN (SELECT row_key FROM dn_starter_new)
   AND (keywords = '' OR keywords = coalesce((SELECT o.keywords FROM dn_starter_keywords o WHERE o.row_key = dn_map.row_key), ''));
UPDATE dn_map SET strip = (SELECT n.strip FROM dn_starter_new n WHERE n.row_key = dn_map.row_key)
 WHERE product_id = 'ahu' AND strip = '' AND row_key IN (SELECT row_key FROM dn_starter_new WHERE strip <> '');
INSERT OR REPLACE INTO dn_starter_keywords (row_key, keywords, strip) SELECT row_key, keywords, strip FROM dn_starter_new;
DROP TABLE dn_starter_new;

-- 4. A rule book is linked once (one product scope or one factory scope); a knowledge map once per product. Duplicates
--    already there: the link for every factory stays, then the oldest.
DELETE FROM ai_map_links WHERE role = 'rulebook' AND rowid NOT IN (
  SELECT rowid FROM (SELECT rowid, ROW_NUMBER() OVER (PARTITION BY map_id ORDER BY (factory_id IS NOT NULL), created_at, rowid) AS rn
                       FROM ai_map_links WHERE role = 'rulebook') WHERE rn = 1);
DELETE FROM ai_map_links WHERE role = 'knowledge' AND rowid NOT IN (
  SELECT rowid FROM (SELECT rowid, ROW_NUMBER() OVER (PARTITION BY product_id, map_id ORDER BY (factory_id IS NOT NULL), created_at, rowid) AS rn
                       FROM ai_map_links WHERE role = 'knowledge') WHERE rn = 1);
CREATE UNIQUE INDEX ai_map_links_rulebook_once ON ai_map_links (map_id) WHERE role = 'rulebook';
CREATE UNIQUE INDEX ai_map_links_knowledge_once ON ai_map_links (product_id, map_id) WHERE role = 'knowledge';

-- 5. The AI's clause-to-row matches were worked out with the old keywords: worked out again on the next review.
DELETE FROM ai_match_cache;
