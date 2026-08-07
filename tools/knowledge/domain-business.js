/* =====================================================================
   Thinkneering — Knowledge Graph: business process domain pack
   ---------------------------------------------------------------------
   Swim-lane process mapping by department. Same engine as the HVAC pack,
   different vocabulary: lanes are departments, nodes are activities and
   decisions, relations are sequencing rather than physical connection.
   ===================================================================== */

(function () {
  'use strict';

  var NODE_KINDS = {
    start:      { label: 'Start',        token: '--kg-start',      icon: 'play',
                  hint: 'The trigger that begins the process.' },
    activity:   { label: 'Activity',     token: '--kg-activity',   icon: 'box',
                  hint: 'Work performed by a department.' },
    decision:   { label: 'Decision',     token: '--kg-decision',   icon: 'split',
                  hint: 'A branch point with two or more outcomes.' },
    approval:   { label: 'Approval',     token: '--kg-approval',   icon: 'stamp',
                  hint: 'A gate that must be passed before work continues.' },
    document:   { label: 'Document',     token: '--kg-document',   icon: 'file',
                  hint: 'A record produced or required.' },
    input:      { label: 'Input',        token: '--kg-input',      icon: 'download',
                  hint: 'What has to exist before the step can start.' },
    output:     { label: 'Output',       token: '--kg-output',     icon: 'upload',
                  hint: 'What the step delivers.' },
    exception:  { label: 'Exception',    token: '--kg-exception',  icon: 'alert',
                  hint: 'A path taken when something goes wrong.' },
    risk:       { label: 'Risk',         token: '--kg-risk',       icon: 'shield',
                  hint: 'A known way this process fails or is delayed.' },
    role:       { label: 'Role',         token: '--kg-role',       icon: 'user',
                  hint: 'A person or function responsible for work.' },
    system:     { label: 'System',       token: '--kg-system',     icon: 'layers',
                  hint: 'An application or tool the process runs in.' },
    note:       { label: 'Note',         token: '--kg-note',       icon: 'note',
                  hint: 'Supporting context.' }
  };

  var RELATIONS = {
    precedes:     { label: 'then',          inverse: null,       arrow: 'plain', dash: '' },
    contains:     { label: 'contains',      inverse: 'part_of',  arrow: 'diamond', dash: '' },
    part_of:      { label: 'is part of',    inverse: 'contains', arrow: 'plain', dash: '' },
    approves:     { label: 'approves',      inverse: null,       arrow: 'plain', dash: '' },
    requires:     { label: 'requires',      inverse: null,       arrow: 'plain', dash: '6 5' },
    produces:     { label: 'produces',      inverse: null,       arrow: 'plain', dash: '' },
    depends_on:   { label: 'depends on',    inverse: null,       arrow: 'plain', dash: '6 5' },
    responsible:  { label: 'responsible for', inverse: null,     arrow: 'plain', dash: '4 4' },
    connected_to: { label: 'connected to',  inverse: null,       arrow: 'both',  dash: '' },
    causes:       { label: 'can cause',     inverse: null,       arrow: 'plain', dash: '3 4' }
  };

  /* Departments become the swim lanes — matching the reference diagram. */
  var LANES = [
    { id: 'sales',      label: 'Sales department',      token: '--kg-lane-1' },
    { id: 'rnd',        label: 'R & D',                 token: '--kg-lane-2' },
    { id: 'planning',   label: 'Production planning',   token: '--kg-lane-3' },
    { id: 'workshop',   label: 'Workshop',              token: '--kg-lane-4' },
    { id: 'purchasing', label: 'Purchasing department', token: '--kg-lane-5' },
    { id: 'quality',    label: 'Quality',               token: '--kg-lane-6' },
    { id: 'logistics',  label: 'Logistics & dispatch',  token: '--kg-lane-7' }
  ];

  var SEED = {
    title: 'Business Process Management',
    kind: 'process',
    domain: 'business',
    description: 'Order management from enquiry to dispatch, mapped by department with decisions, approvals and exception paths.',

    nodes: [
      { ref: 'recv', kind: 'start', lane: 'sales', title: 'Orders receiving',
        aliases: ['order received', 'customer order', 'enquiry received'],
        summary: 'A customer order arrives and enters the process.' },

      { ref: 'vet', kind: 'activity', lane: 'sales', title: 'Vet orders',
        aliases: ['vet order', 'order vetting', 'order check'],
        summary: 'Check the order against catalogue, capacity and commercial terms before it goes further.',
        body: 'Splits three ways: a standard product goes straight to order placement, a new product goes to R&D for a technology file, and volume production goes to planning.' },

      { ref: 'techfile', kind: 'document', lane: 'rnd', title: 'Make a technology file',
        aliases: ['technology file', 'tech file', 'product file'],
        summary: 'R&D produces the technical definition for a product that is not yet in the catalogue.',
        body: 'Until this exists and is signed off, planning cannot schedule and purchasing cannot buy.' },

      { ref: 'place', kind: 'activity', lane: 'sales', title: 'Place order',
        aliases: ['place order', 'order placement', 'order entry'],
        summary: 'The order is formally entered once the product definition is confirmed.' },

      { ref: 'review', kind: 'decision', lane: 'planning', title: 'Order review',
        aliases: ['order review', 'planning review'],
        summary: 'Planning reviews feasibility and splits the work into a production schedule and a materials requirement.' },

      { ref: 'schedule', kind: 'activity', lane: 'planning', title: 'Make production schedule',
        aliases: ['production schedule', 'production plan', 'scheduling'],
        summary: 'Slots the order into the production calendar and issues the job.' },

      { ref: 'matneed', kind: 'activity', lane: 'purchasing', title: 'Materials need',
        aliases: ['materials requirement', 'material need', 'BOM requirement'],
        summary: 'Purchasing works out what has to be bought and by when.' },

      { ref: 'porders', kind: 'activity', lane: 'purchasing', title: 'Place purchasing orders',
        aliases: ['purchase order', 'PO to supplier', 'purchasing order'],
        summary: 'Orders raised on suppliers for the required materials.' },

      { ref: 'followup', kind: 'activity', lane: 'purchasing', title: 'Follow up and confirm',
        aliases: ['expediting', 'supplier follow up', 'material confirmation'],
        summary: 'Chase suppliers and confirm material delivery dates against the production schedule.',
        body: 'This is where a schedule quietly slips. Confirmation, not the purchase order, is what releases production.' },

      { ref: 'prod', kind: 'activity', lane: 'workshop', title: 'Products production',
        aliases: ['production', 'manufacturing', 'product manufacture'],
        summary: 'The workshop builds the product against the schedule and the technology file.' },

      { ref: 'assembly', kind: 'activity', lane: 'planning', title: 'Assembly process',
        aliases: ['assembly', 'assembly process'],
        summary: 'Assembly proceeds once material is confirmed.' },

      { ref: 'pace', kind: 'activity', lane: 'planning', title: 'Follow the production pace',
        aliases: ['production tracking', 'production pace', 'progress monitoring'],
        summary: 'Monitor actual progress against the schedule and escalate variance.' },

      { ref: 'qc', kind: 'decision', lane: 'quality', title: 'Quality check',
        aliases: ['quality check', 'QC', 'inspection'],
        summary: 'Product is inspected. Qualified stock moves to storage; the rest returns for rework.' },

      { ref: 'rework', kind: 'exception', lane: 'workshop', title: 'Rework',
        aliases: ['rework', 'rectification'],
        summary: 'Non-conforming product goes back to the workshop, consuming schedule that was not planned.' },

      { ref: 'storage', kind: 'activity', lane: 'logistics', title: 'Storage',
        aliases: ['storage', 'finished goods store', 'warehouse'],
        summary: 'Qualified product is stored pending release.' },

      { ref: 'payment', kind: 'approval', lane: 'sales', title: 'Urging payment',
        aliases: ['payment collection', 'urging payment', 'payment follow up'],
        summary: 'Payment is pursued before delivery is released.',
        body: 'A commercial gate, not an administrative step. Release before payment is a decision someone has to own in writing.' },

      { ref: 'release', kind: 'activity', lane: 'logistics', title: 'Delivery release',
        aliases: ['delivery release', 'dispatch release', 'release for delivery'],
        summary: 'Goods are released for dispatch once stock exists and payment is settled.' },

      { ref: 'risk-newprod', kind: 'risk', lane: 'rnd', title: 'New product not yet defined',
        aliases: ['undefined product', 'no technology file'],
        summary: 'An order accepted for a product with no technology file blocks planning and purchasing until R&D catches up.' },

      { ref: 'risk-material', kind: 'risk', lane: 'purchasing', title: 'Material arrives late',
        aliases: ['material delay', 'supplier delay'],
        summary: 'Unconfirmed material dates propagate straight into the delivery date.' }
    ],

    edges: [
      ['recv', 'precedes', 'vet'],
      ['vet', 'precedes', 'techfile', null, 'New products'],
      ['vet', 'precedes', 'place', null, 'Volume production'],
      ['techfile', 'precedes', 'place', null, 'OK'],
      ['techfile', 'precedes', 'review'],
      ['place', 'precedes', 'payment'],
      ['place', 'precedes', 'review'],
      ['review', 'precedes', 'schedule'],
      ['review', 'precedes', 'matneed'],
      ['matneed', 'precedes', 'porders'],
      ['porders', 'precedes', 'followup'],
      ['followup', 'precedes', 'prod', null, 'Material confirmed'],
      ['schedule', 'precedes', 'prod'],
      ['schedule', 'precedes', 'assembly', null, 'Material confirmed'],
      ['assembly', 'precedes', 'pace'],
      ['prod', 'precedes', 'qc'],
      ['qc', 'precedes', 'storage', null, 'Qualified'],
      ['qc', 'precedes', 'rework', null, 'Not qualified'],
      ['rework', 'precedes', 'prod'],
      ['storage', 'precedes', 'release'],
      ['payment', 'precedes', 'release'],
      ['techfile', 'depends_on', 'risk-newprod'],
      ['followup', 'depends_on', 'risk-material'],
      ['risk-material', 'causes', 'rework']
    ]
  };

  window.TN_KG_BUSINESS = {
    id: 'business',
    label: 'Business process',
    kind: 'process',
    nodeKinds: NODE_KINDS,
    relations: RELATIONS,
    lanes: LANES,
    standards: [],
    seed: SEED
  };
})();
