// worker/src/index.js — Cloudflare Worker (piano gratuito). Nessun log, nessun salvataggio di foto, IP o utenti.
// /identify  : inoltra in streaming il multipart a Pl@ntNet (la chiave resta qui) e arricchisce la risposta
// /request   : mette in coda UNA specie (dopo aver verificato su GBIF che sia una pianta)
// /report    : segnalazione anonima (solo slug, sezione, testo breve)
// /status    : stato di una richiesta
// /queue*    : solo per la GitHub Action (Bearer QUEUE_KEY)
import taxa from "../../data/taxa_policy.json";
import { makePolicy } from "../../lib/policy.js";
import { verdictOf } from "../../lib/identify.js";

const policy = makePolicy(taxa);
const MAX_BODY = 8 * 1024 * 1024, MAX_PENDING = 60, MAX_REPORTS = 300;

const cors = (env) => ({ "access-control-allow-origin": env.ALLOWED_ORIGIN || "*", "access-control-allow-headers": "content-type,x-turnstile", "access-control-allow-methods": "GET,POST,OPTIONS", "cache-control": "no-store" });
const json = (env, body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors(env), "content-type": "application/json" } });

async function guard(req, env) {
  if (env.TURNSTILE_SECRET) { // senza remoteip: non inviamo l'IP a nessuno
    const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: req.headers.get("x-turnstile") || "" });
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    if (!(await r.json()).success) return "verifica_anti_bot";
  }
  if (env.RL) { // Rate Limiting binding [da verificare disponibilità/sintassi nel piano gratuito]; la chiave non viene salvata da noi
    const { success } = await env.RL.limit({ key: req.headers.get("cf-connecting-ip") || "anon" });
    if (!success) return "troppe_richieste";
  }
  return null;
}

const gj = async (url) => { try { const r = await fetch(url, { cf: { cacheTtl: 86400 } }); return r.ok ? r.json() : null; } catch { return null; } };
async function gbifAccepted(key) {
  let u = await gj(`https://api.gbif.org/v1/species/${key}`);
  if (u?.acceptedKey) u = await gj(`https://api.gbif.org/v1/species/${u.acceptedKey}`);
  return u && u.kingdom === "Plantae" && u.rank === "SPECIES" ? { key: u.key, name: u.canonicalName || u.scientificName } : null;
}

async function identify(req, env) {
  const len = Number(req.headers.get("content-length") || 0);
  if (!(req.headers.get("content-type") || "").startsWith("multipart/form-data") || !len || len > MAX_BODY) return json(env, { error: "richiesta_non_valida" }, 400);
  const url = `https://my-api.plantnet.org/v2/identify/all?nb-results=5&lang=it&api-key=${encodeURIComponent(env.PLANTNET_API_KEY)}`;
  const r = await fetch(url, { method: "POST", body: req.body, headers: { "content-type": req.headers.get("content-type") } }); // pass-through: CPU minima
  if (r.status === 404) return json(env, { verdict: "non_pianta" });
  if (r.status === 429) return json(env, { error: "quota_esaurita" }, 429);
  if (!r.ok) return json(env, { error: "servizio_non_disponibile" }, 502);
  const j = await r.json();
  const top = (j.results ?? []).filter((x) => x.score >= 0.1 || x === j.results[0]).slice(0, 5);
  const candidates = await Promise.all(top.map(async (x) => {
    const acc = x.gbif?.id ? await gbifAccepted(x.gbif.id) : null;
    const name = acc?.name || x.species?.scientificNameWithoutAuthor;
    return { name, gbif_key: acc?.key ?? null, score: x.score, common: (x.species?.commonNames ?? []).slice(0, 3),
      red_list: policy.isRed(name) || policy.isRed(x.species?.genus?.scientificNameWithoutAuthor), images: (x.images ?? []).slice(0, 2).map((i) => i.url?.s).filter(Boolean) };
  }));
  return json(env, { ...verdictOf(candidates), candidates, remaining: j.remainingIdentificationRequests ?? null });
}

async function requestCard(req, env) {
  const { gbif_key } = await req.json().catch(() => ({}));
  if (!Number.isInteger(gbif_key)) return json(env, { error: "richiesta_non_valida" }, 400);
  const acc = await gbifAccepted(gbif_key);
  if (!acc) return json(env, { status: "non_ammessa", motivo: "non è una specie vegetale riconosciuta da GBIF" });
  const idx = await gj(`${env.SITE_URL}/data/index.json`);
  const hit = Array.isArray(idx) && idx.find((p) => p.gbif_key === acc.key);
  if (hit) return json(env, { status: "gia_presente", slug: hit.slug });
  if (await env.STORE.get(`q:${acc.key}`)) return json(env, { status: "in_coda" });
  if ((await env.STORE.list({ prefix: "q:", limit: MAX_PENDING })).keys.length >= MAX_PENDING) return json(env, { status: "coda_piena" });
  await env.STORE.put(`q:${acc.key}`, JSON.stringify({ gbif_key: acc.key, name: acc.name, ts: Date.now() }), { expirationTtl: 7 * 86400 });
  return json(env, { status: "accodata", name: acc.name });
}

async function report(req, env) {
  const b = await req.json().catch(() => ({}));
  if (!/^[a-z-]{3,80}$/.test(b.slug ?? "") || typeof b.message !== "string" || !b.message.trim() || b.message.length > 500) return json(env, { error: "richiesta_non_valida" }, 400);
  if ((await env.STORE.list({ prefix: "r:", limit: MAX_REPORTS })).keys.length >= MAX_REPORTS) return json(env, { error: "troppe_segnalazioni" }, 429);
  const id = `r:${Date.now()}:${crypto.randomUUID().slice(0, 8)}`;
  await env.STORE.put(id, JSON.stringify({ slug: b.slug, section: String(b.section ?? "").slice(0, 60), message: b.message.trim() }), { expirationTtl: 30 * 86400 });
  return json(env, { ok: true });
}

async function queueRoutes(req, env, path) {
  if (req.headers.get("authorization") !== `Bearer ${env.QUEUE_KEY}` || !env.QUEUE_KEY) return json(env, { error: "non_autorizzato" }, 401);
  if (path === "/queue") {
    const read = async (prefix) => Promise.all((await env.STORE.list({ prefix })).keys.map(async (k) => ({ kv: k.name, ...JSON.parse((await env.STORE.get(k.name)) || "{}") })));
    return json(env, { requests: await read("q:"), reports: await read("r:") });
  }
  if (path === "/queue/ack") {
    const { keys = [], failed = [] } = await req.json().catch(() => ({}));
    await Promise.all(keys.filter((k) => /^[qr]:/.test(k)).map((k) => env.STORE.delete(k)));
    await Promise.all(failed.map((f) => env.STORE.put(`f:${f.gbif_key}`, String(f.reason).slice(0, 100), { expirationTtl: 7 * 86400 })));
    return json(env, { ok: true });
  }
  return json(env, { error: "non_trovato" }, 404);
}

export default {
  async fetch(req, env) {
    const { pathname: path, searchParams } = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env) });
    try {
      if (path.startsWith("/queue")) return await queueRoutes(req, env, path);
      if (path === "/health") return json(env, { ok: true });
      if (path === "/status") { const k = Number(searchParams.get("gbif_key")); return json(env, { status: (await env.STORE.get(`q:${k}`)) ? "in_coda" : (await env.STORE.get(`f:${k}`)) ? "fallita" : "non_in_coda" }); }
      if (req.method !== "POST") return json(env, { error: "non_trovato" }, 404);
      const blocked = await guard(req, env);
      if (blocked) return json(env, { error: blocked }, 429);
      if (path === "/identify") return await identify(req, env);
      if (path === "/request") return await requestCard(req, env);
      if (path === "/report") return await report(req, env);
      return json(env, { error: "non_trovato" }, 404);
    } catch { return json(env, { error: "errore_interno" }, 500); }
  },
};
