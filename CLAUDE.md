# CLAUDE.md

open-cap is a continuous compliance platform. Assets come from GitHub/ADO
connectors or the ingest API. Controls are Rego policies evaluated by OPA.
Scores roll up as Framework → Control → pass/fail/skip.

- **Services** live in `services/`: Node 22, ESM, plain JS, deps only express
  and pg. They share `services/common`, and one Dockerfile builds each image
  with `--build-arg SERVICE=<name>`. The backend imports
  `collector/providers/*` for connection tests.
- **Schema:** `deploy/charts/db-stack/files/schema.sql`. It must stay
  idempotent because the schema Job runs on every upgrade.
- **Compliance math** lives in the `applicable_results` view and the
  `compliance_score()` SQL function. skip, error and pending are excluded from
  both numerator and denominator.
- **Catalog:** `services/catalog` holds the built-in controls. The backend
  seeds them once and never overwrites rows that already exist.
- **Deploy:** `deploy/scripts/deploy-local.sh` deploys to Rancher Desktop,
  namespace `cap`, host `cap.bupasec.com`. Use Helm 4 with `--wait=legacy`.
  No chart templates a Secret.
- **Tests:**
  - `cd services && npm test` runs the unit tests.
  - `deploy/scripts/smoke-test.sh` runs end-to-end checks against a deployed
    cluster.
- **Commits:** no Co-Authored-By trailers.
