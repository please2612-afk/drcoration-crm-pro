-- REVIEW DRAFT ONLY: PostgreSQL execution has NOT been validated in this environment.
-- Intended only for a new, isolated staging database named yuan_build_os_test.
-- The current application still requires a PostgreSQL DB/BUCKET adapter and trusted login.
-- This file does not make the existing Worker or the local development server deployable.
BEGIN;

DO $$
BEGIN
  IF current_database() <> 'yuan_build_os_test' THEN
    RAISE EXCEPTION 'Staging migration refused: expected database yuan_build_os_test';
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS yuan_os;

CREATE TABLE IF NOT EXISTS yuan_os.workspaces (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  body TEXT NOT NULL CHECK (jsonb_typeof(body::jsonb) IN ('object', 'null')),
  mutation_id TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

-- Private PostgreSQL assets are a low-service-count candidate for a small staging workload.
-- Never serve them directly: application authorization must precede retrieval.
CREATE TABLE IF NOT EXISTS yuan_os.assets (
  key TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  body BYTEA NOT NULL CHECK (octet_length(body) <= 8388608),
  http_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  custom_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
