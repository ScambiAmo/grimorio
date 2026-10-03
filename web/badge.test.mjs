import test from "node:test";
import assert from "node:assert/strict";
import { badgeSvg, validateBadge, paletteOf, dominantHues, contrast, nameFont, BADGE_RULES as R } from "./src/badge.js";

const JPG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBD";
const base = { name: "Allium ursinum", family: "Amaryllidaceae", no: 7, date: "2026-10-03T12:00:00Z", photo: JPG, hue1: 120, hue2: 45 };

test("badge: la forma è identica per tutti, cambiano solo colori e testi", () => {
  const forma = (svg) => svg.replace(/#[0-9a-f]{6}/g, "#c").replace(/>[^<]*<\/text>/g, "></text>").replace(/font-size="\d+"/g, "").replace(/aria-label="[^"]*"/, "");
  const a = badgeSvg(base), b = badgeSvg({ ...base, name: "Rhododendron ponticum", family: "Ericaceae", no: 12, hue1: 300, hue2: 200 });
  assert.deepEqual(validateBadge(a), []); assert.deepEqual(validateBadge(b), []);
  assert.equal(forma(a), forma(b));
});

test("badge: conforme per ogni tinta e per nomi di ogni lunghezza (anche con caratteri speciali)", () => {
  for (let h = 0; h < 360; h += 15) for (const h2 of [h + 60, h + 180]) assert.deepEqual(validateBadge(badgeSvg({ ...base, hue1: h, hue2: h2 % 360 })), [], `tinte ${h}/${h2}`);
  for (const n of ["Poa", "A".repeat(30), "Una pianta con un nome lunghissimo che va tagliato davvero", `Zea "mays" <b>&`]) {
    const svg = badgeSvg({ ...base, name: n }); assert.deepEqual(validateBadge(svg), [], n); assert.ok(!svg.includes("<b>"));
  }
  for (let len = 1; len <= R.name.max; len++) assert.ok(R.name.charW * len * nameFont(len) <= R.name.room, `lunghezza ${len}`);
});

test("badge: contrasto del testo sempre ≥ 4,5 su qualunque tinta", () => {
  for (let h1 = 0; h1 < 360; h1 += 5) for (let h2 = 0; h2 < 360; h2 += 20) { const p = paletteOf(h1, h2); assert.ok(contrast(p.text, p.rim) >= 4.5 && contrast(p.text, p.bg) >= 4.5, `${h1}/${h2}`); }
});

test("badge: le violazioni vengono rilevate", () => {
  const ok = badgeSvg(base);
  assert.ok(validateBadge(ok.replace('viewBox="0 0 512 512"', 'viewBox="0 0 400 400"')).length);
  assert.ok(validateBadge(ok.replace(/points="[^"]+"/, 'points="0,0 1,1 2,2"')).length, "esagono deformato");
  assert.ok(validateBadge(ok.replace('rx="10"', 'rx="40"')).length, "nastro diverso");
  assert.ok(validateBadge(ok.replace(/<image [^>]+\/>/, "")).length, "senza foto reale");
  assert.ok(validateBadge(badgeSvg({ ...base, photo: "https://x.test/a.jpg" })).length, "foto esterna rifiutata");
  assert.ok(validateBadge(ok.replace("</svg>", "<script>alert(1)</script></svg>")).length, "script");
  assert.ok(validateBadge(ok.replace(/fill="#[0-9a-f]{6}"/, 'fill="red"')).length, "colore non esadecimale");
});

test("palette dalle foto: tinta dominante, grigi ignorati, ripiego verde", () => {
  const px = (r, g, b, n) => Array.from({ length: n }, () => [r, g, b, 255]).flat();
  const d = dominantHues([px(40, 200, 40, 50), px(220, 40, 40, 20), px(128, 128, 128, 500)]);
  assert.ok(d.hue1 >= 105 && d.hue1 <= 135, "verde dominante"); assert.ok(d.hue2 < 30 || d.hue2 > 330, "secondo: rosso");
  assert.equal(dominantHues([px(100, 100, 100, 50)]).hue1, 120);
});
