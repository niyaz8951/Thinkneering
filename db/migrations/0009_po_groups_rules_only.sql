-- 0009 (20 Oct 2026, owner):
-- 1. Product Options keeps the values of a repeated item together: Filter 1 (ISO Coarse 60% (G4), Chevronet, Synthetic,
--    its dimensions and pressure drops) and Filter 2 (ePM1 65% (F7) ...) are two groups of the Filter Supply section, named
--    after the item's first row ("Filter Class: ISO Coarse 60%(G4)"). po_values gets a group column (grp, '' = no group),
--    part of the key, so the same value can sit in two groups. Values saved before keep grp = '' (read the datasheets
--    again to see them grouped).
-- 2. Maps hold only the AI's rules and way of thinking; product information lives in Product Options (datasheet values,
--    special options, notes, and AI notes for admins). Knowledge maps are no longer linked to the AI, and the Facts
--    branch of rule books is no longer read: their VERIFIED facts become AI notes of the factory they were used for
--    (section General), so nothing the AI used is lost. AHU Riyadh gets back the owner's eleven AI notes deleted by the
--    reset of 20 Oct 2026, and every AHU factory the three verified facts of the old template (each only once).

-- 1. po_values with a group
CREATE TABLE po_values_new (
  factory_id  TEXT NOT NULL REFERENCES cm_factories(id) ON DELETE CASCADE,
  row_key     TEXT NOT NULL,
  model       TEXT NOT NULL DEFAULT '',
  grp         TEXT NOT NULL DEFAULT '',
  value_key   TEXT NOT NULL,
  value       TEXT NOT NULL,
  times       INTEGER NOT NULL DEFAULT 1,
  hidden      INTEGER NOT NULL DEFAULT 0,
  first_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  approved    INTEGER NOT NULL DEFAULT 1,
  approved_by TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  approved_at TEXT,
  PRIMARY KEY (factory_id, row_key, model, grp, value_key)
);
INSERT INTO po_values_new (factory_id, row_key, model, grp, value_key, value, times, hidden, first_at, last_at, approved, approved_by, approved_at)
  SELECT factory_id, row_key, model, '', value_key, value, times, hidden, first_at, last_at, approved, approved_by, approved_at FROM po_values;
DROP TABLE po_values;
ALTER TABLE po_values_new RENAME TO po_values;
CREATE INDEX po_values_waiting ON po_values (factory_id) WHERE approved = 0;

-- 2. verified facts of the maps linked to a factory -> AI notes of that factory
CREATE TABLE _facts AS
WITH RECURSIVE t(id, map_id, factory_id, role, depth, top, ok, title, notes, ptitle) AS (
  SELECT n.id, n.map_id, l.factory_id, l.role, 0, '', 1, n.title, n.notes, ''
    FROM mp_nodes n JOIN ai_map_links l ON l.map_id = n.map_id
   WHERE n.parent_id IS NULL AND l.factory_id IS NOT NULL
  UNION ALL
  SELECT c.id, c.map_id, t.factory_id, t.role, t.depth + 1, CASE WHEN t.depth = 0 THEN c.title ELSE t.top END,
         CASE WHEN t.ok = 1 AND c.verified = 1 THEN 1 ELSE 0 END, c.title, c.notes, t.title
    FROM mp_nodes c JOIN t ON c.parent_id = t.id
)
SELECT DISTINCT factory_id, substr(trim(CASE WHEN lower(title) LIKE 'offered%' THEN ptitle ELSE title END) || ': ' || trim(notes), 1, 1000) AS body FROM t
 WHERE ok = 1 AND trim(notes) <> '' AND depth >= 1 AND (
       (role = 'rulebook' AND lower(top) IN ('facts', 'product facts', 'factory facts') AND depth >= 2)
    OR (role = 'knowledge' AND lower(top) NOT IN ('vocabulary') AND NOT (depth = 1 AND lower(title) IN ('product facts', 'vocabulary')))
    OR (role = 'knowledge' AND lower(top) = 'vocabulary' AND lower(title) LIKE 'offered%' AND notes NOT LIKE 'Fill in%'));
INSERT INTO po_extras (id, factory_id, section, row_key, kind, body, created_by, created_at, updated_by, updated_at)
  SELECT lower(hex(randomblob(16))), f.factory_id, 'General', '', 'ai', f.body, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now')
    FROM _facts f
   WHERE NOT EXISTS (SELECT 1 FROM po_extras e WHERE e.factory_id = f.factory_id AND e.kind = 'ai' AND e.body = f.body);
DROP TABLE _facts;

-- the owner's AHU Riyadh AI notes, each one Riyadh does not have yet (by its subject)
INSERT INTO po_extras (id, factory_id, section, row_key, kind, body, created_by, created_at, updated_by, updated_at)
  SELECT lower(hex(randomblob(16))), 'ahu-riyadh', 'General', '', 'ai', v.column1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now')
    FROM (VALUES ('Filters: Standard filters are G4 synthetic pre-filters and F7 final filters on aluminium slide-in racks; other grades to the project schedule; filter sections designed for 2 m/s face velocity.'),
          ('Certification and testing: AHUs are Eurovent certified; air performance measured to ISO 5801 and AMCA 210; health and safety certified to ISO 45001.'),
          ('Delivery and packing: Units are nylon wrapped and delivered on wooden crating; lifting holes are provided on the base frame of every module or mono-block unit.'),
          ('Heat recovery wheels: Heat recovery wheels are Eurovent certified, aluminium (non-combustible), molecular sieve 3 Å coating for enthalpy wheels, double bristle brush seals; wound wheels up to 2400 mm, segmented from 2500 mm.'),
          ('Corrosion protection: Outer and inner panels pass 1000 hours salt spray to ISO 9227 / ASTM B117; outer panel is corrosion-resistant precoated.'),
          ('Warranty: Warranty is 2 years from the date of system acceptance, within 6 months from equipment delivery.'),
          ('Casing and insulation: Double-wall casing, 62 mm panels with PU foam insulation; inner and outer skin precoated galvanised steel 1.0 mm; solid 1.2 mm galvanised floor plate; framework of extruded aluminium profiles 60x60 mm, min 2 mm thick; casing mechanical strength D1 to EN 1886 (Eurovent).'),
          ('Fire rating of insulation: Foam insulation: surface spread of flame class 1 to ASTM E84 (FSI < 25, SDI < 250); fire resistance class 1 to BS 476 parts 6 and 7.'),
          ('Access doors: Hinged access doors, 450 to 800 mm wide depending on the section, with zinc die-cast / glass-fibre reinforced polyamide (PA6) handles operable from both sides and a safety latch.'),
          ('Dampers: Dampers have aluminium blades and frame with nylon bushings; leakage class 2 to EN 1751.'),
          ('Fans and motors: Fans are direct-driven EC plug fans (no belts, no separate VFD), EC external-rotor motors of IE4 / IE5 efficiency to IEC standards.')) v
   WHERE EXISTS (SELECT 1 FROM cm_factories WHERE id = 'ahu-riyadh')
     AND NOT EXISTS (SELECT 1 FROM po_extras e WHERE e.factory_id = 'ahu-riyadh' AND e.kind = 'ai' AND e.body LIKE substr(v.column1, 1, instr(v.column1, ':')) || '%');

-- the verified facts of the AHU rule book template (Eurovent classes, datasheet contents, manuals) become AI notes of
-- every AHU factory that does not have them yet (the template no longer has a Facts branch)
INSERT INTO po_extras (id, factory_id, section, row_key, kind, body, created_by, created_at, updated_by, updated_at)
  SELECT lower(hex(randomblob(16))), f.id, 'General', '', 'ai', v.column1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now')
    FROM cm_factories f, (VALUES
          ('Eurovent certification: Daikin AHUs (D-AHU) are Eurovent certified (EN 1886, EN 13053), made in Dubai and Riyadh. Certified classes by range (panel, insulation, casing strength, casing leakage at -400 Pa / +700 Pa, filter bypass leakage, thermal transmittance, thermal bridging): Energy F2: 42 mm, foam, D1(M), L1(M) / L1(M), F9(M), T3, TB4. Energy S2: 62 mm, foam, D1(M), L1(M) / L1(M), M6(M), T3, TB4. Energy TermiC F2: 42 mm, foam, thermal-break profile, D1(M), L1(M) / L1(M), F9(M), T2, TB2. Energy TermiC S2: 62 mm, foam, thermal-break profile, D1(M), L1(M) / L1(M), F9(M), T2, TB2. Sound F2: 42 mm, mineral wool, D2(M), L1(M) / L1(M), M6(M), T3, TB4. Sound S2: 62 mm, mineral wool, D2(M), L1(M) / L3(M), F9(M), T3, TB3. Sound TermiC F2: 42 mm, mineral wool, thermal-break profile, D1(M), L1(M) / L2(M), F9(M), T2, TB2. Sound TermiC S2: 62 mm, mineral wool, thermal-break profile, D1(M), L1(M) / L2(M), F9(M), T2, TB2. The range of a project is the one on its AHU datasheet.'),
          ('AHU datasheet: The AHU datasheet (selection report) of each unit gives: fan curves with the operating point, fan and motor data (air flow, pressures, power, speed, electrical data), coil performance (air side and water side, entering and leaving conditions, pressure drops), sound power levels by octave band, internal pressure drops of every component, filter classes, dimensions and weights.'),
          ('Manuals: Installation, operation and maintenance (IOM) manuals are provided with the units.')) v
   WHERE f.product_id = 'ahu'
     AND NOT EXISTS (SELECT 1 FROM po_extras e WHERE e.factory_id = f.id AND e.kind = 'ai' AND (e.body = v.column1 OR e.body LIKE substr(v.column1, 1, instr(v.column1, ':')) || '%'));

-- knowledge maps are no longer the AI's; a rule book's Facts branch is switched off with a note
DELETE FROM ai_map_links WHERE role = 'knowledge';
UPDATE mp_nodes SET verified = 0,
       notes = 'Not read by the AI since 20 Oct 2026: product facts are AI notes in Product Options (admins). Its verified facts were copied there. You can delete this branch.'
 WHERE lower(title) IN ('facts', 'product facts', 'factory facts')
   AND parent_id IN (SELECT n.id FROM mp_nodes n JOIN mp_maps m ON m.id = n.map_id WHERE n.parent_id IS NULL AND m.kind = 'rulebook');
-- the decision step "7. Knowledge maps" of the rule books is switched off with the same kind of note
UPDATE mp_nodes SET verified = 0,
       notes = 'Not used since 20 Oct 2026: maps hold the AI''s rules only; facts about the product are AI notes in Product Options (admins). You can delete this branch.'
 WHERE lower(title) LIKE '%knowledge map%'
   AND parent_id IN (SELECT n.id FROM mp_nodes n JOIN mp_maps m ON m.id = n.map_id WHERE lower(n.title) LIKE 'decision steps%' AND m.kind = 'rulebook');
