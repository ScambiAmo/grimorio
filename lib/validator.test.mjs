import test from "node:test";
import assert from "node:assert/strict";
import { validateCard, checkClaim, quoteInFragment } from "./validator.js";

const F = {
  S1: "Taraxacum officinale è una pianta erbacea perenne. Le foglie formano una rosetta basale con margine dentato. I fiori gialli sbocciano in primavera. Alcuni autori citano Hypochaeris radicata come specie simile.",
  S2: "Hemlock (Conium maculatum) is highly toxic. Dosage of 15 g was reported in the trial. All parts are poisonous to humans.",
};
const c = (t, s, q) => ({ t, s, q });
const base = () => ({
  schema_version: 4,
  summary: c("Pianta erbacea perenne", ["S1"], "è una pianta erbacea perenne"),
  identification: { keys: [c("Foglie in rosetta basale", ["S1"], "Le foglie formano una rosetta basale"), c("Fiorisce a gennaio", ["S1"], "fiorisce a gennaio in pianura")], habitat: null, distribution: null, season: {} },
  toxicity: { claims: [] }, warnings: [],
  lookalikes: [],
  therapeutic_and_medicinal: { traditional_uses: [c("Uso tradizionale", ["S1"], "pianta erbacea perenne")], preparations: [{ name: "Infuso", part: "foglie", claim: c("Infuso di foglie", ["S1"], "Le foglie formano una rosetta basale"), dose: c("15 g", ["S2"], "Dosage of 15 g was reported") }], extra_field: "x" },
  culinary_uses: { edible_parts: [{ part: "foglie", season: "primavera", claim: c("Foglie giovani", ["S1"], "Le foglie formano una rosetta basale") }] },
  legal: { protection: null },
});
const only1 = { S1: F.S1 };
const basso = { tier: "basso", redListed: false };

test("quoteInFragment", () => {
  assert.equal(quoteInFragment("Le foglie formano una rosetta basale", F.S1), true);
  assert.equal(quoteInFragment("le foglie, formano una rosetta basale!", F.S1), true);
  assert.equal(quoteInFragment("Le foglie formano una rosetta basale con margine seghettato", F.S1), false, "citazione corta: una parola diversa = scartata");
  const long = "Taraxacum officinale è una pianta erbacea perenne Le foglie formano una rosette basale con margine dentato I fiori gialli sbocciano in primavera";
  assert.equal(quoteInFragment(long, F.S1), true, "citazione lunga: tolleranza di un refuso (>=90% dei bigrammi)");
  assert.equal(quoteInFragment("fiorisce a gennaio in pianura", F.S1), false);
  assert.equal(quoteInFragment("rosetta", F.S1), false, "troppo corta");
  assert.equal(quoteInFragment("pianta ".repeat(31), F.S1), false, "troppo lunga");
  assert.equal(quoteInFragment("etta basale con", F.S1), false, "niente match a metà parola");
  const far = "è una pianta erbacea perenne Le foglie formano una rosetta basale con margine dentato I fiori gialli sbocciano"; // contigua: ok
  assert.equal(quoteInFragment(far, F.S1), true);
  const spliced = "Taraxacum officinale è una pianta erbacea perenne come specie simile Hypochaeris radicata sbocciano in primavera";
  assert.equal(quoteInFragment(spliced, F.S1), false, "pezzi lontani cuciti insieme");
});

test("checkClaim", () => {
  assert.equal(checkClaim(c("Foglie in rosetta", ["S1"], "Le foglie formano una rosetta basale"), F), null);
  assert.equal(checkClaim(c("x", ["S1"], "fiorisce a gennaio in pianura"), F), "citazione_non_trovata");
  assert.equal(checkClaim(c("x", ["S9"], "a b c"), F), "fonte_inesistente");
  assert.equal(checkClaim(c("x", ["__proto__"], "a b c"), F), "fonte_inesistente");
  assert.equal(checkClaim(c("x", [], "a b c"), F), "senza_fonte");
  assert.equal(checkClaim({ t: "x" }, F), "senza_fonte", "claim senza 's' non passa");
  assert.equal(checkClaim(c("Assumere 30 g", ["S2"], "Dosage of 15 g was reported"), F), "numero_non_in_fonte");
  assert.equal(checkClaim(c("Riportati 15 g", ["S2"], "Dosage of 15 g was reported"), F), null);
  assert.equal(checkClaim(c("Riportati 5 g", ["S2"], "Dosage of 15 g was reported"), F), "numero_non_in_fonte", "5 non è dentro 15");
  assert.equal(checkClaim(c("Guarisce l'influenza", ["S1"], "Le foglie formano una rosetta basale"), F), "claim_sanitario");
  assert.equal(checkClaim(c("Vedi http://x.it", ["S1"], "Le foglie formano una rosetta basale"), F), "contenuto_non_ammesso");
});

test("schema errato", () => assert.deepEqual(validateCard({ schema_version: 3 }, F).blocked, ["schema_non_conforme"]));

test("claim falso rimosso, q non salvata, campi extra eliminati", () => {
  const r = validateCard(base(), { ...F }, basso);
  assert.equal(r.dropped.length, 1);
  assert.equal(r.card.identification.keys.length, 1);
  assert.equal("q" in r.card.identification.keys[0], false);
  assert.equal("dose" in r.card.therapeutic_and_medicinal.preparations[0], false);
  assert.equal("extra_field" in r.card.therapeutic_and_medicinal, false);
});

test("tossicità", () => {
  let r = validateCard(base(), { ...F, S3: "La pianta è tossica per il bestiame." }, basso);
  assert.ok(r.blocked.includes("tossicita_mancante"));
  r = validateCard(base(), only1, basso);
  assert.ok(r.card.toxicity.not_found_note.includes("NON significa"));
  const ok = base(); ok.toxicity.claims = [c("Tossica per l'uomo", ["S2"], "All parts are poisonous to humans")];
  r = validateCard(ok, F, basso);
  assert.equal(r.blocked.includes("tossicita_mancante"), false);
});

test("livelli di sicurezza", () => {
  let r = validateCard(base(), only1, basso);
  assert.equal(r.card.therapeutic_and_medicinal.preparations.length, 1);
  assert.equal(r.card.culinary_uses.edible_parts.length, 1);
  r = validateCard(base(), only1, { tier: "medio", redListed: false });
  assert.deepEqual(r.card.therapeutic_and_medicinal.preparations, []);
  assert.equal(r.card.culinary_uses.edible_parts.length, 1);
  r = validateCard(base(), only1, { tier: "alto", redListed: false });
  assert.deepEqual(r.card.therapeutic_and_medicinal.preparations, []);
  assert.deepEqual(r.card.therapeutic_and_medicinal.traditional_uses, []);
  assert.equal(r.card.culinary_uses.blocked_by_safety, true);
  r = validateCard(base(), only1, { tier: "basso", redListed: true });
  assert.equal(r.tier, "alto");
  assert.equal(r.card.culinary_uses.blocked_by_safety, true);
});

test("look-alike: pericolosità decisa dal codice", () => {
  const la = base();
  la.lookalikes = [
    { name: "Conium maculatum", danger: "bassa", claim: c("Conium è molto tossico", ["S2"], "Hemlock (Conium maculatum) is highly toxic") },
    { name: "Inventata sp.", danger: "bassa" },
    { name: "Aethusa cynapium", danger: "alta", claim: c("Simile", ["S1"], "Le foglie formano una rosetta basale") },
    { name: "Hypochaeris radicata", danger: "strana", claim: c("Specie simile", ["S1"], "Alcuni autori citano Hypochaeris radicata come specie simile") },
  ];
  const r = validateCard(la, F, basso, { isRed: (n) => n.startsWith("Con") });
  assert.equal(r.redFlag, true);
  assert.equal(r.tier, "alto");
  assert.deepEqual(r.card.lookalikes.map((l) => l.name), ["Conium maculatum", "Hypochaeris radicata"]);
  assert.equal(r.card.lookalikes[0].danger, "alta");
  assert.equal(r.card.lookalikes[1].danger, "alta", "valore ignoto => prudenza");
  assert.ok(r.dropped.some((d) => d.err === "nome_non_nel_testo_citato"), "Aethusa non è nel testo citato");
  assert.equal(r.card.culinary_uses.blocked_by_safety, true);
});

test("look-alike curati e campo obbligatorio", () => {
  const r = validateCard(base(), only1, basso, { isRed: (n) => n === "Conium maculatum", curatedLookalikes: [{ name: "Conium maculatum", danger: "mortale", note: "n" }] });
  assert.equal(r.redFlag, true);
  assert.equal(r.card.lookalikes_curated.length, 1);
  const b = base(); delete b.lookalikes;
  assert.ok(validateCard(b, only1, basso).blocked.includes("lookalikes_mancante"));
});

test("troppe affermazioni scartate / scheda vuota / sintesi", () => {
  const bad = base(); bad.identification.keys = [1, 2, 3].map(() => c("x", ["S1"], "frase inventata che non esiste"));
  assert.ok(validateCard(bad, only1, basso).blocked.includes("troppe_affermazioni_scartate"));
  const empty = { schema_version: 4, lookalikes: [] };
  const r = validateCard(empty, only1, basso);
  assert.ok(r.blocked.includes("scheda_vuota") && r.blocked.includes("sintesi_mancante"));
});

test("etichette libere non ammesse", () => {
  const b = base(); b.therapeutic_and_medicinal.preparations[0].name = "Vai su http://evil.example";
  assert.equal(validateCard(b, only1, basso).card.therapeutic_and_medicinal.preparations.length, 0);
});
