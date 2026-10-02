import { DISCLAIMER, NO_TOX_INFO, AUTO_CARD, LICENSE, PLANTNET, PRIVACY } from "./src/legal.js";
import { API } from "./config.js";
export const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const search = (idx, q) => { const n = norm(q); return n.length < 2 ? [] : idx.filter((p) => [p.name, ...(p.synonyms || []), ...(p.common_names?.it || []), ...(p.common_names?.en || [])].some((x) => norm(x).includes(n))).slice(0, 20); };
const li = (c) => (c ? `<li>${esc(c.t)} <small>[${esc((c.s || []).join(","))}]</small></li>` : "");
const ul = (a) => (a?.length ? `<ul>${a.map(li).join("")}</ul>` : "");
const det = (t, b) => `<details open><summary>${t}</summary>${b}</details>`;
export function cardHtml(p) {
  const c = p.content, blocked = c.culinary_uses?.blocked_by_safety, m = c.therapeutic_and_medicinal || {}, cur = c.lookalikes_curated || [];
  const danger = p.safety_tier === "alto" || p.auto_checks?.red_flag || cur.length;
  const look = [...cur.map((l) => `<li><b>${esc(l.name)}</b> (${esc(l.danger)}) ${esc(l.note)}</li>`), ...(c.lookalikes || []).map((l) => `<li><b>${esc(l.name)}</b> (${esc(l.danger)}) ${esc(l.claim?.t)}</li>`)].join("");
  const src = (p.sources || []).map((s) => `<li>[${esc(s.key)}] ${/^https:/.test(s.url) ? `<a href="${esc(s.url)}" rel="noopener">${esc(s.title || s.kind)}</a>` : esc(s.title || s.kind)} <small>${esc(s.license)}</small></li>`).join("");
  const img = (p.images || []).map((i) => `<figure><img src="${esc(i.url)}" alt="${esc(p.accepted_name)}" loading="lazy"><small>${esc(i.author)} · ${esc(i.license)}</small></figure>`).join("");
  return `<h2>${esc(p.accepted_name)}</h2><small>${esc(p.family || "")} ${esc((p.common_names?.it || []).join(", "))}</small>
${danger ? `<div class="red">⚠ Specie tossica o confondibile con specie pericolose. Non consumare sulla base di un'identificazione automatica.</div>` : ""}
${p.status !== "verificata" ? `<div class="warn">${esc(AUTO_CARD)}</div>` : ""}${p.is_protected ? `<div class="warn">Specie protetta: la raccolta è regolata dalla legge.</div>` : ""}
${look ? det("Specie simili / confusioni pericolose", `<ul>${look}</ul>`) : ""}${img}
${det("Riconoscimento", `${c.summary ? `<p>${esc(c.summary.t)}</p>` : ""}${ul(c.identification?.keys)}${c.identification?.habitat ? `<p>${esc(c.identification.habitat.t)}</p>` : ""}`)}
${det("Tossicità e avvertenze", `${ul(c.toxicity?.claims)}${ul(c.warnings)}${c.toxicity?.not_found_note ? `<p><b>${esc(NO_TOX_INFO)}</b></p>` : ""}`)}
${det("Uso medicinale tradizionale", blocked ? "<p>Non disponibile per sicurezza.</p>" : `${ul(m.traditional_uses)}${ul(m.contraindications)}${ul(m.interactions)}${(m.preparations || []).map((x) => li({ t: `${x.name}: ${x.claim.t}`, s: x.claim.s })).join("")}<p><small>Consulta un medico o un erborista.</small></p>`)}
${det("Cucina", blocked ? "<p>Non disponibile per sicurezza.</p>" : (c.culinary_uses?.edible_parts || []).map((x) => li({ t: `${x.part}${x.season ? " (" + x.season + ")" : ""}: ${x.claim.t}`, s: x.claim.s })).join("") || "<p>Nessuna informazione.</p>")}
<details><summary>Fonti e licenze</summary><ul>${src}</ul><small>${esc(LICENSE)}</small></details>`;
}

if (typeof document !== "undefined") {
  const $ = (s) => document.querySelector(s), app = $("#app"), ls = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, sv = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const j = async (path, init) => { const r = await fetch(API + path, init); return { st: r.status, d: await r.json().catch(() => ({})) }; };
  let index = [], shots = [], stream = null;
  const load = async () => { index = await fetch("data/index.json", { cache: "no-cache" }).then((r) => r.json()).catch(() => index); };
  const stop = () => { stream?.getTracks().forEach((t) => t.stop()); stream = null; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const grab = (src) => { const w = src.videoWidth || src.width, h = src.videoHeight || src.height, k = Math.min(1, 768 / Math.max(w, h)), c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k); c.getContext("2d").drawImage(src, 0, 0, c.width, c.height); return c; }; // ricodifica: via EXIF/GPS
  const sharp = (c) => { const s = document.createElement("canvas"); s.width = s.height = 64; const x = s.getContext("2d"); x.drawImage(c, 0, 0, 64, 64); const d = x.getImageData(0, 0, 64, 64).data; let m = 0, q = 0, n = 0; for (let i = 0; i < 63; i++) for (let k = 0; k < 63; k++) { const v = d[(i * 64 + k) * 4] - d[(i * 64 + k + 1) * 4] + d[(i * 64 + k) * 4] - d[((i + 1) * 64 + k) * 4]; m += v; q += v * v; n++; } return q / n - (m / n) ** 2; };
  const blob = (c) => new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
  async function snap(video, organ) { let best, bs = -1; for (let i = 0; i < 3; i++) { const c = grab(video), s = sharp(c); if (s > bs) { bs = s; best = c; } await sleep(120); } shots.push({ organ, blob: await blob(best), url: best.toDataURL("image/jpeg", 0.4) }); }
  const shotsHtml = () => shots.map((s) => `<img src="${s.url}" width="64">`).join("");

  async function home() {
    app.innerHTML = `<input id="q" type="search" placeholder="Cerca per nome (italiano o latino)…"><div id="res"></div>
<div class="c"><video id="v" playsinline muted></video><p><select id="o"><option value="leaf">Foglia</option><option value="flower">Fiore</option><option value="fruit">Frutto</option><option value="habit">Portamento</option><option value="bark">Corteccia</option></select> <button id="snap">📷 Scatta</button> <label class="s" style="padding:.6rem .9rem;border:1px solid var(--g);border-radius:10px">Dalla fotocamera/galleria<input id="f" type="file" accept="image/*" capture="environment" hidden></label></p>
<div id="sh">${shotsHtml()}</div><button id="go" ${shots.length ? "" : "disabled"}>Identifica (${shots.length}/5)</button> <button class="s" id="rs">Azzera</button></div>
<p><small>${esc(DISCLAIMER)}</small></p><p><a href="#/i">Privacy e crediti</a></p>`;
    $("#q").oninput = (e) => { $("#res").innerHTML = search(index, e.target.value).map((p) => `<div class="c"><a href="#/p/${esc(p.slug)}">${esc(p.name)}</a> <small>${esc((p.common_names?.it || [])[0] || "")}</small></div>`).join(""); };
    const v = $("#v"); stop(); stream = await navigator.mediaDevices?.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false }).catch(() => null);
    if (stream) { v.srcObject = stream; v.play(); } else v.hidden = true;
    const refresh = () => { $("#sh").innerHTML = shotsHtml(); $("#go").disabled = !shots.length; $("#go").textContent = `Identifica (${shots.length}/5)`; };
    $("#snap").onclick = async () => { if (stream && shots.length < 5) { await snap(v, $("#o").value); refresh(); } else if (!stream) $("#f").click(); };
    $("#f").onchange = async (e) => { for (const f of [...e.target.files].slice(0, 5 - shots.length)) { const c = grab(await createImageBitmap(f, { imageOrientation: "from-image" })); shots.push({ organ: $("#o").value, blob: await blob(c), url: c.toDataURL("image/jpeg", 0.4) }); } refresh(); };
    $("#rs").onclick = () => { shots = []; refresh(); };
    $("#go").onclick = async () => { const fd = new FormData(); shots.forEach((s) => { fd.append("images", s.blob, "p.jpg"); fd.append("organs", s.organ); }); stop(); app.innerHTML = "<p>Identificazione in corso…</p>"; const r = await j("/identify", { method: "POST", body: fd }).catch(() => ({ st: 0, d: {} })); result(r); };
  }
  function result({ st, d }) {
    const back = `<p><a href="#/" onclick="">← Nuova ricerca</a></p>`;
    if (st === 429) return (app.innerHTML = `<div class="warn">Quota di identificazione giornaliera esaurita. Puoi cercare per nome nella libreria.</div>${back}`);
    if (!d.verdict) return (app.innerHTML = `<div class="warn">Servizio non raggiungibile. Riprova o cerca per nome.</div>${back}`);
    const msg = { probabile: "Identificazione probabile", da_affinare: "Da affinare: aggiungi altre foto (pagina inferiore della foglia, fusto, fiore).", non_riconosciuta: "Non riconosciuta.", non_pianta: "Non sembra una pianta." }[d.verdict];
    const rows = (d.candidates || []).map((c) => { const hit = index.find((p) => p.gbif_key === c.gbif_key); return `<div class="c"><b>${esc(c.name)}</b> ${Math.round(c.score * 100)}% ${c.red_list ? "⚠" : ""}<br>${hit ? `<a href="#/p/${esc(hit.slug)}">Apri scheda</a>` : c.gbif_key ? `<button data-k="${c.gbif_key}">Aggiungila alla libreria</button>` : ""}</div>`; }).join("");
    app.innerHTML = `${d.redWarning ? `<div class="red">⚠ Tra le candidate c'è una specie tossica. Non consumare.</div>` : ""}<h2>${esc(msg)}</h2>${rows}<p><small>${esc(DISCLAIMER)}</small></p>${back}`;
    app.querySelectorAll("button[data-k]").forEach((b) => (b.onclick = async () => { const r = await j("/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ gbif_key: +b.dataset.k }) }); const t = { accodata: "Richiesta inviata: la scheda sarà pronta tra pochi minuti o ore.", in_coda: "Già in preparazione.", gia_presente: "La scheda esiste già: ricarica.", non_ammessa: "Non è una specie vegetale ammessa.", coda_piena: "Coda piena, riprova più tardi." }[r.d.status] || "Errore, riprova."; if (["accodata", "in_coda"].includes(r.d.status)) sv("pending", [...new Set([...ls("pending", []), +b.dataset.k])]); b.replaceWith(Object.assign(document.createElement("small"), { textContent: t })); }));
  }
  async function card(slug) {
    const p = await fetch(`data/plants/${encodeURIComponent(slug)}.json`).then((r) => r.json()).catch(() => null);
    if (!p) return (app.innerHTML = "<p>Scheda non disponibile (offline?).</p>");
    const g = ls("grimorio", []), has = g.includes(slug);
    app.innerHTML = `${cardHtml(p)}<p><button id="sv">${has ? "Rimuovi dal grimorio" : "Salva nel grimorio"}</button> <button class="s" id="rp">Segnala errore</button></p><div id="rf"></div><p><small>${esc(PLANTNET)}</small></p>`;
    $("#sv").onclick = () => { sv("grimorio", has ? g.filter((x) => x !== slug) : [...g, slug]); card(slug); };
    $("#rp").onclick = () => { $("#rf").innerHTML = `<div class="c"><input id="rs2" placeholder="Sezione (facoltativo)"><br><textarea id="rm" maxlength="500" rows="3" style="width:100%" placeholder="Cosa non è corretto?"></textarea><br><button id="rg">Invia (anonimo)</button></div>`; $("#rg").onclick = async () => { const r = await j("/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug, section: $("#rs2").value, message: $("#rm").value }) }); $("#rf").textContent = r.st === 200 ? "Grazie, segnalazione inviata." : "Non inviata, riprova."; }; };
  }
  function grimorio() {
    const g = ls("grimorio", []), items = g.map((s) => index.find((p) => p.slug === s)).filter(Boolean), pend = ls("pending", []).filter((k) => !index.some((p) => p.gbif_key === k));
    sv("pending", pend);
    app.innerHTML = `<h2>Il mio grimorio</h2><p><small>${items.length} su ${index.length} specie. Resta su questo dispositivo.</small></p>${items.map((p) => `<div class="c"><a href="#/p/${esc(p.slug)}">${esc(p.name)}</a></div>`).join("")}${pend.length ? `<p><small>${pend.length} richieste in attesa di generazione.</small></p>` : ""}<p><a href="#/">← Indietro</a></p>`;
  }
  async function privacy() {
    const e = await fetch("src/emergency.json").then((r) => r.json()).catch(() => ({ centri_antiveleni: [] }));
    app.innerHTML = `<h2>Privacy e crediti</h2><p>${esc(PRIVACY)}</p><p>${esc(PLANTNET)}</p><p>${esc(LICENSE)}</p><h3>Emergenze</h3><p>${esc(e.emergenza || "112")}</p><ul>${(e.centri_antiveleni || []).filter((c) => c.telefono).map((c) => `<li>${esc(c.nome)}: ${esc(c.telefono)}</li>`).join("")}</ul><p><a href="#/">← Indietro</a></p>`;
  }
  const route = async () => { stop(); const h = location.hash.slice(1) || "/"; if (!index.length) await load(); if (h.startsWith("/p/")) card(h.slice(3)); else if (h === "/g") grimorio(); else if (h === "/i") privacy(); else home(); };
  addEventListener("hashchange", route); route();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}
