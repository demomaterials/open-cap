# Operations

## Deploy

Run from `deploy/` with `kubectl` pointing at the cluster:

```sh
./scripts/deploy-local.sh [--skip-build] [--no-smoke]
```

The script runs these steps, all idempotent:

| Step | What |
|---|---|
| 1 | `setup/install-envoy-gateway.sh`: Envoy Gateway v1.9.3 plus the Gateway API CRDs (namespace `envoy-gateway-system`) |
| 2 | `scripts/bootstrap-secrets.sh`: namespace `cap` and the generated Secrets (never overwrites existing ones). Then `scripts/make-local-ca.sh --apply` creates `cap-tls` if it is missing |
| 3 | `scripts/build-images.sh`: `cap-{frontend,backend,collector,evaluator,presenter}:1` in the local Docker daemon |
| 4 | `helm upgrade --install cap-gateway charts/gateway-stack` |
| 5 | `helm upgrade --install cap-db charts/db-stack`: Postgres, and the schema Job (post-install/upgrade hook) |
| 6 | `helm upgrade --install cap charts/app-stack` |
| 7 | `scripts/smoke-test.sh`: about 19 end-to-end checks through the gateway |

Helm 4 needs `--wait=legacy`, which the scripts already pass.

## Secrets

No chart templates a Secret. The charts only reference these, by name:

| Secret | Keys | Used by |
|---|---|---|
| `cap-db-credentials` | `POSTGRES_PASSWORD`, `APP_DB_PASSWORD` | Postgres, schema Job, all services (as role `cap_app`) |
| `cap-app-secrets` | `JWT_SECRET`, `CAP_ENCRYPTION_KEY`, `ADMIN_PASSWORD` | backend, presenter (JWT), collector and backend (encryption key) |
| `cap-tls` | `tls.crt`, `tls.key` | Gateway HTTPS listener |

To bring your own values, use `scripts/secrets.example.yaml`.

- **Back up `CAP_ENCRYPTION_KEY`.** Without it, every stored PAT and webhook
  secret is unreadable and must be re-entered.
- **`ADMIN_PASSWORD`** only seeds the first account, while the users table is
  empty. After that, manage users in the UI.
- **`POSTGRES_PASSWORD`** is read only on first database init.
- **`APP_DB_PASSWORD`** is re-applied by the schema Job on every upgrade.
  Rotate it by changing the Secret, running `helm upgrade cap-db`, and
  restarting the services.

## Day-2 operations

```sh
kubectl -n cap get pods
kubectl -n cap logs deploy/cap-collector -f          # JSON logs
kubectl -n cap logs deploy/cap-evaluator -c evaluator -f

# Rebuild and roll one service
docker build --build-arg SERVICE=evaluator -t cap-evaluator:1 services
kubectl -n cap rollout restart deploy/cap-evaluator

# psql
kubectl -n cap exec -it cap-db-0 -- psql -U postgres -d cap

# Force a full re-evaluation of everything
kubectl -n cap exec cap-db-0 -- psql -U postgres -d cap -c \
  "INSERT INTO eval_queue (asset_id, reason) SELECT id, 'manual' FROM assets WHERE deleted_at IS NULL ON CONFLICT DO NOTHING; NOTIFY cap_eval;"
```

| Knob (app-stack values) | Default | Effect |
|---|---|---|
| `evaluator.replicas` | 2 (1 on Rancher) | Evaluation throughput |
| `evaluator.batch` / `concurrency` | 25 / 4 | Assets claimed per batch and evaluated in parallel |
| `evaluator.sweepSeconds` | 60 | How often pending or stale results are re-queued |
| `collector.parallelRuns` | 2 | Concurrent collections per replica |
| `presenter.snapshotMinutes` | 15 | Trend resolution |

## Running services locally

```sh
docker run -d --name cap-pg -e POSTGRES_PASSWORD=pg -e POSTGRES_DB=cap -p 55432:5432 postgres:16-alpine
docker run -d --name cap-opa -p 58181:8181 openpolicyagent/opa:1.4.2-static run --server --addr 0.0.0.0:8181
docker exec -i cap-pg psql -U postgres -d cap -v app_password=app < deploy/charts/db-stack/files/schema.sql

export DB_PORT=55432 DB_PASSWORD=app JWT_SECRET=dev CAP_ENCRYPTION_KEY=dev ADMIN_PASSWORD=adminpass123 \
       OPA_URL=http://127.0.0.1:58181 EVALUATOR_URL=http://127.0.0.1:18082
cd services
PORT=18081 node backend/index.js &  PORT=18082 node evaluator/index.js &
PORT=18083 node presenter/index.js & PORT=18084 node collector/index.js &
cd ../frontend && npm run dev        # http://localhost:5173
```

## Troubleshooting

| Symptom | Check |
|---|---|
| Pods in `CreateContainerConfigError` | A Secret is missing: `./scripts/bootstrap-secrets.sh` |
| Gateway not `PROGRAMMED` / no address | Something else is holding 80/443 (Traefik, another LoadBalancer): `kubectl get svc -A \| grep LoadBalancer` |
| All results of one control are *Error* | The control's page shows the compile error; fix the Rego |
| Many *Skipped* results | Open an asset → Definition JSON → `errors`: the PAT is missing a permission |
| Runs fail with `401` / `203` | PAT expired or revoked: edit the connector and paste a new one |
| Results stay *Pending* | `kubectl -n cap logs deploy/cap-evaluator -c evaluator`; `/api/system/status` shows the queue length |
