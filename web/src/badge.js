// web/src/badge.js — badge delle scoperte. Puro (nessun DOM): gira identico nel browser e nei test.
// REGOLE DI FORMA: sono uguali per TUTTI i badge e stanno in BADGE_RULES. Di badge in badge cambiano soltanto
// i colori (ricavati dalle foto reali), i testi e la foto nel medaglione. validateBadge() le fa rispettare.
export const BADGE_RULES = Object.freeze({
  size: 512,
  hex: { cx: 256, cy: 256, outer: 240, inner: 214, rim: 14, line: 4 }, // esagono regolare, punta in alto, bordo doppio
  medal: { cx: 256, cy: 214, r: 122, ring: 8, photo: 244 },            // medaglione tondo con la foto reale (ritagliata al centro)
  ribbon: { x: 56, y: 318, w: 400, h: 64, rx: 10 },                    // nastro con il nome scientifico
  name: { max: 30, fsMax: 28, fsMin: 16, y: 358, charW: 0.56, room: 368 },
  top: { y: 66, fs: 16 }, foot: { y: 430, fs: 18, max: 22 }, fam: { y: 454, fs: 13, max: 20 },
  minContrast: 4.5, maxBytes: 120000,
});

const R = BADGE_RULES;
const hexPts = (rad) => [0, 1, 2, 3, 4, 5].map((i) => { const a = ((-90 + 60 * i) * Math.PI) / 180; return `${(R.hex.cx + rad * Math.cos(a)).toFixed(1)},${(R.hex.cy + rad * Math.sin(a)).toFixed(1)}`; }).join(" ");

// ---------- colore
const toHex = (c) => "#" + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
function hslRgb(h, s, l) { h = ((h % 360) + 360) % 360; s /= 100; l /= 100; const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); return [f(0) * 255, f(8) * 255, f(4) * 255]; }
export const hslHex = (h, s, l) => toHex(hslRgb(h, s, l));
const lum = (c) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// Le due tinte dominanti dei pixel "vivi" (RGBA) delle foto reali: scarta grigi e ombre.
export function dominantHues(pixelSets) {
  const bins = new Array(12).fill(0);
  for (const d of pixelSets) for (let i = 0; i + 3 < d.length; i += 4) {
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255, mx = Math.max(r, g, b), c = mx - Math.min(r, g, b);
    if (mx < 0.15 || c < 0.12) continue;
    let h = mx === r ? ((g - b) / c) % 6 : mx === g ? (b - r) / c + 2 : (r - g) / c + 4; h = (h * 60 + 360) % 360;
    bins[Math.floor(h / 30) % 12] += c * mx;
  }
  const order = bins.map((w, i) => [w, i]).sort((a, b) => b[0] - a[0]);
  const hue1 = order[0][0] > 0 ? order[0][1] * 30 + 15 : 120; // nessun pixel vivo: verde
  const gap = (a, b) => { const x = Math.abs(a - b); return Math.min(x, 360 - x); };
  const far = order.find(([w, i]) => w > 0 && gap(i * 30 + 15, hue1) >= 60);
  return { hue1, hue2: far ? far[1] * 30 + 15 : (hue1 + 40) % 360 };
}

export function paletteOf(hue1, hue2) {
  let l = 40, rim = hslHex(hue2, 48, l);
  while (contrast("#ffffff", rim) < R.minContrast && l > 6) { l -= 2; rim = hslHex(hue2, 48, l); }
  return { bg: hslHex(hue1, 38, 13), rim, accent: hslHex(hue1, 72, 64), text: "#ffffff" };
}

// ---------- SVG
const X = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clip = (s, n) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const ymd = (d) => { const t = new Date(d); return Number.isNaN(t.getTime()) ? "" : t.toISOString().slice(0, 10).split("-").reverse().join("/"); };
export const nameFont = (len) => Math.max(R.name.fsMin, Math.min(R.name.fsMax, Math.floor(R.name.room / (R.name.charW * Math.max(len, 1)))));

export function badgeSvg({ name, family, no, date, photo, hue1 = 120, hue2 = 160 }) {
  const P = paletteOf(hue1, hue2), nm = clip(name, R.name.max), fs = nameFont(nm.length), m = R.medal, k = R.ribbon;
  const img = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(photo || "") ? photo : "";
  const foot = clip(`N° ${Number.isInteger(no) ? no : "?"} · ${ymd(date)}`, R.foot.max), fam = clip(family, R.fam.max);
  const t = (y, size, extra, txt) => `<text x="256" y="${y}" text-anchor="middle" font-family="Georgia,serif" font-size="${size}"${extra} fill="${P.text}">${X(txt)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="${X("Badge scoperta: " + nm)}">` +
    `<defs><clipPath id="m"><circle cx="${m.cx}" cy="${m.cy}" r="${m.r}"/></clipPath></defs>` +
    `<polygon id="hx-o" points="${hexPts(R.hex.outer)}" fill="${P.bg}" stroke="${P.rim}" stroke-width="${R.hex.rim}" stroke-linejoin="round"/>` +
    `<polygon id="hx-i" points="${hexPts(R.hex.inner)}" fill="none" stroke="${P.accent}" stroke-width="${R.hex.line}"/>` +
    t(R.top.y, R.top.fs, ' letter-spacing="4"', "SCOPERTA") +
    `<circle cx="${m.cx}" cy="${m.cy}" r="${m.r}" fill="${P.rim}"/>` +
    (img ? `<image href="${img}" x="${m.cx - m.photo / 2}" y="${m.cy - m.photo / 2}" width="${m.photo}" height="${m.photo}" preserveAspectRatio="xMidYMid slice" clip-path="url(#m)"/>` : "") +
    `<circle cx="${m.cx}" cy="${m.cy}" r="${m.r}" fill="none" stroke="${P.accent}" stroke-width="${m.ring}"/>` +
    `<rect x="${k.x}" y="${k.y}" width="${k.w}" height="${k.h}" rx="${k.rx}" fill="${P.rim}" stroke="${P.accent}" stroke-width="3"/>` +
    t(R.name.y, fs, ' font-style="italic"', nm) + t(R.foot.y, R.foot.fs, "", foot) + t(R.fam.y, R.fam.fs, "", fam) + `</svg>`;
}

// Restituisce l'elenco delle regole violate (vuoto = badge conforme).
export function validateBadge(svg) {
  const s = String(svg), e = [], need = (ok, msg) => { if (!ok) e.push(msg); }, m = R.medal, k = R.ribbon;
  need(s.length <= R.maxBytes, "troppo grande");
  need(s.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"'), "tela non 512×512");
  need(!/<script|<foreignObject|<style|\son\w+=|javascript:/i.test(s), "contenuto attivo non ammesso");
  need(!/(?:href|src)="(?!data:image\/jpeg;base64,|#)/i.test(s), "riferimenti esterni non ammessi");
  const poly = [...s.matchAll(/<polygon [^>]*points="([^"]+)"/g)].map((x) => x[1]);
  need(poly.length === 2 && poly[0] === hexPts(R.hex.outer) && poly[1] === hexPts(R.hex.inner), "esagono non conforme");
  need((s.match(new RegExp(`<circle cx="${m.cx}" cy="${m.cy}" r="${m.r}"`, "g")) || []).length === 3 && (s.match(/<clipPath id="m">/g) || []).length === 1, "medaglione non conforme");
  need(new RegExp(`<image href="data:image/jpeg;base64,[A-Za-z0-9+/=]+" x="${m.cx - m.photo / 2}" y="${m.cy - m.photo / 2}" width="${m.photo}" height="${m.photo}" preserveAspectRatio="xMidYMid slice" clip-path="url\\(#m\\)"/>`).test(s) && (s.match(/<image /g) || []).length === 1, "foto reale mancante o non conforme");
  need(s.includes(`<rect x="${k.x}" y="${k.y}" width="${k.w}" height="${k.h}" rx="${k.rx}"`), "nastro non conforme");
  const texts = [...s.matchAll(/<text [^>]*font-size="(\d+)"[^>]*>([^<]*)<\/text>/g)];
  need(texts.length === 4, "servono esattamente 4 testi");
  if (texts.length === 4) {
    const nm = texts[1], len = [...nm[2].replace(/&[a-z#0-9]+;/g, "x")].length;
    need(len <= R.name.max && +nm[1] === nameFont(len) && +nm[1] >= R.name.fsMin && +nm[1] <= R.name.fsMax, "nome fuori regola (lunghezza o corpo)");
    need(R.name.charW * len * +nm[1] <= R.name.room, "il nome non sta nel nastro");
  }
  const fills = [...s.matchAll(/(?:fill|stroke)="([^"]+)"/g)].map((x) => x[1]);
  need(fills.every((c) => c === "none" || /^#[0-9a-f]{6}$/.test(c)), "colori solo in esadecimale");
  const o = s.match(/<polygon id="hx-o"[^>]*fill="(#[0-9a-f]{6})" stroke="(#[0-9a-f]{6})"/);
  need(!!o && contrast("#ffffff", o[1]) >= R.minContrast && contrast("#ffffff", o[2]) >= R.minContrast, "contrasto del testo insufficiente");
  return e;
}
