// lib/validator.js — validazione DETERMINISTICA della scheda (nessuna IA). Node 22 / Workers / Deno.
// Input : raw (JSON dell'LLM, schema_version 4), fragments {S1:"testo",...},
//         policy {tier, redListed}, opts {isRed(name)->bool, curatedLookalikes:[{name,danger,note}]}
// Output: { card (ricostruita da allowlist, senza "q"), dropped[], blocked[], redFlag, tier }
// LIMITE NOTO: verifica che ogni affermazione sia TRACCIABILE (citazione ritrovata nella fonte, numeri presenti),
// non che la traduzione/parafrasi sia semanticamente fedele. Per questo restano regole di tier, avvisi e segnalazioni.

const norm = (s) => String(s ?? "").toLowerCase()
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/(\d),(\d)/g, "$1.$2")
  .replace(/[^\p{L}\p{N}.\s]/gu, " ")
  .replace(/(?<!\d)\.|\.(?!\d)/g, " ")
  .replace(/\s+/g, " ").trim();

const cache = new Map();
const prep = (frag) => {
  let v = cache.get(frag);
  if (!v) { const n = norm(frag); v = { n: ` ${n} `, w: n ? n.split(" ") : [] }; if (cache.size > 64) cache.clear(); cache.set(frag, v); }
  return v;
};

// La citazione "q" deve comparire nel frammento: alla lettera, oppure con >=90% dei bigrammi dentro UNA finestra locale
// (impedisce di "cucire" insieme pezzi lontani).
export function quoteInFragment(q, frag) {
  const nq = norm(q), qw = nq ? nq.split(" ") : [];
  if (qw.length < 3 || qw.length > 30) return false;
  const f = prep(frag);
  if (f.n.includes(` ${nq} `)) return true;
  const qb = new Set();
  for (let i = 0; i < qw.length - 1; i++) qb.add(qw[i] + " " + qw[i + 1]);
  const need = Math.ceil(0.9 * (qw.length - 1)), win = Math.ceil((qw.length - 1) * 1.3) + 1;
  const pre = [0];
  for (let i = 0; i < f.w.length - 1; i++) pre.push(pre[i] + (qb.has(f.w[i] + " " + f.w[i + 1]) ? 1 : 0));
  for (let s = 0; s < pre.length - 1; s++) if (pre[Math.min(s + win, pre.length - 1)] - pre[s] >= need) return true;
  return false;
}

const numbersIn = (s) => norm(s).match(/\d+(?:\.\d+)?/g) || [];
const BAD_T = /<|>|https?:\/\/|www\./i;
const HEALTH = /\b(cura|curare|guarisce|guarire|guarigione|rimedio|miracolos\w*|efficace)\b/;
const TOX_WORDS = /(tossic|velen|poison|toxic|intossic|avvelen|alcaloid|alkaloid|cardiotox|epatotox|hepatotox|neurotox|lethal|letal|fatal|mortal|ossalat|oxalat|cardiac glycoside|glicosidi cardi)/i;

// Un'affermazione {t, s:[...], q} è valida se: testo ammesso, fonti esistenti, q è nel frammento citato,
// ogni numero di t compare (come numero intero token) nella citazione o nel frammento.
export function checkClaim(c, fragments) {
  if (!c || typeof c.t !== "string" || !c.t.trim()) return "vuota";
  if (c.t.length > 400) return "troppo_lunga";
  if (BAD_T.test(c.t)) return "contenuto_non_ammesso";
  if (HEALTH.test(norm(c.t))) return "claim_sanitario";
  if (!Array.isArray(c.s) || !c.s.length) return "senza_fonte";
  if (c.s.some((k) => typeof k !== "string" || !Object.hasOwn(fragments, k) || typeof fragments[k] !== "string")) return "fonte_inesistente";
  const frs = c.s.map((k) => fragments[k]);
  if (typeof c.q !== "string" || !frs.some((f) => quoteInFragment(c.q, f))) return "citazione_non_trovata";
  const have = new Set(numbersIn(frs.join(" ") + " " + c.q));
  for (const n of numbersIn(c.t)) if (!have.has(n)) return "numero_non_in_fonte";
  return null;
}

const RANK = { bassa: 0, alta: 1, mortale: 2 };
const label = (v, max) => (typeof v === "string" && v.trim() && v.length <= max && !BAD_T.test(v) ? v.trim() : null);

export function validateCard(raw, fragments, policy = { tier: "alto", redListed: false }, opts = {}) {
  const dropped = [], blocked = [];
  if (!raw || typeof raw !== "object" || raw.schema_version !== 4)
    return { card: null, dropped, blocked: ["schema_non_conforme"], redFlag: false, tier: "alto" };

  let kept = 0;
  const claim = (c, path) => {
    if (c == null) return null;
    const err = checkClaim(c, fragments);
    if (err) { dropped.push({ path, err, t: String(c?.t ?? "").slice(0, 120) }); return null; }
    kept++;
    return { t: c.t.trim(), s: [...new Set(c.s)] }; // "q" NON viene salvata
  };
  const claims = (a, path) => (Array.isArray(a) ? a : []).map((c, i) => claim(c, `${path}[${i}]`)).filter(Boolean);
  const withClaim = (a, path, extra) => (Array.isArray(a) ? a : []).map((x, i) => {
    const c = claim(x?.claim, `${path}[${i}].claim`); const e = extra(x);
    return c && e ? { ...e, claim: c } : null;
  }).filter(Boolean);

  // Ricostruzione da ALLOWLIST: qualunque campo non previsto (es. "dose", "note") sparisce.
  const r = raw, id = r.identification ?? {}, med = r.therapeutic_and_medicinal ?? {}, cul = r.culinary_uses ?? {};
  const out = {
    schema_version: 4,
    summary: claim(r.summary, "summary"),
    identification: {
      keys: claims(id.keys, "identification.keys"),
      habitat: claim(id.habitat, "identification.habitat"),
      distribution: claim(id.distribution, "identification.distribution"),
      season: { flowering: claim(id.season?.flowering, "season.flowering"), harvest: claim(id.season?.harvest, "season.harvest") },
    },
    toxicity: { claims: claims(r.toxicity?.claims, "toxicity.claims") },
    warnings: claims(r.warnings, "warnings"),
    therapeutic_and_medicinal: {
      active_principles: claims(med.active_principles, "med.active_principles"),
      traditional_uses: claims(med.traditional_uses, "med.traditional_uses"),
      contraindications: claims(med.contraindications, "med.contraindications"),
      interactions: claims(med.interactions, "med.interactions"),
      preparations: withClaim(med.preparations, "med.preparations", (x) => { const name = label(x?.name, 60); return name ? { name, part: label(x?.part, 40) } : null; }),
    },
    culinary_uses: {
      edible_parts: withClaim(cul.edible_parts, "culinary.edible_parts", (x) => { const part = label(x?.part, 40); return part ? { part, season: label(x?.season, 40) } : null; }),
      flavor_profile: claims(cul.flavor_profile, "culinary.flavor_profile"),
      preparation_effects: claims(cul.preparation_effects, "culinary.preparation_effects"),
      pairings: claims(cul.pairings, "culinary.pairings"),
    },
    legal: { protection: claim(r.legal?.protection, "legal.protection") },
  };

  // Look-alike: campo obbligatorio; nome presente nel testo citato; pericolosità decisa/rialzata dal CODICE
  let redFlag = !!policy.redListed;
  if (!Array.isArray(r.lookalikes)) { blocked.push("lookalikes_mancante"); out.lookalikes = []; }
  else {
    out.lookalikes = r.lookalikes.map((l, i) => {
      const name = label(l?.name, 80), c = claim(l?.claim, `lookalikes[${i}].claim`);
      if (!name || !c) return null;
      const g = norm(name).split(" ")[0];
      if (!c.s.some((k) => prep(fragments[k]).n.includes(` ${g}`))) { dropped.push({ path: `lookalikes[${i}]`, err: "nome_non_nel_testo_citato", t: name }); kept--; return null; }
      let danger = Object.hasOwn(RANK, l.danger) ? l.danger : "alta"; // valore ignoto => prudenza
      if (opts.isRed?.(name)) { redFlag = true; if (RANK[danger] < 1) danger = "alta"; }
      return { name, danger, claim: c, distinguishing_features: claims(l.distinguishing_features, `lookalikes[${i}].features`) };
    }).filter(Boolean);
  }
  // Look-alike curati (lista del repo, non dell'LLM)
  out.lookalikes_curated = (opts.curatedLookalikes ?? []).map((l) => {
    if (opts.isRed?.(l.name)) redFlag = true;
    return { name: l.name, danger: Object.hasOwn(RANK, l.danger) ? l.danger : "alta", note: l.note ?? "" };
  });

  if (!out.summary) blocked.push("sintesi_mancante");
  const total = dropped.length + kept;
  if (kept <= 0) blocked.push("scheda_vuota");
  else if (dropped.length / total > 0.4) blocked.push("troppe_affermazioni_scartate");

  // Tossicità: se un frammento ne parla la sezione deve avere contenuto; altrimenti nota fissa
  const fragsTalkTox = Object.values(fragments).some((t) => TOX_WORDS.test(String(t)));
  if (fragsTalkTox && out.toxicity.claims.length === 0) blocked.push("tossicita_mancante");
  if (!fragsTalkTox) out.toxicity.not_found_note = "Nessuna informazione sulla tossicità trovata nelle fonti consultate: questo NON significa che la pianta sia sicura.";

  // Livello finale e contenuti consentiti
  const tier = redFlag ? "alto" : policy.tier;
  if (tier === "alto") {
    out.therapeutic_and_medicinal.preparations = [];
    out.therapeutic_and_medicinal.traditional_uses = [];
    out.culinary_uses = { blocked_by_safety: true };
  } else if (tier === "medio") {
    out.therapeutic_and_medicinal.preparations = [];
  }
  return { card: out, dropped, blocked, redFlag, tier };
}
