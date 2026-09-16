/* =====================================================================
   Thinkneering — Knowledge Graph: SBU domain pack
   ---------------------------------------------------------------------
   Presentation only. Which kinds exist and which relations are legal
   between them live in D1 (knowledge_kinds, knowledge_edge_rules) and
   are enforced by a trigger; this file supplies the labels, icons and
   colour tokens the map draws with.

   No seed here. The SBU map is seeded by db/2026-09-sbu-map.sql, because
   a graph the AI and the compliance path both read has to exist in the
   database whether or not anyone has opened the map page.

   Rule applied throughout: this map holds how the function works and
   what has been solved before. It does not hold customer names, prices
   or anything that identifies one deal — those belong on the enquiry
   record, not in a reusable graph.
   ===================================================================== */

(function () {
  'use strict';

  /* ── Node kinds ────────────────────────────────────────────────── */
  /* Tokens are reused from the HVAC palette rather than invented, so the
     two maps read as one system and dark mode keeps working. */

  var NODE_KINDS = {
    process:     { label: 'Process step',  token: '--kg-system',      icon: 'git-branch',
                   hint: 'A stage in the pipeline: intake, technical review, factory clarification.' },
    person:      { label: 'Engineer',      token: '--kg-lane-2',      icon: 'user',
                   hint: 'A named person you assign work to. Give them their region and their products.' },
    stakeholder: { label: 'Stakeholder',   token: '--kg-control',     icon: 'users',
                   hint: 'A team or role you depend on, or that depends on you.' },
    factory:     { label: 'Factory',       token: '--kg-equipment',   icon: 'box',
                   hint: 'A manufacturing site you route enquiries to.' },
    market:      { label: 'Market',        token: '--kg-medium',      icon: 'globe',
                   hint: 'A country or region the enquiry belongs to.' },
    enquiry:     { label: 'Enquiry',       token: '--kg-parameter',   icon: 'file-text',
                   hint: 'A single TQRQ or DSRQ, tracked from intake to closure.' },
    capability:  { label: 'Capability',    token: '--kg-component',   icon: 'tool',
                   hint: 'A method you apply: value engineering, compliance strategy.' },
    automation:  { label: 'Automation',    token: '--kg-control',     icon: 'zap',
                   hint: 'A tool or flow that removes manual effort.' },
    metric:      { label: 'Metric',        token: '--kg-parameter',   icon: 'gauge',
                   hint: 'Something measured: response time, conversion rate.' },
    risk:        { label: 'Risk',          token: '--kg-failure',     icon: 'alert-triangle',
                   hint: 'A recurring way things stall, and what it costs.' },

    /* Shared with the HVAC map, so a requirement raised here and a
       requirement raised there mean the same thing. */
    equipment:   { label: 'Equipment',     token: '--kg-equipment',   icon: 'box',
                   hint: 'A deliverable unit of plant: AHU, FCU, chiller, ERV.' },
    requirement: { label: 'Requirement',   token: '--kg-standard',    icon: 'check-square',
                   hint: 'One demand made by a specification.' },
    standard:    { label: 'Standard',      token: '--kg-standard',    icon: 'shield',
                   hint: 'A code, standard or certification scheme.' },
    project:     { label: 'Project',       token: '--kg-medium',      icon: 'briefcase',
                   hint: 'A job. Anchors project-scoped facts.' },
    document:    { label: 'Document',      token: '--kg-note',        icon: 'file',
                   hint: 'A submittal, datasheet, certificate or mail thread.' },
    note:        { label: 'Note',          token: '--kg-note',        icon: 'sticky-note',
                   hint: 'Context that is not itself a subject.' },
    term:        { label: 'Term',          token: '--kg-note',        icon: 'book',
                   hint: 'Vocabulary: what TQRQ, DSRQ or a local acronym actually means.' }
  };

  /* ── Relations ─────────────────────────────────────────────────── */
  /* Dashed lines are for things that are not a hand-off: measurement,
     blocking, automation. Solid is flow. That distinction is what lets a
     dense pipeline map still be readable at a glance. */

  var RELATIONS = {
    /* The outline's edge: "filed beneath". Legal between every pair of kinds
       (db/2026-09-outline.sql), so the outline can always indent; says nothing
       engineering about either end and is never quoted as a fact. */
    under:         { label: 'under',            inverse: null,         arrow: 'plain',   dash: '2 4' },
    covers:         { label: 'covers',         inverse: 'covered_by', arrow: 'plain', dash: '' },
    covered_by:     { label: 'covered by',     inverse: 'covers', arrow: 'plain', dash: '' },
    member_of:      { label: 'member of',      inverse: 'includes', arrow: 'plain', dash: '' },
    includes:       { label: 'includes',       inverse: 'member_of', arrow: 'diamond', dash: '' },
    liaises_with:   { label: 'liaises with',   inverse: null, arrow: 'plain',   dash: '4 4' },
    reports_to:     { label: 'reports to',     inverse: null, arrow: 'plain',   dash: '' },
    backs_up:       { label: 'backs up',       inverse: null, arrow: 'plain',   dash: '4 4' },
    works_on:       { label: 'works on',       inverse: 'staffed_by', arrow: 'plain', dash: '' },
    staffed_by:     { label: 'staffed by',     inverse: 'works_on', arrow: 'plain', dash: '' },
    assigned_to:    { label: 'assigned to',    inverse: null, arrow: 'plain',   dash: '' },
    specialises_in: { label: 'specialises in', inverse: null, arrow: 'plain',   dash: '4 4' },
    applies:        { label: 'applies',        inverse: null, arrow: 'plain',   dash: '4 4' },
    maintains:      { label: 'maintains',      inverse: null, arrow: 'plain',   dash: '2 3' },
    contact:        { label: 'contact',        inverse: null, arrow: 'plain',   dash: '4 4' },
    owns_action:    { label: 'owns',           inverse: null, arrow: 'diamond', dash: '' },
    feeds:        { label: 'feeds',            inverse: null, arrow: 'plain',   dash: '' },
    escalates_to: { label: 'escalates to',     inverse: null, arrow: 'plain',   dash: '6 4' },
    sits_at:      { label: 'sits at',          inverse: null, arrow: 'plain',   dash: '' },
    involves:     { label: 'involves',         inverse: null, arrow: 'plain',   dash: '4 4' },
    owns:         { label: 'owns',             inverse: null, arrow: 'diamond', dash: '' },
    routed_to:    { label: 'routed to',        inverse: null, arrow: 'plain',   dash: '' },
    belongs_to:   { label: 'belongs to',       inverse: null, arrow: 'plain',   dash: '' },
    concerns:     { label: 'concerns',         inverse: null, arrow: 'plain',   dash: '4 4' },
    served_by:    { label: 'served by',        inverse: null, arrow: 'plain',   dash: '' },
    builds:       { label: 'builds',           inverse: null, arrow: 'plain',   dash: '' },
    supports:     { label: 'supports',         inverse: null, arrow: 'plain',   dash: '4 4' },
    mitigates:    { label: 'mitigates',        inverse: null, arrow: 'plain',   dash: '4 4' },
    resolves:     { label: 'resolves',         inverse: null, arrow: 'plain',   dash: '4 4' },
    applies_to:   { label: 'applies to',       inverse: null, arrow: 'plain',   dash: '' },
    automates:    { label: 'automates',        inverse: null, arrow: 'plain',   dash: '2 3' },
    reports:      { label: 'reports',          inverse: null, arrow: 'plain',   dash: '2 3' },
    serves:       { label: 'serves',           inverse: null, arrow: 'plain',   dash: '2 3' },
    measured_by:  { label: 'measured by',      inverse: 'measures', arrow: 'plain', dash: '4 4' },
    measures:     { label: 'measures',         inverse: 'measured_by', arrow: 'plain', dash: '4 4' },
    blocks:       { label: 'blocks',           inverse: null, arrow: 'plain',   dash: '6 5' },
    degrades:     { label: 'degrades',         inverse: null, arrow: 'plain',   dash: '6 5' },
    causes:       { label: 'causes',           inverse: null, arrow: 'plain',   dash: '6 5' },
    exposed_to:   { label: 'exposed to',       inverse: null, arrow: 'plain',   dash: '6 5' },
    cites:        { label: 'cites',            inverse: null, arrow: 'plain',   dash: '' },
    certified_to: { label: 'certified to',     inverse: null, arrow: 'plain',   dash: '' },
    supersedes:   { label: 'supersedes',       inverse: null, arrow: 'plain',   dash: '6 5' },
    annotates:    { label: 'annotates',        inverse: null, arrow: 'plain',   dash: '2 4' },
    defines:      { label: 'defines',          inverse: null, arrow: 'plain',   dash: '2 4' }
  };

  /* ── Lanes ─────────────────────────────────────────────────────── */
  /* These match db/2026-09-sbu-map.sql. Lanes live on the map row, so
     this copy is only what a NEW SBU-domain map starts with. */

  var LANES = [
    { id: 'pipeline',   label: 'Pipeline',            token: '--kg-lane-1' },
    { id: 'people',     label: 'Stakeholders',        token: '--kg-lane-2' },
    { id: 'engineers',  label: 'Engineers',           token: '--kg-lane-2' },
    { id: 'supply',     label: 'Factories & markets', token: '--kg-lane-3' },
    { id: 'scope',      label: 'Technical scope',     token: '--kg-lane-4' },
    { id: 'method',     label: 'Capabilities',        token: '--kg-lane-5' },
    { id: 'automation', label: 'Automation',          token: '--kg-lane-6' },
    { id: 'outcome',    label: 'Metrics & risks',     token: '--kg-lane-7' }
  ];

  /* Standards this pipeline argues about most often. Named only — nothing
     here asserts that any product complies with any of them. */
  var STANDARDS = [
    'Eurovent 4/11', 'EN 1886', 'EN 13053', 'ISO 16890', 'EN 1822',
    'AHRI 430', 'AHRI 550/590', 'AMCA 210', 'VDI 6022', 'DIN 1946-4',
    'ASHRAE 62.1', 'ASHRAE 90.1', 'ATEX 2014/34/EU', 'NFPA 90A', 'ISO 3744'
  ];

  window.TN_KG_SBU = {
    id: 'sbu',
    label: 'SBU — project development',
    kind: 'process',
    nodeKinds: NODE_KINDS,
    relations: RELATIONS,
    /* What the outline view uses: the relation an indented line becomes,
       and the kind a line typed there starts as. */
    outline: { relation: 'under' },
    lanes: LANES,
    standards: STANDARDS,
    // Seeded in SQL, not here. See the header.
    seed: { nodes: [], edges: [] }
  };
})();
