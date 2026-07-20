# Build Plan

This plan explains how to build `lazyconfluence` from the product direction in `docs/README.md`.

## Current Direction

Build a TypeScript terminal app with a rich document-first TUI.

Primary choices:

- Use Bun as the runtime and package manager.
- Use OpenTUI with Solid-style components for the terminal UI.
- Use a local database for synced Confluence content and search.
- Use explicit sync commands for all remote Confluence calls.
- Keep `lazylens/` as read-only reference material only.

This direction can still change, but new work should not continue older implementation notes unless the user explicitly asks to switch back.

## Build Principles

- Build vertical slices that compile and run.
- Keep the app local-first after sync.
- Keep data contracts small and stable before UI polish.
- Prefer one active space in the main view.
- Put multi-space search, space switching, document find, and command discovery in overlays.
- Avoid provider abstractions, plugin systems, and web UI work in V1.
- Do not edit or generate files inside `lazylens/`.

## Target Source Layout

```text
package.json
bun.lock
bunfig.toml
tsconfig.json
src/
  main.tsx
  cli.ts
  errors.ts
  paths.ts
  config.ts
  model.ts
  sync.ts
  confluence/
    client.ts
    mapper.ts
    html.ts
  index/
    db.ts
    schema.ts
    repository.ts
    search.ts
  tui/
    app.tsx
    state.ts
    keymap.ts
    commands.ts
    theme.ts
    components/
      shell.tsx
      navigator.tsx
      document.tsx
      related.tsx
      outline.tsx
      overlays.tsx
      status.tsx
test/
  fixtures/
  helpers/
```

Add files only when a task needs them. Do not create empty modules just to match this tree.

## Dependency Direction

```text
main -> cli
cli -> config, paths, sync, index, tui
sync -> config, confluence, index
confluence -> model
index -> model
tui -> index, model
config -> paths
model -> no app dependencies
paths -> no app dependencies
```

The TUI reads from local repositories and app services. It must not call Confluence directly.

## Shared Data Contracts

Start with these conceptual records before adding richer details.

```text
SpaceSummary
  key
  name
  lastSyncedAt
  pageCount

IndexedPage
  sourceKey
  pageId
  spaceKey
  title
  url
  parentId
  path
  owner
  updatedAt
  contentMarkdown
  snippet

PageLink
  sourceKey
  fromPageId
  targetUrl
  targetPageId
  title
  kind

SearchResult
  pageId
  spaceKey
  title
  path
  snippet
  updatedAt

ViewState
  activeSpaceKey
  selectedPageId
  focusedPane
  overlay
  query
  history
```

These names are guidance, not mandatory API names.

## Implementation Rounds

### Round 0: Foundation

Run first:

- `subagents/01-foundation-shell.md`
- `subagents/02-domain-demo-data.md`

Goal: establish package setup, source tree, shared contracts, and safe fake data.

### Round 1: Parallel Core Work

Run in parallel after Round 0:

- `subagents/03-keymap-command-system.md`
- `subagents/04-confluence-api-mapping.md`
- `subagents/05-local-index-search.md`
- `subagents/06-reader-ui-document-detail.md`

Goal: build independent core systems against shared contracts and fixtures.

### Round 2: Product Overlays

Run after keymap, local index, and reader UI are usable:

- `subagents/07-search-space-link-overlays.md`

Goal: implement intent-specific search, space switching, find, related links, and command overlays.

### Round 3: Integration And Quality

Run after API, index, and UI pieces are available:

- `subagents/08-quality-integration.md`

Goal: wire sync, end-to-end local flow, tests, and docs cleanup.

## Verification Commands

The exact scripts are finalized by the foundation task. Expected checks:

```sh
bun install
bun run typecheck
bun test
bun run lint
```

If a script does not exist yet, the foundation task should create it or explicitly document why it is deferred.

## Integration Rules

- Subagents should own non-overlapping files when possible.
- If a task changes shared contracts, update `docs/TASK_TRACKER.md` and mention impacted tasks.
- UI tasks must load the `opentui` skill before editing OpenTUI code.
- UI tasks may use fixture data until repository functions exist.
- Repository tasks may use fixture records until Confluence mapping exists.
- Confluence tasks must not require real credentials for tests.
- Every task should leave the project typechecking.
- Never edit `lazylens/`.
