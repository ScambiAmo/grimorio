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
