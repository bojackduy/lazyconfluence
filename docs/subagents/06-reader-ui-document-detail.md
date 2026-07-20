# 06 Reader UI And Document Detail

## Mission

Build the document-first TUI shell and reader screen against fixture or local data.

## Must Read

- `docs/README.md`
- `docs/BUILD_PLAN.md`
- `docs/OPENTUI_REFERENCE.md`
- `AGENTS.md`

Load the `opentui` skill before editing UI code.

## Owns

- `src/tui/app.tsx`
- `src/tui/state.ts`
- `src/tui/theme.ts`
- `src/tui/components/shell.tsx`
- `src/tui/components/navigator.tsx`
- `src/tui/components/document.tsx`
- `src/tui/components/related.tsx`
- `src/tui/components/outline.tsx`
- `src/tui/components/status.tsx`

## Depends On

- 01 Foundation Shell
- 02 Domain And Demo Data

## Scope

- Render the main shell from `docs/README.md`.
- Use fixture data until repository reads are available.
- Track active space, selected page, focus pane, overlay, and history.
- Render navigator tree.
- Render rich document content.
- Render related and outline regions with placeholder data if needed.
- Render status and help hints.
- Implement quit, movement, pane focus, page selection, and browser-open command hooks.
- Add narrow-terminal mode if feasible, or leave a clear layout boundary.

## Acceptance Criteria

- TUI opens, displays fixture or local data, and quits cleanly.
- Main layout matches the product plan closely.
- Document content is rendered as a reader, not as raw logs.
- No remote calls happen from TUI components.
- No files under `lazylens/` are changed.

## Checklist

- [ ] OpenTUI skill loaded.
- [ ] Shell layout exists.
- [ ] Navigator exists.
- [ ] Document reader exists.
- [ ] Related region exists.
- [ ] Outline region exists.
- [ ] Status region exists.
- [ ] Basic state transitions exist.
- [ ] Verification commands pass.
- [ ] `docs/TASK_TRACKER.md` is updated.

## Subagent Prompt

```text
Implement docs/subagents/06-reader-ui-document-detail.md. Load the opentui skill first. Build the document-first TUI shell and local state against fixture data or repository reads. Keep UI local-only and do not call Confluence from components.
```
