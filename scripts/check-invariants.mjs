#!/usr/bin/env node
// Invarianti della libreria: se uno fallisce, la CI/maintenance diventa rossa (GitHub ti scrive) e nulla viene pubblicato.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { makePolicy } from "../lib/policy.js";
const D = new URL("../data/", import.meta.url).pathname;
const rj = (f) => JSON.parse(readFileSync(D + f, "utf8"));
const policy = makePolicy(rj("taxa_policy.json"));
const errs = [];
const files = existsSync(D + "plants") ? readdirSync(D + "plants").filter((f) => f.endsWith(".json")) : [];
for (const f of files) {
  const p = rj("plants/" + f), c = p.content, id = `${f}`;
  if (!p.sources?.length) errs.push(`${id}: nessuna fonte`);
  for (const im of p.images ?? []) if (!im.license || !im.author) errs.push(`${id}: immagine senza autore/licenza`);
  if (!c.toxicity?.claims?.length && !c.toxicity?.not_found_note) errs.push(`${id}: né tossicità né nota fissa`);
  if (!Array.isArray(c.lookalikes)) errs.push(`${id}: look-alike assente`);
  if (p.safety_tier === "alto" && (c.therapeutic_and_medicinal?.preparations?.length || !c.culinary_uses?.blocked_by_safety)) errs.push(`${id}: tier alto con preparazioni o uso culinario`);
  if (policy.isRed(p.accepted_name) && p.safety_tier !== "alto") errs.push(`${id}: in lista rossa ma tier ${p.safety_tier}`);
  for (const l of [...(c.lookalikes ?? []), ...(c.lookalikes_curated ?? [])]) if (policy.isRed(l.name) && p.safety_tier !== "alto") errs.push(`${id}: look-alike in lista rossa (${l.name}) ma tier ${p.safety_tier}`);
  if (JSON.stringify(p).includes('"q"')) errs.push(`${id}: contiene citazioni "q"`);
  if (p.content_license !== "CC BY-SA 4.0") errs.push(`${id}: licenza mancante`);
}
if (existsSync(D + "index.json") && rj("index.json").length !== files.length) errs.push("index.json non allineato ai file");
if (errs.length) { console.error("INVARIANTI VIOLATE:\n- " + errs.join("\n- ")); process.exit(1); }
console.log(`Invarianti ok (${files.length} schede)`);
