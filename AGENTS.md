# AGENTS.md

Guidance for agents working in this repository.

## Project Purpose

`lazyconfluence` is a new Rust terminal app inspired by `lazylens`.

The goal is to build a focused Confluence-first TUI that follows this flow:

```text
Confluence Cloud API -> local SQLite/FTS index -> Ratatui TUI -> browser open
```

This is not a direct Python-to-Rust port. Use the existing Python project only to understand proven behavior, then implement a small, idiomatic Rust application.

## Where To Work

All new application code belongs in the repository root as a Rust project.

Expected root-level files and directories include:

```text
Cargo.toml
Cargo.lock
src/
tests/
README.md
AGENTS.md
```

Suggested Rust module layout is documented in `README.md` and should be followed unless there is a clear reason to keep the change smaller.

## Read-Only Submodule

`lazylens/` is a git submodule and is read-only reference material.

Never edit anything under `lazylens/`.

Do not:

- Patch, format, delete, rename, or generate files inside `lazylens/`.
- Run commands that may rewrite files inside `lazylens/`.
- Commit changes inside the submodule.
- Update the submodule pointer unless the user explicitly asks for that.
- Treat the Python code as product code for this repository.

If a task seems to require changing `lazylens/`, stop and ask the user. The intended workflow is to read it, learn from it, and implement equivalent behavior in Rust outside the submodule.

## Reference Reading Order

Before implementing behavior, read `README.md` first. When details are needed, inspect these `lazylens/` files as read-only references:

1. `lazylens/indexers/confluence.py` for Confluence auth, API requests, spaces, pages, children, hierarchy, snippets, and links.
2. `lazylens/extract.py` for snippet extraction strategy.
3. `lazylens/db.py` for SQLite, FTS search, hierarchy, children, and link relationship behavior.
4. `lazylens/indexing.py` for refresh orchestration and safe pruning.
5. `lazylens/config.py` and `lazylens/paths.py` for config and platform paths.
6. `lazylens/tui.py` for keyboard behavior, panes, previews, URLs, history, and relationships.
7. `lazylens/tests/` for expected behavior without real Atlassian calls.

## Implementation Direction

Build the project in the phases described in `README.md`:

1. Rust skeleton with `clap`, config, paths, errors, models, and placeholder commands.
2. Config loading, `init`, and `doctor`.
3. Confluence Cloud client using Atlassian API-token basic auth.
4. HTML mapping into snippets and links.
5. SQLite schema, upserts, FTS5 search, and sync.
6. Tree, children, incoming links, outgoing links, and URL relationship resolution.
7. First Ratatui UI reading only from the local DB.
8. Lazy-style keyboard polish and history.
9. TUI-triggered sync without blocking navigation.
10. Packaging, CI, and release workflow.

The first useful milestone is:

```sh
lazyconfluence init
source ~/.config/lazyconfluence/atlassian.env
lazyconfluence doctor
lazyconfluence sync
lazyconfluence
```

## Product Constraints

- TUI navigation must be local-first and must not depend on live Confluence API calls.
- Remote calls should happen only during explicit sync or refresh.
- Store snippets and metadata by default, not full page bodies.
- Keep secrets out of TOML and source control; resolve API tokens from environment variables.
- Use Confluence Cloud first. Do not add Jira, SharePoint, semantic search, embeddings, web UI, or generic provider abstractions for V1.
- Prefer boring dependencies and small correct features.
- Error messages should tell the user exactly what to fix.

## Verification

When a Rust project exists, prefer these checks before handing off:

```sh
cargo fmt --check
cargo test
cargo clippy --all-targets --all-features -- -D warnings
```

Tests should mock Confluence API behavior. Real Confluence integration tests must be opt-in and require explicit environment variables.

## Working Rules

- Make surgical changes that directly support the requested phase or bug fix.
- Do not refactor unrelated code.
- Do not add speculative compatibility layers or provider abstractions.
- Preserve the project plan in `README.md`; update it only when the user asks or when implementation reality requires a documented change.
- Before editing, check whether files already have user changes and avoid overwriting unrelated work.
- Keep `lazylens/` clean and unchanged.
