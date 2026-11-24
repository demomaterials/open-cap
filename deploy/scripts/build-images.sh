#!/usr/bin/env bash
# Build all open-cap images into the local Docker daemon (Rancher Desktop's
# k3s uses the same daemon, so no push is needed).
#   TAG=1 ./build-images.sh            REGISTRY=<acct>.dkr.ecr.../ PUSH=1 ./build-images.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TAG="${TAG:-1}"
REGISTRY="${REGISTRY:-}"

for svc in backend collector evaluator presenter; do
  echo "==> cap-$svc"
  docker build -q --build-arg SERVICE="$svc" -t "${REGISTRY}cap-$svc:$TAG" "$ROOT/services"
done
echo "==> cap-frontend"
docker build -q -t "${REGISTRY}cap-frontend:$TAG" "$ROOT/frontend"

if [[ "${PUSH:-0}" == "1" ]]; then
  for img in frontend backend collector evaluator presenter; do docker push "${REGISTRY}cap-$img:$TAG"; done
fi
