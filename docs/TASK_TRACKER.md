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
| 04 | Confluence API mapping | Not started | 01, 02 | `subagents/04-confluence-api-mapping.md` |
| 05 | Local index and search | Done | 01, 02 | `subagents/05-local-index-search.md` |
| 06 | Reader UI and document detail | Partial | 01, 02 | `subagents/06-reader-ui-document-detail.md` |
| 07 | Search, spaces, and link overlays | Partial | 03, 05, 06 | `subagents/07-search-space-link-overlays.md` |
| 08 | Quality and integration | Not started | 04, 05, 06, 07 | `subagents/08-quality-integration.md` |

Status values: `Not started`, `In progress`, `Blocked`, `Partial`, `Done`.

## Current Reality

- Foundation shell is done: Bun, TypeScript, CLI entrypoint, TUI launch, `init`, and local `doctor` exist.
- Domain and demo data are done for the mock-backed product slice.
- Reader UI and document detail are partial: the mock-backed TUI renders the main reader, navigator, outline, related panel, and scroll behavior, but repository-backed reads are not wired.
- Search, spaces, and link overlays are partial: active-space page search and space switcher exist against mock data; document find, all-space search UI, command palette, help, and link navigation overlays remain.
- Local index and search are done for this slice: local SQLite schema, repository upserts, relationship queries, URL matching, and page search are implemented and tested.
- Confluence API mapping is not started.
- Explicit sync service is not started.
- Keymap and command registry are not started.
- Quality and integration are not started.

## Parallel Plan

Round 0:

- [x] Run 01 first.
- [x] Run 02 after 01 creates the package/test base.

Round 1:

- [x] Run 05 after 01 and 02.
- [ ] Run 03 and 04 after 01 and 02.
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
```

## Contract Changes

If a task changes shared models, command names, database schema, or config shape, note it here and update dependent briefs.

```text
YYYY-MM-DD  ID  Contract changed  Impacted tasks
2026-07-21  05  Added local SQLite schema v1 for spaces, pages, links, and page_fts plus repository search/query API.  Impacts future sync, CLI search, and TUI repository integration.
```
