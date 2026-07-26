# Next Steps

This is the current execution checklist for `lazyconfluence`. Use it with `docs/TASK_TRACKER.md`; this document answers what to build next, while the tracker records completed work.

Last updated: 2026-07-26

## Current State

- [x] Local-first Confluence index, explicit sync, and local CLI commands.
- [x] Document reader, navigator, Current/Archived views, local drafts, staged create/update/delete, and Overview review/apply flow.
- [x] Active-space page search and space switcher.
- [x] Command registry, context-aware keymap, and scrollable Help overlay.
- [x] Cached PNG inline previews and native image viewer support for Kitty, Ghostty, WezTerm, and configured tmux passthrough.
- [ ] Document find, command palette, all-space search UI, browser open, navigation history, and navigable related links.
- [ ] End-to-end quality and documentation reconciliation.

## Next Recommended Slice

### 1. Document Find (`f`) - Complete

Why first: it is the highest-value missing reader interaction, already has a registered unavailable command, and does not require remote access or data-model changes.

- [x] Add a document-find overlay separate from page search.
- [x] Match against the current rendered Markdown only.
- [x] Support text input, `Enter` or Ctrl+N for next match, `Shift+Enter` or Ctrl+P for previous match, and `Esc` to close. Keep printable `n`/`N` available for search text.
- [x] Scroll the document to the selected match.
- [x] Show match count and current match position.
- [x] Keep the active-space page-search query and selection unchanged.
- [x] Mark `open-document-find` available in `src/tui/commands.ts`.

Acceptance criteria:

- [x] `f` opens find from the reader or navigator.
- [x] Empty and no-match states are clear.
- [x] Find does not call Confluence or mutate local data.
- [x] Tests cover routing, match selection, wraparound, and overlay rendering.

Verification:

```sh
bun run typecheck
bun test test/tui-keymap.test.ts test/tui-layout.test.tsx
bun test
git diff --check
```

## Follow-Up Slices

Work in this order unless product priorities change. Complete one slice and update this file plus `docs/TASK_TRACKER.md` before starting the next.

### 2. Command Palette (`p`) - Complete

- [x] Reuse `src/tui/commands.ts`; do not create a second command list.
- [x] Filter command label, key, and description.
- [x] Run available commands through a single app action dispatcher.
- [x] Show unavailable commands with their reason, but do not run them.
- [x] Preserve text-input behavior and `Esc` close behavior.

### 3. Browser Open and Navigation History (`o`, `b`) - Complete

- [x] Add an explicit browser-open service/hook that opens only the selected canonical page URL.
- [x] Keep browser opening out of rendering components and never use it automatically.
- [x] Record local page navigation history for Page Search and Space Switcher selection. Future link following will use the same navigation helper.
- [x] Implement `b` to restore page, space, view mode, navigator expansion, and document scroll offsets.
- [x] Mark `open-browser` available after tests pass.
- [x] Mark `go-back` available after tests pass.

### 4. Related Links and Outline Navigation (`l`, `Enter`)

- [ ] Make child pages, outgoing links, backlinks, and outline entries selectable.
- [ ] Follow indexed internal targets locally.
- [ ] Route external URLs to the explicit browser-open action.
- [ ] Jump outline entries to their document location.
- [ ] Preserve document-first layout and avoid remote calls.

### 5. All-Space Page Search

- [ ] Add a separate all-space search lens; do not overload active-space `/`.
- [ ] Search local SQLite only, including result space and path.
- [ ] Selecting a result switches active space and opens its page locally.
- [ ] Keep Current/Archived scope explicit.

### 6. Media and Image Polish

- [ ] Add JPEG decoding.
- [ ] Define an SVG strategy: render safely or show a useful placeholder.
- [ ] Add media-cache failure diagnostics and an optional cache-maintenance command.
- [ ] Keep Sixel a fallback/debug path; do not regress Kitty/Ghostty/WezTerm defaults.
- [ ] Perform real-terminal smoke checks only when changing native protocols.

### 7. Quality and Integration Pass

- [ ] Add an end-to-end local-first smoke test using mocked network and a temporary SQLite index.
- [ ] Reconcile stale `docs/HANDOFF.md` with current implementation or replace it with a pointer here.
- [ ] Review `src/tui/app.tsx` for only concrete, low-risk component extraction boundaries.
- [ ] Confirm package scripts: typecheck, test, lint, build.
- [ ] Confirm no credentials, generated artifacts, or `lazylens/` changes are included.

## Working Rules

- Normal TUI browsing is local-only. Only explicit CLI sync may call Confluence.
- Load the `opentui` skill before TUI, keyboard, renderer, scrollbox, or UI-test changes.
- Keep `lazylens/` read-only.
- Do not mark a checkbox complete until its verification has passed.
- Record completed slices in `docs/TASK_TRACKER.md` with the actual commands and test totals.

## Handoff Log

Append one line after each completed slice:

```text
YYYY-MM-DD  Slice  Result  Verification  Next
2026-07-26  Keymap + Help  Command registry, context-aware routing, and Help scrolling implemented.  bun run typecheck; bun test (140 pass, 0 fail, 676 assertions); git diff --check.  Document find.
2026-07-26  Document Find  Local Markdown find overlay with case-insensitive matches, wraparound selection, and document scrolling implemented.  bun run typecheck; bun test (143 pass, 0 fail, 690 assertions); git diff --check.  Command palette.
2026-07-26  Search input polish  Replaced fake search-field text and underscore cursors with focused native OpenTUI inputs for page search, document find, and space switching. Placeholders use muted text and the renderer owns the blinking cursor.  bun run typecheck; bun test test/tui-keymap.test.ts test/tui-layout.test.tsx (46 pass, 0 fail, 278 assertions).  Command palette.
2026-07-26  Search opener focus  Deferred native search-input focus by one tick so `/` and `f` open their overlays without leaking into the query.  bun run typecheck; bun test (143 pass, 0 fail, 690 assertions); git diff --check.  Command palette.
2026-07-26  Command Palette  Added `p` command discovery using the shared registry, native input filtering, available-action dispatch, and unavailable-command reasons.  bun run typecheck; bun test (145 pass, 0 fail, 700 assertions); git diff --check.  Browser open and navigation history.
2026-07-26  Command Palette scroll  Palette selection now calls `scrollChildIntoView` so arrow/Ctrl navigation keeps the active command visible.  bun run typecheck; bun test test/tui-keymap.test.ts test/tui-layout.test.tsx (48 pass, 0 fail, 288 assertions); git diff --check.  Browser open and navigation history.
2026-07-26  Browser open  Added cross-platform explicit browser opening for canonical `http`/`https` page URLs: macOS `open`, Linux `xdg-open`, and Windows `cmd.exe start`. `o` and the Command Palette use the same injected launcher.  bun run typecheck; bun test (149 pass, 0 fail, 709 assertions); git diff --check.  Navigation history.
2026-07-26  Navigation history  Added a bounded in-memory history for Page Search and Space Switcher navigation. `b` restores page, space, view, navigator expansion, and document offsets; missing historic pages safely fall back.  bun run typecheck; bun test (151 pass, 0 fail, 713 assertions); git diff --check.  Related-link navigation.
```
