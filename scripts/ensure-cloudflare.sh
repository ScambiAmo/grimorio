#!/usr/bin/env bash
# Prepara in modo idempotente le risorse Cloudflare e le stampa su GITHUB_OUTPUT. Richiede: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID.
# Permessi del token: Workers Scripts:Edit, Workers KV Storage:Edit, Account Settings:Read.
set -euo pipefail
api="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID"
tmp="$(mktemp)"

# cf METHOD PATH [BODY]: stampa il JSON della risposta. Se l HTTP non è 2xx stampa gli errori di Cloudflare
# (visibili come annotazione del job) e fallisce. CF_LEVEL=warning per le chiamate che possiamo tollerare.
cf() {
  local method=$1 path=$2 body=${3:-} code
  local args=(-sS -X "$method" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" -o "$tmp" -w "%{http_code}")
  if [ -n "$body" ]; then args+=(-d "$body"); fi
  code=$(curl "${args[@]}" "$api$path") || { echo "::${CF_LEVEL:-error}::Cloudflare $method $path: rete non raggiungibile" >&2; return 1; }
  if [[ "$code" != 2* ]]; then
    echo "::${CF_LEVEL:-error}::Cloudflare $method $path -> HTTP $code: $(jq -c ".errors // ." "$tmp" 2>/dev/null || head -c 300 "$tmp")" >&2
    return 1
  fi
  cat "$tmp"
}

# Su un account nuovo il sottodominio workers.dev può non esistere ancora: in quel caso lo creiamo.
sub=$(CF_LEVEL=warning cf GET /workers/subdomain | jq -r ".result.subdomain // empty" || true)
if [ -z "$sub" ]; then
  sub="grimorio-$(printf "%s" "$CLOUDFLARE_ACCOUNT_ID" | sha256sum | cut -c1-8)"
  cf PUT /workers/subdomain "{\"subdomain\":\"$sub\"}" >/dev/null
fi

kv=$(cf GET "/storage/kv/namespaces?per_page=100" | jq -r ".result[] | select(.title==\"grimorio-store\") | .id" | head -n1)
if [ -z "$kv" ]; then
  kv=$(cf POST /storage/kv/namespaces "{\"title\":\"grimorio-store\"}" | jq -r ".result.id")
fi

{ echo "worker_url=https://grimorio-api.$sub.workers.dev"; echo "kv_id=$kv"; } >> "${GITHUB_OUTPUT:-/dev/stdout}"
