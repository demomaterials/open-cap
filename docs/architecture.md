# Architecture

```
                         https://cap.bupasec.com
                                   │
                     ┌─────────────▼──────────────┐  Envoy Gateway (gateway-stack)
                     │ Gateway cap-gateway :443   │  TLS cap-tls, :80 → 301 https
                     └──┬──────┬────────┬──────┬──┘
           /            │      │/api    │      │ /webhooks
        ┌───────────────▼┐  ┌──▼─────┐  │  ┌───▼────────┐
        │ cap-frontend   │  │backend │  │  │ collector  │◄── GitHub / ADO webhooks
        │ React SPA      │  │  API   │  │  │ timer+hook │──► GitHub / ADO REST (PAT)
        └────────────────┘  └──┬──┬──┘  │  └───┬────────┘
                /api/compliance│  │     │      │ upsert assets, queue evaluation
                     ┌─────────┘  │     │      │
               ┌─────▼──────┐     │ validate/test (in-cluster only)
               │ presenter  │     │     │      │
               │ scores,    │  ┌──▼─────────┐   │
               │ trends     │  │ evaluator  │   │
               └─────┬──────┘  │ + OPA side │   │
                     │         └──┬─────────┘   │
                     │            │             │
                  ┌──▼────────────▼─────────────▼──┐
                  │ Postgres (cap-db) — asset       │
                  │ definitions, controls, results  │
                  └─────────────────────────────────┘
```

The services follow the FM Vista model: small single-purpose services, one
Postgres, Envoy Gateway in front, Helm charts per layer, and Secrets created
out-of-band. Unlike FM Vista, open-cap is single-tenant and keeps its own
accounts, so it needs no Keycloak.

## Services

| Service | Route | Responsibility |
|---|---|---|
| `cap-frontend` | `/` | React SPA (nginx). Dashboard, frameworks, controls (Rego editor and tester), assets, connectors, activity, users. |
| `cap-backend` | `/api` | Login (JWT in an HttpOnly cookie, or a bearer token), users, asset types, assets and the ingest API, frameworks, controls (CRUD and versioning), connectors (encrypted PATs, test, run now, webhook secrets), audit log. Seeds the built-in catalog. |
| `cap-collector` | `/webhooks` | Scheduler (queues due connectors), workers (run collections), webhook receivers. Writes asset definitions and queues the changed ones for evaluation. |
| `cap-evaluator` | none (in-cluster only) | Drains `eval_queue` and evaluates every applicable enabled control for each asset through its OPA sidecar. Also serves `/internal/validate` and `/internal/test` for the editor. |
| `cap-presenter` | `/api/compliance` | Read-only roll-ups (overall, framework, control, asset, owner, asset type, severity), drill-down lists, CSV export, status-change feed, and snapshots every 15 min for trends. |

The four Node services share one codebase ([services/common](../services/common))
but run as separate Deployments, each with its own image
(`--build-arg SERVICE=…`).

## Data flow

1. **Trigger.** A trigger inserts a row into `collection_runs`:
   - the scheduler, when `connectors.next_run_at` has passed;
   - "Run now" in the UI;
   - a webhook, as a scoped run for one repository or project.

   `NOTIFY cap_collect` wakes the collectors.
2. **Collect.** A collector claims the run (`FOR UPDATE SKIP LOCKED`, and never
   two runs for the same connector at once) and walks the provider API. For
   each asset it:
   - builds the asset definition;
   - hashes it canonically (`collected_at` is excluded);
   - upserts it.

   When the hash changes, it writes `asset_history` and queues the asset in
   `eval_queue`. After a full run, assets the connector no longer returns are
   soft-deleted.
3. **Evaluate.** Evaluators claim queued assets (`DELETE … SKIP LOCKED`), so
   replicas never overlap. Each one:
   - loads the enabled controls whose `asset_types` include the asset's type;
   - makes sure the right policy version is loaded in its OPA sidecar;
   - evaluates and upserts `evaluations`;
   - records status transitions in `evaluation_events`.

   Editing a control's Rego, asset types or enabled flag bumps its `version`
   and queues every affected asset. A sweep every 60 s re-queues anything
   pending or stale, which makes the system self-healing.
4. **Present.** The view `applicable_results` joins enabled controls with
   active assets of matching type. A pair with no evaluation yet is
   `pending`. Every score is derived from that view.

## Data model

| Table | Purpose |
|---|---|
| `asset_types` | Catalog of types (`github_org`, `github_repo`, `ado_org`, `ado_project`, `ado_repo`, `application`, plus your own) |
| `assets` | One row per asset: `type`, `external_id` (unique per type), `name`, `owner`, `members`, `definition` (the JSON that Rego sees), `content_hash`, `parent_id`, `connector_id`, `deleted_at` |
| `asset_history` | One row per change of a definition |
| `controls` | `key`, `name`, `severity`, `asset_types[]`, `rego`, `remediation`, `enabled`, `version`, `compile_error` |
| `frameworks`, `framework_controls` | Many-to-many, with a per-framework `reference` (e.g. "CIS 1.1.3") |
| `evaluations` | Latest result per (asset, control): `status` (pass/fail/skip/error), `reasons`, `control_version`, `asset_hash` |
| `evaluation_events` | Status transitions (regressions and fixes) |
| `eval_queue` | Assets that need evaluation |
| `connectors`, `collection_runs` | Collector configuration (PAT and webhook secret AES-256-GCM encrypted) and run history with stats |
| `compliance_snapshots` | Periodic scores per overall, framework and control scope, for trends |
| `users`, `audit_log` | Local accounts (scrypt) with admin/editor/viewer roles, and configuration changes |

## Scaling and failure behaviour

- **Evaluators** scale horizontally. Each replica has a private OPA, and work
  is partitioned through the queue. An OPA restart is detected by a sentinel
  policy, after which policies reload lazily.
- **Collectors** scale horizontally. Each replica runs at most
  `COLLECTOR_PARALLEL_RUNS` runs. A run whose heartbeat stops for 5 min is
  marked failed. The scheduler, sweep and snapshot jobs are guarded by Postgres
  advisory locks, so exactly one replica performs each.
- **GitHub rate limits.** The client waits out `x-ratelimit-reset` (up to 15
  min), retries 5xx errors with backoff, and honours `Retry-After`.
- **Partial access.** A failed enrichment call is recorded in the definition's
  `errors` map instead of failing the run, for example branch protection
  returning 403 when the PAT lacks admin. The built-in controls *skip* in that
  case, so missing permissions never show up as false failures.

## Security

- Every route except `/webhooks/*` and the login endpoint requires a session.
  - Cookie sessions are HttpOnly, Secure and SameSite=Lax.
  - Unsafe methods must carry a same-origin `Origin` header.
- Webhooks are authenticated per connector:
  - GitHub: `X-Hub-Signature-256` HMAC.
  - Azure DevOps: basic-auth password or `X-CAP-Webhook-Secret`.
- PATs are write-only through the API and encrypted with `CAP_ENCRYPTION_KEY`.
- Rego cannot use `http.send`, `net.lookup_ip_addr`, `opa.runtime`,
  `rego.parse_module` or `time.now_ns`. OPA listens on the pod's loopback only.
- NetworkPolicies:
  - only Envoy reaches the edge services;
  - only the backend reaches the evaluator;
  - only open-cap pods reach Postgres.
- Services connect as `cap_app`, never as the Postgres superuser.
