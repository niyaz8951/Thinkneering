# Product Options redesign (21 Oct 2026) - agreed and built (merges: yes; coils in one table: yes)

Source: the owner's HILTOP FINAL_R1_COPY datasheet (78 pages, 7 AHU units, Dubai factory, ASTRAWEB 10.1.26.1), read with the site's own reader (`DSRead` + `DSParse.rows`).

## What the datasheet gives
- 7 units, 233 distinct row keys, about 760 distinct values.
- About 78 % of the values are duty or size figures that change with every selection (flows, pressures, velocities, temperatures, capacities, powers, efficiencies, rpm at work, weights, lengths, areas, torques, dimensions). They are not options and are the reason for thousands of "to approve" values (Air Velocity alone 20+ chips).
- About 13 % are construction choices (materials, skins, profile, base, roof, mounting, fluid, flexible, anti-vibration, thermal protection), 5 % ratings / classes (EN 1886, EN 13053, filter class, filter energy class, IE, SFP class, power class), 3 % component models (fan model, heat wheel part number, coil model).
- Location is "ROMA URBE, Italy" with 0-10 m on all 7 units: the selection's default climate, not the site. Location, air density, altitude and outdoor conditions are project conditions, not product options.
- Reader issues: the VRV Xpress line ("1[D]* x EKEXVA250 [A]* EKEA NOSUPPLIED", "Total Capacity[B]*") becomes junk keys; it should be one row "Expansion valve kit: EKEXVA250, control box EKEA, not supplied".
- Fans: model printed before type; no fan materials on this datasheet. Max speed is constant per model (SYQ630-R 1700 rpm, SYQ630-K 2000 rpm): a model fact. Same model seen twice (SYQ630-K) ran at different duties: duty is a range.
- Material Name (ADN05FCD5, ADN12FGD5 ...) seems to encode size, layout and panel; to confirm with the owner before using it.

## Proposal
1. **A kind per mapping row** (Row mapping, code suggests, editor confirms): Option, Class (ordered scale), Model, Duty (range only), Project condition (not stored in Product Options), Hidden. Only Option, Class and Model wait for approval; Duty is shown as min-max per type and never waits.
2. **Type rules per section** (one declarative list like `DSParse.FAN` / `LINKED`): which row names the type (family), which row names the model, e.g. Fans: family from Type (EC / DIDW forward / DIDW backward), model = Model; Filters: type = Filter Class; Heat recovery: type = Type, model = Part Number; Casing: type = Model Box Ref. (+ Profile); Coils: type = section kind + Fluid; Dampers: Material.
3. **Model facts found by code**: a row whose value is the same every time a model is seen is a model fact (max speed); a row that varies is a duty range. No list to maintain.
4. **Common found by code**: a value identical on every type of a section shows once as "Common to every unit seen" at the top of the section; type columns show only what differs.
5. **Layout**: an overview strip of sections (with counts and a "To approve n" chip); a section = Common strip, type tabs, a column table per type (one column per model, model facts, then duty ranges, seen on n units); the Options List lines as "Extras offered" per section; the approval queue as its own view grouped by section and type, so the tree stays clean.
6. **AI evidence** reads the same cards (type -> model -> facts, ranges), not flat rows.

## Phases (each shippable)
- A: kind per mapping row (migration: `dn_map.kind`), code-suggested defaults, Duty as ranges without approval, Project conditions out of the tree; reader fix for the VRV line.
- B: type rules + column tables for every section; Common strip computed.
- C: overview strip, To approve view, Extras offered.
- D: AI evidence from the cards.

## Open questions for the owner
- Material Name coding (ADN 05 F C D 5): what each letter means.
- Keep Location / altitude at all in Product Options, or only in the project's datasheet table.
- Are SYD / SYQ / SYH all DIDW belt or direct driven; is EC the only plug fan.

## Addendum: Qiddiya Tennis Center MEP2 R9 (157 pages, 15 AHU units, Riyadh), 21 Oct 2026
- 285 row keys. Confirms the split: most values are duty figures; the two projects made different choices (62 mm Energy ThermiC S2, thermal-break profile, roof, IE5, 380V/3Ph/60Hz vs 42 mm F2, IE3, 400-415V 50Hz), project choices, not factory limits: both factories offer all options (owner).
- **EC fans exist here**: K3G450PA3103, K3G450PB29N1, K3G400PW0301, K3G355PV7001 as fan arrays (2x / 3x), material Aluminium, IE5. Type is printed two ways ("EC" and "EC Centrifugal Fan Including Electrical Panel & Main Switch"): the family rule must group spellings.
- **Model facts by code, checked on 4 models seen 2-9 times**: always the same per model: max speed, K factor, material, flexible, anti-vibration mount, motor class / connection / poles / thermal protection / brand. Varying (duty): pressures, flow, speed at work, efficiencies, input power, SFP, control voltage, quantity.
- **Humidifier** (Isothermal steam, Immerse Electrode): model in "Name" (1 x UE035XL000 / UE065 / UE130, IP20, supplied loose), distributor model (DP125D30R0 ...), steam kg/h and power as duty. Card per humidifier model; "supplied loose" kept visible.
- **Electric heater**: SS304, 4 steps, Electric Thermal Block, automatic thermostat + manual reset = options; capacity = duty.
- **Mixing box**: damper one / damper two recirculation as sub-headings with material, mounting side (External Left / Top / Right / Bottom); recirculated air %, humidity = duty.
- **Fan external connection** "Damper • Aluminium • Top • 440x1520 4Nm": an option (outlet damper), size is duty.
- **Options list is rich and repeats across sections**: Light wired to external switch (w/o bulb) IP44, Port hole IP55, Magnehelic 0-500 Pa, Additional tapping point, Potentiometer, Flat roof, Stretch film (internal storage), DrainPan SS304. Show each once with the sections it was seen on.
- **Coil cooling water model** "1.25x1.082-2.0-1300-1301.8-5R-15-S-Cu0.36-Al0.11- FrameGALV-H1 1/2" encodes geometry, rows, tube, fin, frame, header: not an option; its parts are already separate rows.
- **Location** here is the real site (RIYADH KING KHALED INTL, 620 m, 1.14 kg/m3), printed in two capitalisations. In HILTOP it was the default ROMA URBE. Still a project condition.
- **Material Name pattern over 22 units** (to confirm with the owner): ADN + size (01-13) + F (supply and return, the units with return sections / heat wheels) or H (supply only) + C (42 mm panel) or G (62 mm panel) + D (no roof, 50 Hz) or W (roof, 60 Hz; outdoor?) + factory (5 Dubai, 9 Riyadh). If confirmed, it names the unit type for free.

## Owner, 21 Oct 2026 (later)
- Both factories can offer all options; the differences between the two datasheets are project choices, not factory limits. Product Options must never read as "this factory cannot". The common strip is named "Common to every unit seen", not "Standard", and the page keeps saying that a value not listed is not known yet.
- Goal of the redesign: readability and sense for users, not new rules about what a factory offers.

## Per-section plan (owner agreed the buckets, 21 Oct 2026; merges to confirm)
Four buckets in every section: Common (once on top), Accessories (Options List lines, once), Model-specific (one column per model / type / class), Duty (range only, never waits for approval).

| Section | Column per | Model-specific | Common | Duty | Accessories |
|---|---|---|---|---|---|
| Casing (Unit Data) | Model box | Panel, insulation, profile, EN 1886 classes | Series, skins, internal parts, drain pan, base, roof, connection side, door, ErP | Size HxW, length, weight, air flow, ESP, SFP, EN 13053 P / V classes | Flat roof, stretch film |
| Dampers (supply, return, mixing box) | none | - | Material, mounting side | Pressure drop, size, torque, recirculation % | Actuator hand quadrant |
| Filters (supply + return merged) | Filter class + name | Name, material, energy class, ePM1/2.5/10, depth | Mounting, pressure drop design | Face velocity, area, panel sizes, clean / medium / dirty dP | Tapping point, light, port hole, Magnehelic, spare filters |
| Heat recovery | Wheel type | Part numbers and diameters seen | Motor consumption | Efficiencies, H class, winter / summer, dP | - |
| Coils (DX + chilled water in one table) | Coil kind | Geometry P22 / P32, connection type, drain pan, fluid, VRV kit | Tube, fin, header, frame, moisture eliminator | Rows, circuits, connection size, capacities, temperatures, dP, water flow | SS304 drain pan |
| Fans (supply + return merged) | Model, grouped EC / DIDW | Type, material, max speed, K factor, motor class, poles | Flexible, AV mounts, thermal protection, motor brand, voltage | Pressures, flow, speed at work, efficiencies, power, SFP, control voltage, fans in array | Light, port hole, potentiometer, outlet damper |
| Humidifier | Humidifier model | Type, IP, supplied loose, power, electrical connection | Drain pan | Steam kg/h, distributors, temperatures, RH | SS304 drain pan |
| Electric heater | none | - | Material, connection, protection | Steps, capacity, temperatures | - |
| Empty section | none | - | - | Length | Light |

Mechanism: one section-rule list in code (which row names the column, which sections merge); the split is automatic (same every time in a column = model-specific; same in every column = common; varying number = duty; Options List = accessories); Row mapping gets a per-row override Auto / Common / Model-specific / Duty / Hide. Approval only for model-specific and common values, per column. Location out of Product Options. Nothing deleted.
Build order: Filters, Fans, Coils, Casing, then the rest; each checked on HILTOP and Qiddiya.


## Built (21 Oct 2026, night)
As planned, with: Power supply card first and General (product notes) last; duty figures folded behind "Show duty figures (n)"; the column row is the column heading, approved there; "Remove old readings" per card for values read before the columns; the VRV Xpress line read as "VRV Expansion Kit". Rules in Thinkneering-Hub-Standards.md (Product Options screen).
