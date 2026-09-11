// functions/api/compliance/extract-datasheet.js
// POST { product, text } -> { fields: [{ label, value }], model }
//
// Reads a selection datasheet's raw extracted text and converts it into
// clean parameter/value pairs using a DEDICATED AI call — separate from
// /api/compliance/ai-suggest's compliance-answering call. Kept as its own endpoint,
// not folded into ai-suggest, because two sequential Workers AI calls
// inside one request would double the risk of hitting the platform-level
// timeout that earlier required shrinking ai-suggest's batch sizes (see
// DEPLOY-ROADMAP.md). Two separate, lighter HTTP round trips are safer
// than one heavy one.
//
// One prompt per product — AHU/FCU/Chiller datasheets describe very
// different equipment, so each gets its own extraction guidance (see
// prompts/datasheet-extraction-*.md for human-readable copies; these are
// the deployed source of truth — edit both together).
//
// Requires the same Workers AI binding ("AI") as ai-suggest.js.

import { requireUser, json, PRODUCTS, complianceTier, withErrorHandling } from '../../_compliance.js';

const MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';
const MAX_INPUT_CHARS = 12000; // generous — this is a single dedicated call, not a per-batch one
const MAX_FIELDS = 120;

const EXTRACTION_RULES = `
IMPORTANT RULES:
1. Read text only — ignore any leftover fragments of images, drawings, or charts.
2. Preserve units exactly as written (mm, kW, l/s, Pa, etc.) — never convert them.
3. If a value is not stated, do not invent it — omit that parameter entirely.
4. If the same parameter appears more than once, keep the most complete version.
5. Convert raw datasheet lines into clear engineering parameter names, not verbatim copies:
   "Panel : 62 mm : Foam" -> "Panel Thickness" = "62 mm" AND "Panel Insulation Material" = "Foam"
   "Profile Aluminium Natural Thermal Break" -> "Frame Material" = "Aluminium", "Thermal Break" = "Yes", "Frame Finish" = "Natural"
6. Do NOT summarize, explain, infer, or calculate — only extract what is explicitly written.
`.trim();

const AHU_EXTRACTION_PROMPT = `You are an HVAC AHU datasheet extraction engine. Extract every relevant technical specification from the datasheet text below into clear parameter/value pairs.

${EXTRACTION_RULES}

EXTRACT DATA IN THESE CATEGORIES (not limited to):
General: Manufacturer, Model, Series, Unit Type, Unit Configuration, Reference Number, Project, Airflow, External Static Pressure, Unit Weight, Overall Dimensions, Connection Side, Roof, Base Frame.
Casing: Panel Thickness, Insulation Thickness/Material, Outer/Inner Skin Material and Thickness, Frame Material, Thermal Break, Internal Construction Material.
Performance: Airflow, ESP, SFP, SFP Class, Velocity, Pressure Drops, Efficiency Classes, Energy Ratings.
Fans: Fan Type, Quantity, Arrangement, Model, Material, Motor Type, Motor Efficiency Class, Motor Power, Voltage, Current, RPM, Electrical Input, IE Class.
Filters (per stage): Filter Stage, Type, Class, EN779/ISO16890 Rating, Material, Pressure Drop Clean/Medium/Dirty, Efficiency, Dimensions, Area, Mounting, Energy Classification.
Coils: Coil Type/Model, Cooling/Sensible Capacity, Refrigerant, Circuit Number, Rows, Tube/Fin/Header/Frame Material, Connection Size, Air Velocity, Air Pressure Drop, Fluid Volume.
Dampers: Type, Material, Pressure Drop, Torque, Dimensions, Mounting.
Construction: Drain Pan Material, Internal Parts Material, Access Sections, Lighting, Inspection Windows, Microswitches, Magnehelic Gauges, Pressure Tappings, UV Lamp, Spare Parts.
Electrical: Supply Voltage, Frequency, Phase, Total Connected Load, Fan/Motor Electrical Data.
Standards: Eurovent, EN13053, ERP, ISO, AHRI, EC Regulations, any efficiency classification.`;

const FCU_EXTRACTION_PROMPT = `You are an HVAC Fan Coil Unit (FCU) datasheet extraction engine. Extract every relevant technical specification from the datasheet text below into clear parameter/value pairs.

${EXTRACTION_RULES}
Also: if the datasheet covers multiple fan speeds, extract each speed's airflow/data separately (e.g. "Airflow High", "Airflow Medium", "Airflow Low") rather than merging them.

EXTRACT DATA IN THESE CATEGORIES (not limited to):
General: Manufacturer, Model, Series, Unit Configuration (Ducted, Cassette, Ceiling-suspended, Console, Concealed), Reference Number, Project, Airflow per speed, External Static Pressure, Unit Weight, Overall Dimensions, Connection Side.
Casing: Casing Material/Thickness, Insulation Material/Thickness, Drain Pan Material/Insulation.
Coil: Coil Type (Chilled Water / DX / Heating), Rows, Cooling/Sensible/Heating Capacity, Tube/Fin Material, Fin Spacing, Connection Size, Water Flow Rate, Water Pressure Drop, Entering/Leaving Water Temperature, Entering/Leaving Air Temperature (DB/WB).
Fan and Motor: Fan Type, Quantity, Number of Speeds, Motor Type (PSC/ECM/EC), Motor Power, Motor Efficiency Class, Voltage, Current, RPM, Sound Power/Pressure Level.
Filter: Type, Class, Material, Mounting, Washable or Disposable.
Controls: Control Type, Valve Type (2-way/3-way), Thermostat Type, Actuator Type, BMS Interface/Protocol.
Electrical: Supply Voltage, Frequency, Phase, Total Connected Load, Full Load Current.
Standards: AHRI 440, Eurovent, ISO, any efficiency classification.`;

const CHILLER_EXTRACTION_PROMPT = `You are an HVAC Air-Cooled Chiller datasheet extraction engine. Extract every relevant technical specification from the datasheet text below into clear parameter/value pairs.

${EXTRACTION_RULES}
Also: if a parameter repeats per circuit or per compressor, extract each occurrence separately with a clear label (e.g. "Circuit 1 Refrigerant Charge", "Circuit 2 Refrigerant Charge") rather than merging them.

EXTRACT DATA IN THESE CATEGORIES (not limited to):
General: Manufacturer, Model, Series, Unit Type (Screw/Scroll/Centrifugal), Reference Number, Project, Cooling Capacity, Overall Dimensions, Operating/Shipping Weight, Number of Independent Refrigerant Circuits, Number of Compressors.
Compressor: Type, Quantity, Model, Refrigerant Type, Capacity Control/Steps of Unloading, Circuit Arrangement.
Evaporator: Type (Shell-and-tube/Plate/DX), Material, Water Flow Rate, Water Pressure Drop, Entering/Leaving Water Temperature, Fouling Factor, Insulation Type, Minimum Flow Rate.
Condenser (Air-Cooled): Fan Type, Quantity, Fan Motor Power/Efficiency Class, Coil Material, Coil Rows, Fin Material/Spacing, Coil Coating, Air Flow Rate, Ambient Design Temperature.
Electrical: Supply Voltage, Frequency, Phase, Total Connected Load, Full Load Current (FLA), Locked Rotor Current (LRA), Max Overcurrent Protection, Inrush Current.
Controls: Controller Type/Model, BMS Interface/Protocol, Safety/Protection Devices, Soft Starter/VFD.
Performance: EER, COP, IPLV, NPLV, Sound Power/Pressure Level.
Standards: AHRI 550/590, Eurovent, ASHRAE 90.1, ISO, any energy efficiency classification.`;

const PROMPTS = {
  'AHU': AHU_EXTRACTION_PROMPT,
  'FCU': FCU_EXTRACTION_PROMPT,
  'Air Cooled Chiller': CHILLER_EXTRACTION_PROMPT,
};

async function handlePost(context) {
  const user = await requireUser(context);
  if (!user) return json({ error: 'Not signed in' }, 401);
  // Same access gate as AI compliance suggestions — datasheet extraction
  // is part of the AI-powered flow, not the plain-conversion one.
  const tier = await complianceTier(context);
  if (tier.tier !== 'pro') {
    return json({ error: 'AI datasheet extraction is not enabled on your account yet — ask an admin for access.' }, 403);
  }
  if (!context.env.AI) {
    return json({ error: 'AI binding not configured — add a Workers AI binding named "AI" to the Pages project.' }, 500);
  }

  let body;
  try { body = await context.request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const product = String(body.product || '').trim();
  if (!PRODUCTS.includes(product)) return json({ error: 'Select a valid product' }, 400);
  const text = String(body.text || '').slice(0, MAX_INPUT_CHARS).trim();
  if (text.length < 40) return json({ error: 'Datasheet text is too short to extract from' }, 400);

  const systemPrompt = PROMPTS[product] + `

OUTPUT: ONLY a JSON array of {"label": "...", "value": "..."} objects, no markdown, no commentary. Omit any parameter not explicitly stated — never invent a value.`;

  let raw = '';
  let directArr = null;
  try {
    const res = await context.env.AI.run(MODEL, {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'DATASHEET TEXT:\n"""\n' + text + '\n"""' },
      ],
      max_tokens: 2000,
      temperature: 0.1,
      response_format: {
        type: 'json_schema',
        json_schema: {
          type: 'object',
          properties: {
            fields: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                  value: { type: 'string' },
                },
                required: ['label', 'value'],
              },
            },
          },
          required: ['fields'],
        },
      },
    });
    if (res && res.response && typeof res.response === 'object' && Array.isArray(res.response.fields)) {
      directArr = res.response.fields;
    } else {
      raw = res && (typeof res.response === 'string' ? res.response
        : (res.result || JSON.stringify(res.response || ''))) || '';
    }
  } catch (err) {
    return json({ error: 'AI extraction failed: ' + (err.message || 'unknown') +
      ' (daily free allocation may be exhausted — resets 00:00 UTC)' }, 502);
  }

  const arr = directArr || extractArray(raw);
  const fields = coerceFields(arr);
  return json({ fields, model: MODEL });
}

// Same text-repair fallback pattern as ai-suggest.js's extractJsonArray —
// handles the model wrapping in prose/markdown, trailing commas, or an
// object-wrapped array instead of a bare one.
function extractArray(raw) {
  let text = String(raw).replace(/```(?:json)?/gi, '').trim();
  const objStart = text.indexOf('{');
  const arrStart = text.indexOf('[');
  if (objStart === 0 || (objStart >= 0 && (arrStart < 0 || objStart < arrStart))) {
    try {
      const obj = JSON.parse(text);
      if (obj && Array.isArray(obj.fields)) return obj.fields;
    } catch {}
  }
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  try { return JSON.parse(text.slice(start, end + 1)); }
  catch {
    try { return JSON.parse(text.slice(start, end + 1).replace(/,(\s*[\]}])/g, '$1')); }
    catch { return []; }
  }
}

function coerceFields(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const f of arr) {
    if (!f || typeof f !== 'object') continue;
    const label = String(f.label || '').slice(0, 100).trim();
    const value = String(f.value || '').slice(0, 300).trim();
    if (!label || !value) continue; // never invent — an empty pair is dropped, not guessed
    out.push({ label, value });
    if (out.length >= MAX_FIELDS) break;
  }
  return out;
}

// Every response is guaranteed JSON for any error this code can catch —
// see withErrorHandling() in _compliance.js.
export const onRequestPost = withErrorHandling(handlePost);
