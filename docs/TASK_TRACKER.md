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
| 01 | Foundation shell | Not started | None | `subagents/01-foundation-shell.md` |
| 02 | Domain and demo data | Not started | 01 | `subagents/02-domain-demo-data.md` |
| 03 | Keymap and command system | Not started | 01, 02 | `subagents/03-keymap-command-system.md` |
| 04 | Confluence API mapping | Not started | 01, 02 | `subagents/04-confluence-api-mapping.md` |
| 05 | Local index and search | Not started | 01, 02 | `subagents/05-local-index-search.md` |
| 06 | Reader UI and document detail | Not started | 01, 02 | `subagents/06-reader-ui-document-detail.md` |
| 07 | Search, spaces, and link overlays | Not started | 03, 05, 06 | `subagents/07-search-space-link-overlays.md` |
| 08 | Quality and integration | Not started | 04, 05, 06, 07 | `subagents/08-quality-integration.md` |

Status values: `Not started`, `In progress`, `Blocked`, `Done`.

## Parallel Plan

Round 0:

- [ ] Run 01 first.
- [ ] Run 02 after 01 creates the package/test base.

Round 1:

- [ ] Run 03, 04, 05, and 06 in parallel after 01 and 02.

Round 2:

- [ ] Run 07 after 03, 05, and 06.

Round 3:

- [ ] Run 08 after 04, 05, 06, and 07.

## Completion Log

Add dated notes here as tasks complete.

```text
YYYY-MM-DD  ID  Result  Verification  Follow-up
```

## Contract Changes

If a task changes shared models, command names, database schema, or config shape, note it here and update dependent briefs.

```text
YYYY-MM-DD  ID  Contract changed  Impacted tasks
```
