#!/usr/bin/env bash
# Prepara in modo idempotente le risorse Cloudflare e le stampa su GITHUB_OUTPUT. Richiede: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID.
# [da verificare] endpoint e permessi del token (Workers Scripts:Edit, Workers KV Storage:Edit, Account Settings:Read).
set -euo pipefail
api="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID"
auth=(-H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json")

sub=$(curl -fsS "${auth[@]}" "$api/workers/subdomain" | jq -r '.result.subdomain // empty')
if [ -z "$sub" ]; then
  sub="grimorio-$(printf '%s' "$CLOUDFLARE_ACCOUNT_ID" | sha256sum | cut -c1-8)"
  curl -fsS -X PUT "${auth[@]}" "$api/workers/subdomain" -d "{\"subdomain\":\"$sub\"}" >/dev/null
fi

kv=$(curl -fsS "${auth[@]}" "$api/storage/kv/namespaces?per_page=100" | jq -r '.result[] | select(.title=="grimorio-store") | .id' | head -n1)
if [ -z "$kv" ]; then
  kv=$(curl -fsS -X POST "${auth[@]}" "$api/storage/kv/namespaces" -d '{"title":"grimorio-store"}' | jq -r '.result.id')
fi

{ echo "worker_url=https://grimorio-api.$sub.workers.dev"; echo "kv_id=$kv"; } >> "${GITHUB_OUTPUT:-/dev/stdout}"
