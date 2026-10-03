import { DISCLAIMER, NO_TOX_INFO, AUTO_CARD, LICENSE, PLANTNET, PRIVACY } from "./src/legal.js";
import { API } from "./config.js";
import { badgeSvg, validateBadge, dominantHues } from "./src/badge.js";
export const MIN_SHOTS = 4, MAX_SHOTS = 5, DISCOVERY_MIN_SCORE = 0.5; // foto obbligatorie (≤5 = 1 credito Pl@ntNet) e confidenza minima per una scoperta
export const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const search = (idx, q) => { const n = norm(q); return n.length < 2 ? [] : idx.filter((p) => [p.name, ...(p.synonyms || []), ...(p.common_names?.it || []), ...(p.common_names?.en || [])].some((x) => norm(x).includes(n))).slice(0, 20); };
// Affermazioni con fonte presenti in una scheda ({t, s:[…]}): misura quanto "lavoro" c'è dietro la scoperta.
export const countClaims = (o) => (!o || typeof o !== "object" ? 0 : (typeof o.t === "string" && Array.isArray(o.s) ? 1 : 0) + Object.values(o).reduce((a, v) => a + countClaims(v), 0));
export const badgeImg = (r, cls = "") => { const svg = badgeSvg(r); return validateBadge(svg).length ? "" : `<img class="badge ${cls}" alt="${esc("Badge: " + r.name)}" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}">`; };
const li = (c) => (c ? `<li>${esc(c.t)} <small>[${esc((c.s || []).join(","))}]</small></li>` : "");
const ul = (a) => (a?.length ? `<ul>${a.map(li).join("")}</ul>` : "");
const det = (t, b, flat) => (flat ? `<h3>${t}</h3>${b}` : `<details open><summary>${t}</summary>${b}</details>`);
export function cardHtml(p, flat = false) {
  const D = (t, b) => det(t, b, flat), c = p.content, blocked = c.culinary_uses?.blocked_by_safety, m = c.therapeutic_and_medicinal || {}, cur = c.lookalikes_curated || [];
  const danger = p.safety_tier === "alto" || p.auto_checks?.red_flag || cur.length;
  const look = [...cur.map((l) => `<li><b>${esc(l.name)}</b> (${esc(l.danger)}) ${esc(l.note)}</li>`), ...(c.lookalikes || []).map((l) => `<li><b>${esc(l.name)}</b> (${esc(l.danger)}) ${esc(l.claim?.t)}</li>`)].join("");
  const src = (p.sources || []).map((s) => `<li>[${esc(s.key)}] ${/^https:/.test(s.url) ? `<a href="${esc(s.url)}" rel="noopener">${esc(s.title || s.kind)}</a>` : esc(s.title || s.kind)} <small>${esc(s.license)}</small></li>`).join("");
  const img = (p.images || []).map((i) => `<figure><img src="${esc(i.url)}" alt="${esc(p.accepted_name)}" loading="lazy"><small>${esc(i.author)} · ${esc(i.license)}</small></figure>`).join("");
  return `<h2>${esc(p.accepted_name)}</h2><small>${esc(p.family || "")} ${esc((p.common_names?.it || []).join(", "))}</small>
${danger ? `<div class="red">⚠ Specie tossica o confondibile con specie pericolose. Non consumare sulla base di un'identificazione automatica.</div>` : ""}
${p.status !== "verificata" ? `<div class="warn">${esc(AUTO_CARD)}</div>` : ""}${p.is_protected ? `<div class="warn">Specie protetta: la raccolta è regolata dalla legge.</div>` : ""}
${look ? D("Specie simili / confusioni pericolose", `<ul>${look}</ul>`) : ""}${img}
${D("Riconoscimento", `${c.summary ? `<p>${esc(c.summary.t)}</p>` : ""}${ul(c.identification?.keys)}${c.identification?.habitat ? `<p>${esc(c.identification.habitat.t)}</p>` : ""}`)}
${D("Tossicità e avvertenze", `${ul(c.toxicity?.claims)}${ul(c.warnings)}${c.toxicity?.not_found_note ? `<p><b>${esc(NO_TOX_INFO)}</b></p>` : ""}`)}
${D("Uso medicinale tradizionale", blocked ? "<p>Non disponibile per sicurezza.</p>" : `${ul(m.traditional_uses)}${ul(m.contraindications)}${ul(m.interactions)}${(m.preparations || []).map((x) => li({ t: `${x.name}: ${x.claim.t}`, s: x.claim.s })).join("")}<p><small>Consulta un medico o un erborista.</small></p>`)}
${D("Cucina", blocked ? "<p>Non disponibile per sicurezza.</p>" : (c.culinary_uses?.edible_parts || []).map((x) => li({ t: `${x.part}${x.season ? " (" + x.season + ")" : ""}: ${x.claim.t}`, s: x.claim.s })).join("") || "<p>Nessuna informazione.</p>")}
${flat ? `<h3>Fonti e licenze</h3><ul>${src}</ul><small>${esc(LICENSE)}</small>` : `<details><summary>Fonti e licenze</summary><ul>${src}</ul><small>${esc(LICENSE)}</small></details>`}`;
}
// L'intero archivio come un unico documento (indice + una sezione per specie), da leggere sul sito senza scaricare nulla.
export function docHtml(plants) {
  if (!plants.length) return `<article class="doc"><h1>Grimorio Botanico</h1><p>L'archivio è ancora vuoto: la prima scoperta potrebbe essere la tua.</p></article>`;
  const toc = plants.map((p, i) => `<li><a href="#/archivio" data-go="${i}">${esc(p.accepted_name)}</a> <small>${esc((p.common_names?.it || [])[0] || "")}</small></li>`).join("");
  return `<article class="doc"><header class="dochead"><h1>Grimorio Botanico</h1><p>Archivio completo · ${plants.length} specie</p><p><small>${esc(DISCLAIMER)}</small></p></header>
<nav id="a-top"><h2>Indice</h2><ol>${toc}</ol></nav>
${plants.map((p, i) => `<section id="a-${i}" class="sp">${cardHtml(p, true)}<p class="noprint"><small><a href="#/archivio" data-go="top">↑ Indice</a></small></p></section>`).join("")}
<p><small>${esc(LICENSE)} ${esc(PLANTNET)}</small></p></article>`;
}

if (typeof document !== "undefined") {
  const $ = (s) => document.querySelector(s), app = $("#app");
  const ls = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const sv = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
  const j = async (path, init) => { const r = await fetch(API + path, init); return { st: r.status, d: await r.json().catch(() => ({})) }; };
  let index = [], shots = [], stream = null, timer = null, docCache = null;
  const load = async () => { index = await fetch("data/index.json", { cache: "no-cache" }).then((r) => r.json()).catch(() => index); };
  const stop = () => { stream?.getTracks().forEach((t) => t.stop()); stream = null; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const grab = (src) => { const w = src.videoWidth || src.width, h = src.videoHeight || src.height, k = Math.min(1, 768 / Math.max(w, h)), c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k); c.getContext("2d").drawImage(src, 0, 0, c.width, c.height); return c; }; // ricodifica: via EXIF/GPS
  const sharp = (c) => { const s = document.createElement("canvas"); s.width = s.height = 64; const x = s.getContext("2d"); x.drawImage(c, 0, 0, 64, 64); const d = x.getImageData(0, 0, 64, 64).data; let m = 0, q = 0, n = 0; for (let i = 0; i < 63; i++) for (let k = 0; k < 63; k++) { const v = d[(i * 64 + k) * 4] - d[(i * 64 + k + 1) * 4] + d[(i * 64 + k) * 4] - d[((i + 1) * 64 + k) * 4]; m += v; q += v * v; n++; } return q / n - (m / n) ** 2; };
  const blob = (c) => new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
  const tiny = (c) => { const s = document.createElement("canvas"); s.width = s.height = 24; const x = s.getContext("2d"); x.drawImage(c, 0, 0, 24, 24); return Array.from(x.getImageData(0, 0, 24, 24).data); }; // per la palette del badge
  const medal = (c) => { const s = document.createElement("canvas"); s.width = s.height = 244; const k = Math.min(c.width, c.height); s.getContext("2d").drawImage(c, (c.width - k) / 2, (c.height - k) / 2, k, k, 0, 0, 244, 244); return s.toDataURL("image/jpeg", 0.8); };
  const addShot = async (c) => { shots.push({ blob: await blob(c), url: c.toDataURL("image/jpeg", 0.4), sc: sharp(c), px: tiny(c), medal: medal(c) }); };
  async function snap(video) { let best, bs = -1; for (let i = 0; i < 3; i++) { const c = grab(video), s = sharp(c); if (s > bs) { bs = s; best = c; } await sleep(120); } await addShot(best); }
  const shotsHtml = () => shots.map((s, i) => `<img src="${s.url}" width="64" data-i="${i}" title="Tocca per togliere" alt="foto ${i + 1}">`).join("");

  async function home() {
    app.innerHTML = `<input id="q" type="search" placeholder="Cerca per nome nell'archivio (italiano o latino)…"><div id="res"></div>
<div class="c"><h3 style="margin:.2rem 0">Scopri una pianta</h3>
<p><small>Scatta almeno ${MIN_SHOTS} foto (massimo ${MAX_SHOTS}) da angolazioni diverse: pianta intera, foglie, fiori o frutti, fusto. Prima la cerchiamo nell'archivio; se non c'è, puoi farla entrare tu nel Grimorio e ricevere il tuo badge.</small></p>
<video id="v" playsinline muted></video>
<p><button id="snap">📷 Scatta</button> <label class="s" style="padding:.6rem .9rem;border:1px solid var(--g);border-radius:10px">Aggiungi dalla galleria<input id="f" type="file" accept="image/*" multiple hidden></label></p>
<div id="sh"></div><p><button id="go" disabled>Cerca</button> <button class="s" id="rs">Azzera</button> <small id="hint"></small></p></div>
<p><small>${esc(DISCLAIMER)}</small></p><p><a href="#/i">Privacy e crediti</a></p>`;
    $("#q").oninput = (e) => { $("#res").innerHTML = search(index, e.target.value).map((p) => `<div class="c"><a href="#/p/${esc(p.slug)}">${esc(p.name)}</a> <small>${esc((p.common_names?.it || [])[0] || "")}</small></div>`).join(""); };
    const v = $("#v"); stop(); stream = await navigator.mediaDevices?.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false }).catch(() => null);
    if (stream) { v.srcObject = stream; v.play(); } else v.hidden = true;
    const refresh = () => {
      const n = shots.length; $("#sh").innerHTML = shotsHtml(); $("#go").disabled = n < MIN_SHOTS; $("#go").textContent = "Cerca";
      $("#hint").textContent = n < MIN_SHOTS ? `Foto ${n}/${MIN_SHOTS}: ne servono ancora ${MIN_SHOTS - n}` : `Foto ${n}/${MAX_SHOTS}: pronto${n < MAX_SHOTS ? " (puoi aggiungerne ancora)" : ""}`;
      $("#sh").querySelectorAll("img").forEach((im) => (im.onclick = () => { shots.splice(+im.dataset.i, 1); refresh(); }));
    };
    $("#snap").onclick = async () => { if (!stream) return $("#f").click(); if (shots.length < MAX_SHOTS) { await snap(v); refresh(); } };
    $("#f").onchange = async (e) => { for (const f of [...e.target.files].slice(0, MAX_SHOTS - shots.length)) await addShot(grab(await createImageBitmap(f, { imageOrientation: "from-image" }))); e.target.value = ""; refresh(); };
    $("#rs").onclick = () => { shots = []; refresh(); };
    const ident = (organs) => { const fd = new FormData(); shots.forEach((s) => { fd.append("images", s.blob, "p.jpg"); if (organs) fd.append("organs", "auto"); }); return j("/identify", { method: "POST", body: fd }).catch(() => ({ st: 0, d: {} })); };
    $("#go").onclick = async () => { if (shots.length < MIN_SHOTS) return; stop(); app.innerHTML = "<p>Cerco nell'archivio e identifico la pianta…</p>"; let r = await ident(true); if (r.st === 502) r = await ident(false); result(r); };
    refresh();
  }

  function result({ st, d }) {
    const back = `<p><a href="#/">← Nuova ricerca</a></p>`;
    if (st === 429) return (app.innerHTML = `<div class="warn">Quota di identificazione giornaliera esaurita. Puoi cercare per nome nell'archivio.</div>${back}`);
    if (!d.verdict) return (app.innerHTML = `<div class="warn">Servizio non raggiungibile. Riprova o cerca per nome.</div>${back}`);
    const msg = { probabile: "Identificazione probabile", da_affinare: "Da affinare: riprova con foto più nitide e da angolazioni diverse (pagina inferiore della foglia, fusto, fiore).", non_riconosciuta: "Non riconosciuta.", non_pianta: "Non sembra una pianta." }[d.verdict];
    const rows = (d.candidates || []).map((c) => {
      const hit = index.find((p) => p.gbif_key === c.gbif_key), mine = ls("scoperte", []).find((x) => x.gbif_key === c.gbif_key);
      const act = hit ? `Già nell'archivio · <a href="#/p/${esc(hit.slug)}">Apri scheda</a>`
        : mine ? `<a href="#/s/${c.gbif_key}">⏳ La tua scoperta è in preparazione</a>`
        : c.gbif_key && c.score >= DISCOVERY_MIN_SCORE ? `Non è ancora nell'archivio.<br><button data-k="${c.gbif_key}">✨ Falla entrare nel Grimorio (sarà una tua scoperta)</button>`
        : c.gbif_key ? `<small>Non è nell'archivio. Confidenza troppo bassa per crearne la scheda: prova con foto migliori.</small>` : "";
      return `<div class="c"><b>${esc(c.name)}</b> ${Math.round(c.score * 100)}% ${c.red_list ? "⚠" : ""}<br>${act}</div>`;
    }).join("");
    app.innerHTML = `${d.redWarning ? `<div class="red">⚠ Tra le candidate c'è una specie tossica. Non consumare.</div>` : ""}<h2>${esc(msg)}</h2>${rows}<p><small>${esc(DISCLAIMER)}</small></p>${back}`;
    app.querySelectorAll("button[data-k]").forEach((b) => (b.onclick = async () => {
      b.disabled = true; const key = +b.dataset.k, c = d.candidates.find((x) => x.gbif_key === key);
      const r = await j("/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ gbif_key: key }) }).catch(() => ({ d: {} }));
      if (r.d.status === "accodata") {
        const best = [...shots].sort((x, y) => y.sc - x.sc)[0], hues = dominantHues(shots.map((s) => s.px));
        sv("scoperte", [...ls("scoperte", []).filter((x) => x.gbif_key !== key), { gbif_key: key, name: c.name, ts: Date.now(), n: shots.length, score: c.score, photo: best?.medal || "", ...hues, fast: !!r.d.fast, status: "attesa" }]);
        shots = []; location.hash = "#/s/" + key; return;
      }
      const t = { in_coda: "Qualcuno sta già facendo nascere questa scheda: la troverai nell'archivio appena pronta.", gia_presente: "La scheda esiste già: ricarica la pagina.", non_ammessa: "Non è una specie vegetale ammessa.", coda_piena: "Coda piena, riprova più tardi." }[r.d.status] || "Errore, riprova.";
      b.replaceWith(Object.assign(document.createElement("small"), { textContent: t }));
    }));
  }

  // Una richiesta accettata diventa una "scoperta" quando la scheda compare nell'archivio.
  async function settle() {
    const recs = ls("scoperte", []), done = [];
    for (const r of recs) {
      if (r.status !== "attesa") continue;
      const hit = index.find((p) => p.gbif_key === r.gbif_key); if (!hit) continue;
      const p = await fetch(`data/plants/${encodeURIComponent(hit.slug)}.json`).then((x) => (x.ok ? x.json() : null)).catch(() => null); if (!p) continue;
      const at = p.generated_at || "";
      Object.assign(r, { status: "scoperta", slug: hit.slug, name: p.accepted_name, family: p.family || "", date: at, no: index.filter((x) => (x.at || "") <= at).length || index.length, claims: countClaims(p.content), sources: (p.sources || []).length });
      done.push(r);
    }
    if (done.length) sv("scoperte", recs);
    return done;
  }

  async function wait(key) {
    const rec = ls("scoperte", []).find((x) => x.gbif_key === key);
    if (!rec) return home();
    if (rec.status === "scoperta") return reveal(key);
    const st = (await j(`/status?gbif_key=${key}`).catch(() => ({ d: {} }))).d.status, mins = Math.max(0, Math.round((Date.now() - rec.ts) / 60000));
    if (location.hash !== "#/s/" + key) return;
    const step = st === "fallita" ? "✖ Non è stato possibile creare la scheda (fonti insufficienti)" : "⏳ Creazione e controllo della scheda dalle fonti aperte";
    app.innerHTML = `<h2>${esc(rec.name)}</h2><div class="c"><p>${rec.photo ? `<img src="${rec.photo}" width="96" alt="la tua foto migliore" style="float:left;margin:0 .8rem .4rem 0">` : ""}Richiesta ricevuta. Se la scheda nascerà, sarà merito delle tue foto.</p>
<ol style="clear:both"><li>✔ Le tue ${rec.n} foto hanno riconosciuto la pianta (${Math.round(rec.score * 100)}%)</li><li>${step}</li><li>Pubblicazione nell'archivio</li></ol></div>
<p><small>Inviata ${mins} min fa. ${rec.fast ? "L'elaborazione è partita subito." : "L'elaborazione automatica parte a intervalli di alcune ore."} Puoi chiudere l'app: riaprendola troverai qui la tua scoperta. Questa pagina si aggiorna da sola.</small></p><p><a href="#/g">Il mio grimorio</a></p>`;
    timer = setInterval(async () => { if (location.hash !== "#/s/" + key) return clearInterval(timer); await load(); if ((await settle()).length) { clearInterval(timer); location.hash = "#/b/" + key; } }, 30000);
  }

  function reveal(key) {
    const all = ls("scoperte", []), r = all.find((x) => x.gbif_key === key && x.status === "scoperta"); if (!r) return home();
    const mine = all.filter((x) => x.status === "scoperta"), pct = index.length ? Math.round((mine.length * 100) / index.length) : 0;
    app.innerHTML = `<h2>🎉 Nuova scoperta!</h2><p style="text-align:center">${badgeImg(r, "big")}</p>
<p>Grazie a te <b>${esc(r.name)}</b> è entrata nel Grimorio: è la specie n° ${esc(r.no)} dell'archivio.</p>
<div class="c"><b>Il tuo contributo</b><ul><li>${r.n} tue foto hanno riconosciuto la pianta (${Math.round(r.score * 100)}% di confidenza)</li><li>La tua richiesta ha fatto nascere una scheda con ${r.claims} affermazioni, ciascuna con la sua fonte (${r.sources} fonti aperte)</li><li>Con questa hai ${mine.length} ${mine.length === 1 ? "scoperta" : "scoperte"}: ${pct}% delle ${index.length} specie dell'archivio</li></ul></div>
<p><a href="#/p/${esc(r.slug)}"><button>Leggi la scheda</button></a> <a href="#/g"><button class="s">Le mie scoperte</button></a></p><p><small>Il badge è creato sul tuo dispositivo con i colori della tua foto: nessun server la conserva.</small></p>`;
  }

  async function card(slug) {
    const p = await fetch(`data/plants/${encodeURIComponent(slug)}.json`).then((r) => r.json()).catch(() => null);
    if (!p) return (app.innerHTML = "<p>Scheda non disponibile (offline?).</p>");
    const g = ls("grimorio", []), has = g.includes(slug);
    app.innerHTML = `${cardHtml(p)}<p><button id="sv">${has ? "Rimuovi dal grimorio" : "Salva nel grimorio"}</button> <button class="s" id="rp">Segnala errore</button></p><div id="rf"></div><p><small>${esc(PLANTNET)}</small></p>`;
    $("#sv").onclick = () => { sv("grimorio", has ? g.filter((x) => x !== slug) : [...g, slug]); card(slug); };
    $("#rp").onclick = () => { $("#rf").innerHTML = `<div class="c"><input id="rs2" placeholder="Sezione (facoltativo)"><br><textarea id="rm" maxlength="500" rows="3" style="width:100%" placeholder="Cosa non è corretto?"></textarea><br><button id="rg">Invia (anonimo)</button></div>`; $("#rg").onclick = async () => { const r = await j("/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug, section: $("#rs2").value, message: $("#rm").value }) }); $("#rf").textContent = r.st === 200 ? "Grazie, segnalazione inviata." : "Non inviata, riprova."; }; };
  }

  async function archive() {
    app.innerHTML = `<h2>Archivio completo</h2><p id="pg"><small>Carico le schede…</small></p>`;
    if (!docCache || docCache.length !== index.length) {
      const out = [], q = [...index]; let n = 0;
      const run = async () => { while (q.length) { const it = q.shift(), p = await fetch(`data/plants/${encodeURIComponent(it.slug)}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null); if (p) out.push(p); n++; if ($("#pg")) $("#pg").textContent = `Carico le schede… ${n}/${index.length}`; } };
      await Promise.all(Array.from({ length: 6 }, run)); docCache = out.sort((a, b) => a.accepted_name.localeCompare(b.accepted_name));
    }
    if (location.hash !== "#/archivio") return;
    app.innerHTML = docHtml(docCache);
    app.querySelectorAll("a[data-go]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); document.getElementById("a-" + a.dataset.go)?.scrollIntoView({ behavior: "smooth" }); }));
  }

  function grimorio() {
    const g = ls("grimorio", []), items = g.map((s) => index.find((p) => p.slug === s)).filter(Boolean), sc = ls("scoperte", []), done = sc.filter((x) => x.status === "scoperta"), wt = sc.filter((x) => x.status === "attesa");
    app.innerHTML = `<h2>Il mio grimorio</h2><div class="c"><b>Le mie scoperte</b><p><small>${done.length} ${done.length === 1 ? "scoperta" : "scoperte"} · ${done.reduce((a, x) => a + x.n, 0)} foto contribuite · ${index.length ? Math.round((done.length * 100) / index.length) : 0}% dell'archivio</small></p>
<div class="bg">${done.map((x) => `<a href="#/b/${x.gbif_key}">${badgeImg(x)}</a>`).join("") || "<small>Nessuna ancora: fotografa una pianta che manca nell'archivio.</small>"}</div>
${wt.map((x) => `<p><a href="#/s/${x.gbif_key}">⏳ ${esc(x.name)}: in preparazione</a></p>`).join("")}</div>
<p><small>${items.length} su ${index.length} specie salvate. Resta su questo dispositivo.</small></p>${items.map((p) => `<div class="c"><a href="#/p/${esc(p.slug)}">${esc(p.name)}</a></div>`).join("")}<p><a href="#/">← Indietro</a></p>`;
  }
  async function privacy() {
    const e = await fetch("src/emergency.json").then((r) => r.json()).catch(() => ({ centri_antiveleni: [] }));
    app.innerHTML = `<h2>Privacy e crediti</h2><p>${esc(PRIVACY)}</p><p>${esc(PLANTNET)}</p><p>${esc(LICENSE)}</p><h3>Emergenze</h3><p>${esc(e.emergenza || "112")}</p><ul>${(e.centri_antiveleni || []).filter((c) => c.telefono).map((c) => `<li>${esc(c.nome)}: ${esc(c.telefono)}</li>`).join("")}</ul><p><a href="#/">← Indietro</a></p>`;
  }
  const route = async () => {
    stop(); clearInterval(timer); const h = location.hash.slice(1) || "/";
    if (!index.length || ls("scoperte", []).some((r) => r.status === "attesa")) await load();
    const fresh = await settle(); if (fresh.length && !h.startsWith("/b/")) { location.hash = "#/b/" + fresh[0].gbif_key; return; }
    if (h.startsWith("/p/")) card(h.slice(3)); else if (h === "/g") grimorio(); else if (h === "/archivio") archive(); else if (h.startsWith("/s/")) wait(+h.slice(3)); else if (h.startsWith("/b/")) reveal(+h.slice(3)); else if (h === "/i") privacy(); else home();
  };
  addEventListener("hashchange", route); route();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}
