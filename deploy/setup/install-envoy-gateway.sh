#!/usr/bin/env bash
# Install the Envoy Gateway controller (Gateway API implementation).
# The chart bundles the Gateway API CRDs + Envoy Gateway CRDs.
# The GatewayClass/Gateway/TLS listener come from charts/gateway-stack.
#
# Prereqs on Rancher Desktop: Traefik disabled (Preferences → Kubernetes),
# so nothing else claims ports 80/443.
set -euo pipefail

EG_VERSION="${EG_VERSION:-v1.9.3}"

if helm status eg -n envoy-gateway-system >/dev/null 2>&1; then
  echo "Envoy Gateway already installed:"; helm list -n envoy-gateway-system
else
  helm upgrade --install eg oci://docker.io/envoyproxy/gateway-helm \
    --version "$EG_VERSION" \
    --namespace envoy-gateway-system --create-namespace \
    --wait=legacy --timeout 5m
fi
kubectl wait --namespace envoy-gateway-system --for=condition=Available deployment/envoy-gateway --timeout=5m
