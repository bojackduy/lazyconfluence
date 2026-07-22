import type { Database } from "bun:sqlite"

export const INDEX_SCHEMA_VERSION = 6

export function applyIndexSchema(database: Database) {
  database.run("PRAGMA foreign_keys = ON")

  const currentVersion = readUserVersion(database)
  if (currentVersion > INDEX_SCHEMA_VERSION) {
    throw new Error(`Unsupported lazyconfluence index schema version: ${currentVersion}`)
  }

  database.exec(INDEX_SCHEMA_SQL)

  if (currentVersion < 3 && !hasColumn(database, "pages", "tree_order")) {
    database.run("ALTER TABLE pages ADD COLUMN tree_order INTEGER NOT NULL DEFAULT 0")
  }

  if (currentVersion > 0 && currentVersion < 6 && hasColumn(database, "page_creates", "parent_page_id")) {
    migratePageCreatesParentNullable(database)
  }

  if (currentVersion < INDEX_SCHEMA_VERSION) {
    database.run(`PRAGMA user_version = ${INDEX_SCHEMA_VERSION}`)
  }
}

function hasColumn(database: Database, table: string, column: string) {
  const rows = database.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>

  return rows.some((row) => row.name === column)
}

function readUserVersion(database: Database) {
  const row = database.query("PRAGMA user_version").get() as { user_version: number } | null

  return Number(row?.user_version ?? 0)
}

function migratePageCreatesParentNullable(database: Database) {
  database.exec(`
    ALTER TABLE page_creates RENAME TO page_creates_old;

    CREATE TABLE page_creates (
      local_id TEXT PRIMARY KEY,
      space_key TEXT NOT NULL REFERENCES spaces(key) ON DELETE CASCADE,
      parent_page_id TEXT REFERENCES pages(page_id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      draft_markdown TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    INSERT INTO page_creates (local_id, space_key, parent_page_id, title, draft_markdown, created_at, updated_at)
    SELECT local_id, space_key, parent_page_id, title, draft_markdown, created_at, updated_at
    FROM page_creates_old;

    DROP TABLE page_creates_old;
    CREATE INDEX IF NOT EXISTS page_creates_space_updated_at_idx ON page_creates(space_key, updated_at);
  `)
}

const INDEX_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS spaces (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  last_synced_at TEXT,
  sync_state TEXT NOT NULL CHECK(sync_state IN ('fresh', 'stale', 'not-synced'))
);

CREATE TABLE IF NOT EXISTS pages (
  page_id TEXT PRIMARY KEY,
  space_key TEXT NOT NULL REFERENCES spaces(key) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  url_key TEXT NOT NULL,
  parent_id TEXT,
  path_json TEXT NOT NULL,
  path_text TEXT NOT NULL,
  owner TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  content_markdown TEXT NOT NULL,
  snippet TEXT NOT NULL,
  tree_order INTEGER NOT NULL DEFAULT 0,
  indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS pages_url_key_idx ON pages(url_key);
CREATE INDEX IF NOT EXISTS pages_space_parent_idx ON pages(space_key, parent_id, title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS pages_space_path_idx ON pages(space_key, path_text COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS page_bodies (
  page_id TEXT PRIMARY KEY REFERENCES pages(page_id) ON DELETE CASCADE,
  remote_version INTEGER NOT NULL,
  source_representation TEXT NOT NULL CHECK(source_representation IN ('storage', 'atlas_doc_format')),
  source_body TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  canonical_json TEXT NOT NULL,
  sidecar_json TEXT NOT NULL,
  editable_markdown TEXT NOT NULL,
  rendered_markdown TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS page_bodies_updated_at_idx ON page_bodies(updated_at);

CREATE TABLE IF NOT EXISTS page_drafts (
  page_id TEXT PRIMARY KEY REFERENCES pages(page_id) ON DELETE CASCADE,
  base_remote_version INTEGER NOT NULL,
  base_source_hash TEXT NOT NULL,
  draft_markdown TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft', 'staged')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  staged_at TEXT
);

CREATE INDEX IF NOT EXISTS page_drafts_status_idx ON page_drafts(status, updated_at);

CREATE TABLE IF NOT EXISTS page_creates (
  local_id TEXT PRIMARY KEY,
  space_key TEXT NOT NULL REFERENCES spaces(key) ON DELETE CASCADE,
  parent_page_id TEXT REFERENCES pages(page_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  draft_markdown TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS page_creates_space_updated_at_idx ON page_creates(space_key, updated_at);

CREATE VIRTUAL TABLE IF NOT EXISTS page_fts USING fts5(
  title,
  path,
  snippet,
  content,
  page_id UNINDEXED,
  tokenize = 'unicode61'
);

CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY,
  from_page_id TEXT NOT NULL REFERENCES pages(page_id) ON DELETE CASCADE,
  target_url TEXT NOT NULL,
  target_url_key TEXT NOT NULL,
  target_page_id TEXT,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('internal', 'external')),
  UNIQUE(from_page_id, target_url)
);

CREATE INDEX IF NOT EXISTS links_from_page_idx ON links(from_page_id, title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS links_target_page_idx ON links(target_page_id);
CREATE INDEX IF NOT EXISTS links_target_url_key_idx ON links(target_url_key);
`
