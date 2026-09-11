/* =====================================================================
   Thinkneering — Process Map: HVAC equipment supply domain pack
   ---------------------------------------------------------------------
   All field-specific knowledge lives here, separate from the engine in
   process-map.js. Everything in this file is data plus pure functions,
   so it can be moved into D1 later without touching the engine.
   Written for an equipment manufacturer / supplier working MEP projects
   in the GCC: tender through to units delivered and handed over on site.
   ===================================================================== */

(function () {
  'use strict';

  /* ── Stages (colour on the canvas comes from these) ────────────── */

  var STAGES = [
    { id: 'tender',      label: 'Tender & bid',          token: '--pm-stage-tender' },
    { id: 'commercial',  label: 'Award & commercial',    token: '--pm-stage-commercial' },
    { id: 'engineering', label: 'Engineering & submittal', token: '--pm-stage-engineering' },
    { id: 'production',  label: 'Procurement & production', token: '--pm-stage-production' },
    { id: 'quality',     label: 'Testing & inspection',  token: '--pm-stage-quality' },
    { id: 'logistics',   label: 'Logistics & customs',   token: '--pm-stage-logistics' },
    { id: 'site',        label: 'Site delivery & handover', token: '--pm-stage-site' }
  ];

  /* ── Card types ────────────────────────────────────────────────────
     colour: 'stage' means the card takes its stage colour. A token
     string overrides it — reserved for cards that must pop regardless
     of where they sit (risk, branching, waiting).
     ---------------------------------------------------------------- */

  var CARD_TYPES = {
    step:       { label: 'Activity',    shape: 'rect',    colour: 'stage',            icon: 'square' },
    submittal:  { label: 'Submittal',   shape: 'rect',    colour: 'stage',            icon: 'send' },
    document:   { label: 'Document',    shape: 'rect',    colour: 'stage',            icon: 'file' },
    commercial: { label: 'Commercial',  shape: 'rect',    colour: 'stage',            icon: 'coin' },
    inspection: { label: 'Inspection',  shape: 'rect',    colour: 'stage',            icon: 'check' },
    logistics:  { label: 'Logistics',   shape: 'rect',    colour: 'stage',            icon: 'truck' },
    site:       { label: 'Site work',   shape: 'rect',    colour: 'stage',            icon: 'pin' },
    input:      { label: 'Input',       shape: 'rect',    colour: 'stage',            icon: 'download' },
    output:     { label: 'Deliverable', shape: 'rect',    colour: 'stage',            icon: 'upload' },
    automation: { label: 'Automation',  shape: 'rect',    colour: '--color-purple',   icon: 'bolt' },

    decision:   { label: 'Decision',    shape: 'diamond', colour: '--color-warning',  icon: 'split' },
    approval:   { label: 'Approval gate', shape: 'diamond', colour: '--color-warning', icon: 'stamp' },
    milestone:  { label: 'Milestone',   shape: 'rect',    colour: '--color-accent',   icon: 'flag' },
    waiting:    { label: 'Waiting',     shape: 'rect',    colour: '--color-orange',   icon: 'clock' },
    stopper:    { label: 'Stopper',     shape: 'rect',    colour: '--color-danger',   icon: 'alert' },
    note:       { label: 'Note',        shape: 'rect',    colour: '--color-text-muted', icon: 'note' }
  };

  /* ── Who does the work ─────────────────────────────────────────── */

  var PARTIES = [
    'Client / employer',
    'Consultant / engineer',
    'Main contractor',
    'MEP subcontractor',
    'Sales',
    'Estimation / application engineering',
    'Design engineering',
    'Factory — planning',
    'Factory — production',
    'Factory — QA',
    'Third-party inspector',
    'Logistics / shipping',
    'Customs broker',
    'Projects / site team',
    'Service / commissioning',
    'Finance / commercial'
  ];

  var PRODUCT_LINES = [
    'Air handling unit (AHU)',
    'Fan coil unit (FCU)',
    'Air cooled chiller',
    'Water cooled chiller',
    'VRF system',
    'Ventilation fans',
    'Controls / BMS',
    'Mixed package'
  ];

  var FACTORIES = ['UAE', 'KSA', 'China', 'Italy', 'Other'];

  /* ── Standards commonly cited in GCC submittals ────────────────── */

  var STANDARDS = [
    { id: 'eurovent', label: 'Eurovent certification', note: 'Product performance certification' },
    { id: 'en1886', label: 'EN 1886', note: 'AHU casing: D, L, F, T and TB classes' },
    { id: 'en13053', label: 'EN 13053', note: 'AHU performance ratings' },
    { id: 'ahri430', label: 'AHRI 430', note: 'Central station air handling units' },
    { id: 'ahri440', label: 'AHRI 440', note: 'Room fan coil units' },
    { id: 'ahri410', label: 'AHRI 410', note: 'Forced circulation coils' },
    { id: 'ahri550', label: 'AHRI 550/590', note: 'Water chilling packages' },
    { id: 'iso16890', label: 'ISO 16890 / EN 779', note: 'Air filter classification' },
    { id: 'en1822', label: 'EN 1822', note: 'HEPA and ULPA filters' },
    { id: 'ashrae621', label: 'ASHRAE 62.1', note: 'Ventilation for acceptable indoor air quality' },
    { id: 'ashrae901', label: 'ASHRAE 90.1', note: 'Energy standard' },
    { id: 'iso9001', label: 'ISO 9001', note: 'Quality management system' },
    { id: 'en13501', label: 'EN 13501 / UL 900', note: 'Reaction to fire classification' },
    { id: 'iec60204', label: 'IEC 60204-1', note: 'Electrical equipment of machines' },
    { id: 'qcs', label: 'QCS 2014 (Qatar)', note: 'Qatar Construction Specifications' },
    { id: 'kahramaa', label: 'Kahramaa (Qatar)', note: 'Utility approval' },
    { id: 'qcdd', label: 'QCDD / Civil Defence', note: 'Fire and life safety approval' },
    { id: 'dm', label: 'Dubai Municipality', note: 'Green building and product approval' },
    { id: 'esma', label: 'ESMA / ECAS (UAE)', note: 'Conformity marking' },
    { id: 'saso', label: 'SASO / SABER (KSA)', note: 'Conformity certificate for import' },
    { id: 'sbc601', label: 'SBC 601 (KSA)', note: 'Saudi energy conservation code' },
    { id: 'estidama', label: 'Estidama (Abu Dhabi)', note: 'Pearl rating requirements' }
  ];

  /* ── Tag vocabulary the health rules look for ──────────────────── */

  var TAGS = {
    complianceMatrix: 'compliance-matrix',
    selection: 'selection',
    submittal: 'submittal',
    approval: 'approval',
    resubmit: 'resubmit',
    fat: 'fat',
    witness: 'witness-test',
    payment: 'payment',
    lc: 'lc',
    longLead: 'long-lead',
    exportDocs: 'export-docs',
    customs: 'customs',
    conformity: 'conformity',
    dispatch: 'dispatch',
    siteAccess: 'site-access',
    offloading: 'offloading',
    handover: 'handover',
    snagging: 'snagging',
    warranty: 'warranty',
    omManual: 'om-manual'
  };

  /* ── Helpers used by the rules ─────────────────────────────────── */

  function tagged(ctx, tag) {
    return ctx.nodes.filter(function (n) {
      return (n.tags || []).some(function (t) { return t.toLowerCase() === tag; });
    });
  }

  function hasTag(ctx, tag) { return tagged(ctx, tag).length > 0; }

  function ofType(ctx, type) {
    return ctx.nodes.filter(function (n) { return n.type === type; });
  }

  function ofStage(ctx, stage) {
    return ctx.nodes.filter(function (n) { return n.stage === stage; });
  }

  /* ── Domain health rules ───────────────────────────────────────────
     Each rule returns null when the process is fine, or an object with
     the deduction and a plain-English fix. Deterministic — no AI.
     ---------------------------------------------------------------- */

  var RULES = [
    {
      id: 'slack-negative',
      test: function (ctx) {
        if (ctx.slackDays === null || ctx.slackDays >= 0) return null;
        return {
          weight: Math.min(20, 6 + Math.round(Math.abs(ctx.slackDays) / 5)),
          message: 'Forecast delivery is ' + Math.abs(ctx.slackDays) + ' days later than the required-on-site date',
          fix: 'Compress the long-lead procurement or start the submittal earlier — the critical path will not absorb this.'
        };
      }
    },
    {
      id: 'no-compliance-matrix',
      test: function (ctx) {
        if (hasTag(ctx, TAGS.complianceMatrix)) return null;
        if (!ofStage(ctx, 'tender').length && !ofStage(ctx, 'engineering').length) return null;
        return {
          weight: 8,
          message: 'No compliance matrix step',
          fix: 'Consultants routinely return submittals with no clause-by-clause matrix. Add it before the submittal card.'
        };
      }
    },
    {
      id: 'approval-no-resubmit',
      test: function (ctx) {
        var gates = ofType(ctx, 'approval');
        if (!gates.length) return null;
        var open = gates.filter(function (g) {
          var out = ctx.outgoing(g.id);
          var loops = out.some(function (e) { return e.kind === 'feedback'; });
          return out.length < 2 || !loops;
        });
        if (!open.length) return null;
        return {
          weight: Math.min(12, open.length * 6),
          message: open.length + ' approval gate' + (open.length > 1 ? 's have' : ' has') + ' no revise-and-resubmit loop',
          fix: 'First-time approval is the exception. Branch the gate and loop the rejected path back to the submittal preparation card.'
        };
      }
    },
    {
      id: 'submittal-no-gate',
      test: function (ctx) {
        if (!ofType(ctx, 'submittal').length) return null;
        if (ofType(ctx, 'approval').length) return null;
        return {
          weight: 8,
          message: 'Submittal issued with no approval gate modelled',
          fix: 'Add an approval gate so the review duration and the rejected path are visible on the critical path.'
        };
      }
    },
    {
      id: 'no-fat',
      test: function (ctx) {
        if (!ofStage(ctx, 'production').length) return null;
        if (hasTag(ctx, TAGS.fat) || hasTag(ctx, TAGS.witness)) return null;
        return {
          weight: 7,
          message: 'No factory acceptance or witness test before dispatch',
          fix: 'Most GCC specifications require a witnessed FAT. Unplanned, it adds weeks between production complete and release.'
        };
      }
    },
    {
      id: 'no-long-lead',
      test: function (ctx) {
        if (!ofStage(ctx, 'production').length) return null;
        if (hasTag(ctx, TAGS.longLead)) return null;
        return {
          weight: 5,
          message: 'No long-lead item identified in production',
          fix: 'Compressors, coils, VFDs and controls usually set the real lead time. Flag them so the critical path is honest.'
        };
      }
    },
    {
      id: 'no-payment',
      test: function (ctx) {
        if (!ofStage(ctx, 'commercial').length && !ofStage(ctx, 'production').length) return null;
        if (hasTag(ctx, TAGS.payment) || hasTag(ctx, TAGS.lc) || ofType(ctx, 'commercial').length) return null;
        return {
          weight: 6,
          message: 'No payment or LC milestone',
          fix: 'Factories usually will not book a production slot before the advance is received. Model it — it is a real gate.'
        };
      }
    },
    {
      id: 'no-export-docs',
      test: function (ctx) {
        if (!ofStage(ctx, 'logistics').length) return null;
        if (hasTag(ctx, TAGS.exportDocs)) return null;
        return {
          weight: 6,
          message: 'No export documentation step',
          fix: 'Invoice, packing list, certificate of origin and conformity certificate. Missing paperwork is the usual cause of a customs hold.'
        };
      }
    },
    {
      id: 'no-conformity',
      test: function (ctx) {
        if (!ofStage(ctx, 'logistics').length) return null;
        if (hasTag(ctx, TAGS.conformity) || hasTag(ctx, TAGS.customs)) return null;
        return {
          weight: 5,
          message: 'No local conformity or customs clearance step',
          fix: 'SABER, ECAS or the local equivalent has to be in the flow before the shipment lands, not after.'
        };
      }
    },
    {
      id: 'no-site-access',
      test: function (ctx) {
        if (!ofStage(ctx, 'site').length) return null;
        if (hasTag(ctx, TAGS.siteAccess)) return null;
        return {
          weight: 5,
          message: 'No site readiness or access confirmation before delivery',
          fix: 'Confirm crane access, opening sizes and a receiving party. A truck turned away at the gate is a full-day loss.'
        };
      }
    },
    {
      id: 'no-handover',
      test: function (ctx) {
        if (!ctx.nodes.length) return null;
        if (hasTag(ctx, TAGS.handover) || ofType(ctx, 'milestone').length) return null;
        return {
          weight: 6,
          message: 'No handover milestone — the finish line is undefined',
          fix: 'Add a signed delivery note or handover milestone so the process has a measurable end.'
        };
      }
    },
    {
      id: 'no-om-warranty',
      test: function (ctx) {
        if (!ofStage(ctx, 'site').length) return null;
        if (hasTag(ctx, TAGS.omManual) || hasTag(ctx, TAGS.warranty)) return null;
        return {
          weight: 5,
          message: 'No O&M manual or warranty certificate deliverable',
          fix: 'These are usually a payment release condition. Left out of the process, they get chased months later.'
        };
      }
    },
    {
      id: 'long-wait-unescalated',
      test: function (ctx) {
        var slow = ctx.nodes.filter(function (n) {
          return (n.type === 'waiting' || n.type === 'approval') && ctx.calendarDays(n) >= 14;
        });
        var unescalated = slow.filter(function (n) {
          return !ctx.outgoing(n.id).some(function (e) {
            var t = ctx.byId[e.to];
            return t && (t.type === 'stopper' || t.type === 'decision');
          });
        });
        if (!unescalated.length) return null;
        return {
          weight: Math.min(8, unescalated.length * 4),
          message: unescalated.length + ' wait' + (unescalated.length > 1 ? 's' : '') + ' over 14 days with no escalation path',
          fix: 'Add a follow-up or escalation branch so a silent consultant does not quietly become a month.'
        };
      }
    },
    {
      id: 'unowned',
      test: function (ctx) {
        if (ctx.nodes.length < 5) return null;
        var unowned = ctx.nodes.filter(function (n) {
          return n.type !== 'note' && !n.party && !n.owner;
        });
        var share = unowned.length / ctx.nodes.length;
        if (share < 0.4) return null;
        return {
          weight: 5,
          message: Math.round(share * 100) + '% of cards have no responsible party',
          fix: 'Assign a party to each card — handover points between sales, engineering and the factory are where time is lost.'
        };
      }
    },
    {
      id: 'no-selection-confirm',
      test: function (ctx) {
        if (!ofStage(ctx, 'engineering').length) return null;
        if (hasTag(ctx, TAGS.selection)) return null;
        return {
          weight: 4,
          message: 'No step confirming final equipment selection against the approved specification',
          fix: 'Selections drift between tender and order. Confirm them once before the factory PO, not after production starts.'
        };
      }
    }
  ];

  /* ── Templates ─────────────────────────────────────────────────────
     Cards use short refs; the engine resolves them to ids and lays the
     map out by stage, so no hand-authored coordinates.
     lead is in working days unless a unit is given.
     ---------------------------------------------------------------- */

  var TEMPLATES = [
    {
      id: 'full-lifecycle',
      name: 'Tender to units delivered on site',
      description: 'The complete equipment supply lifecycle: enquiry, bid, award, submittal approval, factory order, production, FAT, shipment, customs and site handover.',
      project: { productLine: 'Air handling unit (AHU)', factory: 'UAE', workWeek: 5 },
      cards: [
        // Tender & bid
        { ref: 'enq',    type: 'input',      stage: 'tender', title: 'Tender enquiry received', party: 'Sales', lead: 0,
          desc: 'Specification, drawings, BOQ and schedule of equipment issued by the consultant through the main contractor.' },
        { ref: 'bidno',  type: 'decision',   stage: 'tender', title: 'Bid / no bid?', party: 'Sales', lead: 1,
          desc: 'Assessed on product fit, factory capacity, payment terms and the required delivery date.' },
        { ref: 'nobid',  type: 'stopper',    stage: 'tender', title: 'No bid — enquiry closed', party: 'Sales', lead: 0,
          desc: 'Recorded with the reason so repeat mismatches with a consultant or contractor become visible.' },
        { ref: 'specrev',type: 'step',       stage: 'tender', title: 'Review specification and drawings', party: 'Estimation / application engineering', lead: 2,
          desc: 'Identify the specified classes, ratings and any clause the standard product cannot meet.', tags: ['spec-review'] },
        { ref: 'matrix', type: 'document',   stage: 'tender', title: 'Prepare compliance matrix', party: 'Estimation / application engineering', lead: 3,
          desc: 'Clause-by-clause compliance statement against the specification, with deviations listed openly rather than left blank.',
          tags: ['compliance-matrix'], standards: ['en1886', 'eurovent', 'ahri430'] },
        { ref: 'sel',    type: 'step',       stage: 'tender', title: 'Equipment selection and sizing', party: 'Estimation / application engineering', lead: 2,
          desc: 'Selection software output for each tag, checked against the schedule of equipment.', tags: ['selection'] },
        { ref: 'price',  type: 'step',       stage: 'tender', title: 'Request factory budget pricing', party: 'Sales', lead: 5,
          desc: 'Budget cost from the factory including options, coatings and any non-standard construction.' },
        { ref: 'offer',  type: 'output',     stage: 'tender', title: 'Submit tender offer', party: 'Sales', lead: 2,
          desc: 'Technical and commercial offer with the compliance matrix attached.' },
        { ref: 'clar',   type: 'waiting',    stage: 'tender', title: 'Technical and commercial clarifications', party: 'Consultant / engineer', lead: 10,
          desc: 'Rounds of queries on deviations, alternatives and price. Duration is outside your control.' },
        { ref: 'award',  type: 'decision',   stage: 'tender', title: 'Award decision', party: 'Client / employer', lead: 0,
          desc: 'Award, loss, or retender.' },

        // Award & commercial
        { ref: 'loi',    type: 'input',      stage: 'commercial', title: 'LOI or letter of award received', party: 'Main contractor', lead: 0,
          desc: 'The point from which the delivery clock is contractually running.' },
        { ref: 'contract',type: 'step',      stage: 'commercial', title: 'Contract review and risk sign-off', party: 'Finance / commercial', lead: 3,
          desc: 'Liquidated damages, retention, payment terms and delivery obligations reviewed before acceptance.' },
        { ref: 'advance',type: 'commercial', stage: 'commercial', title: 'Advance payment or LC established', party: 'Finance / commercial', lead: 10,
          desc: 'Most factories will not book a production slot before this clears. Treat it as a hard gate.',
          tags: ['payment', 'lc'] },
        { ref: 'kickoff',type: 'step',       stage: 'commercial', title: 'Kick-off meeting with contractor', party: 'Projects / site team', lead: 1,
          desc: 'Agree submittal dates, delivery sequence by area, and site access constraints.' },

        // Engineering & submittal
        { ref: 'confirm',type: 'step',       stage: 'engineering', title: 'Confirm final selections against approved spec', party: 'Design engineering', lead: 3,
          desc: 'Reconcile the tender selection with any post-tender specification changes before anything is ordered.', tags: ['selection'] },
        { ref: 'pack',   type: 'submittal',  stage: 'engineering', title: 'Prepare technical submittal pack', party: 'Design engineering', lead: 5,
          desc: 'Datasheets, dimensional and sectional drawings, compliance matrix, certification, filter and coil data, wiring and controls schematics.',
          tags: ['submittal'], standards: ['en1886', 'eurovent', 'iso16890', 'ahri430'] },
        { ref: 'qcpack', type: 'inspection', stage: 'engineering', title: 'Internal check of submittal pack', party: 'Factory — QA', lead: 1,
          desc: 'Cross-check every tag, capacity and accessory against the schedule before it leaves the office.' },
        { ref: 'issue',  type: 'submittal',  stage: 'engineering', title: 'Issue submittal via main contractor', party: 'Projects / site team', lead: 1,
          desc: 'Transmittal raised and logged with a reference number and a required-return date.', tags: ['submittal'] },
        { ref: 'review', type: 'waiting',    stage: 'engineering', title: 'Consultant review', party: 'Consultant / engineer', lead: 15,
          desc: 'Typical contractual review period. In practice it runs longer when the contractor holds the transmittal.' },
        { ref: 'gate',   type: 'approval',   stage: 'engineering', title: 'Approval status', party: 'Consultant / engineer', lead: 0,
          desc: 'Approved, approved as noted, or revise and resubmit.', tags: ['approval'] },
        { ref: 'revise', type: 'step',       stage: 'engineering', title: 'Revise and resubmit', party: 'Design engineering', lead: 5,
          desc: 'Address each comment in a response sheet rather than reissuing silently.', tags: ['resubmit'] },
        { ref: 'afc',    type: 'milestone',  stage: 'engineering', title: 'Approved for construction', party: 'Consultant / engineer', lead: 0,
          desc: 'The gate that releases the factory order. Nothing upstream of it should be ordered on risk without a written instruction.' },

        // Procurement & production
        { ref: 'po',     type: 'commercial', stage: 'production', title: 'Release purchase order to factory', party: 'Finance / commercial', lead: 2,
          desc: 'Order raised against the approved submittal revision, not the tender revision.', tags: ['payment'] },
        { ref: 'ack',    type: 'step',       stage: 'production', title: 'Order acknowledgement and slot booking', party: 'Factory — planning', lead: 5,
          desc: 'Factory confirms specification, price and the production week.' },
        { ref: 'proc',   type: 'step',       stage: 'production', title: 'Long-lead component procurement', party: 'Factory — planning', lead: 20,
          desc: 'Compressors, coils, fans, VFDs and controls. This normally sets the real delivery date.', tags: ['long-lead'] },
        { ref: 'delay',  type: 'stopper',    stage: 'production', title: 'Long-lead component delay', party: 'Factory — planning', lead: 15,
          desc: 'Component shortage pushes the production slot. Downstream testing, shipping and site dates all move with it.' },
        { ref: 'build',  type: 'step',       stage: 'production', title: 'Production and assembly', party: 'Factory — production', lead: 15,
          desc: 'Casing, coil, fan section, electrical panel and controls assembly against the released drawings.' },

        // Testing & inspection
        { ref: 'ihtest', type: 'inspection', stage: 'quality', title: 'In-house performance and casing tests', party: 'Factory — QA', lead: 3,
          desc: 'Airflow, static pressure, power, leakage and casing class verification per the applicable standard.',
          standards: ['en1886', 'ahri430'] },
        { ref: 'fat',    type: 'inspection', stage: 'quality', title: 'Factory acceptance test (witnessed)', party: 'Third-party inspector', lead: 2,
          desc: 'Consultant, client or third-party witness attends. Schedule it early — the witness date, not the test, is usually the constraint.',
          tags: ['fat', 'witness-test'] },
        { ref: 'fatres', type: 'decision',   stage: 'quality', title: 'FAT result', party: 'Consultant / engineer', lead: 0,
          desc: 'Pass, pass with observations, or fail requiring rectification and retest.' },
        { ref: 'rect',   type: 'step',       stage: 'quality', title: 'Rectify and retest', party: 'Factory — production', lead: 5,
          desc: 'Close out observations and re-witness only the affected tests where the consultant agrees.' },
        { ref: 'dossier',type: 'document',   stage: 'quality', title: 'Issue test certificates and QA dossier', party: 'Factory — QA', lead: 2,
          desc: 'Test reports, certification, material certificates and the inspection record.', standards: ['eurovent', 'iso9001'] },

        // Logistics & customs
        { ref: 'pack2',  type: 'step',       stage: 'logistics', title: 'Packing, marking and protection', party: 'Factory — production', lead: 3,
          desc: 'Marked by tag and delivery area so site can offload in installation sequence.', tags: ['dispatch'] },
        { ref: 'docs',   type: 'document',   stage: 'logistics', title: 'Export documentation', party: 'Logistics / shipping', lead: 3,
          desc: 'Commercial invoice, packing list, certificate of origin and conformity certificate.',
          tags: ['export-docs', 'conformity'], standards: ['saso', 'esma'] },
        { ref: 'ship',   type: 'logistics',  stage: 'logistics', title: 'Booking and shipment', party: 'Logistics / shipping', lead: 5,
          desc: 'Container booking, loading and bill of lading issued.' },
        { ref: 'transit',type: 'waiting',    stage: 'logistics', title: 'Transit to destination port', party: 'Logistics / shipping', lead: 21, unit: 'cd',
          desc: 'Calendar days, not working days — sailing time does not stop at the weekend.' },
        { ref: 'customs',type: 'logistics',  stage: 'logistics', title: 'Customs clearance and local conformity', party: 'Customs broker', lead: 5,
          desc: 'Duty, inspection and release against the conformity certificate.', tags: ['customs', 'conformity'] },
        { ref: 'hold',   type: 'stopper',    stage: 'logistics', title: 'Customs hold — documentation mismatch', party: 'Customs broker', lead: 10,
          desc: 'Usually a mismatch between the invoice description and the conformity certificate. Demurrage accrues daily.' },

        // Site delivery & handover
        { ref: 'access', type: 'step',       stage: 'site', title: 'Confirm site readiness and access', party: 'Projects / site team', lead: 2,
          desc: 'Crane or forklift availability, route and opening sizes, receiving party and offload window confirmed in writing.',
          tags: ['site-access'] },
        { ref: 'deliver',type: 'site',       stage: 'site', title: 'Delivery to site and offloading', party: 'Projects / site team', lead: 1,
          desc: 'Units delivered in installation sequence to the agreed laydown or riser position.', tags: ['offloading'] },
        { ref: 'joint',  type: 'inspection', stage: 'site', title: 'Joint inspection and delivery note sign-off', party: 'Main contractor', lead: 1,
          desc: 'Condition and quantity checked with the contractor before the truck leaves.' },
        { ref: 'claim',  type: 'stopper',    stage: 'site', title: 'Transit damage or shortage claim', party: 'Logistics / shipping', lead: 10,
          desc: 'Raised against the carrier or insurer. Replacement parts restart a short production and shipping cycle.' },
        { ref: 'store',  type: 'site',       stage: 'site', title: 'Storage and protection until installation', party: 'Main contractor', lead: 0,
          desc: 'Responsibility for protection passes to the contractor on sign-off — record the condition.' },
        { ref: 'hand',   type: 'milestone',  stage: 'site', title: 'Handover to installation contractor', party: 'Projects / site team', lead: 1,
          desc: 'Signed delivery note closes the supply scope and starts the warranty clock.', tags: ['handover'] },
        { ref: 'om',     type: 'output',     stage: 'site', title: 'Issue O&M manuals and warranty certificates', party: 'Service / commissioning', lead: 5,
          desc: 'Usually a condition for releasing retention. Issue with the handover, not months later.',
          tags: ['om-manual', 'warranty'] }
      ],
      links: [
        ['enq', 'bidno'], ['bidno', 'nobid', 'conditional', 'No bid'], ['bidno', 'specrev', 'conditional', 'Bid'],
        ['specrev', 'matrix'], ['matrix', 'sel'], ['sel', 'price'], ['price', 'offer'],
        ['offer', 'clar'], ['clar', 'award'],
        ['award', 'nobid', 'conditional', 'Lost'], ['award', 'loi', 'conditional', 'Awarded'],
        ['loi', 'contract'], ['contract', 'advance'], ['advance', 'kickoff'], ['kickoff', 'confirm'],
        ['matrix', 'pack', 'dependency', 'Matrix reused'],
        ['confirm', 'pack'], ['pack', 'qcpack'], ['qcpack', 'issue'], ['issue', 'review'], ['review', 'gate'],
        ['gate', 'revise', 'conditional', 'Revise & resubmit'], ['revise', 'issue', 'feedback', 'Resubmit'],
        ['gate', 'afc', 'conditional', 'Approved'],
        ['afc', 'po'], ['advance', 'po', 'dependency', 'Payment cleared'],
        ['po', 'ack'], ['ack', 'proc'], ['proc', 'delay', 'conditional', 'Shortage'],
        ['delay', 'proc', 'feedback', 'Re-plan'], ['proc', 'build'], ['build', 'ihtest'],
        ['ihtest', 'fat'], ['fat', 'fatres'], ['fatres', 'rect', 'conditional', 'Fail'],
        ['rect', 'fat', 'feedback', 'Retest'], ['fatres', 'dossier', 'conditional', 'Pass'],
        ['dossier', 'pack2'], ['pack2', 'docs'], ['docs', 'ship'], ['ship', 'transit'],
        ['transit', 'customs'], ['customs', 'hold', 'conditional', 'Documents queried'],
        ['hold', 'customs', 'feedback', 'Resolved'], ['customs', 'access', 'conditional', 'Released'],
        ['access', 'deliver'], ['deliver', 'joint'], ['joint', 'claim', 'conditional', 'Damage found'],
        ['claim', 'deliver', 'feedback', 'Replacement'], ['joint', 'store', 'conditional', 'Accepted'],
        ['store', 'hand'], ['hand', 'om']
      ]
    },

    {
      id: 'submittal-approval',
      name: 'Technical submittal and consultant approval',
      description: 'The approval loop on its own — the stage that most often absorbs unplanned weeks.',
      project: { productLine: 'Mixed package', workWeek: 5 },
      cards: [
        { ref: 'spec',  type: 'input',      stage: 'engineering', title: 'Approved specification and schedule', party: 'Consultant / engineer', lead: 0,
          desc: 'The revision the submittal must be built against — confirm it is the latest before starting.' },
        { ref: 'sel',   type: 'step',       stage: 'engineering', title: 'Confirm selections', party: 'Design engineering', lead: 3,
          desc: 'Capacity, airflow, static pressure, sound and electrical data per tag.', tags: ['selection'] },
        { ref: 'mtx',   type: 'document',   stage: 'engineering', title: 'Compliance matrix', party: 'Estimation / application engineering', lead: 3,
          desc: 'Clause by clause, with every deviation stated and justified.', tags: ['compliance-matrix'],
          standards: ['en1886', 'eurovent'] },
        { ref: 'dwg',   type: 'document',   stage: 'engineering', title: 'Dimensional and sectional drawings', party: 'Design engineering', lead: 4,
          desc: 'Including service clearances and the removal space for coils and filters.' },
        { ref: 'certs', type: 'document',   stage: 'engineering', title: 'Certification and test data', party: 'Factory — QA', lead: 2,
          desc: 'Certification, casing class reports, filter classification and fire ratings.',
          standards: ['eurovent', 'en1886', 'iso16890', 'en13501'] },
        { ref: 'pack',  type: 'submittal',  stage: 'engineering', title: 'Assemble submittal pack', party: 'Design engineering', lead: 2,
          desc: 'One indexed document, one transmittal, one revision number.', tags: ['submittal'] },
        { ref: 'ic',    type: 'inspection', stage: 'engineering', title: 'Internal check before issue', party: 'Factory — QA', lead: 1,
          desc: 'Tag list reconciled against the schedule of equipment. Catches most first-round rejections.' },
        { ref: 'iss',   type: 'submittal',  stage: 'engineering', title: 'Issue to consultant via contractor', party: 'Projects / site team', lead: 1,
          desc: 'Logged with a transmittal reference and a required-return date.', tags: ['submittal'] },
        { ref: 'wait',  type: 'waiting',    stage: 'engineering', title: 'Consultant review period', party: 'Consultant / engineer', lead: 15,
          desc: 'Contractual period. Track the actual against it — the gap is your negotiating evidence.' },
        { ref: 'chase', type: 'step',       stage: 'engineering', title: 'Follow up and escalate', party: 'Projects / site team', lead: 3,
          desc: 'Escalate through the contractor when the review period is exceeded.' },
        { ref: 'gate',  type: 'approval',   stage: 'engineering', title: 'Approval status', party: 'Consultant / engineer', lead: 0,
          desc: 'Approved, approved as noted, or revise and resubmit.', tags: ['approval'] },
        { ref: 'resp',  type: 'document',   stage: 'engineering', title: 'Comment response sheet', party: 'Design engineering', lead: 3,
          desc: 'Answer every comment individually. Reissuing without a response sheet invites a second rejection.',
          tags: ['resubmit'] },
        { ref: 'afc',   type: 'milestone',  stage: 'engineering', title: 'Approved for construction', party: 'Consultant / engineer', lead: 0,
          desc: 'Releases the factory order.' }
      ],
      links: [
        ['spec', 'sel'], ['sel', 'mtx'], ['sel', 'dwg'], ['mtx', 'pack'], ['dwg', 'pack'], ['certs', 'pack'],
        ['pack', 'ic'], ['ic', 'iss'], ['iss', 'wait'], ['wait', 'chase', 'conditional', 'Overdue'],
        ['chase', 'wait', 'feedback', 'Chased'], ['wait', 'gate'],
        ['gate', 'resp', 'conditional', 'Revise & resubmit'], ['resp', 'iss', 'feedback', 'Resubmit'],
        ['gate', 'afc', 'conditional', 'Approved']
      ]
    },

    {
      id: 'order-to-shipment',
      name: 'Factory order to shipment',
      description: 'From approved-for-construction to the container leaving the factory.',
      project: { productLine: 'Air cooled chiller', factory: 'Italy', workWeek: 5 },
      cards: [
        { ref: 'afc',   type: 'input',      stage: 'production', title: 'Approved for construction', party: 'Consultant / engineer', lead: 0,
          desc: 'Approved submittal revision, with any noted comments incorporated.' },
        { ref: 'po',    type: 'commercial', stage: 'production', title: 'Purchase order to factory', party: 'Finance / commercial', lead: 2,
          desc: 'Raised against the approved revision with the agreed incoterms.', tags: ['payment'] },
        { ref: 'pay',   type: 'commercial', stage: 'production', title: 'Advance payment cleared', party: 'Finance / commercial', lead: 10,
          desc: 'Production slot is not confirmed until this lands.', tags: ['payment', 'lc'] },
        { ref: 'ack',   type: 'step',       stage: 'production', title: 'Order acknowledgement and slot', party: 'Factory — planning', lead: 5,
          desc: 'Written confirmation of specification, price and production week.' },
        { ref: 'lead',  type: 'step',       stage: 'production', title: 'Long-lead procurement', party: 'Factory — planning', lead: 25,
          desc: 'Compressors, heat exchangers, VFDs and controls.', tags: ['long-lead'] },
        { ref: 'build', type: 'step',       stage: 'production', title: 'Assembly', party: 'Factory — production', lead: 15,
          desc: 'Frame, circuit, electrical panel and controls.' },
        { ref: 'run',   type: 'inspection', stage: 'quality', title: 'Run test and performance verification', party: 'Factory — QA', lead: 3,
          desc: 'Capacity, power and sound verified on the test rig.', standards: ['ahri550', 'eurovent'] },
        { ref: 'fat',   type: 'inspection', stage: 'quality', title: 'Witnessed factory acceptance test', party: 'Third-party inspector', lead: 2,
          desc: 'Book the witness date at order stage, not when the unit is ready.', tags: ['fat', 'witness-test'] },
        { ref: 'res',   type: 'decision',   stage: 'quality', title: 'FAT result', party: 'Consultant / engineer', lead: 0, desc: 'Pass or rectify and retest.' },
        { ref: 'rect',  type: 'step',       stage: 'quality', title: 'Rectify and retest', party: 'Factory — production', lead: 5, desc: 'Close observations and re-witness the affected tests.' },
        { ref: 'cert',  type: 'document',   stage: 'quality', title: 'Test certificates and QA dossier', party: 'Factory — QA', lead: 2,
          desc: 'Issued before release for packing.', standards: ['iso9001'] },
        { ref: 'pk',    type: 'step',       stage: 'logistics', title: 'Packing and marking', party: 'Factory — production', lead: 3,
          desc: 'Marked by tag and delivery area.', tags: ['dispatch'] },
        { ref: 'docs',  type: 'document',   stage: 'logistics', title: 'Export and conformity documents', party: 'Logistics / shipping', lead: 3,
          desc: 'Invoice, packing list, certificate of origin, conformity certificate.', tags: ['export-docs', 'conformity'],
          standards: ['saso', 'esma'] },
        { ref: 'ship',  type: 'logistics',  stage: 'logistics', title: 'Container booking and loading', party: 'Logistics / shipping', lead: 5,
          desc: 'Bill of lading issued on departure.' }
      ],
      links: [
        ['afc', 'po'], ['po', 'pay'], ['pay', 'ack'], ['ack', 'lead'], ['lead', 'build'], ['build', 'run'],
        ['run', 'fat'], ['fat', 'res'], ['res', 'rect', 'conditional', 'Fail'], ['rect', 'fat', 'feedback', 'Retest'],
        ['res', 'cert', 'conditional', 'Pass'], ['cert', 'pk'], ['pk', 'docs'], ['docs', 'ship']
      ]
    },

    {
      id: 'shipment-to-site',
      name: 'Shipment, customs and site delivery',
      description: 'The last mile, where demurrage and refused deliveries live.',
      project: { workWeek: 5 },
      cards: [
        { ref: 'dep',   type: 'logistics', stage: 'logistics', title: 'Departure from origin port', party: 'Logistics / shipping', lead: 0, desc: 'Bill of lading issued.' },
        { ref: 'trans', type: 'waiting',   stage: 'logistics', title: 'Sea transit', party: 'Logistics / shipping', lead: 21, unit: 'cd',
          desc: 'Calendar days. Add buffer for transhipment.' },
        { ref: 'pre',   type: 'document',  stage: 'logistics', title: 'Pre-arrival documentation check', party: 'Customs broker', lead: 2,
          desc: 'Reconcile invoice description, HS code and conformity certificate before arrival — the cheapest place to catch a mismatch.',
          tags: ['export-docs', 'conformity'] },
        { ref: 'arr',   type: 'logistics', stage: 'logistics', title: 'Arrival and discharge', party: 'Logistics / shipping', lead: 2, unit: 'cd', desc: 'Free time starts here.' },
        { ref: 'cust',  type: 'logistics', stage: 'logistics', title: 'Customs clearance', party: 'Customs broker', lead: 5,
          desc: 'Duty assessment, inspection and release.', tags: ['customs'] },
        { ref: 'hold',  type: 'stopper',   stage: 'logistics', title: 'Customs hold', party: 'Customs broker', lead: 10,
          desc: 'Demurrage and storage accrue daily while it is resolved.' },
        { ref: 'access',type: 'step',      stage: 'site', title: 'Confirm site access and receiving party', party: 'Projects / site team', lead: 2,
          desc: 'Crane, route, opening sizes, offload window and a named receiver.', tags: ['site-access'] },
        { ref: 'notready', type: 'stopper',stage: 'site', title: 'Site not ready — delivery deferred', party: 'Main contractor', lead: 5,
          desc: 'Units go to interim storage at cost, or the truck is turned away.' },
        { ref: 'trk',   type: 'logistics', stage: 'site', title: 'Inland transport to site', party: 'Logistics / shipping', lead: 1, desc: 'Permits arranged for oversized loads.' },
        { ref: 'off',   type: 'site',      stage: 'site', title: 'Delivery and offloading', party: 'Projects / site team', lead: 1,
          desc: 'In installation sequence, to the agreed position.', tags: ['offloading'] },
        { ref: 'insp',  type: 'inspection',stage: 'site', title: 'Joint inspection and delivery note', party: 'Main contractor', lead: 1,
          desc: 'Condition and count agreed before the truck leaves.' },
        { ref: 'claim', type: 'stopper',   stage: 'site', title: 'Damage or shortage claim', party: 'Logistics / shipping', lead: 10, desc: 'Raised against carrier or insurer.' },
        { ref: 'hand',  type: 'milestone', stage: 'site', title: 'Handover signed', party: 'Projects / site team', lead: 0,
          desc: 'Supply scope closed, warranty clock started.', tags: ['handover'] }
      ],
      links: [
        ['dep', 'trans'], ['trans', 'arr'], ['pre', 'cust', 'dependency', 'Documents verified'], ['arr', 'cust'],
        ['cust', 'hold', 'conditional', 'Queried'], ['hold', 'cust', 'feedback', 'Resolved'],
        ['cust', 'access', 'conditional', 'Released'],
        ['access', 'notready', 'conditional', 'Not ready'], ['notready', 'access', 'feedback', 'Re-confirm'],
        ['access', 'trk', 'conditional', 'Ready'], ['trk', 'off'], ['off', 'insp'],
        ['insp', 'claim', 'conditional', 'Damage'], ['claim', 'off', 'feedback', 'Replacement'],
        ['insp', 'hand', 'conditional', 'Accepted']
      ]
    },

    {
      id: 'variation',
      name: 'Variation / change order',
      description: 'A specification change after the order is placed — the quiet killer of delivery dates.',
      project: { workWeek: 5 },
      cards: [
        { ref: 'req',  type: 'input',      stage: 'engineering', title: 'Change request received', party: 'Consultant / engineer', lead: 0,
          desc: 'A revised specification, a layout change or a value-engineering instruction.' },
        { ref: 'imp',  type: 'step',       stage: 'engineering', title: 'Assess technical impact', party: 'Design engineering', lead: 3,
          desc: 'What changes on the unit, and whether it affects an already-approved submittal.' },
        { ref: 'sched',type: 'step',       stage: 'engineering', title: 'Assess schedule impact', party: 'Factory — planning', lead: 2,
          desc: 'Whether the production slot holds, and whether any long-lead item restarts.', tags: ['long-lead'] },
        { ref: 'cost', type: 'commercial', stage: 'commercial', title: 'Price the variation', party: 'Finance / commercial', lead: 3,
          desc: 'Cost, and the delivery extension claimed alongside it.', tags: ['payment'] },
        { ref: 'sub',  type: 'submittal',  stage: 'commercial', title: 'Submit variation proposal', party: 'Sales', lead: 1,
          desc: 'Technical and commercial impact in one document, with the schedule extension stated explicitly.', tags: ['submittal'] },
        { ref: 'wait', type: 'waiting',    stage: 'commercial', title: 'Client and consultant review', party: 'Client / employer', lead: 10,
          desc: 'Production continues on the original scope at risk, or stops — decide which, in writing.' },
        { ref: 'gate', type: 'approval',   stage: 'commercial', title: 'Variation approved?', party: 'Client / employer', lead: 0,
          desc: 'Approved, rejected, or approved with a revised price.', tags: ['approval'] },
        { ref: 'hold', type: 'stopper',    stage: 'production', title: 'Production held pending decision', party: 'Factory — planning', lead: 10,
          desc: 'Slot released to another order — regaining it is rarely immediate.' },
        { ref: 'resub',type: 'submittal',  stage: 'engineering', title: 'Reissue affected submittal', party: 'Design engineering', lead: 5,
          desc: 'Only the affected drawings and datasheets, clearly marked as a revision.', tags: ['submittal', 'resubmit'] },
        { ref: 'rel',  type: 'milestone',  stage: 'production', title: 'Revised scope released to production', party: 'Factory — planning', lead: 0,
          desc: 'New agreed delivery date recorded against the contract.' }
      ],
      links: [
        ['req', 'imp'], ['imp', 'sched'], ['sched', 'cost'], ['cost', 'sub'], ['sub', 'wait'],
        ['wait', 'hold', 'conditional', 'Decision delayed'], ['hold', 'wait', 'feedback', 'Escalate'],
        ['wait', 'gate'], ['gate', 'resub', 'conditional', 'Approved'], ['resub', 'rel'],
        ['gate', 'rel', 'conditional', 'Rejected — original scope']
      ]
    }
  ];

  /* ── Public shape ──────────────────────────────────────────────── */

  window.TN_PM_DOMAIN = {
    id: 'hvac-supply',
    label: 'HVAC equipment supply (tender to site)',
    stages: STAGES,
    cardTypes: CARD_TYPES,
    parties: PARTIES,
    productLines: PRODUCT_LINES,
    factories: FACTORIES,
    standards: STANDARDS,
    tags: TAGS,
    rules: RULES,
    templates: TEMPLATES
  };
})();
