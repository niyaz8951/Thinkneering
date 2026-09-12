-- =====================================================================
-- SBU — the regional project development map.
--
-- The HVAC map answers "what is this equipment and what governs it". This
-- one answers a different question: "where is this enquiry, who owes me
-- something, and have we solved this before". Same graph, different kinds,
-- because a pipeline stage is not a component and pretending otherwise
-- would put both in one meaningless pile.
--
-- The two maps are meant to be read together. A spec clause resolved on
-- the HVAC map is knowledge; the fact that the Jebel Ali factory quoted a
-- special option for it in nine days is a precedent, and lives here.
--
-- Requires: db/2026-09-knowledge-typed.sql and db/2026-09-actions.sql.
-- Re-runnable — every insert is keyed and re-seeding overwrites cleanly.
--   npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-09-sbu-map.sql
-- =====================================================================

-- ── Kinds this map needs ─────────────────────────────────────────────
-- Added to the same registry the HVAC map uses. A kind is global; which
-- kinds a map actually uses is a matter of what is on it.

INSERT OR REPLACE INTO knowledge_kinds (kind,label,hint,sort_order) VALUES
  ('process',    'Process step',  'A stage in a pipeline: intake, technical review, factory clarification.', 110),
  ('stakeholder','Stakeholder',   'A team or role you depend on, or that depends on you.', 120),
  ('factory',    'Factory',       'A manufacturing site you route enquiries to.', 130),
  ('market',     'Market',        'A country or region the enquiry belongs to.', 140),
  ('enquiry',    'Enquiry',       'A single TQRQ or DSRQ, tracked from intake to closure.', 150),
  ('capability', 'Capability',    'A method you apply: value engineering, compliance strategy.', 160),
  ('automation', 'Automation',    'A tool or flow that removes manual effort.', 170),
  ('metric',     'Metric',        'Something measured: response time, conversion rate.', 180),
  ('risk',       'Risk',          'A recurring way things stall, and what it costs.', 190);

-- ── What may connect to what ─────────────────────────────────────────
-- The trigger on knowledge_edges enforces this, so anything missing here
-- simply cannot be drawn. Deliberately tight: an unconstrained work graph
-- degenerates into everything-relates-to-everything within a month.

-- Pipeline flow and ownership.
INSERT OR IGNORE INTO knowledge_edge_rules (from_kind,to_kind,relation) VALUES
  ('process','process','feeds'),
  ('process','process','escalates_to'),
  ('enquiry','process','sits_at'),
  ('process','stakeholder','involves'),
  ('process','factory','routed_to'),
  ('stakeholder','process','owns'),
  ('stakeholder','stakeholder','escalates_to');

-- Where an enquiry comes from and what it is about.
INSERT OR IGNORE INTO knowledge_edge_rules (from_kind,to_kind,relation) VALUES
  ('enquiry','market','belongs_to'),
  ('enquiry','project','belongs_to'),
  ('enquiry','equipment','concerns'),
  ('enquiry','requirement','concerns'),
  ('enquiry','factory','routed_to'),
  ('enquiry','stakeholder','involves'),
  ('market','factory','served_by'),
  ('factory','equipment','builds');

-- Methods, and what they act on.
INSERT OR IGNORE INTO knowledge_edge_rules (from_kind,to_kind,relation) VALUES
  ('capability','process','supports'),
  ('capability','risk','mitigates'),
  ('capability','requirement','resolves'),
  ('capability','equipment','applies_to');

-- Automation, and what it removes effort from.
INSERT OR IGNORE INTO knowledge_edge_rules (from_kind,to_kind,relation) VALUES
  ('automation','process','automates'),
  ('automation','metric','reports'),
  ('automation','stakeholder','serves'),
  ('automation','automation','feeds');

-- Measurement and failure.
INSERT OR IGNORE INTO knowledge_edge_rules (from_kind,to_kind,relation) VALUES
  ('process','metric','measured_by'),
  ('metric','process','measures'),
  ('risk','process','blocks'),
  ('risk','metric','degrades'),
  ('risk','risk','causes'),
  ('process','risk','exposed_to');

-- Technical scope reaches across into the HVAC vocabulary.
INSERT OR IGNORE INTO knowledge_edge_rules (from_kind,to_kind,relation) VALUES
  ('requirement','standard','cites'),
  ('stakeholder','equipment','supports'),
  ('factory','standard','certified_to');

-- Every new kind may supersede its own kind, and be annotated.
INSERT OR IGNORE INTO knowledge_edge_rules (from_kind,to_kind,relation)
SELECT k.kind, k.kind, 'supersedes' FROM knowledge_kinds k;
INSERT OR IGNORE INTO knowledge_edge_rules (from_kind,to_kind,relation)
SELECT 'note', k.kind, 'annotates' FROM knowledge_kinds k;
INSERT OR IGNORE INTO knowledge_edge_rules (from_kind,to_kind,relation)
SELECT 'term', k.kind, 'defines' FROM knowledge_kinds k;

-- ── The map ──────────────────────────────────────────────────────────

-- Nothing is deleted here.
--
-- This began as DELETE-then-INSERT, which is the obvious way to make a seed
-- re-runnable and was quietly destructive: by the time you re-run it the map
-- also holds engineers you added, markets from db/2026-09-people.sql, and the
-- actions hanging off them. All of it went.
--
-- Every insert below is INSERT OR IGNORE instead, so a second run adds what
-- is missing and touches nothing else. The cost is that editing the seed text
-- here no longer updates a row that already exists — delete that specific row
-- first, or edit it in the map, which is where it should be edited anyway.

INSERT OR IGNORE INTO knowledge_maps
  (id, slug, title, description, kind, domain, visibility, status, owner_id, lanes, created_at, updated_at)
SELECT
  'map_sbu', 'sbu', 'SBU',
  'Regional project development: the TQRQ and DSRQ pipeline, who it depends on, '
  || 'what stalls it, and what has already been solved.',
  'process', 'sbu', 'org', 'active',
  COALESCE((SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1), 'system'),
  '[{"id":"pipeline","label":"Pipeline","token":"--kg-lane-1"},'
  || '{"id":"people","label":"Stakeholders","token":"--kg-lane-2"},'
  || '{"id":"supply","label":"Factories & markets","token":"--kg-lane-3"},'
  || '{"id":"scope","label":"Technical scope","token":"--kg-lane-4"},'
  || '{"id":"method","label":"Capabilities","token":"--kg-lane-5"},'
  || '{"id":"automation","label":"Automation","token":"--kg-lane-6"},'
  || '{"id":"outcome","label":"Metrics & risks","token":"--kg-lane-7"}]',
  datetime('now'), datetime('now');

-- ── Nodes ────────────────────────────────────────────────────────────
-- Everything seeds as `draft`. This map was written from a role
-- description, not from the record, so none of it has been checked yet —
-- and the whole point of the approved tier is that somebody looked.
--
-- Scope is 'general': these are how the function works, not facts about
-- one project.

INSERT OR IGNORE INTO knowledge_nodes
  (id, map_id, kind, title, aliases, summary, body, attributes, tags, standards,
   lane, x, y, status, scope, origin, version, created_by, created_at, updated_at)
VALUES
-- Pipeline ------------------------------------------------------------
 ('sbu_tqrq','map_sbu','process','TQRQ pipeline','["TQRQ","technical query","technical request"]',
  'Technical queries raised against a live or prospective project, from intake to closure.',
  '','[]','["pipeline"]','[]','pipeline',80,60,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_dsrq','map_sbu','process','DSRQ pipeline','["DSRQ","design support request"]',
  'Design support requests where the answer is a selection, a drawing or a special configuration.',
  '','[]','["pipeline"]','[]','pipeline',80,200,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_intake','map_sbu','process','Enquiry intake','["intake","logging"]',
  'The enquiry arrives, is logged, and is judged for completeness before anyone works on it.',
  '','[]','[]','[]','pipeline',80,340,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_techreview','map_sbu','process','Technical review','["spec review","deviation review"]',
  'Consultant specification read against what we can actually supply. Deviations and special options identified here.',
  '','[]','[]','[]','pipeline',80,480,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_factoryclar','map_sbu','process','Factory clarification','["factory query","special quotation"]',
  'What the factory must confirm before a price or a compliance statement can be given.',
  '','[]','[]','[]','pipeline',80,620,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_pricing','map_sbu','process','Special option pricing','["special pricing","cost request"]',
  'Optimised factory pricing for non-standard scope, and what it does to competitiveness.',
  '','[]','[]','[]','pipeline',80,760,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_proposal','map_sbu','process','Proposal & compliance statement','["offer","submittal"]',
  'The compliance matrix and technical offer that goes back to Sales.',
  '','[]','[]','[]','pipeline',80,900,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_booking','map_sbu','process','Booking conversion','["order","booking"]',
  'Where a technically resolved enquiry becomes a booked order, or does not.',
  '','[]','[]','[]','pipeline',80,1040,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_closure','map_sbu','process','Enquiry closure','["closure","won lost"]',
  'Closed won, closed lost or withdrawn, with the reason recorded. The reason is the part worth keeping.',
  '','[]','[]','[]','pipeline',80,1180,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_escalation','map_sbu','process','Escalation','["escalate","critical opportunity"]',
  'What happens to a strategic enquiry that has stopped moving.',
  '','[]','[]','[]','pipeline',80,1320,'draft','general','human',1,'seed',datetime('now'),datetime('now')),

-- Stakeholders --------------------------------------------------------
 ('sbu_sales','map_sbu','stakeholder','Regional Sales','["sales","area sales"]',
  'Owns the customer and the commercial decision. Raises most enquiries.',
  '','[]','[]','[]','people',420,60,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_appeng','map_sbu','stakeholder','Application Engineering','["app eng","AE"]',
  'Selections, sizing and the technical shape of the offer.',
  '','[]','[]','[]','people',420,200,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_prodeng','map_sbu','stakeholder','Product Engineering','["product eng","PE"]',
  'Owns what the product can and cannot be made to do.',
  '','[]','[]','[]','people',420,340,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_controls','map_sbu','stakeholder','Controls team','["controls","BMS team"]',
  'Control logic, integration protocol and points lists.',
  '','[]','[]','[]','people',420,480,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_globalsbu','map_sbu','stakeholder','Global SBU','["SBU","global team"]',
  'Product strategy and the authority behind non-standard commitments.',
  '','[]','[]','[]','people',420,620,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_consultant','map_sbu','stakeholder','Consultant','["specifier","MEP consultant"]',
  'Writes the specification the compliance matrix is answered against.',
  '','[]','[]','[]','people',420,760,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_contractor','map_sbu','stakeholder','Contractor','["MEP contractor","main contractor"]',
  'Buys the equipment and owns installation scope.',
  '','[]','[]','[]','people',420,900,'draft','general','human',1,'seed',datetime('now'),datetime('now')),

-- Factories & markets -------------------------------------------------
 ('sbu_mea','map_sbu','market','MEA region','["Middle East and Africa","MEA"]',
  'The markets this pipeline covers.',
  '','[]','[]','[]','supply',760,60,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_fac_uae','map_sbu','factory','Factory — UAE','["Jebel Ali","UAE plant"]',
  'Regional plant. Shortest lead time for the MEA pipeline.',
  '','[]','[]','[]','supply',760,200,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_fac_ksa','map_sbu','factory','Factory — Saudi Arabia','["KSA plant","Saudi factory"]',
  'Regional plant. Relevant where local content is specified.',
  '','[]','[]','[]','supply',760,340,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_fac_eu','map_sbu','factory','Factory — Europe','["EU plant","European factory"]',
  'Source for hygienic, ATEX and certification-heavy scope.',
  '','[]','[]','[]','supply',760,480,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_fac_in','map_sbu','factory','Factory — India','["India plant"]',
  'Cost-competitive source for volume scope.',
  '','[]','[]','[]','supply',760,620,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_fac_cn','map_sbu','factory','Factory — China','["China plant"]',
  'Source for specific product lines and components.',
  '','[]','[]','[]','supply',760,760,'draft','general','human',1,'seed',datetime('now'),datetime('now')),

-- Technical scope -----------------------------------------------------
 ('sbu_ahu','map_sbu','equipment','AHU','["air handling unit","AHU"]',
  'Air handling units, the largest source of specification deviation in this pipeline.',
  '','[]','[]','[]','scope',1100,60,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_fcu','map_sbu','equipment','FCU','["fan coil unit","FCU"]',
  'Fan coil units.',
  '','[]','[]','[]','scope',1100,180,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_chiller','map_sbu','equipment','Chiller','["chiller"]',
  'Air and water cooled chillers.',
  '','[]','[]','[]','scope',1100,300,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_erv','map_sbu','equipment','ERV','["energy recovery ventilator","ERV","HRV"]',
  'Energy recovery ventilation.',
  '','[]','[]','[]','scope',1100,420,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_bms','map_sbu','requirement','Controls & BMS integration','["BMS","BACnet","Modbus","integration"]',
  'Protocol, points list and who owns the interface. A frequent late-stage surprise.',
  '','[]','[]','[]','scope',1100,540,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_filtration','map_sbu','requirement','Filtration','["filter class","ISO 16890","HEPA"]',
  'Filter classes and the pressure drop they cost.',
  '','[]','[]','[]','scope',1100,660,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_acoustics','map_sbu','requirement','Acoustics','["sound power","NC","attenuation"]',
  'Sound power limits, and the attenuation needed to reach them.',
  '','[]','[]','[]','scope',1100,780,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_hygiene','map_sbu','requirement','Hygienic requirements','["hygiene","VDI 6022","DIN 1946-4"]',
  'Hygienic construction for healthcare and pharma scope.',
  '','[]','[]','[]','scope',1100,900,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_atex','map_sbu','requirement','ATEX','["ATEX","hazardous area","explosion proof"]',
  'Explosive atmosphere scope: zone, category and what it excludes.',
  '','[]','[]','[]','scope',1100,1020,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_certs','map_sbu','requirement','Certifications','["Eurovent","AHRI","certification"]',
  'Which certification a specification demands, and whether the offered unit carries it.',
  '','[]','[]','[]','scope',1100,1140,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_deviation','map_sbu','requirement','Technical deviation','["deviation","non-compliance"]',
  'Where the offer knowingly departs from the specification, and the justification given.',
  '','[]','[]','[]','scope',1100,1260,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_special','map_sbu','requirement','Special option','["special","non-standard"]',
  'Scope outside the standard configurator, needing factory engineering and pricing.',
  '','[]','[]','[]','scope',1100,1380,'draft','general','human',1,'seed',datetime('now'),datetime('now')),

-- Capabilities --------------------------------------------------------
 ('sbu_ve','map_sbu','capability','Value engineering','["VE","cost optimisation"]',
  'Removing cost without losing compliance. The most common route to a booking.',
  '','[]','[]','[]','method',1440,60,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_altproduct','map_sbu','capability','Alternative product proposal','["alternative","equal and approved"]',
  'Offering a different product that meets the intent when the specified one cannot be supplied competitively.',
  '','[]','[]','[]','method',1440,200,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_compstrategy','map_sbu','capability','Compliance strategy','["compliance approach","deviation strategy"]',
  'Deciding what to comply with, what to deviate on, and how to argue it.',
  '','[]','[]','[]','method',1440,340,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_riskreduction','map_sbu','capability','Technical risk reduction','["risk reduction","de-risking"]',
  'Closing the unknowns before they become a claim.',
  '','[]','[]','[]','method',1440,480,'draft','general','human',1,'seed',datetime('now'),datetime('now')),

-- Automation ----------------------------------------------------------
 ('sbu_vba','map_sbu','automation','Excel VBA tooling','["VBA","costing tool","macro"]',
  'Costing, selection and nomenclature tools that remove repeat manual work.',
  '','[]','[]','[]','automation',1780,60,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_powerautomate','map_sbu','automation','Power Automate flows','["Power Automate","flow","routing"]',
  'Routing, assignment and notification between the teams in this map.',
  '','[]','[]','[]','automation',1780,200,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_dashboard','map_sbu','automation','Pipeline dashboard','["dashboard","tracker","visibility"]',
  'Enquiry status and ageing, visible without asking anyone.',
  '','[]','[]','[]','automation',1780,340,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_kpi','map_sbu','automation','KPI & management reporting','["KPI","reporting","MIS"]',
  'What gets reported upward, and how it is produced.',
  '','[]','[]','[]','automation',1780,480,'draft','general','human',1,'seed',datetime('now'),datetime('now')),

-- Metrics & risks -----------------------------------------------------
 ('sbu_m_response','map_sbu','metric','Response time','["turnaround","TAT","response"]',
  'Time from enquiry intake to a usable technical answer.',
  '','[]','[]','[]','outcome',2120,60,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_m_conversion','map_sbu','metric','Booking conversion','["hit rate","conversion","win rate"]',
  'Share of technically resolved enquiries that become orders.',
  '','[]','[]','[]','outcome',2120,200,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_m_ageing','map_sbu','metric','Pipeline ageing','["ageing","open days"]',
  'How long open enquiries have been open, by stage.',
  '','[]','[]','[]','outcome',2120,340,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_r_factorylag','map_sbu','risk','Factory response lag','["factory delay","awaiting factory"]',
  'The enquiry is complete on our side and waiting on someone else.',
  '','[]','[]','[]','outcome',2120,480,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_r_specambiguity','map_sbu','risk','Specification ambiguity','["unclear spec","ambiguous clause"]',
  'The clause can be read two ways and the reading changes the price.',
  '','[]','[]','[]','outcome',2120,620,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_r_latescope','map_sbu','risk','Late scope change','["scope creep","revised spec"]',
  'The specification moves after the offer is priced.',
  '','[]','[]','[]','outcome',2120,760,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_r_undefinedowner','map_sbu','risk','No clear owner','["ownership gap","unassigned"]',
  'Everyone assumes someone else is answering. The most expensive one, because nothing looks wrong.',
  '','[]','[]','[]','outcome',2120,900,'draft','general','human',1,'seed',datetime('now'),datetime('now'));

-- ── Edges ────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO knowledge_edges (id, map_id, from_id, to_id, relation, status, created_by, created_at)
VALUES
-- Pipeline flow
 ('sbue01','map_sbu','sbu_intake','sbu_techreview','feeds','draft','seed',datetime('now')),
 ('sbue02','map_sbu','sbu_techreview','sbu_factoryclar','feeds','draft','seed',datetime('now')),
 ('sbue03','map_sbu','sbu_factoryclar','sbu_pricing','feeds','draft','seed',datetime('now')),
 ('sbue04','map_sbu','sbu_pricing','sbu_proposal','feeds','draft','seed',datetime('now')),
 ('sbue05','map_sbu','sbu_proposal','sbu_booking','feeds','draft','seed',datetime('now')),
 ('sbue06','map_sbu','sbu_booking','sbu_closure','feeds','draft','seed',datetime('now')),
 ('sbue07','map_sbu','sbu_tqrq','sbu_intake','feeds','draft','seed',datetime('now')),
 ('sbue08','map_sbu','sbu_dsrq','sbu_intake','feeds','draft','seed',datetime('now')),
 ('sbue09','map_sbu','sbu_factoryclar','sbu_escalation','escalates_to','draft','seed',datetime('now')),
 ('sbue10','map_sbu','sbu_pricing','sbu_escalation','escalates_to','draft','seed',datetime('now')),

-- Who is involved where
 ('sbue11','map_sbu','sbu_intake','sbu_sales','involves','draft','seed',datetime('now')),
 ('sbue12','map_sbu','sbu_techreview','sbu_appeng','involves','draft','seed',datetime('now')),
 ('sbue13','map_sbu','sbu_techreview','sbu_consultant','involves','draft','seed',datetime('now')),
 ('sbue14','map_sbu','sbu_factoryclar','sbu_prodeng','involves','draft','seed',datetime('now')),
 ('sbue15','map_sbu','sbu_proposal','sbu_sales','involves','draft','seed',datetime('now')),
 ('sbue16','map_sbu','sbu_booking','sbu_contractor','involves','draft','seed',datetime('now')),
 ('sbue17','map_sbu','sbu_escalation','sbu_globalsbu','involves','draft','seed',datetime('now')),
 ('sbue18','map_sbu','sbu_sales','sbu_globalsbu','escalates_to','draft','seed',datetime('now')),

-- Routing
 ('sbue19','map_sbu','sbu_factoryclar','sbu_fac_uae','routed_to','draft','seed',datetime('now')),
 ('sbue20','map_sbu','sbu_factoryclar','sbu_fac_ksa','routed_to','draft','seed',datetime('now')),
 ('sbue21','map_sbu','sbu_factoryclar','sbu_fac_eu','routed_to','draft','seed',datetime('now')),
 ('sbue22','map_sbu','sbu_factoryclar','sbu_fac_in','routed_to','draft','seed',datetime('now')),
 ('sbue23','map_sbu','sbu_factoryclar','sbu_fac_cn','routed_to','draft','seed',datetime('now')),
 ('sbue24','map_sbu','sbu_mea','sbu_fac_uae','served_by','draft','seed',datetime('now')),
 ('sbue25','map_sbu','sbu_mea','sbu_fac_ksa','served_by','draft','seed',datetime('now')),
 ('sbue26','map_sbu','sbu_fac_uae','sbu_ahu','builds','draft','seed',datetime('now')),
 ('sbue27','map_sbu','sbu_fac_eu','sbu_ahu','builds','draft','seed',datetime('now')),
 ('sbue28','map_sbu','sbu_fac_in','sbu_fcu','builds','draft','seed',datetime('now')),

-- Scope attaches to equipment
 ('sbue29','map_sbu','sbu_hygiene','sbu_ahu','applies_to','draft','seed',datetime('now')),
 ('sbue30','map_sbu','sbu_atex','sbu_ahu','applies_to','draft','seed',datetime('now')),
 ('sbue31','map_sbu','sbu_acoustics','sbu_ahu','applies_to','draft','seed',datetime('now')),
 ('sbue32','map_sbu','sbu_filtration','sbu_ahu','applies_to','draft','seed',datetime('now')),
 ('sbue33','map_sbu','sbu_bms','sbu_chiller','applies_to','draft','seed',datetime('now')),
 ('sbue34','map_sbu','sbu_certs','sbu_chiller','applies_to','draft','seed',datetime('now')),
 ('sbue35','map_sbu','sbu_special','sbu_ahu','applies_to','draft','seed',datetime('now')),
 ('sbue36','map_sbu','sbu_deviation','sbu_ahu','applies_to','draft','seed',datetime('now')),

-- Capabilities
 ('sbue37','map_sbu','sbu_ve','sbu_pricing','supports','draft','seed',datetime('now')),
 ('sbue38','map_sbu','sbu_altproduct','sbu_proposal','supports','draft','seed',datetime('now')),
 ('sbue39','map_sbu','sbu_compstrategy','sbu_techreview','supports','draft','seed',datetime('now')),
 ('sbue40','map_sbu','sbu_riskreduction','sbu_factoryclar','supports','draft','seed',datetime('now')),
 ('sbue41','map_sbu','sbu_compstrategy','sbu_deviation','resolves','draft','seed',datetime('now')),
 ('sbue42','map_sbu','sbu_ve','sbu_special','resolves','draft','seed',datetime('now')),
 ('sbue43','map_sbu','sbu_riskreduction','sbu_r_specambiguity','mitigates','draft','seed',datetime('now')),
 ('sbue44','map_sbu','sbu_compstrategy','sbu_r_latescope','mitigates','draft','seed',datetime('now')),

-- Automation
 ('sbue45','map_sbu','sbu_vba','sbu_pricing','automates','draft','seed',datetime('now')),
 ('sbue46','map_sbu','sbu_vba','sbu_proposal','automates','draft','seed',datetime('now')),
 ('sbue47','map_sbu','sbu_powerautomate','sbu_intake','automates','draft','seed',datetime('now')),
 ('sbue48','map_sbu','sbu_powerautomate','sbu_escalation','automates','draft','seed',datetime('now')),
 ('sbue49','map_sbu','sbu_dashboard','sbu_m_ageing','reports','draft','seed',datetime('now')),
 ('sbue50','map_sbu','sbu_dashboard','sbu_m_response','reports','draft','seed',datetime('now')),
 ('sbue51','map_sbu','sbu_kpi','sbu_m_conversion','reports','draft','seed',datetime('now')),
 ('sbue52','map_sbu','sbu_dashboard','sbu_kpi','feeds','draft','seed',datetime('now')),
 ('sbue53','map_sbu','sbu_kpi','sbu_globalsbu','serves','draft','seed',datetime('now')),

-- Measurement and failure
 ('sbue54','map_sbu','sbu_intake','sbu_m_response','measured_by','draft','seed',datetime('now')),
 ('sbue55','map_sbu','sbu_booking','sbu_m_conversion','measured_by','draft','seed',datetime('now')),
 ('sbue56','map_sbu','sbu_r_factorylag','sbu_factoryclar','blocks','draft','seed',datetime('now')),
 ('sbue57','map_sbu','sbu_r_specambiguity','sbu_techreview','blocks','draft','seed',datetime('now')),
 ('sbue58','map_sbu','sbu_r_latescope','sbu_pricing','blocks','draft','seed',datetime('now')),
 ('sbue59','map_sbu','sbu_r_undefinedowner','sbu_escalation','blocks','draft','seed',datetime('now')),
 ('sbue60','map_sbu','sbu_r_factorylag','sbu_m_response','degrades','draft','seed',datetime('now')),
 ('sbue61','map_sbu','sbu_r_undefinedowner','sbu_m_ageing','degrades','draft','seed',datetime('now')),
 ('sbue62','map_sbu','sbu_r_specambiguity','sbu_r_latescope','causes','draft','seed',datetime('now'));

UPDATE knowledge_maps SET
  node_count     = (SELECT COUNT(*) FROM knowledge_nodes WHERE map_id = 'map_sbu'),
  approved_count = (SELECT COUNT(*) FROM knowledge_nodes WHERE map_id = 'map_sbu' AND status = 'approved'),
  updated_at     = datetime('now')
 WHERE id = 'map_sbu';
