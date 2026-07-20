# 01 Foundation Shell

## Mission

Create the smallest runnable app foundation.

## Must Read

- `docs/README.md`
- `docs/BUILD_PLAN.md`
- `docs/OPENTUI_REFERENCE.md`
- `AGENTS.md`

Load the `opentui` skill before writing the placeholder TUI.

## Owns

- `package.json`
- `bunfig.toml`
- `tsconfig.json`
- `src/main.tsx`
- `src/cli.ts`
- `src/errors.ts`
- `src/tui/app.tsx` for placeholder shell only

## Depends On

None.

## Scope

- Create package metadata and scripts.
- Add TypeScript and TSX setup.
- Add OpenTUI Solid preload config if needed.
- Implement command parsing for `init`, `doctor`, `sync`, `search`, and default TUI.
- Implement placeholder handlers with clear messages.
- Add a placeholder TUI screen that can quit.
- Add `typecheck`, `test`, and `lint` scripts or document why one is deferred.

## Acceptance Criteria

- `bun install` completes.
- `bun run typecheck` completes.
- `bun test` completes.
- Running the default command opens a placeholder terminal UI and exits cleanly.
- No files under `lazylens/` are changed.

## Checklist

- [ ] Package setup exists.
- [ ] TypeScript config exists.
- [ ] CLI stubs exist.
- [ ] Placeholder TUI exists.
- [ ] Verification commands pass.
- [ ] `docs/TASK_TRACKER.md` is updated.

## Subagent Prompt

```text
Implement docs/subagents/01-foundation-shell.md. Work only in the root project, never in lazylens/. Load the opentui skill before writing TUI code. Create the minimal Bun/TypeScript/OpenTUI skeleton with command stubs and a placeholder TUI. Keep the change small and verify typecheck/test.
```
