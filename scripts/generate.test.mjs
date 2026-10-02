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
  const r = spawnSync("node", ["--import", root + "scripts/stub-network.mjs", root + "scripts/generate.mjs"], { env: { ...process.env, DATA_DIR: d, SEED_FILE: join(d, "seed.txt"), LLM_GAP_MS: "0", MAX_PER_RUN: "3", GITHUB_TOKEN: "t", ...extraEnv }, encoding: "utf8" });
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
  assert.equal(idx.length, 1); assert.equal(idx[0].slug, "allium-ursinum");
  assert.match(run({}, d).out, /nessuna scheda|^$|/); // seconda esecuzione: idempotente
  assert.equal(JSON.parse(readFileSync(join(d, "index.json"), "utf8")).length, 1);
});

test("quota LLM esaurita: nessuna scheda, nessun crash, si riprova al prossimo giro", () => {
  const { d, out } = run({ STUB_LLM: "429" });
  assert.match(out, /Quota LLM esaurita/);
  assert.equal(existsSync(join(d, "plants/allium-ursinum.json")), false);
});
