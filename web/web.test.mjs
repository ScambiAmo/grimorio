import test from "node:test";
import assert from "node:assert/strict";
import { search, cardHtml, esc } from "./app.js";
const idx = [{ name: "Allium ursinum", slug: "allium-ursinum", synonyms: [], common_names: { it: ["Aglio orsino"], en: [] } }];
test("ricerca senza accenti/maiuscole", () => { assert.equal(search(idx, "AGLIO ORSINO").length, 1); assert.equal(search(idx, "a").length, 0); });
test("scheda: niente HTML iniettato, tier alto blocca uso culinario, avviso rosso", () => {
  const p = { accepted_name: "<img src=x onerror=alert(1)>", safety_tier: "alto", status: "auto", sources: [{ key: "S1", url: "javascript:alert(1)", title: "t", license: "l" }], images: [],
    content: { summary: { t: "<script>x</script>", s: ["S1"] }, culinary_uses: { blocked_by_safety: true }, lookalikes_curated: [{ name: "Conium maculatum", danger: "mortale", note: "n" }], toxicity: { not_found_note: "x" } } };
  const h = cardHtml(p);
  assert.ok(!h.includes("<img src=x") && !h.includes("<script>") && !h.includes('href="javascript'));
  assert.ok(h.includes('class="red"') && h.includes("Non disponibile per sicurezza"));
  assert.equal(esc(`"<&>'`), "&quot;&lt;&amp;&gt;&#39;");
});

import { docHtml, countClaims, badgeImg, MIN_SHOTS, MAX_SHOTS } from "./app.js";
const plant = (n, fam) => ({ accepted_name: n, family: fam, safety_tier: "basso", status: "auto", sources: [{ key: "S1", url: "https://it.wikipedia.org/wiki/X", title: "Wikipedia", license: "CC BY-SA 4.0" }], images: [], common_names: { it: ["Nome"] },
  content: { summary: { t: "Riassunto", s: ["S1"] }, identification: { keys: [{ t: "Foglie", s: ["S1"] }] }, toxicity: { not_found_note: "x" } } });
test("archivio: pagina unica con indice, sezioni piatte (niente details) e HTML sempre scappato", () => {
  const h = docHtml([plant("Allium ursinum", "Amaryllidaceae"), plant("<b>x</b>", "F")]);
  assert.ok(h.includes('id="a-0"') && h.includes('id="a-1"') && h.includes('data-go="1"') && h.includes("2 specie"));
  assert.ok(!h.includes("<details open>") && !h.includes("<b>x</b>"));
  assert.ok(docHtml([]).includes("ancora vuoto"));
});
test("contributo: conta solo le affermazioni con fonte; 4–5 foto obbligatorie", () => {
  assert.equal(countClaims(plant("a", "b").content), 2);
  assert.equal(countClaims({ lookalikes_curated: [{ name: "x", note: "y" }] }), 0);
  assert.equal(MIN_SHOTS, 4); assert.equal(MAX_SHOTS, 5);
});
test("badgeImg: restituisce un'immagine solo se il badge è conforme", () => {
  const rec = { name: "Allium ursinum", family: "Amaryllidaceae", no: 1, date: "2026-10-03", photo: "data:image/jpeg;base64,AAAA", hue1: 100, hue2: 20 };
  assert.ok(badgeImg(rec).startsWith("<img")); assert.equal(badgeImg({ ...rec, photo: "" }), "");
});
