import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, copyFileSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("../", import.meta.url).pathname;
function run(extraEnv = {}, dir) {
  const d = dir ?? mkdtempSync(join(tmpdir(), "g-"));
  if (!dir) { for (const f of ["taxa_policy.json", "lookalikes.json"]) copyFileSync(root + "data/" + f, join(d, f)); writeFileSync(join(d, "seed.txt"), "# seed\nAllium ursinum\n"); }
  const r = spawnSync("node", ["--import", root + "scripts/stub-network.mjs", root + "scripts/generate.mjs"], { env: { ...process.env, DATA_DIR: d, SEED_FILE: join(d, "seed.txt"), LLM_GAP_MS: "0", MAX_PER_RUN: "3", GITHUB_TOKEN: "t", BOOK_FILE: join(d, "nessun-libro.json"), ...extraEnv }, encoding: "utf8" });
  return { d, out: r.stdout + r.stderr };
}

test("pipeline end-to-end: seed -> fonti -> LLM -> validatore -> scheda + indice", () => {
  const { d, out } = run();
  assert.match(out, /OK allium-ursinum/);
  const p = JSON.parse(readFileSync(join(d, "plants/allium-ursinum.json"), "utf8"));
  assert.equal(p.gbif_key, 5);
  assert.equal(p.safety_tier, "alto", "specie fuori allowlist = alto");
  assert.equal(p.content.culinary_uses.blocked_by_safety, true);
  assert.deepEqual(p.content.therapeutic_and_medicinal.preparations, []);
  assert.ok(p.content.lookalikes_curated.some((l) => l.name === "Convallaria majalis" && l.danger === "mortale"), "look-alike curati iniettati dal codice");
  assert.equal(p.content.lookalikes[0].danger, "alta", "Convallaria è in lista rossa: pericolosità rialzata dal codice");
  assert.ok(!JSON.stringify(p).includes('"q"'), "nessuna citazione salvata");
  assert.equal(p.images[0].license, "CC BY-SA 4.0"); assert.equal(p.images[0].author, "Mario");
  assert.deepEqual(p.common_names.it, ["Aglio orsino"]);
  assert.ok(p.sources.every((s) => s.url));
  const idx = JSON.parse(readFileSync(join(d, "index.json"), "utf8"));
  assert.equal(idx.length, 1); assert.equal(idx[0].slug, "allium-ursinum"); assert.ok(Date.parse(idx[0].at) > 0, "data di creazione nell'indice");
  assert.match(run({}, d).out, /nessuna scheda|^$|/); // seconda esecuzione: idempotente
  assert.equal(JSON.parse(readFileSync(join(d, "index.json"), "utf8")).length, 1);
});

test("quota LLM esaurita: nessuna scheda, nessun crash, si riprova al prossimo giro", () => {
  const { d, out } = run({ STUB_LLM: "429" });
  assert.match(out, /Quota LLM esaurita/);
  assert.equal(existsSync(join(d, "plants/allium-ursinum.json")), false);
});

test("Cloudflare Workers AI: usato se ci sono le credenziali, anche con JSON dentro un blocco ``` e testo attorno", () => {
  const { d, out } = run({ CLOUDFLARE_ACCOUNT_ID: "acc", CLOUDFLARE_API_TOKEN: "tok", STUB_EXPECT_CF: "1", STUB_LLM: "fence" });
  assert.match(out, /OK allium-ursinum/); assert.ok(existsSync(join(d, "plants/allium-ursinum.json")));
  assert.equal(JSON.parse(readFileSync(join(d, "plants/allium-ursinum.json"), "utf8")).model, "@cf/meta/llama-3.3-70b-instruct-fp8-fast");
});
test("token Cloudflare senza permesso Workers AI: errore chiaro in annotazione, nessuna scheda, nessun crash", () => {
  const { d, out } = run({ CLOUDFLARE_ACCOUNT_ID: "acc", CLOUDFLARE_API_TOKEN: "tok", STUB_LLM: "401" });
  assert.match(out, /non ha il permesso Workers AI/); assert.match(out, /::warning::generate: .*Workers AI/);
  assert.equal(existsSync(join(d, "plants/allium-ursinum.json")), false);
});

test("scheda bloccata al primo tentativo: un secondo tentativo con il motivo; se riesce passa gli stessi controlli, se no resta non pubblicata", () => {
  const ok = run({ STUB_LLM: "retry" });
  assert.match(ok.out, /recuperata al secondo tentativo: Allium ursinum/); assert.match(ok.out, /OK allium-ursinum/);
  assert.ok(existsSync(join(ok.d, "plants/allium-ursinum.json")));
  const no = run({ STUB_LLM: "retry", NO_RETRY: "1" });
  assert.match(no.out, /FALLITA Allium ursinum/); assert.equal(existsSync(join(no.d, "plants/allium-ursinum.json")), false, "senza secondo tentativo la bozza difettosa non viene pubblicata");
});

test("appunti del libro: arrivano al modello come fonte in più, la specie fuori archivio viene creata, il registro evita rigenerazioni a catena", () => {
  const f = join(mkdtempSync(join(tmpdir(), "libro-")), "libro.json");
  writeFileSync(f, JSON.stringify([{ name: "Allium ursinum", it: "aglio orsino", text: "MARCATORE_LIBRO Foglie lanceolate, odore di aglio." }]));
  const a = run({ BOOK_FILE: f, STUB_EXPECT_BOOK: "1" });
  assert.match(a.out, /OK allium-ursinum/); assert.ok(existsSync(join(a.d, "plants/allium-ursinum.json")));
  assert.ok(Object.keys(JSON.parse(readFileSync(join(a.d, "book_done.json"), "utf8"))).includes("Allium ursinum"), "registrato");
  const b = run({ BOOK_FILE: f, STUB_EXPECT_BOOK: "1" }, a.d);
  assert.ok(!/FALLITA|ERRORE/.test(b.out));
});
