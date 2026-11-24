#!/usr/bin/env bash
# Create the namespace and the Secrets the charts reference — only if absent,
# so re-running never rotates anything. No chart templates a Secret.
#
#   cap-db-credentials   POSTGRES_PASSWORD, APP_DB_PASSWORD
#   cap-app-secrets      JWT_SECRET, CAP_ENCRYPTION_KEY, ADMIN_PASSWORD
#
# CAP_ENCRYPTION_KEY encrypts every connector PAT and webhook secret at rest.
# Losing it means re-entering all PATs; back it up with your other secrets.
#
# To supply your own values instead, apply scripts/secrets.example.yaml
# (copied to secrets-<env>.yaml, gitignored) before running this script.
set -euo pipefail
NAMESPACE="${NAMESPACE:-cap}"

kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
rand() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c "${1:-32}"; }

ensure() {
  local name="$1"; shift
  if kubectl -n "$NAMESPACE" get secret "$name" >/dev/null 2>&1; then
    echo "secret/$name exists (kept)"
  else
    kubectl -n "$NAMESPACE" create secret generic "$name" "$@" >/dev/null
    echo "secret/$name created"
  fi
}

ensure cap-db-credentials \
  --from-literal=POSTGRES_PASSWORD="$(rand 32)" \
  --from-literal=APP_DB_PASSWORD="$(rand 32)"

ensure cap-app-secrets \
  --from-literal=JWT_SECRET="$(rand 64)" \
  --from-literal=CAP_ENCRYPTION_KEY="$(rand 64)" \
  --from-literal=ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(rand 20)}"

echo
echo "Initial admin password (user 'admin'):"
echo "  kubectl -n $NAMESPACE get secret cap-app-secrets -o jsonpath='{.data.ADMIN_PASSWORD}' | base64 -d; echo"
