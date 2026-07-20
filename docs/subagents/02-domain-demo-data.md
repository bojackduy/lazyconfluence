# 02 Domain And Demo Data

## Mission

Create shared domain contracts and sanitized fixture data so other agents can work in parallel.

## Must Read

- `docs/README.md`
- `docs/BUILD_PLAN.md`
- `AGENTS.md`

## Owns

- `src/model.ts`
- `test/fixtures/*`
- `test/helpers/*` for basic fixture helpers only

## Depends On

- 01 Foundation Shell

## Scope

- Define `SpaceSummary`.
- Define `IndexedPage`.
- Define `PageLink`.
- Define `SearchResult`.
- Define view state, focus pane, and overlay types.
- Add fake spaces.
- Add fake page records.
- Add fake links and backlinks.
- Add representative Confluence API payload fixtures.
- Add representative Confluence storage HTML fixtures.
- Add helper functions for temp config and temp database paths if the test framework exists.

## Acceptance Criteria

- Models compile without importing UI, database, or Confluence modules.
- Fixtures contain no secrets or real company content.
- API, storage, index, sync, and UI tasks can reuse the fixtures.
- No files under `lazylens/` are changed.

## Checklist

- [ ] Shared model contracts exist.
- [ ] Demo spaces exist.
- [ ] Demo pages exist.
- [ ] Demo links exist.
- [ ] Confluence JSON fixtures exist.
- [ ] Storage HTML fixtures exist.
- [ ] Test helpers exist where useful.
- [ ] Verification commands pass.
- [ ] `docs/TASK_TRACKER.md` is updated.

## Subagent Prompt

```text
Implement docs/subagents/02-domain-demo-data.md. Create shared model contracts and sanitized fixtures only. Do not implement storage, UI, sync, or Confluence behavior. Never edit lazylens/.
```
