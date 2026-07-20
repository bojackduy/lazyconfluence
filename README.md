# lazyconfluence Rust Plan

`lazyconfluence` is a new Rust terminal app inspired by `lazylens`. This repo is used as a reference for how to talk to Confluence, normalize page data, build a local search index, and render a keyboard-first document browser.

The new app should not be a direct Python-to-Rust port. It should be a focused Confluence-first tool with a lazygit-style TUI, fast local search, and muscle-memory keyboard shortcuts.

## Target

Build a Rust/Ratatui TUI for browsing and searching Confluence pages from a local SQLite index.

The core flow is:

```text
Confluence Cloud API -> local SQLite/FTS index -> ratatui TUI -> browser open
```

The TUI must never depend on live Confluence API calls for normal navigation. Remote calls happen during explicit sync/refresh only.

## Goals

- Connect to Confluence Cloud with Atlassian API-token basic auth.
- Index configured Confluence spaces locally.
- Store page metadata, hierarchy, snippets, and links.
- Search locally with SQLite FTS5.
- Browse spaces, top-level pages, folders, child pages, and related links.
- Open canonical Confluence URLs from the terminal.
- Preserve a lazy-style keyboard workflow with `h/j/k/l`, arrows, `/`, `enter`, `r`, `?`, and `q`.
- Keep sensitive content local and avoid storing full page bodies by default.

## Non-Goals For V1

- Jira support.
- SharePoint support.
- Multi-provider project grouping.
- Semantic search or embeddings.
- Full offline Confluence mirror.
- Confluence Data Center support unless explicitly added later.
- A web UI.

## Reference Reading Order

Read these existing files to understand how `lazylens` works before building `lazyconfluence`.

1. `README.md`
   Learn the current user-facing model: config, env vars, local indexing, search, and TUI behavior.

2. `lazylens/indexers/confluence.py`
   Main Confluence reference. This contains auth, API calls, space resolution, page fetching, hierarchy extraction, HTML snippets, and link extraction.

3. `lazylens/extract.py`
   Snippet strategy. It removes boilerplate and keeps a useful preview instead of storing full documents.

4. `lazylens/db.py`
   SQLite schema, FTS search, upserts, hierarchy queries, children queries, and link relationship lookup.

5. `lazylens/indexing.py`
   Refresh orchestration: upsert source, compare existing items, write changed items, prune missing items only when the scan is complete.

6. `lazylens/config.py`
   TOML config loading and path expansion.

7. `lazylens/paths.py`
   Platform-specific config/data/cache paths.

8. `lazylens/tui.py`
   TUI layout, keybindings, preview formatting, open URL behavior, history stack, result stack, and relation panes.

9. `tests/test_confluence_indexer.py`
   Best source for expected Confluence API mapping behavior without real Atlassian calls.

10. `tests/test_db.py`
    Reference tests for FTS search, relationships, hierarchy, and URL normalization.

11. `tests/test_tui.py`
    Reference tests for keyboard behavior and navigation expectations.

## Existing Confluence Behavior To Reuse

The important Confluence flow lives in `lazylens/indexers/confluence.py`.

Use these behaviors in Rust:

- Normalize site root to a wiki URL.
  `https://example.atlassian.net` becomes `https://example.atlassian.net/wiki`.
- Use basic auth with `email:api_token` encoded as base64.
- Resolve configured space keys with `GET /api/v2/spaces`.
- Fetch pages with `GET /api/v2/pages` and `space-id` params.
- Use `body-format=storage` when page body is needed.
- For incremental sync, fetch page lists without body first, then fetch changed page bodies individually.
- Fetch direct children with `GET /api/v2/pages/{page_id}/direct-children` to discover folders and hierarchy nodes.
- Convert Confluence storage HTML into a short useful snippet.
- Extract `<a href="...">` links and normalize relative Confluence URLs to absolute URLs.
- Map pages/folders into one local item model.
- Track incomplete scans and skip pruning when pagination limits stopped the scan early.

## Product Shape

`lazyconfluence` answers these questions quickly:

- Where is that Confluence page?
- Which space or parent page owns it?
- Is this result worth opening?
- What child pages does it have?
- What pages does it link to?
- What pages link back to it?

The app should feel like a fast terminal document explorer, not a full Confluence replacement.

## CLI Target

Commands:

```sh
lazyconfluence init
lazyconfluence doctor
lazyconfluence sync
lazyconfluence search <query>
lazyconfluence
```

Command behavior:

- `init`: create starter config and env-file skeleton.
- `doctor`: verify config path, DB path, base URL, email, token env var, and configured spaces.
- `sync`: call Confluence, update the local index, and print a concise report.
- `search <query>`: search local index for debugging and scripting.
- no subcommand: open the TUI.

## Config Target

Default paths:

- Config: `~/.config/lazyconfluence/config.toml`
- Env skeleton: `~/.config/lazyconfluence/atlassian.env`
- Database: `~/.local/share/lazyconfluence/index.sqlite3`
- Cache: `~/.cache/lazyconfluence/`

Example config:

```toml
database = "~/.local/share/lazyconfluence/index.sqlite3"

[confluence]
name = "Work Confluence"
base_url = "https://example.atlassian.net"
email = "you@example.com"
api_token_env = "CONFLUENCE_API_TOKEN"
space_keys = ["ARCH", "PLAT"]
page_limit = 100
max_pages = 5

[ui]
theme = "default"
icons = "ascii"
```

Token values should stay out of TOML and source control.

Example env file:

```sh
export CONFLUENCE_API_TOKEN=""
```

## Rust Architecture

Suggested crate layout:

```text
src/
  main.rs
  cli.rs
  config.rs
  paths.rs
  model.rs
  open.rs
  error.rs
  confluence/
    mod.rs
    client.rs
    mapper.rs
    html.rs
  index/
    mod.rs
    schema.rs
    repository.rs
    search.rs
  tui/
    mod.rs
    app.rs
    state.rs
    layout.rs
    keymap.rs
    widgets.rs
    theme.rs
```

Suggested dependencies:

```toml
[dependencies]
anyhow = "1"
base64 = "0.22"
chrono = { version = "0.4", features = ["serde"] }
clap = { version = "4", features = ["derive"] }
crossterm = "0.28"
directories = "5"
open = "5"
ratatui = "0.29"
reqwest = { version = "0.12", features = ["json", "rustls-tls"], default-features = false }
rusqlite = { version = "0.32", features = ["bundled"] }
scraper = "0.22"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "2"
tokio = { version = "1", features = ["macros", "rt-multi-thread"] }
toml = "0.8"
url = "2"
```

Keep dependencies boring until there is a concrete need for more.

## Core Model

Start with one primary item model:

```rust
pub struct IndexedItem {
    pub source_key: String,
    pub item_key: String,
    pub title: String,
    pub url: String,
    pub path: String,
    pub content_type: String,
    pub modified_at: String,
    pub owner: String,
    pub category: String,
    pub container: String,
    pub snippet: String,
    pub links: Vec<String>,
    pub parent_key: String,
    pub structure_type: StructureType,
}

pub enum StructureType {
    Page,
    Folder,
}
```

Use Confluence page ID as `item_key`.

Use `parent_key` for page tree navigation.

Use `category` for the top-level page or space bucket.

Use `container` for the space name.

## SQLite Schema

Start close to the current Python schema:

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sources (
    key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    base_url TEXT NOT NULL,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY,
    source_key TEXT NOT NULL REFERENCES sources(key) ON DELETE CASCADE,
    item_key TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    path TEXT NOT NULL,
    content_type TEXT NOT NULL,
    modified_at TEXT NOT NULL,
    owner TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    container TEXT NOT NULL DEFAULT '',
    snippet TEXT NOT NULL DEFAULT '',
    parent_key TEXT NOT NULL DEFAULT '',
    structure_type TEXT NOT NULL DEFAULT 'page',
    indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source_key, item_key)
);

CREATE VIRTUAL TABLE IF NOT EXISTS item_fts USING fts5(
    title,
    snippet,
    category,
    path,
    item_id UNINDEXED
);

CREATE TABLE IF NOT EXISTS item_links (
    id INTEGER PRIMARY KEY,
    source_key TEXT NOT NULL,
    from_item_key TEXT NOT NULL,
    target_url TEXT NOT NULL,
    UNIQUE(source_key, from_item_key, target_url)
);
```

Repository functions to implement:

- `upsert_source`
- `items_by_source`
- `upsert_items`
- `delete_source_items_not_seen`
- `search`
- `categories`
- `children`
- `item_by_id`
- `outgoing_links`
- `incoming_links`
- `relationship_url_key`

## Search Behavior

Use SQLite FTS5 prefix search like the current Python implementation.

Example:

```text
architecture decision
```

becomes:

```text
architecture* decision*
```

Search should include:

- page title
- snippet
- category
- path

Default empty-query results should be recent pages sorted by modified time, then title.

Folders should support structure navigation but should not appear in normal search results.

## Relationship Behavior

Store outgoing links from each page in `item_links`.

When showing relationships:

- Outgoing links are links from the selected page.
- Incoming links are pages whose outgoing links resolve to the selected page.
- If a link resolves to an indexed page, show the page title and allow keyboard navigation.
- If it does not resolve, show it as an external URL but do not treat it as an internal page.

Normalize Confluence page URLs by page ID so these match:

```text
https://example.atlassian.net/wiki/spaces/ARCH/pages/123/HLD
https://example.atlassian.net/wiki/spaces/ARCH/pages/123/HLD+Updated
```

## TUI Target

The first UI should be simple, fast, and stable.

Initial layout:

```text
┌ Spaces / Tree ─────┬ Pages ───────────────────────┬ Preview ───────────────┐
│ All                │ API Decision                  │ API Decision           │
│ ARCH               │ HLD                           │ Modified: ...          │
│   Platform         │ KDD-002                       │ URL: ...               │
│   Decisions        │ Runbook                       │                        │
│                    │                               │ snippet...             │
├ Links ─────────────┴───────────────────────────────┴────────────────────────┤
│ Outgoing / Incoming links                                                     │
└ / search | enter open | l drill/follow | r sync | ? help | q quit ──────────┘
```

Suggested state:

```rust
pub enum FocusPane {
    Tree,
    Pages,
    Links,
    Search,
    Help,
}

pub struct AppState {
    pub focus: FocusPane,
    pub query: String,
    pub categories: Vec<CategorySummary>,
    pub results: Vec<SearchResult>,
    pub selected_result: Option<SearchResult>,
    pub outgoing: Vec<RelatedItem>,
    pub incoming: Vec<RelatedItem>,
    pub history: Vec<ViewState>,
    pub status: String,
}
```

## Keymap Target

Use lazygit/vim-style keys as the primary muscle memory, with arrows as aliases.

| Key | Action |
|---|---|
| `q` | Quit |
| `?` | Help/about |
| `/` | Focus search |
| `esc` | Leave search or close modal |
| `enter` | Open selected page, apply search, or enter tree node |
| `o` | Open selected page in browser |
| `r` | Sync/refresh index |
| `c` | Clear search |
| `h` / `left` | Back or parent pane |
| `j` / `down` | Move down |
| `k` / `up` | Move up |
| `l` / `right` | Drill into children or focus/follow links |
| `tab` | Next pane |
| `shift-tab` | Previous pane |
| `g` | Top of current list |
| `G` | Bottom of current list |
| `[` | Incoming links |
| `]` | Outgoing links |
| `b` | Back in navigation history |

V1 should avoid too many commands. Only add shortcuts once they map to a real workflow.

## Implementation Phases

### Phase 1: Rust Skeleton

Success criteria:

- `lazyconfluence --help` works.
- `cargo test` runs.
- Paths resolve on macOS/Linux.

Tasks:

- Create Cargo project.
- Add `clap` CLI.
- Add `config`, `paths`, `error`, and `model` modules.
- Add empty command handlers for `init`, `doctor`, `sync`, `search`, and TUI default.

### Phase 2: Config And Doctor

Success criteria:

- `lazyconfluence init` writes config and env skeleton.
- `lazyconfluence doctor` reports missing token/config clearly.

Tasks:

- Parse TOML config.
- Expand `~` paths.
- Resolve token from configured env var.
- Print exact next command when setup is incomplete.

### Phase 3: Confluence Client

Success criteria:

- Unit tests mock API JSON and verify space/page requests.

Tasks:

- Implement `ConfluenceClient` with `reqwest`.
- Implement basic auth header.
- Implement `resolve_spaces`.
- Implement page pagination.
- Implement page body fetch.
- Implement direct-children fetch.

### Phase 4: HTML Mapping

Success criteria:

- Storage HTML maps to title/snippet/links consistently.

Tasks:

- Extract text from storage HTML.
- Remove obvious boilerplate.
- Truncate snippet.
- Extract and normalize links.
- Map API payloads into `IndexedItem`.

### Phase 5: SQLite Index

Success criteria:

- `sync` writes pages to DB.
- `search` returns local results.
- Folders do not appear in normal search.

Tasks:

- Create schema.
- Upsert source and items.
- Refresh FTS rows.
- Refresh item links.
- Implement incremental unchanged detection.
- Prune missing pages only after complete scans.

### Phase 6: Tree And Relationships

Success criteria:

- Children queries work.
- Incoming/outgoing relationships work.
- URL variants resolve by Confluence page ID.

Tasks:

- Implement category/top-level page queries.
- Implement `children`.
- Implement `outgoing_links`.
- Implement `incoming_links`.
- Implement `relationship_url_key`.

### Phase 7: First Ratatui UI

Success criteria:

- TUI opens and reads from DB.
- User can move selection, search, preview, and open a page.

Tasks:

- Setup crossterm terminal lifecycle.
- Draw tree, pages, preview, links, and status bar.
- Implement `j/k`, arrows, `/`, `enter`, `q`.
- Update preview and links on selection change.

### Phase 8: Lazy-Style Navigation Polish

Success criteria:

- TUI feels predictable with keyboard-only navigation.

Tasks:

- Add focus borders.
- Add history stack.
- Add `h/l` drill/back behavior.
- Add incoming/outgoing link focus.
- Add help modal.
- Add search highlighting.

### Phase 9: Sync From TUI

Success criteria:

- Pressing `r` syncs without freezing the UI.

Tasks:

- Spawn sync task.
- Send progress/status events to app state.
- Reload DB after sync completes.
- Show concise success/failure status.

### Phase 10: Packaging And Release

Success criteria:

- `cargo install --path .` works.
- CI runs format, clippy, and tests.

Tasks:

- Add README usage.
- Add sample config.
- Add GitHub Actions.
- Add release build workflow later.

## Testing Strategy

Start with unit tests before end-to-end tests.

Test areas:

- Config parsing and path expansion.
- Missing auth and doctor messages.
- Confluence URL normalization.
- Mocked Confluence API pagination.
- Page/folder mapping.
- HTML snippet extraction.
- Link extraction and de-duplication.
- SQLite upsert/search.
- Relationship URL matching.
- TUI reducer/state transitions without rendering where possible.

Keep API tests mocked. Real Confluence integration tests should be opt-in and require explicit env vars.

## Design Principles

- Local-first: TUI reads local data.
- Explicit sync: remote APIs only run when requested.
- Minimal storage: snippets by default, full content only if later configured.
- Fast keyboard path: every common action should be reachable without the mouse.
- Small correct features: avoid adding Jira/SharePoint/general project abstractions until Confluence-only behavior is good.
- Clear failure messages: auth and config errors should tell the user exactly what to fix.

## First Milestone Definition

The first useful milestone is:

```sh
lazyconfluence init
source ~/.config/lazyconfluence/atlassian.env
lazyconfluence doctor
lazyconfluence sync
lazyconfluence
```

Inside the TUI, the user can:

- See configured/indexed spaces.
- Browse top-level page groups.
- Search pages locally.
- Preview selected pages.
- Open selected pages in the browser.
- Follow internal Confluence links when the target is indexed.
- Return with back/history keys.

That is enough for V1.
