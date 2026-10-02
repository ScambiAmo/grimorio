// lib/identify.js — esito dell'identificazione (soglie iniziali, da calibrare con foto reali)
export function verdictOf(cands) {
  const c = [...cands].sort((a, b) => b.score - a.score);
  const top = c[0];
  if (!top || top.score < 0.30) return { verdict: "non_riconosciuta", redWarning: false };
  const second = c[1]?.score ?? 0;
  const redWarning = c.some((x) => x.score >= 0.10 && x.red_list);
  const ok = top.score >= 0.80 && top.score - second >= 0.25 && !redWarning;
  return { verdict: ok ? "probabile" : "da_affinare", redWarning };
}
