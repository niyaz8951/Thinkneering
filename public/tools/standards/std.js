/* Standards library - shared helpers for index.html and standard.html. */
(function () {
  "use strict";
  var TOOL_ID = "standards";
  var PRODUCT = { ahu: "AHU", fcu: "FCU", chiller: "Chiller" };
  var byId = {}, groupName = {};
  window.STD.ITEMS.forEach(function (s) { byId[s.id] = s; });
  window.STD.GROUPS.forEach(function (g) { groupName[g.id] = g.name; });

  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&"); }
  // Words a specification may put between the body and the number: "ASHRAE Standard 90.1", "AHRI Std. 410".
  var FILLER = "(?:(?:Standard|Std\\.?|Guideline)[\\s\\-]*)?";
  /* "EN 1886" also finds "EN1886", "EN-1886", "EN 1886:2007" and "ANSI/ASHRAE Standard 62.1".
     It does not find a different number: not "EN 18860", and "ASHRAE 90" is not "ASHRAE 90.2". */
  function keyRegex(key) {
    var src = key.split(/[\s\-]+/).map(esc).join("[\\s\\-]*" + FILLER);
    return new RegExp("(^|[^A-Za-z0-9])" + src + (/\d$/.test(key) ? "(?!\\d|\\.\\d)" : "(?![A-Za-z0-9])"), "i");
  }
  var compiled = window.STD.ITEMS.map(function (s) { return { item: s, res: (s.keys || []).map(keyRegex) }; });

  // Any text that looks like a standard number, to report the ones the library does not hold.
  var GENERIC = /\b(BS EN ISO|BS EN|EN ISO|ASHRAE|AHRI|ARI|AMCA|ASTM|ASME|ANSI|NFPA|UL|ISO|IEC|EN|BS|DIN|VDI|NEMA|SASO|ABMA|AFBMA|HTM|IEEE|AWS|CIBSE|GB\/T|GB)[ \t\-\/]{0,3}(?:Standard |Std\.? ?|Guideline )?([A-Z]{0,2} ?\d{1,5}(?:[.\/\-]\d{1,4})*[A-Z]?)/g;

  function known(text) { return compiled.some(function (c) { return c.res.some(function (r) { return r.test(text); }); }); }

  /* A certification body that runs several programmes ("Eurovent"). The word alone does not say
     which programme is meant, so the words near it decide (item.near in standards-data.js). */
  var NEAR_SPAN = 70;
  function scanNear(text, found, missing, seen) {
    var words = {};
    window.STD.ITEMS.forEach(function (s) { if (s.near) (words[s.near.word] = words[s.near.word] || []).push(s); });
    Object.keys(words).forEach(function (word) {
      var re = new RegExp("(^|[^A-Za-z0-9])" + esc(word) + "(?![A-Za-z0-9])([ \\t]*\\d{1,3}\\/\\d{1,3})?", "ig"), m, unclear = false;
      while ((m = re.exec(text))) {
        if (m[2]) {                                             // "Eurovent 4/21": a document number
          var doc = word + " " + m[2].trim(), k = doc.toUpperCase().replace(/\s+/g, "");
          if (!seen[k]) { seen[k] = true; missing.push(doc); }
          continue;
        }
        var around = text.slice(Math.max(0, m.index - NEAR_SPAN), m.index + m[0].length + NEAR_SPAN), hit = false;
        words[word].forEach(function (s) {
          if (s.near.words.some(function (w) { return new RegExp("(^|[^A-Za-z0-9])" + esc(w).replace(/\s+/g, "[\\s\\-]*"), "i").test(around); })) {
            hit = true; if (found.indexOf(s) < 0) found.push(s);
          }
        });
        if (!hit) unclear = true;
      }
      if (unclear && !seen[word.toUpperCase()]) { seen[word.toUpperCase()] = true; missing.push(word + " (the text does not say which programme)"); }
    });
  }

  /* Reads pasted specification text. Returns the library standards named in it and
     the standard numbers found that the library does not hold. */
  function scan(text) {
    var found = [], missing = [], seen = {}, m;
    compiled.forEach(function (c) { if (c.res.some(function (r) { return r.test(text); })) found.push(c.item); });
    GENERIC.lastIndex = 0;
    while ((m = GENERIC.exec(text))) {
      var num = m[2].replace(/[\-\/](19|20)\d\d$/, "").replace(/\s+/g, " ").trim();
      var name = m[1] + " " + num;
      if (/^(19|20)\d\d$/.test(num)) continue;                // "ISO 2016" style years
      if (known(" " + name + " ")) continue;
      var k = name.toUpperCase().replace(/\s+/g, "");
      if (!seen[k]) { seen[k] = true; missing.push(name); }
    }
    scanNear(text, found, missing, seen);
    found.sort(function (a, b) { return window.STD.ITEMS.indexOf(a) - window.STD.ITEMS.indexOf(b); });
    return { found: found, missing: missing };
  }

  /* The standard a page address names: standard.html#id or standard.html?id=id.
     A broken address (a stray % sign) is returned as typed instead of stopping the page. */
  function idFromAddress(loc) {
    var raw = loc.hash.slice(1);
    if (!raw) { var q = /[?&]id=([^&#]*)/.exec(loc.search || ""); raw = q ? q[1] : ""; }
    try { return decodeURIComponent(raw); } catch (e) { return raw; }
  }

  // The tile this tool sits in decides the back link (an admin can move the tool).
  function backLink(profile) {
    var cat = profile.categories.filter(function (c) { return c.tools.some(function (t) { return t.id === TOOL_ID; }); })[0];
    return cat ? { href: Hub.url("dashboard.html#" + encodeURIComponent(cat.id)), text: cat.name + " tools" }
               : { href: Hub.url("dashboard.html"), text: "Dashboard" };
  }

  function badges(s) {
    var out = [Hub.el("span", { "class": "badge", text: s.body })];
    (s.products || []).forEach(function (p) { out.push(Hub.el("span", { "class": "badge ok", text: PRODUCT[p] })); });
    return out;
  }

  function tile(s, href) {
    return Hub.el("a", { "class": "tile st-tile", href: href }, [
      Hub.el("h3", { text: s.code }),
      Hub.el("p", { text: s.title }),
      Hub.el("span", { "class": "meta" }, badges(s))
    ]);
  }

  window.Std = { TOOL_ID: TOOL_ID, PRODUCT: PRODUCT, byId: byId, groupName: groupName, scan: scan, idFromAddress: idFromAddress, backLink: backLink, badges: badges, tile: tile };
})();
