#!/usr/bin/env node
// scripts/generate.mjs — genera/rigenera schede in data/plants/ (gira in GitHub Actions, Node 22, nessuna dipendenza).
// Coda: (1) richieste degli utenti dal Worker, (2) rigenerazioni da segnalazioni, (3) seed/species.txt.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { validateCard } from "../lib/validator.js";
import { makePolicy, slugOf } from "../lib/policy.js";
import { SYSTEM, userPrompt } from "../lib/prompt.js";

const env = process.env;
const UA = `GrimorioBotanico/4 (https://github.com/${env.GITHUB_REPOSITORY || "owner/grimorio"}; biblioteca botanica aperta)`;
const BASE = env.LLM_BASE_URL || "https://models.github.ai/inference";
const MODEL = env.LLM_MODEL || "openai/gpt-4.1-mini"; // [da verificare nel catalogo: GET https://models.github.ai/catalog/models]
const TOKEN = env.LLM_API_KEY || env.GITHUB_TOKEN;
const MAX = Number(env.MAX_PER_RUN || 4), GAP = Number(env.LLM_GAP_MS || 8000), BUDGET = Number(env.FRAG_BUDGET || 14000);
const DATA = env.DATA_DIR ? env.DATA_DIR.replace(/\/?$/, "/") : new URL("../data/", import.meta.url).pathname;
const SEED = env.SEED_FILE || new URL("../seed/species.txt", import.meta.url).pathname;
const readJson = (f, d) => (existsSync(DATA + f) ? JSON.parse(readFileSync(DATA + f, "utf8")) : d);
const writeJson = (f, v) => writeFileSync(DATA + f, JSON.stringify(v, null, 1) + "\n");
const policy = makePolicy(readJson("taxa_policy.json", {}));
const curatedMap = readJson("lookalikes.json", {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strip = (h) => String(h ?? "").replace(/<[^>]+>/g, "").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
class Quota extends Error {}

async function jget(url) {
  try { const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(20000) }); return r.ok ? await r.json() : null; }
  catch { return null; }
}

// ---------- GBIF: nome accettato, famiglia, nomi comuni, sinonimi (dal codice, non dall'LLM)
async function gbifResolve({ key, name }) {
  let u;
  if (key) u = await jget(`https://api.gbif.org/v1/species/${key}`);
  else {
    const m = await jget(`https://api.gbif.org/v1/species/match?kingdom=Plantae&name=${encodeURIComponent(name)}`);
    if (!m || m.matchType === "NONE" || !m.usageKey) return null;
    u = await jget(`https://api.gbif.org/v1/species/${m.usageKey}`);
  }
  if (u?.acceptedKey) u = await jget(`https://api.gbif.org/v1/species/${u.acceptedKey}`);
  if (!u || u.kingdom !== "Plantae" || u.rank !== "SPECIES") return null;
  const [vn, sy] = await Promise.all([jget(`https://api.gbif.org/v1/species/${u.key}/vernacularNames?limit=200`), jget(`https://api.gbif.org/v1/species/${u.key}/synonyms?limit=50`)]);
  const common = { it: [], en: [] };
  for (const v of vn?.results ?? []) { const l = v.language === "ita" ? "it" : v.language === "eng" ? "en" : null; const n = v.vernacularName?.trim(); if (l && n && !common[l].includes(n) && common[l].length < 8) common[l].push(n); }
  return { gbif_key: u.key, name: u.canonicalName || u.scientificName, family: u.family ?? null, common, synonyms: [...new Set((sy?.results ?? []).map((x) => x.canonicalName).filter(Boolean))].slice(0, 30) };
}

// ---------- Fonti
async function wikidata(key) {
  const s = await jget(`https://www.wikidata.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent("haswbstatement:P846=" + key)}&format=json`);
  const qid = s?.query?.search?.[0]?.title; if (!qid) return null;
  const e = (await jget(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=sitelinks|claims|labels&sitefilter=itwiki|enwiki&languages=it|en&format=json`))?.entities?.[qid];
  return e ? { qid, it: e.sitelinks?.itwiki?.title, en: e.sitelinks?.enwiki?.title, image: e.claims?.P18?.[0]?.mainsnak?.datavalue?.value, labels: { it: e.labels?.it?.value, en: e.labels?.en?.value } } : null;
}
function pickSections(t, max) {
  const [intro, ...rest] = t.split(/\n(?==+ [^\n]+ =+\n)/);
  const pri = (h) => (/tossic|veleno|toxic|poison|\busi\b|\buso\b|uses|habitat|descrizion|description|distribuzion|medicin|culinar|cucina|commestib/i.test(h.split("\n")[0]) ? 0 : 1);
  return [intro, ...rest.filter((x) => pri(x) === 0), ...rest.filter((x) => pri(x) === 1)].join("\n").slice(0, max);
}
async function wikipedia(lang, title, max) {
  const j = await jget(`https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=${encodeURIComponent(title)}`);
  const p = Object.values(j?.query?.pages ?? {})[0];
  if (!p || p.missing !== undefined || !p.extract) return null;
  return { kind: "wikipedia", label: `wikipedia ${lang}`, text: pickSections(p.extract, max), url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, "_"))}`, title: p.title, license: "CC BY-SA 4.0" };
}
async function europepmc(name) {
  const q = `TITLE_ABS:"${name}" AND (toxicity OR poisoning OR "traditional use")`;
  const j = await jget(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(q)}&format=json&pageSize=4&resultType=core`);
  return (j?.resultList?.result ?? []).filter((r) => r.abstractText && r.pmid).slice(0, 3)
    .map((r) => ({ kind: "europepmc", label: `pubmed PMID ${r.pmid}`, text: strip(r.abstractText).slice(0, 1200), url: `https://europepmc.org/article/MED/${r.pmid}`, pmid: String(r.pmid), title: r.title, license: "abstract usato come input, non riprodotto" }));
}
async function commonsImage(file) {
  const j = await jget(`https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent("File:" + file)}&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=800&format=json`);
  const ii = Object.values(j?.query?.pages ?? {})[0]?.imageinfo?.[0]; if (!ii) return null;
  const m = ii.extmetadata ?? {}, lic = m.LicenseShortName?.value ?? "";
  if (!/^(CC BY(-SA)? \d|CC0|Public domain|PD)/i.test(lic)) return null;
  return { url: ii.thumburl || ii.url, author: strip(m.Artist?.value) || "autore non indicato", license: lic, license_url: m.LicenseUrl?.value ?? null, source_page: ii.descriptionurl };
}

// ---------- LLM (API compatibile OpenAI; default GitHub Models col GITHUB_TOKEN dell'Action)
async function llm(system, user) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}`, "user-agent": UA },
    body: JSON.stringify({ model: MODEL, temperature: 0.1, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    signal: AbortSignal.timeout(120000),
  });
  if (res.status === 429) throw new Quota("429");
  if (!res.ok) throw new Error(`LLM ${res.status} ${(await res.text()).slice(0, 200)}`);
  const raw = await res.text();
  let data; try { data = JSON.parse(raw); } catch { throw new Error(`LLM: risposta non JSON (HTTP ${res.status}, ${res.headers.get("content-type")}, url ${res.url}): ${JSON.stringify(raw.slice(0, 160))}`); }
  const txt = data.choices?.[0]?.message?.content ?? "";
  try { return JSON.parse(txt.replace(/^\s*```(?:json)?|```\s*$/g, "").trim()); } catch { throw new Error(`LLM: il modello non ha risposto in JSON (${data.model ?? "?"}): ${JSON.stringify(String(txt).slice(0, 120))}`); }
}

// ---------- Una scheda
async function generateOne(t) {
  const g = await gbifResolve(t);
  if (!g) return { ok: false, reason: "non_pianta_o_non_risolta_da_gbif" };
  const slug = slugOf(g.name), file = `plants/${slug}.json`, prev = readJson(file, null);
  if (prev && !t.force) return { ok: true, skipped: true, slug };

  const wd = await wikidata(g.gbif_key);
  const raw = [await wikipedia("it", wd?.it || g.name, Math.round(BUDGET * 0.4)), await wikipedia("en", wd?.en || g.name, Math.round(BUDGET * 0.3)), ...(await europepmc(g.name))].filter(Boolean);
  const names = [...(wd?.labels?.it ? [wd.labels.it] : []), ...g.common.it.slice(0, 5), ...g.common.en.slice(0, 5)];
  if (names.length) raw.push({ kind: "wikidata", label: "wikidata", text: `Nomi: ${names.join(", ")}.`, url: `https://www.wikidata.org/wiki/${wd?.qid ?? ""}`, title: "Wikidata", license: "CC0" });
  if (!raw.some((f) => f.kind === "wikipedia" || f.kind === "europepmc")) return { ok: false, reason: "nessuna_fonte_testuale" };
  const frags = raw.map((f, i) => ({ ...f, key: `S${i + 1}` }));
  const fragMap = Object.fromEntries(frags.map((f) => [f.key, f.text]));

  const pol = policy.decide(g.name);
  await sleep(GAP);
  const card = await llm(SYSTEM, userPrompt(g.name, frags));
  const v = validateCard(card, fragMap, { tier: pol.tier, redListed: policy.isRed(g.name) }, { isRed: policy.isRed, curatedLookalikes: curatedMap[g.name] ?? [] });
  if (v.blocked.length) return { ok: false, reason: v.blocked.join(",") };

  const cited = new Set(JSON.stringify(v.card).match(/"S\d+"/g)?.map((x) => x.slice(1, -1)));
  const img = wd?.image ? await commonsImage(wd.image) : null;
  writeJson(file, {
    gbif_key: g.gbif_key, accepted_name: g.name, family: g.family, common_names: g.common, synonyms: g.synonyms,
    safety_tier: v.tier, status: prev?.status === "ritirata" ? "ritirata" : "auto", is_protected: pol.protected || !!v.card.legal.protection,
    content_license: "CC BY-SA 4.0", version: (prev?.version ?? 0) + 1, generated_at: new Date().toISOString(), model: MODEL,
    sources: frags.filter((f) => cited.has(f.key) || f.kind === "wikidata").map(({ key, kind, url, pmid, title, license }) => ({ key, kind, url, pmid, title, license })),
    images: img ? [img] : [], auto_checks: { dropped: v.dropped, red_flag: v.redFlag }, content: v.card,
  });
  return { ok: true, slug };
}

function rebuildIndex() {
  mkdirSync(DATA + "plants", { recursive: true });
  const rows = readdirSync(DATA + "plants").filter((f) => f.endsWith(".json")).map((f) => {
    const p = readJson("plants/" + f); return { slug: f.slice(0, -5), gbif_key: p.gbif_key, name: p.accepted_name, family: p.family, common_names: p.common_names, synonyms: p.synonyms, tier: p.safety_tier, status: p.status, protected: p.is_protected };
  }).sort((a, b) => a.name.localeCompare(b.name));
  writeJson("index.json", rows); return rows;
}

// ---------- Coda
async function worker(path, init) {
  if (!env.WORKER_URL || !env.QUEUE_KEY) return null;
  try { const r = await fetch(env.WORKER_URL + path, { ...init, headers: { authorization: `Bearer ${env.QUEUE_KEY}`, "content-type": "application/json" }, signal: AbortSignal.timeout(15000) }); return r.ok ? await r.json() : null; } catch { return null; }
}

async function main() {
  const index = rebuildIndex(), have = new Set(index.map((p) => p.slug));
  const failures0 = readJson("failures.json", {}), failures = Array.isArray(failures0) ? {} : failures0; // (era un array: i fallimenti non venivano salvati)
  const tasks = [], ack = [], failed = [];
  const q = (await worker("/queue")) ?? { requests: [], reports: [] };
  for (const r of q.requests) tasks.push({ key: r.gbif_key, name: r.name, kv: r.kv });
  const bySlug = {};
  for (const r of q.reports) (bySlug[r.slug] ??= []).push(r.kv);
  for (const [slug, kvs] of Object.entries(bySlug)) if (kvs.length >= 3 && have.has(slug)) { const p = readJson(`plants/${slug}.json`); tasks.push({ key: p.gbif_key, name: p.accepted_name, force: true, reportKvs: kvs }); }
  if (existsSync(SEED))
    for (const line of readFileSync(SEED, "utf8").split("\n")) {
      const n = line.trim(); if (!n || n.startsWith("#") || have.has(slugOf(n))) continue;
      const f = failures[n]; if (f && f.n >= 3 && Date.now() - Date.parse(f.last) < 14 * 864e5) continue;
      tasks.push({ name: n, seed: true });
    }

  let llmCalls = 0, okN = 0, consecutiveErr = 0; const problems = [];
  for (const t of tasks) {
    if (llmCalls >= MAX) break;
    try {
      const r = await generateOne(t);
      if (!r.skipped) llmCalls++;
      if (t.kv) ack.push(t.kv); if (t.reportKvs) ack.push(...t.reportKvs);
      consecutiveErr = 0;
      if (r.ok) { okN++; delete failures[t.name ?? t.key]; console.log("OK", r.slug, r.skipped ? "(già presente)" : ""); }
      else { console.log("FALLITA", t.name ?? t.key, r.reason); problems.push(`${t.name ?? t.key}: ${r.reason}`); const k = t.name ?? String(t.key); failures[k] = { n: (failures[k]?.n ?? 0) + 1, last: new Date().toISOString(), reason: r.reason }; if (t.kv) failed.push({ gbif_key: t.key, reason: r.reason }); }
    } catch (e) {
      if (e instanceof Quota) { console.log("Quota LLM esaurita: mi fermo, riprenderò al prossimo giro."); break; }
      console.log("ERRORE", t.name ?? t.key, e.message); problems.push(`${t.name ?? t.key}: ERRORE ${e.message}`);
      if (++consecutiveErr >= 3) { console.log("Tre errori di fila: mi fermo (inutile insistere)."); break; }
    }
  }
  rebuildIndex(); writeJson("failures.json", failures);
  const esc = (x) => String(x).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  console.log(`::notice::generate: ${okN} schede ok, ${problems.length} problemi su ${tasks.length} richieste in coda`);
  for (const x of problems.slice(0, 6)) console.log(`::warning::generate: ${esc(x).slice(0, 280)}`);
  if (ack.length || failed.length) await worker("/queue/ack", { method: "POST", body: JSON.stringify({ keys: ack, failed }) });
}
main().catch((e) => { console.error(e); process.exit(0); }); // exit 0: i progressi parziali vengono comunque committati
