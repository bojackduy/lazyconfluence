# Task Breakdown

This file is the checklist for parallel execution. Each task is written so a subagent can own it without editing submodules.

## Coordination Checklist

- [ ] Read `PRODUCT_PLAN.md`.
- [ ] Read `BUILD_PLAN.md`.
- [ ] Read `AGENTS.md`.
- [ ] Load the `opentui` skill before any terminal UI or keymap work.
- [ ] Confirm the task's file ownership before editing.
- [ ] Do not edit `lazylens/`.
- [ ] Do not update the submodule pointer.
- [ ] Keep tests mocked unless the task explicitly says otherwise.
- [ ] Run the relevant verification commands before handoff.
- [ ] Update this checklist when a task is completed.

## Task Status Board

| ID | Task | Status | Depends On | Primary Files |
| --- | --- | --- | --- | --- |
| T0 | Project skeleton | Not started | None | `package.json`, `tsconfig.json`, `src/main.tsx`, `src/cli.ts` |
| T1 | Shared models | Not started | T0 | `src/model.ts` |
| T2 | Config, paths, doctor | Not started | T0, T1 | `src/config.ts`, `src/paths.ts`, `src/cli.ts` |
| T3 | Local index repository | Not started | T0, T1 | `src/index/*`, `test/fixtures/*` |
| T4 | Confluence client and mapper | Not started | T0, T1 | `src/confluence/*`, `test/fixtures/*` |
| T5 | HTML to document content | Not started | T1 | `src/confluence/html.ts`, `test/fixtures/*` |
| T6 | Sync orchestration | Not started | T2, T3, T4, T5 | `src/sync.ts`, `src/cli.ts` |
| T7 | TUI shell and state | Not started | T0, T1 | `src/tui/*` |
| T8 | Search and overlays | Not started | T3, T7 | `src/tui/components/*`, `src/tui/keymap.ts` |
| T9 | Relationship navigation | Not started | T3, T7 | `src/tui/components/*`, `src/tui/state.ts` |
| T10 | Test fixtures and helpers | Not started | T0, T1 | `test/fixtures/*`, `test/helpers/*` |
| T11 | Documentation reconciliation | Not started | T0 | `README.md`, `AGENTS.md`, `BUILD_PLAN.md` |

Status values: `Not started`, `In progress`, `Blocked`, `Done`.

## T0: Project Skeleton

Purpose: create the smallest runnable app foundation.

Suggested owner: setup agent.

Files owned:

- `package.json`
- `bunfig.toml`
- `tsconfig.json`
- `src/main.tsx`
- `src/cli.ts`
- `src/errors.ts`

Checklist:

- [ ] Create package metadata and scripts.
- [ ] Add TypeScript config for TSX.
- [ ] Add OpenTUI Solid preload config if needed.
- [ ] Implement command parsing for `init`, `doctor`, `sync`, `search`, and default TUI.
- [ ] Implement placeholder handlers that return clear messages.
- [ ] Add a placeholder TUI screen that can quit.
- [ ] Add `typecheck`, `test`, and `lint` scripts or document why one is deferred.
- [ ] Verify install, typecheck, and test.

Acceptance criteria:

- `bun install` completes.
- `bun run typecheck` completes.
- `bun test` completes.
- Running the default command opens a placeholder terminal UI and exits cleanly.

Subagent prompt:

```text
Implement T0 from TASK_BREAKDOWN.md. Work only in the root project, never in lazylens/. Load the opentui skill before writing TUI code. Create the minimal Bun/TypeScript/OpenTUI skeleton with command stubs and a placeholder TUI. Keep the change small and verify typecheck/test.
```

## T1: Shared Models

Purpose: publish the basic contracts other tasks can compile against.

Suggested owner: contracts agent.

Files owned:

- `src/model.ts`

Checklist:

- [ ] Define `SpaceSummary`.
- [ ] Define `IndexedPage`.
- [ ] Define `PageLink`.
- [ ] Define `SearchResult`.
- [ ] Define view state and focus/overlay enums.
- [ ] Keep model types serializable and dependency-free.
- [ ] Add simple factory fixtures if useful for tests.
- [ ] Verify typecheck.

Acceptance criteria:

- Models compile without importing UI, database, or Confluence modules.
- Other tasks can import stable page, space, link, and search result contracts.

Subagent prompt:

```text
Implement T1 from TASK_BREAKDOWN.md. Create shared model contracts only. Do not implement storage, UI, or Confluence behavior. Keep types small and dependency-free.
```

## T2: Config, Paths, Doctor

Purpose: make setup safe and clear before remote calls exist.

Suggested owner: setup/config agent.

Files owned:

- `src/config.ts`
- `src/paths.ts`
- `src/cli.ts` for command integration only
- `test/config.test.ts`

Checklist:

- [ ] Resolve config, data, and cache paths.
- [ ] Support home-directory expansion.
- [ ] Define config shape for Confluence base URL, email, token env var, and spaces.
- [ ] Implement `init` writing starter config and env skeleton without secrets.
- [ ] Implement `doctor` checks for config file, database path, base URL, email, token env var, and spaces.
- [ ] Print actionable next steps for missing setup.
- [ ] Add tests for path expansion and missing-token behavior.
- [ ] Verify typecheck and tests.

Acceptance criteria:

- `init` is safe to run repeatedly.
- `doctor` never prints token values.
- Missing setup messages tell the user what to do next.

Subagent prompt:

```text
Implement T2 from TASK_BREAKDOWN.md. Build config/path/init/doctor behavior. Do not call Confluence. Do not edit lazylens/. Add tests for path expansion and missing token diagnostics.
```

## T3: Local Index Repository

Purpose: make local data usable for search and browsing before remote sync.

Suggested owner: storage agent.

Files owned:

- `src/index/db.ts`
- `src/index/schema.ts`
- `src/index/repository.ts`
- `src/index/search.ts`
- `test/index.test.ts`

Checklist:

- [ ] Open/create the local database.
- [ ] Create schema for spaces, pages, links, and search content.
- [ ] Implement migrations in a deterministic way.
- [ ] Implement upsert space/page/link operations.
- [ ] Implement children queries.
- [ ] Implement outgoing links and incoming links.
- [ ] Implement page lookup by ID.
- [ ] Implement page search for active space and all spaces.
- [ ] Implement URL-to-page relationship matching.
- [ ] Add tests using local fixture records.
- [ ] Verify typecheck and tests.

Acceptance criteria:

- Repository tests pass without network access.
- Search returns page results with title, path, snippet, and space.
- Relationship queries can identify indexed internal links.

Subagent prompt:

```text
Implement T3 from TASK_BREAKDOWN.md. Build the local database and repository layer against shared models and fixtures. Do not call Confluence and do not implement UI.
```

## T4: Confluence Client And Mapper

Purpose: fetch Confluence records and map API payloads into local models.

Suggested owner: API agent.

Files owned:

- `src/confluence/client.ts`
- `src/confluence/mapper.ts`
- `test/confluence-client.test.ts`
- `test/confluence-mapper.test.ts`

Checklist:

- [ ] Normalize Confluence base URL to the wiki root.
- [ ] Build basic auth header from email and token.
- [ ] Resolve configured spaces.
- [ ] Fetch pages by space with pagination.
- [ ] Fetch page body by page ID.
- [ ] Fetch direct children by page ID.
- [ ] Map page and folder payloads into shared local models.
- [ ] Preserve enough metadata for tree navigation and display.
- [ ] Add tests with mocked fetch and JSON fixtures.
- [ ] Verify typecheck and tests.

Acceptance criteria:

- Tests require no real Atlassian credentials.
- Pagination and direct-children behavior are covered.
- API models map consistently into shared app models.

Subagent prompt:

```text
Implement T4 from TASK_BREAKDOWN.md. Build the Confluence client and mapper with mocked tests. Read lazylens only as reference. Do not edit lazylens/ and do not build sync orchestration yet.
```

## T5: HTML To Document Content

Purpose: convert Confluence storage content into useful terminal-readable content.

Suggested owner: content extraction agent.

Files owned:

- `src/confluence/html.ts`
- `test/html.test.ts`
- `test/fixtures/confluence-html/*`

Checklist:

- [ ] Extract readable text from Confluence storage HTML.
- [ ] Convert common structures into markdown-like document content.
- [ ] Preserve headings, lists, tables, links, inline code, and code blocks where feasible.
- [ ] Remove obvious boilerplate.
- [ ] Generate useful snippets.
- [ ] Extract links.
- [ ] Normalize relative Confluence links to absolute URLs.
- [ ] De-duplicate links.
- [ ] Add tests with representative storage HTML fixtures.
- [ ] Verify typecheck and tests.

Acceptance criteria:

- Converted content is good enough for rich terminal rendering.
- Snippets are short and useful.
- Link extraction handles relative and absolute URLs.

Subagent prompt:

```text
Implement T5 from TASK_BREAKDOWN.md. Build Confluence storage HTML conversion, snippets, and link extraction with fixtures. Read lazylens as reference only and do not edit it.
```

## T6: Sync Orchestration

Purpose: connect config, Confluence fetch, mapping, and local storage through explicit sync.

Suggested owner: integration agent.

Files owned:

- `src/sync.ts`
- `src/cli.ts` for sync integration only
- `test/sync.test.ts`

Checklist:

- [ ] Load config and token from env.
- [ ] Resolve configured spaces.
- [ ] Fetch page lists.
- [ ] Fetch bodies for changed pages.
- [ ] Fetch direct children for hierarchy.
- [ ] Convert content and links.
- [ ] Upsert pages and links into local repository.
- [ ] Skip pruning if scan is incomplete.
- [ ] Print concise sync report.
- [ ] Add tests for complete scan, incomplete scan, and changed pages.
- [ ] Verify typecheck and tests.

Acceptance criteria:

- `sync` writes local data only when explicitly called.
- Incomplete scans do not delete existing pages.
- Failures are clear and actionable.

Subagent prompt:

```text
Implement T6 from TASK_BREAKDOWN.md. Connect config, Confluence, HTML conversion, and repository into explicit sync. Keep tests mocked and do not perform real network calls.
```

## T7: TUI Shell And State

Purpose: create the document-first interface using local or fixture data.

Suggested owner: UI shell agent.

Files owned:

- `src/tui/app.tsx`
- `src/tui/state.ts`
- `src/tui/theme.ts`
- `src/tui/keymap.ts`
- `src/tui/components/shell.tsx`
- `src/tui/components/navigator.tsx`
- `src/tui/components/document.tsx`
- `src/tui/components/status.tsx`

Checklist:

- [ ] Render the main shell from `PRODUCT_PLAN.md`.
- [ ] Use fixture data until repository reads are available.
- [ ] Track active space, selected page, focus pane, overlay, and history.
- [ ] Render navigator tree.
- [ ] Render rich document content.
- [ ] Render status/help hints.
- [ ] Implement quit, movement, pane focus, page selection, and browser-open commands.
- [ ] Add a narrow-terminal mode if feasible, or leave clear TODO with layout boundary.
- [ ] Verify typecheck and any UI tests available.

Acceptance criteria:

- TUI opens, displays fixture/local data, and quits cleanly.
- Main layout matches the product plan closely.
- No remote calls happen from TUI components.

Subagent prompt:

```text
Implement T7 from TASK_BREAKDOWN.md. Load the opentui skill before editing UI code. Build the TUI shell and local state against fixture data or repository reads. Keep it document-first and avoid remote calls from UI code.
```

## T8: Search And Overlays

Purpose: implement intent-specific search and action overlays.

Suggested owner: overlay agent.

Files owned:

- `src/tui/components/overlays.tsx`
- `src/tui/components/search.tsx`
- `src/tui/keymap.ts`
- `src/tui/state.ts` for overlay state only

Checklist:

- [ ] Implement page search overlay for active space.
- [ ] Add all-space search scope toggle.
- [ ] Implement space switcher overlay.
- [ ] Implement in-document find overlay.
- [ ] Implement command/action discovery overlay.
- [ ] Implement help overlay.
- [ ] Wire `/`, `f`, `s`, `p`, `?`, `esc`, `enter`, `n`, and `N`.
- [ ] Verify typecheck and relevant tests.

Acceptance criteria:

- Search behavior is split by intent.
- Overlay closing and keyboard focus are predictable.
- Page search and document find do not conflict.

Subagent prompt:

```text
Implement T8 from TASK_BREAKDOWN.md. Load the opentui skill before editing UI or keymap code. Add search, find, space switcher, command palette, and help overlays to the TUI. Keep scopes separate and keyboard-first.
```

## T9: Relationship Navigation

Purpose: make links and backlinks first-class navigation surfaces.

Suggested owner: navigation agent.

Files owned:

- `src/tui/components/related.tsx`
- `src/tui/components/outline.tsx`
- `src/tui/state.ts` for relationship/history behavior only
- `src/index/repository.ts` only if relationship query shape must be adjusted

Checklist:

- [ ] Render outgoing links.
- [ ] Render incoming links.
- [ ] Distinguish indexed internal pages from external URLs.
- [ ] Follow indexed internal links locally.
- [ ] Open external links in browser.
- [ ] Implement history back behavior.
- [ ] Implement outline navigation from document headings.
- [ ] Verify typecheck and tests.

Acceptance criteria:

- Related links support the product questions from `PRODUCT_PLAN.md`.
- History returns to previous page and selection reliably.
- External links do not pretend to be internal pages.

Subagent prompt:

```text
Implement T9 from TASK_BREAKDOWN.md. Load the opentui skill before editing UI or keymap code. Build related-link, backlink, outline, and history navigation. Do not introduce remote calls into the TUI.
```

## T10: Test Fixtures And Helpers

Purpose: unblock parallel work with shared fake data.

Suggested owner: testing agent.

Files owned:

- `test/fixtures/*`
- `test/helpers/*`

Checklist:

- [ ] Add fake spaces.
- [ ] Add fake page list payloads.
- [ ] Add fake page body payloads.
- [ ] Add fake direct-children payloads.
- [ ] Add representative Confluence storage HTML.
- [ ] Add local repository seed records.
- [ ] Add helper functions for temp config and temp database paths.
- [ ] Verify tests consume fixtures without absolute machine paths.

Acceptance criteria:

- API, storage, sync, and UI tasks can share fixtures.
- Fixtures contain no secrets or real company content.

Subagent prompt:

```text
Implement T10 from TASK_BREAKDOWN.md. Create sanitized fixtures and test helpers for spaces, pages, HTML bodies, direct children, and local seed data. Do not use real Confluence content.
```

## T11: Documentation Reconciliation

Purpose: keep future agents from following stale notes.

Suggested owner: docs agent.

Files owned:

- `README.md`
- `AGENTS.md`
- `BUILD_PLAN.md`
- `TASK_BREAKDOWN.md`

Checklist:

- [ ] Mark or replace stale implementation direction in `README.md` after the user approves.
- [ ] Keep `PRODUCT_PLAN.md` as the product source of truth.
- [ ] Keep `BUILD_PLAN.md` as the implementation source of truth.
- [ ] Keep `TASK_BREAKDOWN.md` current as tasks complete.
- [ ] Ensure submodule read-only warnings remain explicit.
- [ ] Verify docs do not include secrets or user-specific credentials.

Acceptance criteria:

- A future agent can determine current product direction, implementation direction, and task status in under five minutes.
- Stale Rust/Ratatui notes are not mistaken for the active plan.

Subagent prompt:

```text
Implement T11 from TASK_BREAKDOWN.md only after user approval to reconcile README.md. Preserve product direction and submodule read-only rules. Do not edit lazylens/.
```

## Suggested Parallel Assignment

After T0 and T1 are done, run these in parallel:

- [ ] Agent A: T2 config, paths, doctor.
- [ ] Agent B: T3 local index repository.
- [ ] Agent C: T4 Confluence client and mapper.
- [ ] Agent D: T5 HTML conversion.
- [ ] Agent E: T7 TUI shell against fixtures.
- [ ] Agent F: T10 fixtures and helpers.

Then integrate:

- [ ] Agent G: T6 sync orchestration.
- [ ] Agent H: T8 search and overlays.
- [ ] Agent I: T9 relationship navigation.
- [ ] Agent J: T11 documentation reconciliation.

## Completion Rules

When a task is done:

- [ ] Change its status in the task board to `Done`.
- [ ] Mark completed checklist items.
- [ ] Note any changed contracts under the task section.
- [ ] List verification commands that passed.
- [ ] List any blocked follow-up work.
