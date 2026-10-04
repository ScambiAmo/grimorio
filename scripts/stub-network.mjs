// Precaricato dai test: sostituisce fetch con risposte finte (GBIF, Wikidata, Wikipedia, Commons, LLM).
const R = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
const IT = "Allium ursinum, detto aglio orsino, è una pianta erbacea perenne. Le foglie possono essere confuse con quelle di Convallaria majalis, che è tossico. Cresce nei boschi umidi.";
const CARD = {
  schema_version: 4,
  summary: { t: "Pianta erbacea perenne dei boschi umidi", s: ["S1"], q: "è una pianta erbacea perenne" },
  identification: { keys: [{ t: "Cresce nei boschi umidi", s: ["S1"], q: "Cresce nei boschi umidi" }], habitat: null, distribution: null, season: {} },
  toxicity: { claims: [{ t: "Le foglie si confondono con una specie tossica", s: ["S1"], q: "possono essere confuse con quelle di Convallaria majalis" }] },
  lookalikes: [{ name: "Convallaria majalis", danger: "bassa", claim: { t: "Foglie confondibili col mughetto", s: ["S1"], q: "possono essere confuse con quelle di Convallaria majalis" } }],
  warnings: [], therapeutic_and_medicinal: { preparations: [{ name: "Infuso", part: "foglie", claim: { t: "Infuso", s: ["S1"], q: "è una pianta erbacea perenne" } }] },
  culinary_uses: { edible_parts: [{ part: "foglie", claim: { t: "Foglie", s: ["S1"], q: "è una pianta erbacea perenne" } }] }, legal: { protection: null },
};
globalThis.fetch = async (url) => {
  const u = String(url);
  if (process.env.STUB_EXPECT_CF && u.includes("/chat/completions") && !u.startsWith("https://api.cloudflare.com/client/v4/accounts/acc/ai/v1/")) return new Response("url sbagliato", { status: 500 });
  if (process.env.STUB_LLM === "401" && u.includes("/chat/completions")) return new Response(JSON.stringify({ success: false, errors: [{ code: 10000, message: "Authentication error" }] }), { status: 401 });
  if (process.env.STUB_LLM === "fence" && u.includes("/chat/completions")) return R({ choices: [{ message: { content: "Ecco la scheda:\n```json\n" + JSON.stringify(CARD) + "\n```" } }] });
  if (u.includes("models.github.ai") || u.includes("/chat/completions")) return process.env.STUB_LLM === "429" ? new Response("", { status: 429 }) : R({ choices: [{ message: { content: JSON.stringify(CARD) } }] });
  if (u.includes("/species/match")) return R({ usageKey: 5, matchType: "EXACT" });
  if (u.endsWith("/species/5")) return R({ key: 5, kingdom: "Plantae", rank: "SPECIES", canonicalName: "Allium ursinum", family: "Amaryllidaceae" });
  if (u.includes("vernacularNames")) return R({ results: [{ vernacularName: "Aglio orsino", language: "ita" }, { vernacularName: "Ramsons", language: "eng" }] });
  if (u.includes("/synonyms")) return R({ results: [{ canonicalName: "Allium latifolium" }] });
  if (u.includes("wikidata.org") && u.includes("list=search")) return R({ query: { search: [{ title: "Q1" }] } });
  if (u.includes("wikidata.org")) return R({ entities: { Q1: { sitelinks: { itwiki: { title: "Allium ursinum" } }, claims: { P18: [{ mainsnak: { datavalue: { value: "Img.jpg" } } }] }, labels: { it: { value: "Aglio orsino" } } } } });
  if (u.includes("it.wikipedia.org")) return R({ query: { pages: { 1: { title: "Allium ursinum", extract: IT } } } });
  if (u.includes("en.wikipedia.org")) return R({ query: { pages: { "-1": { missing: "" } } } });
  if (u.includes("europepmc")) return R({ resultList: { result: [] } });
  if (u.includes("commons.wikimedia.org")) return R({ query: { pages: { 1: { imageinfo: [{ thumburl: "https://upload.wikimedia.org/x.jpg", descriptionurl: "https://commons.wikimedia.org/wiki/File:Img.jpg", extmetadata: { LicenseShortName: { value: "CC BY-SA 4.0" }, Artist: { value: "<a>Mario</a>" } } }] } } } });
  return R({}, 404);
};
