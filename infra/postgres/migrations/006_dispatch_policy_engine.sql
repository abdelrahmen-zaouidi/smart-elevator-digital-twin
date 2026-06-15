-- =============================================================================
-- Migration 006 — AI-Adaptive Dispatch Policy Engine stores
-- =============================================================================
-- Three tables back the dual-brain dispatch engine:
--
--   dispatch_decision_log   one row per decision tick: the context snapshot, the
--                           ACTIVE brain's decision + score table, every SHADOW
--                           brain's decision, and what was actually dispatched.
--                           This is the audit trail AND the training feature set.
--
--   dispatch_outcome        realized KPIs for a decision after its evaluation
--                           window (wait, energy, machine stress, fairness, any
--                           safety event) + the computed reward. Label/reward
--                           source for Brain B training and the evaluator.
--
--   dispatch_model_registry trained Brain B versions with their training window,
--                           metrics, artifact path and lifecycle status
--                           (SHADOW -> CANARY -> CHAMPION -> RETIRED).
--
-- All idempotent (CREATE TABLE/INDEX IF NOT EXISTS). Plain tables (not Timescale
-- hypertables): decision volume is modest and we want simple FK joins.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Decision log — the binding decision plus all shadow opinions per tick.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dispatch_decision_log (
  decision_id      bigserial PRIMARY KEY,
  ts               timestamptz NOT NULL DEFAULT now(),
  thing_id         text        NOT NULL,
  active_brain     text        NOT NULL,
  active_policy    text        NOT NULL,
  previous_policy  text,
  overridden_by    text,
  confidence       numeric(5, 4),
  changed          boolean     NOT NULL DEFAULT false,
  dispatched       boolean     NOT NULL DEFAULT false,
  command_id       text,
  reason           text,
  context          jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- the context vector
  score_table      jsonb       NOT NULL DEFAULT '[]'::jsonb,  -- Brain A term breakdown
  shadow           jsonb       NOT NULL DEFAULT '[]'::jsonb,  -- challenger decisions
  guardrails       jsonb       NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_dispatch_decision_thing_time
  ON dispatch_decision_log (thing_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_dispatch_decision_policy_time
  ON dispatch_decision_log (active_policy, ts DESC);
CREATE INDEX IF NOT EXISTS idx_dispatch_decision_brain_time
  ON dispatch_decision_log (active_brain, ts DESC);

COMMENT ON TABLE dispatch_decision_log IS
  'One row per dispatch decision tick. Binding (active) decision + shadow brain decisions + context snapshot. Audit trail and Brain B training features.';

-- ---------------------------------------------------------------------------
-- Outcome store — realized KPIs + reward for a decision's evaluation window.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dispatch_outcome (
  outcome_id       bigserial PRIMARY KEY,
  decision_id      bigint      REFERENCES dispatch_decision_log (decision_id) ON DELETE CASCADE,
  thing_id         text        NOT NULL,
  window_start     timestamptz NOT NULL,
  window_end       timestamptz NOT NULL,
  avg_wait_s       numeric,
  energy_kwh       numeric,
  peak_kw          numeric,
  trips            integer,
  machine_stress   numeric,        -- proxy from vibration/temp/duty
  fairness_penalty numeric,        -- from longest wait vs SLA
  safety_violation boolean     NOT NULL DEFAULT false,
  reward           numeric,        -- shared reward function output
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dispatch_outcome_decision
  ON dispatch_outcome (decision_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_outcome_thing_time
  ON dispatch_outcome (thing_id, window_end DESC);

COMMENT ON TABLE dispatch_outcome IS
  'Realized KPIs + reward for a decision after its evaluation window. Label/reward source for Brain B training and the promotion evaluator.';

-- ---------------------------------------------------------------------------
-- Model registry — Brain B versions and their lifecycle.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dispatch_model_registry (
  model_id        text PRIMARY KEY,             -- e.g. ml_v1-2026-05-31
  brain_id        text        NOT NULL,         -- ml_v1
  version         text        NOT NULL,
  trained_at      timestamptz NOT NULL DEFAULT now(),
  training_from   timestamptz,
  training_to     timestamptz,
  training_rows   integer,
  metrics         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  artifact_path   text,
  status          text        NOT NULL DEFAULT 'SHADOW',   -- SHADOW|CANARY|CHAMPION|RETIRED
  notes           text
);

CREATE INDEX IF NOT EXISTS idx_dispatch_model_status
  ON dispatch_model_registry (status, trained_at DESC);

COMMENT ON TABLE dispatch_model_registry IS
  'Trained Brain B (ML challenger) versions. status drives the champion-challenger promotion: SHADOW -> CANARY -> CHAMPION -> RETIRED.';

COMMIT;
