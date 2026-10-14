/* Self-test for "Check a specification" (std.js). Run: node test-standards.js */
global.window = {};
require("./standards-data.js");
require("./std.js");
var Std = window.Std, fails = 0;

function codes(list) { return list.map(function (s) { return s.id; }); }
function check(name, text, wantFound, wantMissing, notFound) {
  var out = Std.scan(text), f = codes(out.found), ok = true;
  wantFound.forEach(function (id) { if (f.indexOf(id) < 0) ok = false; });
  (notFound || []).forEach(function (id) { if (f.indexOf(id) >= 0) ok = false; });
  wantMissing.forEach(function (m) { if (!out.missing.some(function (x) { return x.indexOf(m) === 0; })) ok = false; });
  if (!ok) fails++;
  console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : "\n     found " + JSON.stringify(f) + "\n     missing " + JSON.stringify(out.missing)));
}

console.log("--- wording between the body and the number ---");
check("ASHRAE Standard 90.1-2019", "Energy efficiency to ASHRAE Standard 90.1-2019.", ["ashrae-90-1"], []);
check("ANSI/ASHRAE Standard 62.1, ASHRAE Std 55", "Comply with ANSI/ASHRAE Standard 62.1 and ASHRAE Std 55.", ["ashrae-62-1", "ashrae-55"], []);
check("AHRI / AMCA / NFPA Standard", "AHRI Standard 410 coils; AMCA Standard 210 fans; NFPA Standard 90A", ["ahri-410", "amca-210", "nfpa-90a"], []);
check("Std. and Guideline", "ASHRAE Std. 52.2 filters, ANSI/AHRI Std 430, ANSI/AMCA Standard 300, VDI Guideline 6022", ["ashrae-52-2", "ahri-430", "amca-300", "vdi-6022"], []);
check("prefixes", "BS EN ISO 5801, EN ISO 16890-1:2016, DIN EN ISO 12944-2, ISO/IEC 60529, ANSI/AHRI 440, EN1886 L1(M), ISO 1940/1 G6.3",
  ["amca-210", "iso-16890", "iso-12944", "iec-60529", "ahri-440", "en-1886", "iso-21940"], []);
check("placeholder example", "Casing to EN 1886 class D1/L1/T2/TB2. Coils rated to AHRI 410. Filters ISO 16890 ePM1 60%. Insulation to NFPA 90A and ASTM E84.",
  ["en-1886", "ahri-410", "iso-16890", "nfpa-90a", "astm-e84"], []);

console.log("--- a near number is not the same standard ---");
check("ASHRAE 90.2 / 62.2", "ASHRAE 90.2 and ASHRAE 62.2 residential", [], ["ASHRAE 90.2", "ASHRAE 62.2"], ["ashrae-90-1", "ashrae-62-1"]);
check("ASHRAE Standard 62.2", "ANSI/ASHRAE Standard 62.2", [], ["ASHRAE 62.2"], ["ashrae-62-1"]);
check("NFPA 90B", "Ducts to NFPA 90B.", [], ["NFPA 90B"], ["nfpa-90a"]);
check("ASHRAE 52.1, ISO 3746, SASO 2663", "ASHRAE 52.1 dust spot; ISO 3746 survey; SASO 2663", [], ["ASHRAE 52.1", "ISO 3746", "SASO 2663"], ["ashrae-52-2", "iso-3744", "saso-2874"]);
check("EN 18860 is not EN 1886", "Casing to EN 18860", [], ["EN 18860"], ["en-1886"]);
check("other parts", "IEC 60335-2-80 fans, IEC 60034-1 motors, DIN 1946-6 dwellings, EN 13501-2", [], ["IEC 60335-2-80", "IEC 60034-1", "DIN 1946-6", "EN 13501-2"],
  ["iec-60335-2-40", "iec-60034-30-1", "din-1946-4", "en-13501-1"]);
check("the right parts still match", "IEC 60335-2-40, IEC 60034-30-1, DIN 1946-4, EN 13501-1, AMCA 500-D, UL 508A, ASHRAE 145.2, ASHRAE 185.2",
  ["iec-60335-2-40", "iec-60034-30-1", "din-1946-4", "en-13501-1", "amca-500-d", "ul-508a", "iso-10121", "ashrae-185"], []);
check("a year is not a standard", "ISO 9001:2015 factory, built in 2019, ISO 2016", ["iso-9001"], [], []);

console.log("--- Eurovent ---");
check("Eurovent with fan coil wording", "Eurovent certified fan coil units", ["eurovent-fcu"], [], ["eurovent-ahu"]);
check("Eurovent with AHU wording", "Air handling units shall be Eurovent certified.", ["eurovent-ahu"], [], ["eurovent-fcu"]);
check("Eurovent with chiller wording", "Chillers shall be Eurovent certified", ["eurovent-chiller"], [], ["eurovent-ahu"]);
check("Eurovent 4/21", "Filters to Eurovent 4/21.", [], ["Eurovent 4/21"], ["eurovent-ahu"]);
check("bare Eurovent", "Manufacturer shall be a member of Eurovent.", [], ["Eurovent (the text"], ["eurovent-ahu", "eurovent-fcu", "eurovent-chiller"]);

console.log("--- nothing to find ---");
check("no standards", "lorem ipsum dolor sit amet no standards here at all", [], []);
var none = Std.scan("lorem ipsum dolor sit amet");
if (none.found.length || none.missing.length) { fails++; console.log("FAIL plain text gives results"); }

console.log(fails ? "\n" + fails + " check(s) FAILED" : "\nAll checks passed");
process.exit(fails ? 1 : 0);
