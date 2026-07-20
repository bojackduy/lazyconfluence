# Handoff

This file summarizes the current project state after the mock-backed UI slice and describes the recommended execution order for the next work.

## Current Product Direction

`lazyconfluence` is a terminal-first, read-only Confluence document browser.

The intended runtime flow is local-first:

```text
init -> explicit sync -> local database/index -> TUI reads local data
```

Normal browsing in the TUI must not call Confluence directly. Remote Confluence access should happen only through explicit sync or refresh commands.

## Current Implementation State

Implemented so far:

- Bun, TypeScript, and OpenTUI Solid project foundation exists.
- The app starts through `src/main.tsx` and `src/cli.ts`.
- Default command opens the TUI: `bun run start`.
- `init` writes local Atlassian config and token env file outside the repo.
- `doctor` prints local config status only. It does not perform remote checks yet.
- `sync` and `search` CLI commands are placeholders.
- Shared domain records exist in `src/model.ts`.
- Multi-space mock data exists in `src/mock-data.ts`.
- Mock TUI exists in `src/tui/app.tsx`.
- Theme exists in `src/tui/theme.ts`.
- TUI renders a header, navigator tree, markdown document reader, outline, related panel, and status bar.
- Navigator supports `j/k`, `h/l`, `enter`, collapsible rows, and parent fallback.
- Document pane supports `j/k` line scroll and `d/u` half-page scroll.
- `/` opens active-space page search.
- `s` opens the space switcher.
- Missing or invalid credentials show a non-blocking mock-mode notice in the TUI.
- Mock UI still runs without credentials.

Latest verification after the credential notice work:

```sh
bun run typecheck
bun test
```

Result at handoff: `26 pass`, `0 fail`.

## Important Constraints

- Do not edit `lazylens/`. It is a read-only reference submodule.
- Do not update the submodule pointer unless explicitly requested.
- Keep secrets out of repository files and examples.
- Keep tests mocked unless the task explicitly requires integration with local temp data.
- The TUI should read from local repositories or app services, not directly from Confluence.
- Use explicit sync or refresh commands for remote Confluence calls.
- Support one active space in the main view.
- Keep search intent-specific: active-space page search, all-space search, document find, command discovery, and space switcher are separate workflows.
- Load the `opentui` skill before any terminal UI edits.

## Known Gaps

- `docs/TASK_TRACKER.md` is stale. It still marks planned tasks as not started, even though foundation, mock domain data, mock UI, config, and some overlay behavior now exist.
- There is no local database or index layer yet.
- There is no Confluence API client or mapper yet.
- There is no sync service yet.
- The TUI still reads directly from mock data.
- CLI `sync` and `search` are deferred placeholders.
- There is no command registry or dedicated keymap module yet.
- Remaining planned overlays are missing: document find, all-space page search, command palette, help, link navigation overlay.
- Internal link following, browser open, and navigation history are not complete.
- `src/tui/app.tsx` is still a single large component. Split it only when a concrete next task needs ownership boundaries.

## Recommended Execution Order

### 0. Reconcile Planning Docs

Before starting the next coding slice, update `docs/TASK_TRACKER.md` so future agents do not treat stale statuses as truth.

Suggested status adjustment:

- Foundation shell: done or mostly done.
- Domain and demo data: done for mock data.
- Reader UI and document detail: partially done.
- Search, spaces, and link overlays: partially done.
- Keymap and command system: not done.
- Confluence API mapping: not done.
- Local index and search: not done.
- Quality and integration: not done.

Verification: docs-only change, no runtime checks required unless code changes are included.

### 1. Build Local Index And Repository

This should be the next product-code slice.

Add only what is needed:

- `src/index/db.ts`
- `src/index/schema.ts`
- `src/index/repository.ts`
- `src/index/search.ts`
- `test/index.test.ts`

Implement:

- Open/create local database in a user-data path.
- Deterministic schema setup or migrations.
- Upsert spaces, pages, and links.
- Page lookup by ID.
- Children queries.
- Outgoing link queries.
- Incoming link queries.
- Active-space search.
- All-space search.
- URL-to-indexed-page matching for internal links.

Acceptance criteria:

- Tests use temp local data and no network.
- Search returns title, path, snippet, updated time, and space.
- Relationship queries distinguish child pages, outgoing links, and backlinks.
- No TUI remote calls are introduced.

Verification:

```sh
bun run typecheck
bun test
```

### 2. Build Confluence API Client And Mapper

This can happen after or in parallel with the repository work once shared models are stable.

Add:

- `src/confluence/client.ts`
- `src/confluence/mapper.ts`
- `src/confluence/html.ts` if HTML-to-markdown/link extraction is not owned elsewhere
- `test/confluence-client.test.ts`
- `test/confluence-mapper.test.ts`

Implement:

- Normalize Atlassian site URL to the Confluence wiki API root.
- Build basic auth headers from email plus API token.
- Resolve configured spaces.
- Fetch pages by space with pagination.
- Fetch page body by page ID.
- Fetch direct children by page ID.
- Map Confluence payloads into `SpaceSummary`, `IndexedPage`, `ReaderPage` support data, and `PageLink` records.

Acceptance criteria:

- All tests mock network calls.
- Pagination is covered.
- Direct children are covered.
- Mapper preserves tree, path, owner, updated time, URL, body markdown, and link metadata.

Verification:

```sh
bun run typecheck
bun test
```

### 3. Add Explicit Sync Service

Add:

- `src/sync.ts`
- `test/sync.test.ts`

Implement:

- Load local auth config.
- Refuse sync with a clear message when config or token is missing.
- Resolve configured spaces.
- Fetch page lists.
- Fetch bodies for new or changed pages.
- Fetch direct children for hierarchy.
- Extract links and map internal/external URLs.
- Upsert spaces, pages, and links into the repository.
- Print a concise sync report.
- Do not prune existing pages after incomplete scans.

Acceptance criteria:

- `bun run start sync` is the only path that contacts Confluence.
- Mocked sync tests cover partial failure and no-prune behavior.
- Sync writes to local data only after explicit command.

Verification:

```sh
bun run typecheck
bun test
```

### 4. Connect CLI To Real Local Services

Update `src/cli.ts` after repository and sync services exist.

Implement:

- `doctor` checks local config and local database status.
- `sync` calls the sync service.
- `search` queries the local index.
- Default TUI still starts without remote calls.

Acceptance criteria:

- CLI commands are coherent: `init`, `doctor`, `sync`, `search`, default TUI.
- Missing credentials are reported clearly without stack traces.
- Search works from local indexed data.

Verification:

```sh
bun run typecheck
bun test
```

### 5. Move TUI From Mock Data To Repository Reads

Do this after repository reads are stable.

Preferred approach:

- Add a small TUI data adapter or state module rather than calling repository functions all over `App`.
- Keep mock data available as a fallback only if no local index exists.
- Preserve the current mock UI behavior while replacing data source calls.

Implement:

- Load configured/local spaces.
- Pick default active space from config or first indexed space.
- Load active-space tree from repository.
- Load selected reader page from repository.
- Query active-space page search from repository.
- Query space switcher from repository.
- Keep credential notice non-blocking.

Acceptance criteria:

- Normal TUI browsing makes no live Confluence calls.
- Empty local database gets a friendly first-run state.
- Existing keyboard behavior keeps working.
- Mock fallback does not mask real local-data failures once data exists.

Verification:

```sh
bun run typecheck
bun test
```

### 6. Add Command Registry And Keymap Module

Add:

- `src/tui/commands.ts`
- `src/tui/keymap.ts`
- `src/tui/state.ts` if state transitions need to leave `App`
- `test/tui-keymap.test.ts`

Implement explicit command names for:

- Quit
- Help
- Active-space page search
- Document find
- Space switcher
- Command discovery
- Open selected page in browser
- Sync or refresh action hook
- Back navigation
- Pane focus
- Tree fold/expand
- Link follow

Acceptance criteria:

- `q`, `?`, `/`, `f`, `s`, `p`, `enter`, `o`, `r`, `h`, `j`, `k`, `l`, `b`, `tab`, and `esc` have explicit command intent.
- Overlay input handling does not conflict with global keys.
- Command definitions can be rendered by help or command discovery.

Verification:

```sh
bun run typecheck
bun test
```

### 7. Finish Product Overlays And Navigation

Build on the command/keymap work.

Implement:

- `f` document find overlay.
- Active-space/all-space page search scope behavior.
- `p` command palette.
- `?` help overlay.
- Related link navigation.
- Outline jump behavior.
- Internal indexed link follow.
- External browser open through explicit action.
- `b` back navigation history.
- `o` open selected canonical Confluence page in browser.

Acceptance criteria:

- Search behavior remains split by intent.
- Document find does not change page search state.
- Space switching does not permanently crowd the main view.
- Internal links navigate locally when indexed.
- External links require explicit open action.

Verification:

```sh
bun run typecheck
bun test
```

### 8. Integration And Quality Pass

Finish the first useful milestone.

Implement:

- End-to-end local-first test using mocked network and temp local data.
- Docs cleanup after user approval.
- Update root `README.md` if stale.
- Update `docs/TASK_TRACKER.md` and completion log.
- Ensure no generated files or secrets are committed.

Acceptance criteria:

- User can run `init`, `sync`, default TUI, search locally, browse a space tree, read pages, follow indexed links, and open pages in browser.
- Explicit sync is the only remote operation path.
- Empty, missing-config, missing-token, and stale-local-data states are user-friendly.

Verification:

```sh
bun run typecheck
bun test
bun run lint
```

## Immediate Next Task Prompt

Use this prompt for the next coding agent:

```text
Implement the local index and repository layer for lazyconfluence. Read docs/HANDOFF.md, docs/README.md, docs/BUILD_PLAN.md, docs/TASK_TRACKER.md, and AGENTS.md first. Do not edit lazylens/. Add src/index/db.ts, src/index/schema.ts, src/index/repository.ts, src/index/search.ts, and tests. Keep all tests local and network-free. The TUI must continue using mock data until repository reads are explicitly wired in a later task. Run bun run typecheck and bun test before handoff.
```

## Useful Files

- `src/model.ts`: shared domain types.
- `src/mock-data.ts`: current mock data and behavior reference.
- `src/tui/app.tsx`: current OpenTUI app and keyboard behavior.
- `src/config.ts`: local Atlassian config, token loading, credential status.
- `src/paths.ts`: local config path resolution.
- `src/cli.ts`: current CLI entry points and placeholders.
- `test/mock-data.test.ts`: mock behavior tests.
- `test/search-key-routing.test.ts`: overlay key routing tests.
- `test/tui-layout.test.tsx`: headless OpenTUI layout test.
- `test/config.test.ts`: config and credential status tests.

## Final Notes

- The next major value is not direct API wiring. It is the local data boundary.
- Build local storage first so Confluence sync and TUI reads can integrate cleanly.
- Keep changes surgical. Do not split or refactor the TUI until the next task needs that boundary.
- If product intent is unclear, ask before adding abstractions such as providers, plugins, or web UI.
