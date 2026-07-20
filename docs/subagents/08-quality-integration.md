# 08 Quality And Integration

## Mission

Wire the core systems into the first useful local-first milestone and tighten verification.

## Must Read

- `docs/README.md`
- `docs/BUILD_PLAN.md`
- `docs/OPENTUI_REFERENCE.md`
- `docs/TASK_TRACKER.md`
- `AGENTS.md`

Load the `opentui` skill before editing UI code.

## Owns

- `src/sync.ts`
- `src/cli.ts` for integration only
- `test/sync.test.ts`
- `test/integration.test.ts` if practical
- `README.md` only after user approval to reconcile stale root docs
- `docs/*` for tracker and handoff updates

## Depends On

- 04 Confluence API Mapping
- 05 Local Index And Search
- 06 Reader UI And Document Detail
- 07 Search, Spaces, And Link Overlays

## Scope

- Load config and token from env.
- Resolve configured spaces.
- Fetch page lists.
- Fetch bodies for changed pages.
- Fetch direct children for hierarchy.
- Convert content and links.
- Upsert pages and links into the local repository.
- Skip pruning if scan is incomplete.
- Print concise sync report.
- Connect CLI commands to real services.
- Connect TUI to repository reads.
- Add integration tests with mocked network and temp local data.
- Update docs and tracker.

## Acceptance Criteria

- `init`, `doctor`, `sync`, `search`, and default TUI form a coherent local-first flow.
- `sync` writes local data only when explicitly called.
- Incomplete scans do not delete existing pages.
- TUI normal browsing makes no live Confluence calls.
- Verification commands pass.
- No files under `lazylens/` are changed.

## Checklist

- [ ] Sync service exists.
- [ ] CLI commands use real services.
- [ ] TUI reads repository data.
- [ ] Search command queries local data.
- [ ] Mocked sync tests exist.
- [ ] Integration tests exist where practical.
- [ ] Stale docs are reconciled after user approval.
- [ ] Verification commands pass.
- [ ] `docs/TASK_TRACKER.md` is updated.

## Subagent Prompt

```text
Implement docs/subagents/08-quality-integration.md. Wire sync, CLI, local repository, and TUI into the first useful local-first milestone. Keep remote calls explicit, tests mocked, and lazylens/ untouched. Load the opentui skill before any UI edits.
```
