// lib/policy.js — lista rossa / livelli di sicurezza per taxon. Puro: riceve la tabella, non legge file.
// Un taxon è un genere ("Conium") o un binomio ("Solanum dulcamara"); il binomio ha la precedenza sul genere.
export const normTaxon = (s) => String(s ?? "").toLowerCase()
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/×/g, " ").replace(/\s+x\s+/g, " ")
  .replace(/[^a-z\s-]/g, " ").replace(/\s+/g, " ").trim();

export const slugOf = (name) => normTaxon(name).split(" ").slice(0, 3).join("-");

export function makePolicy(table) {
  const map = new Map(Object.entries(table).map(([k, v]) => [normTaxon(k), v]));
  const lookup = (name) => {
    const t = normTaxon(name).split(" ");
    return map.get(t.slice(0, 2).join(" ")) ?? map.get(t[0]) ?? null;
  };
  return {
    lookup,
    // lista rossa = voce ESPLICITA con tier alto (una specie sconosciuta NON è "in lista rossa", ma è trattata come alto)
    isRed: (name) => lookup(name)?.tier === "alto",
    decide(name, { redFlag = false } = {}) {
      const p = lookup(name);
      let tier = p ? p.tier : "alto";            // default prudente
      if (redFlag) tier = "alto";                // un look-alike in lista rossa vince sempre
      return { tier, protected: !!p?.protected, reason: p?.reason ?? "Specie non in allowlist: livello prudente", listed: !!p };
    },
  };
}
