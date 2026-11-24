#!/usr/bin/env bash
# End-to-end checks through the Envoy gateway. Needs no /etc/hosts entry.
set -uo pipefail
cd "$(dirname "$0")"
HOST="${HOST:-cap.bupasec.com}"
ADDR="${ADDR:-127.0.0.1}"
NS="${NS:-cap}"
CA="local-ca/ca.crt"
CURL=(curl -sS --max-time 20 --resolve "$HOST:443:$ADDR" --resolve "$HOST:80:$ADDR")
[[ -f $CA ]] && CURL+=(--cacert "$CA") || CURL+=(-k)
BASE="https://$HOST"
PASS=0; FAIL=0
ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ✗ $1"; FAIL=$((FAIL+1)); }
expect() { # name expected actual
  [[ "$2" == "$3" ]] && ok "$1" || bad "$1 (expected $2, got $3)"; }
code() { "${CURL[@]}" -o /dev/null -w '%{http_code}' "$@"; }

echo "== edge"
expect "http redirects to https" 301 "$(code "http://$HOST/")"
expect "SPA served" 200 "$(code "$BASE/")"
expect "SPA deep link served" 200 "$(code "$BASE/frameworks/abc")"
expect "API requires auth" 401 "$(code "$BASE/api/assets")"
expect "compliance API requires auth" 401 "$(code "$BASE/api/compliance/summary")"
expect "unknown webhook connector rejected" 404 "$(code -X POST -H 'content-type: application/json' -d '{}' "$BASE/webhooks/github/00000000-0000-0000-0000-000000000000")"
expect "evaluator internal API not exposed" 200 "$(code "$BASE/internal/status")"   # falls through to SPA, never the evaluator
body=$("${CURL[@]}" "$BASE/internal/status" | head -c 200)
[[ "$body" == *"<!doctype html>"* ]] && ok "/internal/* lands on the SPA" || bad "/internal/* reached a service: $body"

echo "== auth"
PW=$(kubectl -n "$NS" get secret cap-app-secrets -o jsonpath='{.data.ADMIN_PASSWORD}' | base64 -d)
expect "bad password rejected" 401 "$(code -X POST -H 'content-type: application/json' -d '{"username":"admin","password":"wrong-password"}' "$BASE/api/auth/login")"
TOKEN=$("${CURL[@]}" -X POST -H 'content-type: application/json' -d "{\"username\":\"admin\",\"password\":\"$PW\"}" "$BASE/api/auth/login" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
[[ -n "$TOKEN" ]] && ok "admin login" || { bad "admin login"; echo "$PASS passed, $FAIL failed"; exit 1; }
AUTH=(-H "authorization: Bearer $TOKEN")
expect "me" 200 "$(code "${AUTH[@]}" "$BASE/api/auth/me")"

echo "== catalog"
n=$("${CURL[@]}" "${AUTH[@]}" "$BASE/api/controls" | grep -o '"key":"' | wc -l | tr -d ' ')
[[ $n -ge 19 ]] && ok "built-in controls seeded ($n)" || bad "controls seeded ($n)"
n=$("${CURL[@]}" "${AUTH[@]}" "$BASE/api/frameworks" | grep -o '"key":"' | wc -l | tr -d ' ')
[[ $n -ge 3 ]] && ok "frameworks seeded ($n)" || bad "frameworks seeded ($n)"

echo "== evaluate"
r=$("${CURL[@]}" "${AUTH[@]}" -X POST -H 'content-type: application/json' \
  -d '{"rego":"package cap\ndefault pass := false\npass if input.owner == \"smoke\"","definition":{"owner":"smoke"}}' "$BASE/api/controls/test")
[[ "$r" == *'"status":"pass"'* ]] && ok "rego test endpoint (evaluator + OPA)" || bad "rego test: $r"
r=$("${CURL[@]}" "${AUTH[@]}" -X POST -H 'content-type: application/json' -d '{"rego":"package cap\npass if {"}' "$BASE/api/controls/validate")
[[ "$r" == *'"ok":false'* ]] && ok "invalid rego rejected" || bad "invalid rego: $r"
expect "ingest smoke asset" 200 "$(code "${AUTH[@]}" -X POST -H 'content-type: application/json' \
  -d '[{"type":"application","external_id":"smoke:app","name":"smoke-test-app","owner":"smoke","members":["a","b"]}]' "$BASE/api/assets/ingest")"
sleep 4
s=$("${CURL[@]}" "${AUTH[@]}" "$BASE/api/compliance/summary")
[[ "$s" == *'"application"'* ]] && ok "application results in compliance summary" || bad "summary: ${s:0:200}"
expect "CSV export" 200 "$(code "${AUTH[@]}" "$BASE/api/compliance/export.csv")"
SMOKE_ID=$("${CURL[@]}" "${AUTH[@]}" "$BASE/api/assets?q=smoke:app" | sed -n 's/.*"id":"\([0-9a-f-]\{36\}\)".*/\1/p' | head -1)
[[ -n "$SMOKE_ID" ]] && expect "remove smoke asset" 204 "$(code "${AUTH[@]}" -X DELETE "$BASE/api/assets/$SMOKE_ID")"

echo
echo "$PASS passed, $FAIL failed"
[[ $FAIL == 0 ]]
