#!/usr/bin/env node
// Sonda diagnostica (solo workflow_dispatch): chiede a GitHub Models catalogo e risposte di prova e le scrive come annotazioni del job.
const H = { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "content-type": "application/json", "user-agent": "grimorio-probe" };
const say = (m) => console.log(`::notice::${String(m).replace(/%/g, "%25").replace(/\r?\n/g, " ⏎ ").slice(0, 480)}`);
async function probe(name, url, init = {}) {
  try { const r = await fetch(url, { ...init, headers: H, signal: AbortSignal.timeout(60000) }), b = await r.text(); say(`${name}: HTTP ${r.status} ${r.headers.get("content-type")} ${b.slice(0, 220)}`); return b; }
  catch (e) { say(`${name}: ERRORE ${e.message}`); return ""; }
}
const cat = await probe("catalogo", "https://models.github.ai/catalog/models");
try { const ids = JSON.parse(cat).map((m) => m.id); say(`catalogo: ${ids.length} modelli · gpt-4.1-mini presente: ${ids.includes("openai/gpt-4.1-mini")} · ${ids.slice(0, 14).join(", ")}`); } catch {}
const chat = (model, extra, content) => probe(`chat ${model}${extra.response_format ? " +json" : ""}`, "https://models.github.ai/inference/chat/completions", { method: "POST", body: JSON.stringify({ model, max_tokens: 40, messages: [{ role: "user", content }], ...extra }) });
for (const model of ["openai/gpt-4.1-mini", "openai/gpt-4o-mini"]) {
  await chat(model, {}, "Rispondi solo con la parola: ciao");
  await chat(model, { response_format: { type: "json_object" } }, 'Rispondi con un oggetto JSON {"a":1}');
}
