# Task Tracker

Track parallel execution here. Update this file whenever a subagent starts, blocks, or completes a task.

## Global Rules

- [ ] Read `docs/README.md`.
- [ ] Read `docs/BUILD_PLAN.md`.
- [ ] Read `docs/OPENTUI_REFERENCE.md` before UI work.
- [ ] Read `AGENTS.md`.
- [ ] Confirm file ownership before editing.
- [ ] Do not edit `lazylens/`.
- [ ] Do not update the submodule pointer.
- [ ] Keep tests mocked unless a task explicitly says otherwise.
- [ ] Run relevant verification commands before handoff.

## Status Board

| ID | Task | Status | Depends On | Brief |
| --- | --- | --- | --- | --- |
| 01 | Foundation shell | Done | None | `subagents/01-foundation-shell.md` |
| 02 | Domain and demo data | Done | 01 | `subagents/02-domain-demo-data.md` |
| 03 | Keymap and command system | Not started | 01, 02 | `subagents/03-keymap-command-system.md` |
| 04 | Confluence API mapping | Done | 01, 02 | `subagents/04-confluence-api-mapping.md` |
| 05 | Local index and search | Done | 01, 02 | `subagents/05-local-index-search.md` |
| 06 | Reader UI and document detail | Partial | 01, 02 | `subagents/06-reader-ui-document-detail.md` |
| 07 | Search, spaces, and link overlays | Partial | 03, 05, 06 | `subagents/07-search-space-link-overlays.md` |
| 08 | Quality and integration | Not started | 04, 05, 06, 07 | `subagents/08-quality-integration.md` |

Status values: `Not started`, `In progress`, `Blocked`, `Partial`, `Done`.

## Current Reality

- Foundation shell is done: Bun, TypeScript, CLI entrypoint, TUI launch, `init`, and local `doctor` exist.
- Domain and demo data are done for the mock-backed product slice.
- Reader UI and document detail are partial: the TUI renders the main reader, navigator, outline, related panel, scroll behavior, safe document-kind symbols, richer markdown/code/table styling, orphaned local pages, draft previews, and local-first staged creates; it now reads pages from the local SQLite index, edits synced pages and staged creates in a transient in-app Markdown editor, stages new child pages from the navigator with `n`, and reviews/applies or discards current-space staged changes from a normal-view Overview popup after explicit approval. Browser-open hooks and broader polish remain.
- Search, spaces, and link overlays are partial: active-space page search and space switcher read the local SQLite index; document find, all-space search UI, command palette, help, and link navigation overlays remain.
- Local index and search are done for this slice: local SQLite schema, repository upserts, Confluence tree ordering, relationship queries, URL matching, and page search are implemented and tested.
- Confluence API mapping is done for the read-only slice: URL normalization, auth headers, mocked paginated fetches, recursive direct children, canonical document projection, storage HTML mapping including tables, sidecar preservation, and local model mapping are implemented and tested.
- Explicit sync service is done for the first local-first slice: `sync` loads local auth, fetches configured spaces/pages/children, maps Confluence storage into local projections, writes spaces/pages/links/body artifacts into SQLite, reports partial failures, and does not prune local pages after incomplete scans.
- CLI local DB integration is done for `doctor`, `search`, local body `repair`, local draft/stage/discard/diff/preview commands, and scoped `sync` flags. These commands read local SQLite except for explicit `sync`.
- Local editing is started: CLI drafts can be created from a markdown file or `$EDITOR`, staged, unstaged, discarded, previewed, and diffed against the synced body artifact. The TUI opens an in-app Markdown editor with `e`; `Ctrl+T` stages the transient editor buffer, `Esc` closes without changing staged docs, `n` on the navigator creates a local child page immediately, and normal-view Overview shows current-space staged update/create diffs for selecting changes to apply or discard. Broader preservation for opaque Confluence content remains.
- Sync observability is done for the first remote slice: Confluence requests time out by default, service-level progress events cover remote wait points, and CLI `sync` prints progress unless `--quiet` is set.
- TUI date rendering is defensive: existing rows with missing or invalid timestamps display `unknown`, and future syncs use the sync timestamp when Confluence omits page dates.
- Keymap and command registry are not started.
- Quality and integration are not started.

## Parallel Plan

Round 0:

- [x] Run 01 first.
- [x] Run 02 after 01 creates the package/test base.

Round 1:

- [x] Run 05 after 01 and 02.
- [x] Run 04 after 01 and 02.
- [ ] Run 03 after 01 and 02.
- [ ] Continue 06 from the current partial mock-backed reader UI.

Round 2:

- [ ] Run 07 after 03, 05, and 06.

Round 3:

- [ ] Run 08 after 04, 05, 06, and 07.

## Completion Log

Add dated notes here as tasks complete.

```text
YYYY-MM-DD  ID  Result  Verification  Follow-up
2026-07-21  05  Local SQLite index, repository, relationship queries, URL matching, and search implemented.  bun run typecheck; bun test (30 pass, 0 fail).  Next: build Confluence API mapping or explicit sync service; do not wire TUI yet.
2026-07-21  04  Read-only Confluence client, canonical document mapping, storage HTML projection, link extraction, and opaque macro sidecar preservation implemented.  bun run typecheck; bun test (38 pass, 0 fail).  Next: explicit sync service should connect mocked Confluence client/mapper to the local repository.
2026-07-21  sync  Explicit sync service implemented and CLI `sync` now runs it.  bun run typecheck; bun test (42 pass, 0 fail).  Next: CLI `search`/doctor local DB integration or TUI repository adapter; keep TUI mock-backed until integration task.
2026-07-21  body-artifacts  Local schema v2 and repository/sync persistence for canonical body artifacts implemented.  bun run typecheck; bun test (43 pass, 0 fail).  Next: CLI local DB search/doctor or TUI repository adapter.
2026-07-21  cli-local  CLI `doctor` reports local DB health, CLI `search` queries SQLite, and `sync --space/--spaces` scopes explicit sync.  bun run typecheck; bun test (47 pass, 0 fail).  Next: TUI repository adapter or command/keymap registry.
2026-07-21  sync-progress  Confluence request timeout, sync progress events, default CLI sync progress output, `sync --quiet`, and current init handoff message implemented.  bun run typecheck; bun test (49 pass, 0 fail).  Next: TUI repository adapter or command/keymap registry.
2026-07-21  tui-local  TUI default data path now reads spaces, page tree, selected document, links, and search from the local SQLite index with an empty-index smoke screen.  bun run typecheck; bun test (49 pass, 0 fail).  Next: command/keymap registry, browser-open hook, or remaining overlays.
2026-07-21  tui-date-fix  Fixed TUI crash on pages with empty/invalid `updatedAt`; mapper now falls back to sync time for future undated Confluence pages.  bun run typecheck; bun test (51 pass, 0 fail).  Next: smoke test `bun run start` against synced data.
2026-07-21  tui-reader-polish  Added safe-width navigator document symbols plus richer markdown, fenced code, and table styling for the reader.  bun run typecheck; bun test (51 pass, 0 fail).  Next: command/keymap registry, browser-open hook, or remaining overlays.
2026-07-21  sync-tree-robustness  Sync now recursively discovers children, keeps failed body-fetch pages visible as placeholders, page-only failures no longer make the CLI exit nonzero, Confluence tables render as markdown tables, code highlighting initializes Tree-sitter, and orphaned local pages appear in the TUI tree.  bun run typecheck; bun test (54 pass, 0 fail).  Next: rerun `bun run start sync --space PTPCUOYKCI`, then reopen the TUI.
2026-07-21  tree-order  Persisted Confluence tree order in SQLite and changed navigator sibling sorting to use synced tree order instead of alphabetical title order.  bun run typecheck; bun test (55 pass, 0 fail).  Next: rerun sync so existing rows get tree_order values.
2026-07-21  multiline-code-paragraphs  Confluence paragraphs containing a single multiline `<code>` node now map to fenced code blocks, preserving Mermaid/ERD newlines instead of flattening them as inline code.  bun run typecheck; bun test (56 pass, 0 fail).  Next: rerun sync so stored body artifacts are regenerated.
2026-07-21  body-repair  Added local `repair` command to rebuild stored body artifacts and page/search projections from existing `source_body`; parser now also merges Mermaid-style adjacent code-only paragraphs while keeping isolated inline-code paragraphs inline.  bun run typecheck; bun test (59 pass, 0 fail); bun run start repair (71 artifacts rebuilt); verified page 1962803383 has a Mermaid fence.  Next: reopen the TUI and inspect the repaired document rendering.
2026-07-21  local-editing  Added schema v4 local page drafts plus CLI draft/edit/stage/unstage/discard/diff/preview commands.  bun run typecheck; bun test (61 pass, 0 fail).  Next: implement remote apply with version/hash conflict checks and Confluence write-back.
2026-07-21  tui-external-editor  TUI `e` action now suspends OpenTUI, opens `$EDITOR` for the selected page, resumes after editor exit, saves changed markdown as a local draft, and shows draft/staged state in the header/status bar.  bun run typecheck; bun test (62 pass, 0 fail).  Next: add TUI stage/discard/diff actions or remote apply with conflict checks.
2026-07-21  tui-in-app-editor  Replaced the TUI `$EDITOR` path with an in-app local Markdown draft editor plus save, stage/unstage, discard, diff, and draft reader preview actions.  bun run typecheck; bun test (64 pass, 0 fail, 273 assertions).  Next: implement remote apply with Markdown-to-Confluence conversion and version/hash conflict checks.
2026-07-21  tui-remote-apply  Added TUI draft review/apply controls, conservative Markdown-to-Confluence storage conversion, Confluence page update API, and apply preflight conflict/block checks.  bun run typecheck; bun test (71 pass, 0 fail, 311 assertions).  Next: add richer preservation for opaque Confluence content before allowing macro-heavy pages to apply.
2026-07-22  tui-staged-changes  Replaced one-page editor review with a normal-view current-space Overview popup; editor buffers are transient until `Ctrl+T` stages, and `Esc` closes without changing staged docs.  bun run typecheck; bun test (72 pass, 0 fail, 323 assertions).  Next: polish keyboard command registry/help and optionally add split diff rendering.
2026-07-22  tui-create-page  Added schema v5 staged page creates, Confluence page create API, apply-create service, `n` navigator new-page popup, and Overview support for staged create/update changes.  bun run typecheck; bun test (77 pass, 0 fail, 348 assertions).  Next: add body editing for staged creates or split diff rendering if needed.
2026-07-22  tui-local-first-create  Staged page creates now appear immediately as virtual local pages in the navigator/reader and can be edited with the same transient editor before Overview apply/discard.  bun run typecheck; bun test (78 pass, 0 fail, 354 assertions).  Next: split diff rendering or command palette/help wiring if needed.
```

## Contract Changes

If a task changes shared models, command names, database schema, or config shape, note it here and update dependent briefs.

```text
YYYY-MM-DD  ID  Contract changed  Impacted tasks
2026-07-21  05  Added local SQLite schema v1 for spaces, pages, links, and page_fts plus repository search/query API.  Impacts future sync, CLI search, and TUI repository integration.
2026-07-21  04  Added canonical document model, mapping sidecar, Confluence client API, and mapper output that derives IndexedPage/PageLink projections from Confluence storage.  Impacts sync, future editable Markdown, and TUI repository integration.
2026-07-21  sync  Added syncConfluence service report contract and made CLI `sync` the explicit Confluence fetch/write path.  Impacts CLI integration, local-first smoke tests, and future TUI repository integration.
2026-07-21  body-artifacts  Migrated local schema to v2 with page_bodies and added PageBodyArtifact repository contract storing raw source, canonical JSON, sidecar JSON, editable Markdown seed, and rendered Markdown.  Impacts future editable Markdown and Confluence write-back.
2026-07-21  cli-local  Added repository stats contract for local health checks and CLI flags for local search/sync scoping.  Impacts help/command registry and future TUI command wiring.
2026-07-21  sync-progress  Added `SyncProgressEvent`, `SyncConfluenceOptions.onProgress`, CLI `sync --quiet`, and optional `ConfluenceClientOptions.requestTimeoutMs`; `FetchLike` now accepts an AbortSignal.  Impacts future TUI sync status wiring and client tests.
2026-07-21  tui-local  Added `IndexRepository.listPagesInSpace` and `TuiDataSource`; default TUI now opens the local index instead of mock data.  Impacts TUI smoke testing and future command wiring.
2026-07-21  tui-date-fix  `ConfluencePage` accepts `updatedAt`/`modifiedAt`, mapper accepts `syncedAt`, and TUI date display returns `unknown` for invalid timestamps.  Impacts sync mapping and TUI header rendering.
2026-07-21  sync-tree-robustness  Added canonical `TableBlock`; sync page counts now include body-failure placeholders, CLI treats page-only failures as non-fatal, and TUI tree rows can represent detached local pages.  Impacts document projection, sync reports, CLI sync semantics, and TUI tree rendering.
2026-07-21  tree-order  Migrated local index schema to v3 with `pages.tree_order`; `IndexedPage.treeOrder` is optional for fixtures but persisted for synced/repository pages.  Impacts repository ordering, sync mapping, and navigator sibling order.
2026-07-21  body-repair  Added `mapConfluenceBody`, `IndexRepository.listPageBodies`, `IndexRepository.deleteLinksFromPage`, `repairBodyArtifacts`, and CLI `repair`.  Impacts local maintenance commands and any future body-artifact migration flow.
2026-07-21  local-editing  Migrated local index schema to v4 with `page_drafts`; added `PageDraft`, draft stats, and CLI commands `edit`, `draft`, `drafts`, `stage`, `unstage`, `discard`, `diff`, and `preview`.  Impacts local maintenance commands, future TUI edit actions, and remote apply/write-back.
2026-07-21  tui-external-editor  Added shared `editing` module, `TuiDataSource.editPageDraft`, `TuiDataSource.getPageDraftStatus`, and optional test hooks for external editor suspend/resume.  Impacts TUI actions and future staged/apply UI.
2026-07-21  tui-in-app-editor  Added direct TUI draft APIs for editable input, save, stage/unstage, discard, and diff; reader projections now prefer local draft Markdown and derive draft snippets.  Impacts future remote apply/write-back and any command palette actions for draft lifecycle.
2026-07-21  tui-remote-apply  Added `ConfluenceClient.updatePage`, `applyPageDraftToConfluence`, conservative `markdownToConfluenceStorage`, and `TuiDataSource.applyPageDraft`; `FetchLike` now supports method, headers, body, and signal.  Impacts future write-back, conflict resolution, and preservation work.
2026-07-22  tui-staged-changes  Added `TuiDataSource.listStagedDraftChanges`, `applyStagedDrafts`, and `discardPageDrafts`; TUI review/apply is now normal-view current-space Overview based instead of active-editor-buffer based.  Impacts future command palette/help and batch write-back UX.
2026-07-22  tui-create-page  Migrated local index schema to v5 with `page_creates`; added `PageCreate`, `ConfluenceClient.createPage`, `applyPageCreateToConfluence`, and `TuiDataSource.stagePageCreate/listStagedChanges/applyStagedChanges/discardStagedChanges`.  Impacts Overview, write-back, and future staged create body editing.
2026-07-22  tui-local-first-create  Added virtual `create:<localId>` page projections plus `TuiDataSource.getEditablePageInput`/`stagePageBuffer` so staged creates share the reader/editor path with synced pages.  Impacts TUI selection, Overview apply/discard, and future command palette/help wiring.
```
