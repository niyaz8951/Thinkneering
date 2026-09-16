/* Thinkneering — HVAC engine: reference data
   Every value here is a STARTING POINT, editable in the calculator. None of it
   is a substitute for the project specification or the consultant's basis of
   design. Where a number drives equipment selection, confirm it before use. */
(function () {
  'use strict';
  var H = (window.HVAC = window.HVAC || {});

  /* Summer design outdoor conditions. Representative values for the region;
     confirm against the project's stated basis of design (which is often
     dictated by the local authority or the consultant, not by ASHRAE). */
  var LOCATIONS = [
    { id: 'dubai', name: 'Dubai, UAE', lat: 25.25, db: 46.0, wb: 30.0, range: 10.5, alt: 5 },
    { id: 'abudhabi', name: 'Abu Dhabi, UAE', lat: 24.43, db: 46.0, wb: 30.5, range: 11.0, alt: 5 },
    { id: 'sharjah', name: 'Sharjah, UAE', lat: 25.33, db: 46.5, wb: 30.0, range: 11.5, alt: 10 },
    { id: 'alain', name: 'Al Ain, UAE', lat: 24.26, db: 48.0, wb: 25.0, range: 14.5, alt: 265 },
    { id: 'riyadh', name: 'Riyadh, KSA', lat: 24.71, db: 45.5, wb: 22.0, range: 14.0, alt: 612 },
    { id: 'jeddah', name: 'Jeddah, KSA', lat: 21.49, db: 42.0, wb: 29.5, range: 9.5, alt: 15 },
    { id: 'dammam', name: 'Dammam, KSA', lat: 26.43, db: 46.0, wb: 30.5, range: 11.0, alt: 10 },
    { id: 'doha', name: 'Doha, Qatar', lat: 25.29, db: 45.0, wb: 30.5, range: 10.0, alt: 10 },
    { id: 'kuwait', name: 'Kuwait City', lat: 29.38, db: 48.0, wb: 27.0, range: 12.5, alt: 55 },
    { id: 'muscat', name: 'Muscat, Oman', lat: 23.59, db: 44.0, wb: 30.0, range: 9.0, alt: 15 },
    { id: 'manama', name: 'Manama, Bahrain', lat: 26.23, db: 42.5, wb: 30.5, range: 8.5, alt: 5 },
    { id: 'custom', name: 'Custom / from project spec', lat: 25.0, db: 46.0, wb: 30.0, range: 10.0, alt: 0 }
  ];

  /* Indoor design presets. */
  var INDOOR = [
    { id: 'office', name: 'Office / commercial', db: 23.0, rh: 50 },
    { id: 'retail', name: 'Retail / mall', db: 23.0, rh: 55 },
    { id: 'residential', name: 'Residential', db: 24.0, rh: 50 },
    { id: 'hotel', name: 'Hotel guest room', db: 23.0, rh: 50 },
    { id: 'hospital', name: 'Hospital ward', db: 22.0, rh: 50 },
    { id: 'datacentre', name: 'Data / equipment room', db: 22.0, rh: 45 },
    { id: 'kitchen', name: 'Commercial kitchen', db: 25.0, rh: 55 },
    { id: 'custom', name: 'Custom', db: 23.0, rh: 50 }
  ];

  /* Opaque construction presets. U-values W/m2.K, absorptance for sol-air. */
  var WALLS = [
    { id: 'w-heavy-uninsulated', name: 'Heavy block, uninsulated', u: 2.20, absorptance: 0.60 },
    { id: 'w-block-50', name: 'Block + 50 mm insulation', u: 0.57, absorptance: 0.55 },
    { id: 'w-block-75', name: 'Block + 75 mm insulation', u: 0.40, absorptance: 0.55 },
    { id: 'w-estidama', name: 'Insulated cavity (Estidama / DGBR typical)', u: 0.32, absorptance: 0.50 },
    { id: 'w-sbc', name: 'Insulated cavity (SBC 601 typical)', u: 0.30, absorptance: 0.50 },
    { id: 'w-curtain', name: 'Curtain wall spandrel (insulated)', u: 0.45, absorptance: 0.70 },
    { id: 'w-precast', name: 'Precast sandwich panel', u: 0.35, absorptance: 0.55 },
    { id: 'w-custom', name: 'Custom U-value', u: 0.40, absorptance: 0.55 }
  ];

  var ROOFS = [
    { id: 'r-uninsulated', name: 'Concrete slab, uninsulated', u: 2.50, absorptance: 0.75 },
    { id: 'r-50', name: 'Slab + 50 mm insulation', u: 0.55, absorptance: 0.70 },
    { id: 'r-75', name: 'Slab + 75 mm insulation', u: 0.38, absorptance: 0.70 },
    { id: 'r-100', name: 'Slab + 100 mm insulation', u: 0.28, absorptance: 0.70 },
    { id: 'r-reflective', name: 'Insulated + reflective / cool roof', u: 0.28, absorptance: 0.35 },
    { id: 'r-metal', name: 'Insulated metal deck', u: 0.33, absorptance: 0.60 },
    { id: 'r-custom', name: 'Custom U-value', u: 0.30, absorptance: 0.70 }
  ];

  /* Glazing presets. SHGC is the solar heat gain coefficient at normal incidence. */
  var GLAZING = [
    { id: 'g-single-clear', name: 'Single clear 6 mm', u: 5.70, shgc: 0.82 },
    { id: 'g-single-tint', name: 'Single tinted 6 mm', u: 5.70, shgc: 0.62 },
    { id: 'g-double-clear', name: 'Double glazed, clear', u: 2.80, shgc: 0.70 },
    { id: 'g-double-tint', name: 'Double glazed, tinted', u: 2.70, shgc: 0.48 },
    { id: 'g-double-lowe', name: 'Double glazed, low-E', u: 1.80, shgc: 0.35 },
    { id: 'g-double-lowe-refl', name: 'Double glazed, low-E reflective', u: 1.60, shgc: 0.25 },
    { id: 'g-triple-lowe', name: 'Triple glazed, low-E', u: 1.10, shgc: 0.28 },
    { id: 'g-custom', name: 'Custom', u: 1.80, shgc: 0.35 }
  ];

  /* Internal shading multiplier applied to solar gain. */
  var SHADING = [
    { id: 's-none', name: 'No internal shading', factor: 1.00 },
    { id: 's-blinds-light', name: 'Venetian blinds, light', factor: 0.55 },
    { id: 's-blinds-medium', name: 'Venetian blinds, medium', factor: 0.65 },
    { id: 's-roller-light', name: 'Roller blind, light', factor: 0.45 },
    { id: 's-roller-dark', name: 'Roller blind, dark', factor: 0.75 },
    { id: 's-curtain', name: 'Curtains, medium', factor: 0.60 },
    { id: 's-external', name: 'External shading / fully shaded', factor: 0.25 }
  ];

  /* Occupancy: density (m2 per person), sensible and latent watts per person.
     Latent rises steeply with activity — this is where GCC malls and gyms
     diverge sharply from an office. */
  var OCCUPANCY = [
    { id: 'o-office', name: 'Office, seated light work', density: 10, sensible: 70, latent: 45 },
    { id: 'o-meeting', name: 'Meeting room, seated', density: 2.5, sensible: 70, latent: 45 },
    { id: 'o-retail', name: 'Retail, standing / walking', density: 5, sensible: 75, latent: 70 },
    { id: 'o-restaurant', name: 'Restaurant, seated eating', density: 1.5, sensible: 80, latent: 80 },
    { id: 'o-residential', name: 'Residential, seated', density: 20, sensible: 70, latent: 45 },
    { id: 'o-classroom', name: 'Classroom, seated', density: 2.5, sensible: 70, latent: 45 },
    { id: 'o-gym', name: 'Gym, athletics', density: 10, sensible: 210, latent: 315 },
    { id: 'o-lobby', name: 'Lobby / circulation', density: 15, sensible: 75, latent: 55 },
    { id: 'o-custom', name: 'Custom', density: 10, sensible: 70, latent: 45 }
  ];

  /* Lighting and small-power densities, W/m2. */
  var LIGHTING = [
    { id: 'l-led', name: 'LED, efficient design', density: 6 },
    { id: 'l-led-retail', name: 'LED, retail / display', density: 12 },
    { id: 'l-fluoro', name: 'Fluorescent, older office', density: 12 },
    { id: 'l-residential', name: 'Residential', density: 5 },
    { id: 'l-custom', name: 'Custom', density: 8 }
  ];

  var EQUIPMENT = [
    { id: 'e-office-light', name: 'Office, laptops', density: 8 },
    { id: 'e-office-heavy', name: 'Office, desktops + monitors', density: 15 },
    { id: 'e-retail', name: 'Retail', density: 10 },
    { id: 'e-residential', name: 'Residential', density: 5 },
    { id: 'e-server', name: 'Server / comms room', density: 500 },
    { id: 'e-none', name: 'None / negligible', density: 0 },
    { id: 'e-custom', name: 'Custom', density: 10 }
  ];

  /* Fresh air rates. Per-person and per-area components, L/s. */
  var VENTILATION = [
    { id: 'v-office', name: 'Office (2.5 L/s·p + 0.3 L/s·m²)', perPerson: 2.5, perArea: 0.3 },
    { id: 'v-retail', name: 'Retail (3.8 L/s·p + 0.6 L/s·m²)', perPerson: 3.8, perArea: 0.6 },
    { id: 'v-classroom', name: 'Classroom (5.0 L/s·p + 0.6 L/s·m²)', perPerson: 5.0, perArea: 0.6 },
    { id: 'v-residential', name: 'Residential (2.5 L/s·p + 0.3 L/s·m²)', perPerson: 2.5, perArea: 0.3 },
    { id: 'v-hotel', name: 'Hotel room (2.5 L/s·p + 0.3 L/s·m²)', perPerson: 2.5, perArea: 0.3 },
    { id: 'v-restaurant', name: 'Restaurant (3.8 L/s·p + 0.9 L/s·m²)', perPerson: 3.8, perArea: 0.9 },
    { id: 'v-custom', name: 'Custom', perPerson: 2.5, perArea: 0.3 }
  ];

  function find(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return list[0];
  }

  H.data = {
    LOCATIONS: LOCATIONS, INDOOR: INDOOR, WALLS: WALLS, ROOFS: ROOFS,
    GLAZING: GLAZING, SHADING: SHADING, OCCUPANCY: OCCUPANCY,
    LIGHTING: LIGHTING, EQUIPMENT: EQUIPMENT, VENTILATION: VENTILATION,
    find: find
  };
})();
