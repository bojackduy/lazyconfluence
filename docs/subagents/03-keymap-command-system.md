# 03 Keymap And Command System

## Mission

Create the app command registry and keyboard behavior foundation.

## Must Read

- `docs/README.md`
- `docs/BUILD_PLAN.md`
- `docs/OPENTUI_REFERENCE.md`
- `AGENTS.md`

Load the `opentui` skill before editing keymap or UI code.

## Owns

- `src/tui/keymap.ts`
- `src/tui/commands.ts`
- `src/tui/state.ts` for command-facing state transitions only
- `test/tui-keymap.test.ts` if practical

## Depends On

- 01 Foundation Shell
- 02 Domain And Demo Data

## Scope

- Define command names for navigation, search, find, space switcher, open, sync, help, and quit.
- Register lazy-family keys.
- Keep command definitions discoverable for a command palette.
- Add mode or overlay-aware behavior so search/find inputs do not conflict with global keys.
- Add aliases for arrows where appropriate.
- Keep bindings data-driven where possible.

## Acceptance Criteria

- `q`, `?`, `/`, `f`, `s`, `p`, `enter`, `o`, `r`, `h`, `j`, `k`, `l`, `b`, `tab`, and `esc` have explicit command intent.
- Key behavior can be queried or rendered by help/command discovery later.
- Keymap code does not directly fetch Confluence data.
- No files under `lazylens/` are changed.

## Checklist

- [ ] OpenTUI skill loaded.
- [ ] Command registry exists.
- [ ] Keymap registration exists.
- [ ] Overlay-aware behavior exists or has a clear integration boundary.
- [ ] Tests or documented manual checks exist.
- [ ] Verification commands pass.
- [ ] `docs/TASK_TRACKER.md` is updated.

## Subagent Prompt

```text
Implement docs/subagents/03-keymap-command-system.md. Load the opentui skill first. Build command and keymap infrastructure for lazy-family navigation, overlays, and discoverable commands. Do not implement full UI screens or remote calls.
```
