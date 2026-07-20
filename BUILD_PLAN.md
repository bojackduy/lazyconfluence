# Build Plan

This document explains how to build `lazyconfluence` from the product direction in `PRODUCT_PLAN.md`.

## Current Implementation Direction

Build a TypeScript terminal app with a rich document-first TUI.

Primary choices:

- Use Bun as the runtime and package manager.
- Use OpenTUI with Solid-style components for the terminal UI.
- Use a local database for synced Confluence content and search.
- Use explicit sync commands for all remote Confluence calls.
- Keep `lazylens/` as read-only reference material only.

This direction can still change, but new work should not continue the older Rust/Ratatui plan unless the user explicitly asks to switch back.

## Build Principles

- Build vertical slices that compile and run.
- Keep the app local-first after sync.
- Separate product intent from implementation details.
- Keep data contracts small and stable before UI polish.
- Prefer one active space in the main view.
- Put multi-space search, space switching, document find, and command discovery in overlays.
- Avoid provider abstractions, plugin systems, and web UI work in V1.
- Do not edit or generate files inside `lazylens/`.

## OpenTUI Skill Requirement

Before writing or changing terminal UI code, load the `opentui` skill and follow its instructions.

Relevant skill docs to consult by area:

- Renderer and lifecycle: `docs/getting-started.mdx`, `docs/core-concepts/renderer.mdx`, `docs/core-concepts/lifecycle.mdx`.
- Solid components: `docs/bindings/solid.mdx`.
- Layout: `docs/core-concepts/layout.mdx`.
- Keyboard and command layers: `docs/core-concepts/keyboard.mdx`, `docs/keymap/overview.mdx`.
- Rich document display: `docs/components/markdown.mdx`, `docs/components/scrollbox.mdx`, `docs/components/text.mdx`.
- Tests: `docs/core-concepts/testing.mdx`.

The goal is not to copy OpenCode's app structure. Use the skill to write correct OpenTUI code, then keep the `lazyconfluence` UI smaller and document-focused.

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
```

Add files only when a task needs them. Do not create empty modules just to match this tree.

## Dependency Direction

```text
main -> cli
cli -> config, paths, confluence, index, tui
confluence -> model
index -> model
tui -> index, model
config -> paths
model -> no app dependencies
paths -> no app dependencies
```

The TUI should read from application services and local repositories. It should not call Confluence directly.

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

## Build Phases

### Phase 0: Project Skeleton

Goal: a runnable CLI and empty TUI shell.

Deliverables:

- Package/runtime setup.
- `lazyconfluence --help` equivalent.
- Command stubs for `init`, `doctor`, `sync`, `search`, and default TUI.
- Minimal test command.

Exit criteria:

- Install works.
- Typecheck passes.
- Test command passes, even if tests are minimal.
- TUI can open a placeholder screen and quit.

### Phase 1: Config, Paths, And Doctor

Goal: safe setup without touching Confluence.

Deliverables:

- Config path resolution.
- Data/cache path resolution.
- Starter config writer.
- Env token skeleton writer.
- Doctor command that reports missing config, token, and spaces clearly.

Exit criteria:

- `init` creates non-secret starter files.
- `doctor` gives actionable next steps.
- Tests cover path expansion and missing-token behavior.

### Phase 2: Local Index Foundation

Goal: local storage is usable before remote sync exists.

Deliverables:

- Database open/create.
- Schema migrations.
- Repository functions for spaces, pages, links, children, search, and page lookup.
- Seed-fixture path for UI development.

Exit criteria:

- Tests cover upsert, search, children, outgoing links, incoming links, and URL matching.
- CLI `search` can query local fixture data.

### Phase 3: Confluence Fetch And Mapping

Goal: convert Confluence API responses into local records.

Deliverables:

- API client for spaces, pages, page bodies, and direct children.
- Auth header construction from env token.
- Pagination handling.
- Storage HTML to readable markdown.
- Snippet and link extraction.
- Mapping tests using mocked payloads.

Exit criteria:

- No real Atlassian calls in normal tests.
- Relative and absolute links normalize consistently.
- Changed-page detection can avoid fetching bodies for unchanged pages.

### Phase 4: Sync Pipeline

Goal: explicit sync writes useful local content.

Deliverables:

- Sync orchestration by configured space.
- Upsert source/space/page/link records.
- Safe pruning only after complete scans.
- Concise sync report.

Exit criteria:

- `sync` updates the local index.
- Failed or incomplete sync does not prune unseen pages.
- Tests cover partial scans and changed/unchanged pages.

### Phase 5: Reader TUI Core

Goal: product experience works with local data.

Deliverables:

- App shell with navigator, document, related, outline, and status regions.
- Active-space state.
- Page selection.
- Rich document rendering from stored markdown.
- Browser open action.
- Basic `h/j/k/l`, `enter`, `o`, `q`, and `tab` behavior.

Exit criteria:

- TUI reads local data only.
- User can browse a space tree and read pages.
- User can open selected page in browser.

### Phase 6: Search And Overlays

Goal: search is intent-specific and discoverable.

Deliverables:

- Page search overlay for active space.
- All-space search scope.
- Space switcher overlay.
- In-document find overlay.
- Command/action discovery overlay.
- Help overlay.

Exit criteria:

- `/` searches pages in active space.
- `f` finds inside current document.
- `s` switches spaces.
- `p` opens commands/actions.
- `?` explains current keys.

### Phase 7: Relationship Navigation And Polish

Goal: relationships make browsing feel better than web search.

Deliverables:

- Outgoing and incoming link panes.
- Follow indexed internal links.
- External link open behavior.
- Navigation history.
- Narrow terminal mode layout.
- Theme polish and selection/copy behavior.

Exit criteria:

- Internal links navigate locally when indexed.
- External links open in browser.
- History works reliably.
- Narrow terminals remain usable.

## Parallel Workstreams

These can be done concurrently after Phase 0 creates basic files and shared contracts.

```text
Workstream A: Setup, config, paths, doctor
Workstream B: Local database, schema, repository, search
Workstream C: Confluence client, mapper, HTML conversion
Workstream D: TUI shell, state, layout, keymap
Workstream E: Test fixtures, mocked payloads, verification helpers
Workstream F: Documentation and handoff updates
```

Recommended parallel order:

```text
Round 1:
  A creates config/paths contracts.
  B creates local repository against fixture data.
  D creates UI shell against mocked in-memory data.
  E creates fixtures for B, C, and D.

Round 2:
  C implements mocked API mapping.
  B integrates mapped records.
  D switches from mocked data to repository reads.
  F updates docs based on actual command names.

Round 3:
  C and B join through sync.
  D adds search, space switcher, document find, and relationship navigation.
  E expands coverage around integration boundaries.
```

## Integration Rules

- Subagents should own non-overlapping files when possible.
- If two tasks need the same model types, one task owns `src/model.ts` and publishes the contract first.
- UI tasks may use fixture data until repository functions exist.
- Repository tasks may use fixture records until Confluence mapping exists.
- Confluence tasks must not require real credentials for tests.
- Every task should leave the project typechecking.
- If a task changes shared contracts, update `TASK_BREAKDOWN.md` and mention impacted tasks.

## Verification Commands

The exact scripts will be finalized during Phase 0. The expected checks are:

```sh
bun install
bun run typecheck
bun test
bun run lint
```

If a script does not exist yet, create or update the appropriate package script as part of Phase 0.

## Read-Only References

Use these for behavior and UI inspiration, but do not edit them:

- `lazylens/` for Confluence sync, extraction, local indexing, and previous keyboard behavior.
- `~/Code/opencode` for rich terminal UI structure and OpenTUI usage.
- The `opentui` skill for current OpenTUI API usage and patterns.

Do not copy large chunks blindly. Extract patterns and build a smaller app for this product.
