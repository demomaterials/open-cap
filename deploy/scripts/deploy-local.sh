#!/usr/bin/env bash
# Fresh Rancher Desktop cluster → running open-cap at https://cap.bupasec.com
#   ./deploy-local.sh [--skip-build] [--no-smoke]
set -euo pipefail
cd "$(dirname "$0")/.."      # deploy/
NS=cap
ENV="${ENV:-rancher}"
SKIP_BUILD=0; SMOKE=1
for a in "$@"; do
  case "$a" in
    --skip-build) SKIP_BUILD=1 ;;
    --no-smoke) SMOKE=0 ;;
    *) echo "unknown flag $a"; exit 2 ;;
  esac
done

echo "### 1/6 Envoy Gateway controller"
./setup/install-envoy-gateway.sh

echo "### 2/6 Secrets"
./scripts/bootstrap-secrets.sh
kubectl -n "$NS" get secret cap-tls >/dev/null 2>&1 || ./scripts/make-local-ca.sh --apply

if [[ $SKIP_BUILD == 0 ]]; then
  echo "### 3/6 Images"
  ./scripts/build-images.sh
fi

echo "### 4/6 gateway-stack"
helm upgrade --install cap-gateway ./charts/gateway-stack -n "$NS" -f "./charts/gateway-stack/values-$ENV.yaml" --wait=legacy --timeout 5m

echo "### 5/6 db-stack"
helm upgrade --install cap-db ./charts/db-stack -n "$NS" -f "./charts/db-stack/values-$ENV.yaml" --wait=legacy --timeout 10m

echo "### 6/6 app-stack"
helm upgrade --install cap ./charts/app-stack -n "$NS" -f "./charts/app-stack/values-$ENV.yaml" --wait=legacy --timeout 10m
# Local images keep the same tag; restart so rebuilt images are picked up.
if [[ $SKIP_BUILD == 0 ]]; then
  kubectl -n "$NS" rollout restart deploy -l app.kubernetes.io/part-of=open-cap >/dev/null
  kubectl -n "$NS" rollout status deploy -l app.kubernetes.io/part-of=open-cap --timeout=5m
fi

kubectl -n "$NS" get pods
[[ $SMOKE == 1 ]] && ./scripts/smoke-test.sh
echo
echo "open-cap is up: https://cap.bupasec.com  (user: admin)"
echo "  password: kubectl -n $NS get secret cap-app-secrets -o jsonpath='{.data.ADMIN_PASSWORD}' | base64 -d; echo"
