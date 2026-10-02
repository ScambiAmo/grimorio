// Test del Worker con KV e fetch simulati (nessuna rete). Il file sorgente importa JSON (lo gestisce wrangler): qui lo adattiamo.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("../", import.meta.url).pathname;
const src = readFileSync(root + "worker/src/index.js", "utf8")
  .replace(/import taxa from .*;/, `const taxa = JSON.parse(${JSON.stringify(readFileSync(root + "data/taxa_policy.json", "utf8"))});`)
  .replace('"../../lib/policy.js"', JSON.stringify(pathToFileURL(root + "lib/policy.js").href))
  .replace('"../../lib/identify.js"', JSON.stringify(pathToFileURL(root + "lib/identify.js").href));
const tmp = join(mkdtempSync(join(tmpdir(), "w-")), "w.mjs"); writeFileSync(tmp, src);
const worker = (await import(pathToFileURL(tmp).href)).default;

const kvStore = new Map();
const STORE = { get: async (k) => kvStore.get(k) ?? null, put: async (k, v) => void kvStore.set(k, v), delete: async (k) => void kvStore.delete(k),
  list: async ({ prefix = "", limit = 1000 } = {}) => ({ keys: [...kvStore.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit).map((name) => ({ name })) }) };
const env = { STORE, QUEUE_KEY: "k", PLANTNET_API_KEY: "pk", SITE_URL: "https://x.github.io/g", ALLOWED_ORIGIN: "https://x.github.io" };
const calls = [];
globalThis.fetch = async (url, init) => {
  const u = String(url); calls.push(u);
  const R = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
  if (u.includes("my-api.plantnet.org")) return R({ remainingIdentificationRequests: 321, results: [
    { score: 0.91, species: { scientificNameWithoutAuthor: "Allium ursinum", genus: { scientificNameWithoutAuthor: "Allium" } }, gbif: { id: "100" } },
    { score: 0.12, species: { scientificNameWithoutAuthor: "Convallaria majalis", genus: { scientificNameWithoutAuthor: "Convallaria" } }, gbif: { id: "200" } }] });
  if (u.endsWith("/species/100")) return R({ key: 100, kingdom: "Plantae", rank: "SPECIES", canonicalName: "Allium ursinum" });
  if (u.endsWith("/species/200")) return R({ key: 200, kingdom: "Plantae", rank: "SPECIES", canonicalName: "Convallaria majalis" });
  if (u.endsWith("/species/300")) return R({ key: 300, kingdom: "Fungi", rank: "SPECIES", canonicalName: "Amanita phalloides" });
  if (u.endsWith("/data/index.json")) return R([{ slug: "taraxacum-officinale", gbif_key: 999 }]);
  return R({}, 404);
};
const call = (path, init = {}) => worker.fetch(new Request("https://api.test" + path, init), env);
const post = (path, body, h = {}) => call(path, { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(body) });

test("identify: inoltra, risolve GBIF, segnala lista rossa e non espone la chiave", async () => {
  const r = await call("/identify", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=x", "content-length": "100" }, body: "--x--" });
  const j = await r.json();
  assert.equal(j.verdict, "da_affinare"); assert.equal(j.redWarning, true); assert.equal(j.remaining, 321);
  assert.equal(j.candidates[1].red_list, true);
  assert.ok(!JSON.stringify(j).includes("pk"));
  assert.equal((await call("/identify", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 400);
});
test("request: solo piante, dedupe, già presente", async () => {
  assert.equal((await (await post("/request", { gbif_key: 300 })).json()).status, "non_ammessa");
  assert.equal((await (await post("/request", { gbif_key: "x" })).json()).error, "richiesta_non_valida");
  assert.equal((await (await post("/request", { gbif_key: 100 })).json()).status, "accodata");
  assert.equal((await (await post("/request", { gbif_key: 100 })).json()).status, "in_coda");
  assert.equal((await (await call("/status?gbif_key=100")).json()).status, "in_coda");
});
test("report: validazione e nessun dato personale salvato", async () => {
  assert.equal((await post("/report", { slug: "../x", message: "m" })).status, 400);
  assert.equal((await post("/report", { slug: "allium-ursinum", message: "x".repeat(501) })).status, 400);
  assert.equal((await post("/report", { slug: "allium-ursinum", section: "Tossicità", message: "errore" })).status, 200);
  const stored = [...kvStore.entries()].filter(([k]) => k.startsWith("r:"));
  assert.equal(stored.length, 1); assert.deepEqual(Object.keys(JSON.parse(stored[0][1])).sort(), ["message", "section", "slug"]);
});
test("queue: protetta da Bearer, ack e stato fallita", async () => {
  assert.equal((await call("/queue")).status, 401);
  const q = await (await call("/queue", { headers: { authorization: "Bearer k" } })).json();
  assert.equal(q.requests.length, 1); assert.equal(q.reports.length, 1);
  await post("/queue/ack", { keys: [q.requests[0].kv], failed: [{ gbif_key: 100, reason: "x" }] }, { authorization: "Bearer k" });
  assert.equal((await (await call("/status?gbif_key=100")).json()).status, "fallita");
});
test("nessun log dell'IP: il Worker non lo legge senza binding RL", async () => {
  assert.ok(!readFileSync(root + "worker/src/index.js", "utf8").includes("console.log"));
});
