# GRIMORIO BOTANICO — Specifica v4

PWA gratuita e aperta: fotografi (o inquadri) una pianta, la riconosci e la scheda entra in una **libreria pubblica** che cresce da sola.
Principi: **costo zero · nessun dato utente · nessun account · il minimo intervento umano · sicurezza dei contenuti prima di tutto**.
Revisione del 2 ottobre 2026. Sostituisce la v3.

## 1. Cosa cambia rispetto alla v3

| v3 | v4 | Perché |
|---|---|---|
| Supabase (DB, Auth, cron, Edge Functions) | **Git come database**: una scheda JSON per specie nel repo pubblico | niente pausa dopo 7 giorni, niente backup da fare (la cronologia git *è* il backup), libreria clonabile da chiunque |
| Auth anonima, quote per utente e per hash IP, profili, collection, area admin | **Nessun account, nessuna tabella utenti.** Il "grimorio" personale sta solo sul dispositivo (IndexedDB) | zero dati utente |
| Gemini + fatturazione consigliata (D1) | **GitHub Models** col `GITHUB_TOKEN` dell'Action: nessuna chiave, nessun costo | i termini del free tier Gemini non coprono utenti SEE |
| 7 segreti | **3 segreti** | meno lavoro tuo |
| Moderazione in app | **Automatica**: ≥3 segnalazioni su una scheda = rigenerazione dalle fonti | nessuno da pagare o da disturbare |
| Dosi (flag) e ricette | **Eliminate** | senza revisore umano non c'è modo sicuro di pubblicarle |
| Gemini Vision come ripiego | Eliminato (già nella v3) | identificare a occhio è il rischio n. 1 |

## 2. Cosa fai tu (una volta, ~15 minuti)
1. **GitHub**: nuovo repository *pubblico* `grimorio`. Settings → Pages → Source: *GitHub Actions*. Settings → Actions → General → Workflow permissions: *Read and write*.
2. **Cloudflare**: account gratuito (senza carta). Crea un *API token* con permessi di modifica su Workers e Workers KV e lettura delle impostazioni account [da verificare i nomi esatti dei permessi]; copia anche l'*Account ID*.
3. **Pl@ntNet**: registrati su my.plantnet.org e copia la API key.
4. GitHub → Settings → Secrets and variables → Actions → 3 segreti: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `PLANTNET_API_KEY`.
5. Collega Claude Code al repo e incolla il **prompt master** (§10). Fine: tutto il resto è automatico.

Nessuna decisione sull'LLM (usa GitHub Models), nessuna email di login, nessun numero da copiare (lo verifica l'agente).

## 3. Architettura

```
[PWA React · GitHub Pages]  ── legge ──►  data/index.json + data/plants/<slug>.json   (file statici, nel repo)
   │ 2–5 foto (≤768 px, JPEG, EXIF rimosso sul dispositivo) = 1 credito Pl@ntNet
   ▼
[Cloudflare Worker]  /identify  ─ inoltra in streaming a Pl@ntNet (la chiave resta qui) ─► top-5 + GBIF + lista rossa + verdetto
                     /request   ─ verifica su GBIF che sia una pianta ─► coda (Workers KV, 7 giorni)
                     /report    ─ segnalazione anonima (slug, sezione, ≤500 caratteri) ─► KV (30 giorni)
   ▲ GET /queue (Bearer derivato da CLOUDFLARE_API_TOKEN: nessun segreto in più)
[GitHub Action "generate", ogni ~30 min]
   coda utenti + rigenerazioni da segnalazioni + seed ─► GBIF · Wikidata · Wikipedia · Europe PMC
   ─► LLM (GitHub Models) ─► validatore deterministico ─► scheda JSON ─► commit ─► deploy del sito
```
Latenza di una specie nuova: da pochi minuti a qualche ora (cron di GitHub best-effort + limiti del free tier LLM). L'app lo dice e ricorda la richiesta sul dispositivo; alla riapertura la scheda compare da sola.

## 4. Flusso utente
1. **Camera**: anteprima live (`getUserMedia`, camera posteriore) con modalità guidata foglia → fiore/frutto → portamento. Per ogni organo l'app cattura una breve raffica di fotogrammi e tiene il **più nitido** (varianza del Laplaciano su una copia a bassa risoluzione). Fallback automatico: `<input type="file" accept="image/*" capture="environment">`. **Non** si identifica ogni fotogramma: la quota Pl@ntNet (500/giorno, condivisa) si esaurirebbe in pochi minuti. Le foto non vengono mai salvate.
2. **Risultato** (verdetto dal Worker, soglie da calibrare): `probabile` (1ª ≥ 0,80, distacco ≥ 0,25, nessuna candidata ≥ 0,10 in lista rossa) · `da_affinare` (chiede altre foto mirate; avviso rosso se c'è lista rossa) · `non_riconosciuta` (1ª < 0,30) · `non_pianta`.
3. **Scheda presente** → si mostra (0 uso IA). **Assente** → "Aggiungila alla libreria": il Worker verifica Plantae su GBIF, deduplica e accoda.
4. **Quota Pl@ntNet esaurita** → messaggio chiaro + ricerca per nome (client-side su `index.json`). Nessuna identificazione con IA di visione.
5. **Il mio grimorio**: schede salvate e richieste in attesa, solo su IndexedDB ("N su M"), disponibili offline.
6. **Segnala errore** per sezione (anonimo).

## 5. Dati e privacy (zero dati utente)
- Nessun account, cookie, analytics, tracker, font o script da CDN esterni. Nessun log applicativo. **Unica eccezione**: lo script di Cloudflare Turnstile, caricato solo quando si invia una richiesta al Worker e dichiarato nell'informativa.
- Il Worker non legge né salva IP; inoltra il multipart senza ispezionarlo. Pl@ntNet vede il Worker, non l'utente. Cloudflare e GitHub, come infrastruttura, vedono comunque gli IP in transito: l'informativa lo dice.
- Unici dati scritti dal Worker: richieste in coda (gbif_key + nome specie, 7 giorni) e segnalazioni (slug, sezione, testo; 30 giorni). Nessun identificativo.
- La libreria è pubblica, licenza **CC BY-SA 4.0** (derivata da Wikipedia): attribuzione in ogni scheda.
- Anti-abuso senza identità: Cloudflare Turnstile (widget invisibile; il Worker verifica il token con Siteverify, **senza inoltrare l'IP**; ogni token vale una sola volta e scade in 5 minuti, quindi il client ne chiede uno nuovo per ogni chiamata), rate limiting per IP tramite il binding `ratelimit` (la chiave non viene salvata da noi), tetto sulla coda (60) e sulle segnalazioni (300), richieste solo per specie vegetali di GBIF.

## 6. Sicurezza dei contenuti (nel codice, non nell'IA)
- **Validatore** (`lib/validator.js`, 22 gruppi di test superati): ogni affermazione è `{t, s, q}`; `q` (citazione letterale 3–30 parole) deve comparire nel frammento citato (alla lettera, o ≥90% dei bigrammi dentro una finestra locale); ogni numero di `t` deve comparire come numero intero nel testo citato; testi con link/HTML o promesse sanitarie ("cura", "guarisce"…) sono scartati; la scheda è ricostruita da una allowlist di campi, e `q` non viene salvata. >40% di affermazioni scartate, tossicità mancante pur avendo fonti che ne parlano, look-alike mancanti o sintesi vuota ⇒ **scheda non pubblicata**.
- **Limite noto, dichiarato**: il validatore garantisce che ogni frase sia *tracciabile* a una fonte, non che la parafrasi sia semanticamente fedele (il controllo lessicale non funziona tra lingue). Per questo esistono i livelli, gli avvisi e le segnalazioni.
- **Livelli**: default `alto` per qualunque specie sconosciuta; solo `data/taxa_policy.json` (curata, 61 alto · 5 medio · 16 basso) può abbassarlo. `alto`: solo identificazione, tossicità, avvertenze. `medio`: uso culinario, nessuna preparazione. `basso`: preparazioni tradizionali con fonte, **senza dosi**.
- **Look-alike**: campo obbligatorio; il nome deve comparire nel testo citato; la pericolosità è decisa dal codice (se il look-alike è in lista rossa ⇒ almeno `alta` e la scheda diventa `alto`). In più `data/lookalikes.json` (curato) aggiunge dal codice le confusioni note (es. aglio orsino ↔ mughetto/colchico/gigaro) e un test verifica che quelle "mortali" siano in lista rossa.
- **Nessuna informazione ≠ sicurezza**: se le fonti non parlano di tossicità la scheda riporta la nota fissa.
- **Fuori scopo**: funghi e non-piante (rifiutati da `/request`), diagnosi e cure, ricette, dosi, preparazioni di cannabis/oppio/efedra (solo scheda informativa).
- **Invarianti** (`scripts/check-invariants.mjs`, in CI e prima di ogni commit di dati): fonte presente, immagini con autore+licenza, tossicità o nota fissa, nessuna preparazione in `alto`, lista rossa coerente con i tier, nessuna `q` salvata.
- ⚠ `taxa_policy.json` e `lookalikes.json` sono un punto di partenza **non rivisto da un tossicologo**. Si estendono con una Pull Request.

## 7. Moderazione (facoltativa, zero obbligatoria)
Niente area admin. ≥3 segnalazioni su una scheda ⇒ rigenerazione dalle fonti (mai ritiro automatico: sarebbe un'arma per i vandali). Chi vuole intervenire modifica un JSON con una PR o usa `workflow_dispatch`. Un workflow fallito ti arriva come email di GitHub: è l'unico "avviso" previsto.

## 8. Limiti reali e stato di verifica (2 ottobre 2026)
| Cosa | Stato |
|---|---|
| GitHub Models: accesso gratuito con limiti di frequenza per ogni account; in Action con `GITHUB_TOKEN` e permesso `models: read`; endpoint compatibile OpenAI `https://models.github.ai/inference` | **verificato** (documentazione) |
| GitHub Models: limiti di token per richiesta, ID modello (`publisher/model`), idoneità del free tier per un'app pubblica (è descritto come adatto al prototipo) | **da verificare**: il primo run lo scopre; `FRAG_BUDGET`, `LLM_MODEL`, `LLM_BASE_URL` sono configurabili. Se non idoneo: stesso client, altro provider |
| Cloudflare Workers Free: 100.000 richieste/giorno, 10 ms di CPU per richiesta; **50 subrequest esterne + 1.000 verso servizi Cloudflare (KV) per invocazione** (il Worker ne usa al massimo ~8); KV free: 100k letture, 1.000 scritture/giorno | **verificato** (documentazione ufficiale, ottobre 2026) |
| Turnstile: piano gratuito, fino a 20 widget per account; la verifica lato server (Siteverify) è obbligatoria | **verificato** |
| Rate Limiting nei Worker: binding `ratelimit` stabile (GA da settembre 2025), opzioni `namespace_id` e `simple {limit, period: 10 o 60 s}` | **verificato** l'esistenza e le opzioni; **da verificare** la riga esatta in `wrangler.toml` e la disponibilità sul piano free (blocco già pronto, commentato, in `wrangler.toml`) |
| Pl@ntNet: 500 identificazioni/giorno in totale, uso non commerciale, attribuzione obbligatoria, ≤5 foto = 1 credito | dalla v3, **non riverificato**. È il vero tetto di scala dell'app |
| Permessi esatti del token API, endpoint `workers/subdomain`, `wrangler-action` con `secrets`, bot-commit come "attività" contro la disattivazione dei cron | **da verificare** (l'agente lo fa e annota in `docs/DECISIONS.md`) |
| Workflow schedulati GitHub: si disattivano dopo 60 giorni senza attività del repo | noto; `maintenance.yml` fa un commit di rinnovo |

### Già fatto su Cloudflare da questa chat (connettore collegato)
- Account raggiunto: 0 Worker e 0 namespace KV all'inizio.
- Creato il namespace KV **`grimorio-store`** (id `a070f85486ea4665968c76d986ba6286`). Il deploy lo ritrova per nome: `ensure-cloudflare.sh` non ne crea un secondo.
- Il connettore *non* può: creare token API, registrare il sottodominio workers.dev, creare widget Turnstile o pubblicare il codice di un Worker. Per questo restano il token (passo 2 del §2) e il deploy via GitHub Action.

## 9. Criteri di accettazione
CI verde (`npm test`: 22 gruppi, invarianti, scansione segreti, build PWA) · sito online su GitHub Pages · Worker raggiungibile (`/health`) · `identify` risponde con una foto di prova · ≥3 schede generate end-to-end dal seed · `Allium ursinum`, `Foeniculum vulgare`, `Daucus carota` risultano `alto` con look-alike mortali visibili · nessuna scheda con `blocked` pubblicata · nessuna chiave nel bundle · l'app funziona senza alcun account.
Dopo il lancio, **facoltativo**: 10 foto reali (luce scarsa, piante giovani, parti incomplete) per calibrare le soglie del §4.

## 10. Prompt master per l'agente di coding
*Copia da qui a "FINE PROMPT".*

Sei l'ingegnere unico di "Grimorio Botanico". Questo documento (GRIMORIO_v4.md) è la specifica; i blocchi `### FILE: percorso` sono file del repo già scritti e collaudati.
Obiettivo: consegnare nel repo GitHub corrente l'app completa, collegata a CI/CD, con il MINIMO lavoro per l'utente. L'utente NON è uno sviluppatore: non fargli domande tecniche, decidi tu e annota in `docs/DECISIONS.md`. Se manca un segreto o un account, scrivilo in `docs/BLOCKERS.md` ed esegui comunque tutto il resto.

Regole fisse
- Costo zero: solo piani gratuiti. Nessun account utente, cookie, analytics, tracker, log di IP, font o script da CDN esterni (unica eccezione: lo script di Turnstile). Vietato introdurre Auth, database utenti o servizi a pagamento.
- Nessuna chiave nel frontend o nel repo. Nel bundle solo `VITE_API_URL` (e, se esiste, la site key pubblica di Turnstile).
- Estrai ogni blocco `### FILE:` IDENTICO al percorso indicato. Non riscrivere `lib/validator.js`, `lib/policy.js`, `lib/identify.js`, `lib/prompt.js` e i relativi test: se un test fallisce, correggi il codice che lo usa, non il test, salvo un errore dimostrabile (annotalo).
- Dove la specifica dice [da verificare], verifica sulla documentazione ufficiale e correggi (es. ID modello e limiti di token di GitHub Models, sintassi Rate Limiting di Cloudflare, permessi del token, `wrangler-action`). Annota ogni correzione.

Ordine di lavoro (commit piccoli, CI sempre verde)
1. Estrai i file, aggiungi `.gitignore`, esegui `npm test`.
2. `web/` è GIÀ scritta (JavaScript puro, nessuna build, nessuna dipendenza: `index.html`, `app.js`, `sw.js`, `config.js`, manifest). Non riscriverla: completala solo dove serve (icone PNG per iOS generate da `icon.svg`, Turnstile del punto 4, rifiniture grafiche) mantenendo `npm test` verde. Il deploy sostituisce `__API_URL__` in `config.js`.
3. Verifica il numero del Centro Antiveleni di Verona (AOUI Verona) sul sito ufficiale e inseriscilo in `emergency.json`; se non riesci a verificarlo, lascia `null`.
4. Turnstile: crea un widget *Invisible* via API se il token lo consente (altrimenti `docs/BLOCKERS.md`), imposta `TURNSTILE_SECRET` sul Worker e la site key pubblica come variabile di build. Nella PWA chiedi un token NUOVO prima di ogni chiamata a `/identify`, `/request`, `/report` (valgono una volta sola, 5 minuti) e inviarlo nell'header `x-turnstile`. Poi verifica la sintassi del binding `ratelimit` (blocco commentato in `wrangler.toml`), attivalo e annota in `docs/DECISIONS.md`.
5. Fai girare la CI, correggi finché è verde, poi deploy (`deploy.yml`), poi lancia `generate.yml` (seed). Controlla che le prime schede compaiano e passino gli invarianti.
6. Scrivi `docs/README.md` (10 righe: cos'è, cosa è automatico, come aggiungere una specie = una riga in `seed/species.txt`, cosa fare se un workflow diventa rosso).
7. Rispondi all'utente con 5 righe: URL del sito, cosa è automatico, cosa deve ancora fare lui (solo la calibrazione facoltativa del §9), eventuali blocchi.

FINE PROMPT
