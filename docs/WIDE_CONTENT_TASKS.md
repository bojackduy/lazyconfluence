# Wide Content Tasks

Execution tracker for `WIDE_CONTENT_PLAN.md`. Update checkboxes as work is completed and verified.

## Phase 1: Document Focus Mode

- [x] Register a `toggle-document-focus` command with `z`.
- [x] Add context-aware key routing for the normal reader.
- [x] Add document focus-mode state and remember the previous pane focus.
- [x] Hide navigator, outline, and related panes while focused.
- [x] Preserve document horizontal and vertical scroll offsets by keeping the reader scrollbox mounted.
- [x] Show a focus-mode marker and restore hint.
- [x] Add keymap and layout tests.
- [x] Run typecheck, full tests, build, and diff validation.

## Phase 2: Horizontal Overflow Affordance

- [ ] Detect horizontal document overflow.
- [ ] Show horizontal position and off-screen-content indication.
- [ ] Add width-aware Left/Right footer guidance.
- [ ] Test fitting content, overflowing content, and history restoration.

## Phase 3: Full-Screen Table Viewer

- [ ] Parse rendered Markdown tables into a local viewer model.
- [ ] Add table selection or nearest-table activation.
- [ ] Build a full-screen row/column scrolling overlay.
- [ ] Keep table headers visible during vertical movement.
- [ ] Show visible and total row/column ranges.
- [ ] Restore the source document position on close.
- [ ] Add keymap, parser, and layout tests.

## Phase 4: Stacked-Row Reflow

- [ ] Add an opt-in grid/record view toggle.
- [ ] Map table headers to labeled fields per row.
- [ ] Handle empty, duplicate, and multiline headers.
- [ ] Preserve selected row across grid and record views.
- [ ] Add parser and narrow-layout tests.
