-- FCU row mapping, as the AHU's (owner, 22 Oct 2026): starter keywords per product.
-- 1. dn_starter_keywords was keyed by row only (every row was an AHU row). It is rebuilt with the product, the AHU rows
--    kept as they are; SQLite cannot change a primary key, so the table is rebuilt (as in 0003 and 0012).
CREATE TABLE dn_starter_keywords_new (
  product_id TEXT NOT NULL DEFAULT 'ahu',
  row_key    TEXT NOT NULL,
  keywords   TEXT NOT NULL,
  strip      TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (product_id, row_key)
);
INSERT INTO dn_starter_keywords_new (product_id, row_key, keywords, strip) SELECT 'ahu', row_key, keywords, strip FROM dn_starter_keywords;
DROP TABLE dn_starter_keywords;
ALTER TABLE dn_starter_keywords_new RENAME TO dn_starter_keywords;

-- 2. Starter keywords for the rows of the FCU technical report (McQuay Smart Tools; Kifaf Phase-5 Plot-2 FCU/GF/16).
--    The keys are the reader's (DSParse.rowKey): "Application/Design Air Flow" is read as two rows since 22 Oct 2026;
--    a superscript can come out as "m³" or "m3", so both spellings are listed.
INSERT INTO dn_starter_keywords (product_id, row_key, keywords, strip) VALUES
  ('fcu', 'general||power supply', 'power supply; electrical characteristic; electrical supply; supply voltage; main power; electrical power', ''),
  ('fcu', 'unit data||application air flow(m³/h)', 'air flow; airflow; air volume; air quantity', ''),
  ('fcu', 'unit data||application air flow(m3/h)', 'air flow; airflow; air volume; air quantity', ''),
  ('fcu', 'unit data||application esp (pa)', 'external static; external pressure; esp', ''),
  ('fcu', 'unit data||fan power input (w)', 'power input; power consumption; input power; fan power', ''),
  ('fcu', 'unit data||running current (a)', 'running current; full load current; full load amp; fla', ''),
  ('fcu', 'unit data||net dimension w*d*h (mm)', 'unit dimension; overall dimension; unit height; ceiling void; unit size', ''),
  ('fcu', 'unit data||unit net weight (kg)', 'unit weight; operating weight; net weight', ''),
  ('fcu', 'unit data||fan control type', 'fan speed; three speed; 3 speed; speed control; speed selector', ''),
  ('fcu', 'configuration information||drain pan type', 'drain pan; condensate pan; drip tray; condensate tray', ''),
  ('fcu', 'configuration information||drain pan material', 'drain pan material; drain pan stainless; drain pan galvan; drip tray stainless', ''),
  ('fcu', 'configuration information||drain pan insulation', 'drain pan insulat; drip tray insulat; condensate pan insulat', ''),
  ('fcu', 'configuration information||return plenum type', 'return plenum; plenum box; return air plenum; bottom return; rear return', ''),
  ('fcu', 'configuration information||return plenum insulation', 'plenum insulat', ''),
  ('fcu', 'configuration information||filter type', 'filter; washable filter; aluminium mesh; aluminum mesh; nylon mesh; filter media', ''),
  ('fcu', 'configuration information||coil area (m²)', 'coil face area; coil area', ''),
  ('fcu', 'configuration information||coil area (m2)', 'coil face area; coil area', ''),
  ('fcu', 'configuration information||face velocity(m/s)', 'face velocity; coil velocity', ''),
  ('fcu', 'configuration information||fpi', 'fins per; fin spac; fpi; fin pitch', ''),
  ('fcu', 'configuration information||fins material', 'fin alumin; fin copper; fin material; fin coated; hydrophilic', ''),
  ('fcu', 'configuration information||pipe connection', 'connection side; left hand; right hand; handing', ''),
  ('fcu', 'configuration information||water connection size', 'water connection; connection size; coil connection', ''),
  ('fcu', 'configuration information||motor type', 'motor type; psc motor; ec motor; brushless; dc motor; ac motor', ''),
  ('fcu', 'configuration information||rated motor speed (rpm)', 'motor speed; rpm', ''),
  ('fcu', 'configuration information||fan qty', 'number of fans; fan quantity', ''),
  ('fcu', 'cooling coil (cooling mode)||total cooling capacity(kw)', 'cooling capacity; total capacity; total cooling', ''),
  ('fcu', 'cooling coil (cooling mode)||sensible cooling capacity(kw)', 'sensible capacity; sensible cooling', ''),
  ('fcu', 'cooling coil (cooling mode)||on coil db (°c)', 'entering air; air on coil; entering dry bulb; edb', ''),
  ('fcu', 'cooling coil (cooling mode)||on coil wb (°c)', 'entering wet bulb; ewb', ''),
  ('fcu', 'cooling coil (cooling mode)||ewt(°c)', 'entering water; chilled water supply; water inlet; ewt', ''),
  ('fcu', 'cooling coil (cooling mode)||lwt(°c)', 'leaving water; chilled water return; water outlet; lwt', ''),
  ('fcu', 'cooling coil (cooling mode)||coil rows', 'rows deep; coil rows; row coil; number of rows', ''),
  ('fcu', 'cooling coil (cooling mode)||wpd (kpa)', 'water pressure drop; water side pressure; wpd', ''),
  ('fcu', 'cooling coil (cooling mode)||water flow rate (l/s)', 'water flow; gpm', ''),
  ('fcu', 'cooling coil (heating mode)||heating capacity(kw)', 'heating capacity; hot water coil; heating coil', ''),
  ('fcu', 'electric heater||heating capacity(kw)', 'electric heater; electric heating; heater capacity', ''),
  ('fcu', 'acoustical performance|lw inlet + rad(db(a))|overall', 'sound power; sound level; noise level; noise criteria', ''),
  ('fcu', 'acoustical performance|lw outlet duct(db(a))|overall', 'discharge sound; outlet sound; duct sound', '');

-- 3. FCU mapping rows nobody gave keywords (or Remove text) get the starter ones, as 0005 did for the AHU.
UPDATE dn_map SET keywords = (SELECT s.keywords FROM dn_starter_keywords s WHERE s.product_id = 'fcu' AND s.row_key = dn_map.row_key)
 WHERE product_id = 'fcu' AND keywords = '' AND row_key IN (SELECT row_key FROM dn_starter_keywords WHERE product_id = 'fcu');
