CREATE TABLE workspaces (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  revision INTEGER DEFAULT 0 NOT NULL,
  body TEXT NOT NULL,
  mutation_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
