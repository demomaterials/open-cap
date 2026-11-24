-- open-cap schema. Applied by the db-stack schema Job on every install/upgrade,
-- so every statement here MUST be idempotent.
--
-- psql variables (set by the Job):  :app_password  — password for role cap_app

\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Application role. Services never connect as the postgres superuser.
-- ---------------------------------------------------------------------------
SELECT format('CREATE ROLE cap_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cap_app') \gexec
SELECT format('ALTER ROLE cap_app LOGIN PASSWORD %L', :'app_password') \gexec

-- ---------------------------------------------------------------------------
-- Users (local accounts; the bootstrap admin is created by the backend)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text NOT NULL UNIQUE,
  display_name  text,
  password_hash text NOT NULL,
  role          text NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin','editor','viewer')),
  disabled      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Connectors: where assets come from (GitHub / Azure DevOps, PAT auth)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connectors (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL UNIQUE,
  provider           text NOT NULL CHECK (provider IN ('github','ado')),
  config             jsonb NOT NULL DEFAULT '{}'::jsonb,   -- org/organization, apiUrl, filters
  credential_enc     text,                                  -- AES-256-GCM encrypted PAT
  webhook_secret_enc text,                                  -- AES-256-GCM encrypted webhook secret
  schedule_minutes   integer NOT NULL DEFAULT 360 CHECK (schedule_minutes >= 5),
  enabled            boolean NOT NULL DEFAULT true,
  next_run_at        timestamptz NOT NULL DEFAULT now(),
  last_run_at        timestamptz,
  last_status        text,
  last_error         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS collection_runs (
  id            bigserial PRIMARY KEY,
  connector_id  uuid NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
  trigger       text NOT NULL CHECK (trigger IN ('schedule','manual','webhook')),
  scope         jsonb,                 -- null = full collection; else e.g. {"repo":"name"}
  status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  claimed_by    text,
  heartbeat_at  timestamptz,
  started_at    timestamptz,
  finished_at   timestamptz,
  stats         jsonb NOT NULL DEFAULT '{}'::jsonb,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS collection_runs_status_idx ON collection_runs (status, created_at);
CREATE INDEX IF NOT EXISTS collection_runs_connector_idx ON collection_runs (connector_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Assets. `definition` is the asset definition JSON that Rego evaluates.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS asset_types (
  type         text PRIMARY KEY,
  display_name text NOT NULL,
  description  text,
  provider     text                    -- github | ado | manual | …
);

CREATE TABLE IF NOT EXISTS assets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type              text NOT NULL REFERENCES asset_types(type) ON UPDATE CASCADE,
  external_id       text NOT NULL,
  name              text NOT NULL,
  connector_id      uuid REFERENCES connectors(id) ON DELETE SET NULL,
  parent_id         uuid REFERENCES assets(id) ON DELETE SET NULL,
  owner             text,
  members           jsonb NOT NULL DEFAULT '[]'::jsonb,
  definition        jsonb NOT NULL,
  content_hash      text NOT NULL,
  last_seen_run_id  bigint,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_changed_at   timestamptz NOT NULL DEFAULT now(),
  last_collected_at timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  UNIQUE (type, external_id)
);
CREATE INDEX IF NOT EXISTS assets_type_idx ON assets (type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS assets_connector_idx ON assets (connector_id);
CREATE INDEX IF NOT EXISTS assets_owner_idx ON assets (owner);
CREATE INDEX IF NOT EXISTS assets_name_lower_idx ON assets (lower(name));

-- One row per *change* of an asset definition.
CREATE TABLE IF NOT EXISTS asset_history (
  id           bigserial PRIMARY KEY,
  asset_id     uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  content_hash text NOT NULL,
  definition   jsonb NOT NULL,
  collected_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS asset_history_asset_idx ON asset_history (asset_id, collected_at DESC);

-- ---------------------------------------------------------------------------
-- Frameworks and controls
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS frameworks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,
  name        text NOT NULL,
  description text,
  version     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS controls (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key           text NOT NULL UNIQUE,
  name          text NOT NULL,
  description   text,
  severity      text NOT NULL DEFAULT 'medium' CHECK (severity IN ('critical','high','medium','low','info')),
  asset_types   text[] NOT NULL CHECK (cardinality(asset_types) > 0),
  rego          text NOT NULL,
  remediation   text,
  enabled       boolean NOT NULL DEFAULT true,
  version       integer NOT NULL DEFAULT 1,
  compile_error text,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS controls_asset_types_idx ON controls USING gin (asset_types);

CREATE TABLE IF NOT EXISTS framework_controls (
  framework_id uuid NOT NULL REFERENCES frameworks(id) ON DELETE CASCADE,
  control_id   uuid NOT NULL REFERENCES controls(id) ON DELETE CASCADE,
  reference    text,          -- e.g. "CIS 1.1.3"
  PRIMARY KEY (framework_id, control_id)
);
CREATE INDEX IF NOT EXISTS framework_controls_control_idx ON framework_controls (control_id);

-- ---------------------------------------------------------------------------
-- Evaluations: latest result per (asset, control)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS evaluations (
  asset_id        uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  control_id      uuid NOT NULL REFERENCES controls(id) ON DELETE CASCADE,
  status          text NOT NULL CHECK (status IN ('pass','fail','skip','error')),
  reasons         jsonb NOT NULL DEFAULT '[]'::jsonb,
  control_version integer NOT NULL,
  asset_hash      text NOT NULL,
  duration_ms     integer,
  evaluated_at    timestamptz NOT NULL DEFAULT now(),
  status_since    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (asset_id, control_id)
);
CREATE INDEX IF NOT EXISTS evaluations_control_idx ON evaluations (control_id, status);

-- Status transitions (pass → fail etc.) for audit and drill-down.
CREATE TABLE IF NOT EXISTS evaluation_events (
  id          bigserial PRIMARY KEY,
  asset_id    uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  control_id  uuid NOT NULL REFERENCES controls(id) ON DELETE CASCADE,
  from_status text,
  to_status   text NOT NULL,
  reasons     jsonb NOT NULL DEFAULT '[]'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS evaluation_events_time_idx ON evaluation_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS evaluation_events_pair_idx ON evaluation_events (control_id, asset_id, occurred_at DESC);

-- Work queue for the evaluator: one row per asset that needs (re)evaluation.
CREATE TABLE IF NOT EXISTS eval_queue (
  asset_id    uuid PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
  reason      text,
  enqueued_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Compliance view.
--   applicable pair = active asset whose type is in control.asset_types,
--                     for every enabled control.
--   status          = latest evaluation, or 'pending' if not yet evaluated.
-- Score = pass / (pairs - skip - error - pending); NULL when nothing is scorable.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW applicable_results AS
SELECT c.id  AS control_id,
       a.id  AS asset_id,
       a.type AS asset_type,
       a.owner,
       COALESCE(e.status, 'pending') AS status,
       e.reasons,
       e.evaluated_at,
       (e.status IS NOT NULL AND (e.control_version <> c.version OR e.asset_hash <> a.content_hash)) AS stale
FROM controls c
JOIN assets a ON a.type = ANY (c.asset_types) AND a.deleted_at IS NULL
LEFT JOIN evaluations e ON e.asset_id = a.id AND e.control_id = c.id
WHERE c.enabled;

CREATE OR REPLACE FUNCTION compliance_score(pass bigint, total bigint, skip bigint, err bigint, pending bigint)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN (total - skip - err - pending) > 0
              THEN round(100.0 * pass / (total - skip - err - pending), 2)
         END
$$;

CREATE TABLE IF NOT EXISTS compliance_snapshots (
  id         bigserial PRIMARY KEY,
  taken_at   timestamptz NOT NULL DEFAULT now(),
  scope      text NOT NULL CHECK (scope IN ('overall','framework','control')),
  scope_id   uuid,
  total      integer NOT NULL,
  passing    integer NOT NULL,
  failing    integer NOT NULL,
  skipped    integer NOT NULL,
  errored    integer NOT NULL,
  pending    integer NOT NULL,
  score      numeric
);
CREATE INDEX IF NOT EXISTS compliance_snapshots_scope_idx ON compliance_snapshots (scope, scope_id, taken_at DESC);

-- ---------------------------------------------------------------------------
-- Audit log for configuration changes made through the UI/API
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id          bigserial PRIMARY KEY,
  actor       text,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text,
  detail      jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_time_idx ON audit_log (occurred_at DESC);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO cap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cap_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO cap_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO cap_app;
