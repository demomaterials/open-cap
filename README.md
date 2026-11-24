# open-cap: continuous asset compliance

open-cap measures, continuously, how compliant your assets are with a set of
controls. Examples of assets are GitHub organizations, Azure DevOps projects,
repositories and applications.

- **Collectors** pull assets from GitHub and Azure DevOps using a PAT. They run
  on a timer, on webhook events, or when someone clicks "Run now". Each asset is
  stored in Postgres as a JSON **asset definition**: the provider's API
  response plus related API responses.
- **Controls** are written in the UI. Each control says which asset types it
  applies to and holds a **Rego** policy that decides pass / fail / skip
  from the asset definition.
- **Evaluators** run every applicable control against every asset whenever
  either one changes.
- **Presenters** roll results up as **Framework → Controls → Passing / Failing /
  Skipped** and keep a trend history.

```
compliance % = passing / (assets × applicable controls − skipped − errored − pending)
```

Skipped (not applicable), errored (unexecutable) and not-yet-evaluated results
are removed from both the numerator and the denominator.

## Layout

| Path | What |
|---|---|
| [services/](services/) | Node.js services sharing one codebase, one image each: `backend`, `collector`, `evaluator`, `presenter` |
| [services/catalog/](services/catalog/) | Built-in asset types, 19 controls (`rego/*.rego`), 3 frameworks; seeded once, then editable in the UI |
| [frontend/](frontend/) | React SPA, served by nginx |
| [deploy/charts/](deploy/charts/) | Helm charts: `gateway-stack` (Envoy Gateway), `db-stack` (Postgres + schema Job), `app-stack` (services, routes, NetworkPolicies) |
| [deploy/scripts/](deploy/scripts/) | `deploy-local.sh`, `smoke-test.sh`, `bootstrap-secrets.sh`, `make-local-ca.sh`, `build-images.sh` |
| [docs/](docs/) | [architecture](docs/architecture.md), [writing controls](docs/controls.md), [connectors](docs/connectors.md), [operations](docs/operations.md) |

## Quick start (Rancher Desktop)

Prerequisites: Rancher Desktop with the dockerd (moby) runtime, **Traefik
disabled**, `kubectl`, `helm` ≥ 3.14 (4.x tested), `openssl`.

```sh
cd deploy
./scripts/deploy-local.sh          # Envoy Gateway → secrets/TLS → images → charts → smoke test
```

Everything goes into namespace **`cap`**. The Envoy Gateway controller goes
into `envoy-gateway-system`. The app is served at **https://cap.bupasec.com**.

One-time steps on your laptop (both need sudo):

```sh
echo "127.0.0.1 cap.bupasec.com" | sudo tee -a /etc/hosts
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain deploy/scripts/local-ca/ca.crt
```

Sign in as `admin` with the generated password:

```sh
kubectl -n cap get secret cap-app-secrets -o jsonpath='{.data.ADMIN_PASSWORD}' | base64 -d; echo
```

Then go to **Connectors → Add connector**, pick GitHub or Azure DevOps, and
paste a PAT. The first collection starts immediately. Results appear on the
dashboard as soon as the evaluator has processed the assets.

## Development

```sh
cd services && npm install && npm test        # unit tests
cd frontend && npm install && npm run dev     # SPA dev server; proxies /api to local services
```

For a full local loop without Kubernetes, see
[docs/operations.md](docs/operations.md#running-services-locally).
