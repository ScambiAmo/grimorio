import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makePolicy, normTaxon, slugOf } from "./policy.js";
import { verdictOf } from "./identify.js";

const table = JSON.parse(readFileSync(new URL("../data/taxa_policy.json", import.meta.url)));
const lookalikes = JSON.parse(readFileSync(new URL("../data/lookalikes.json", import.meta.url)));
const P = makePolicy(table);

test("normalizzazione", () => {
  assert.equal(normTaxon("Mentha × piperita"), "mentha piperita");
  assert.equal(normTaxon("Mentha x  piperita L."), "mentha piperita l");
  assert.equal(slugOf("Atropa bella-donna"), "atropa-bella-donna");
  assert.equal(slugOf("Mentha × piperita"), "mentha-piperita");
});
test("binomio batte genere, genere vale per le specie del genere", () => {
  assert.equal(P.decide("Mentha pulegium").tier, "alto");
  assert.equal(P.decide("Mentha × piperita").tier, "basso");
  assert.equal(P.decide("Conium maculatum").tier, "alto");
  assert.equal(P.decide("Digitalis lutea").tier, "alto");
  assert.equal(P.decide("Taraxacum officinale").tier, "basso");
  assert.equal(P.decide("Salvia officinalis").tier, "medio");
});
test("default alto e look-alike vince", () => {
  assert.equal(P.decide("Allium ursinum").tier, "alto");
  assert.equal(P.decide("Allium ursinum").listed, false);
  assert.equal(P.decide("Taraxacum officinale", { redFlag: true }).tier, "alto");
  assert.equal(P.isRed("Allium ursinum"), false, "sconosciuta non è lista rossa esplicita");
  assert.equal(P.isRed("Aconitum napellus"), true);
});
test("ogni look-alike curato è presente e coerente con la lista rossa", () => {
  for (const [sp, list] of Object.entries(lookalikes)) {
    if (sp.startsWith("_")) continue;
    for (const l of list) if (l.danger === "mortale") assert.equal(P.isRed(l.name), true, `${l.name} (mortale) deve essere in lista rossa`);
  }
});
test("verdetto identificazione", () => {
  const c = (score, red = false) => ({ score, red_list: red });
  assert.equal(verdictOf([c(0.9), c(0.05)]).verdict, "probabile");
  assert.equal(verdictOf([c(0.85), c(0.7)]).verdict, "da_affinare");
  assert.equal(verdictOf([c(0.9), c(0.12, true)]).verdict, "da_affinare");
  assert.equal(verdictOf([c(0.9), c(0.12, true)]).redWarning, true);
  assert.equal(verdictOf([c(0.9), c(0.05, true)]).verdict, "probabile", "sotto 0,10 la lista rossa non conta");
  assert.equal(verdictOf([c(0.2)]).verdict, "non_riconosciuta");
  assert.equal(verdictOf([]).verdict, "non_riconosciuta");
});
