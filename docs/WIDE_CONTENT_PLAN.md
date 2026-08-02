# Wide Content Plan

This document is the source of truth for making wide Confluence content readable in the terminal. Implement the phases in order and track execution in `WIDE_CONTENT_TASKS.md`.

## Problem

Wide Markdown tables and other long document blocks can exceed the document viewport. The current reader supports horizontal scrolling, but the navigator and side rail consume useful width and the overflow controls are not discoverable. Even a document-only layout cannot fit every comparison table, so pane hiding is only the first layer of the solution.

## Product Principles

- Preserve table comparison semantics before reflowing content.
- Keep normal document browsing calm; wide-content controls appear only when useful.
- Do not mutate synced Markdown merely to fit the terminal.
- Preserve the selected page, document scroll offsets, pane state, and navigation history when entering or leaving transient reading modes.
- Keep normal browsing local-first.

## Phase 1: Document Focus Mode

Add a `z` command that toggles a document-only reading layout.

- Hide the navigator, outline, and related panes.
- Keep the page header, document pane, status, and compact footer.
- Move focus to the document when focus mode opens.
- Restore the previously focused pane when focus mode closes, when that pane is valid.
- Preserve vertical and horizontal document scroll offsets.
- Show a visible `FOCUS` marker and `z restore panes` hint.
- Keep existing Left/Right horizontal scrolling and Up/Down vertical scrolling.
- Preserve intrinsic table column widths so widening the reader reveals additional columns instead of rescaling the same columns.
- Report intrinsic table width to the document scrollbox so Left/Right movement is not clamped at zero.
- Make the command available through Help and the Command Palette.

Acceptance criteria:

- `z` opens and closes focus mode from the normal reader.
- The supporting panes disappear without recreating or resetting the document reader.
- Wide tables expose more columns in focus mode and retain horizontal overflow when they still do not fit.
- Closing focus mode restores the prior pane focus and scroll position.
- Narrow-terminal behavior remains usable.

## Phase 2: Horizontal Overflow Affordance

Make wide content discoverable without requiring prior shortcut knowledge.

- Detect whether the document content exceeds the viewport horizontally.
- Show a horizontal overflow indicator and current horizontal position.
- Add a width-aware footer hint for Left/Right scrolling.
- Keep the indicator out of the way when no horizontal overflow exists.
- Ensure navigation history continues to save and restore horizontal offsets.

Acceptance criteria:

- A wide table visibly signals that more columns exist off-screen.
- The signal disappears for content that fits.
- Left/Right movement and restored history positions are covered by tests.

## Phase 3: Full-Screen Table Viewer

Add an explicit viewer for reading one table independently from the surrounding document.

- Open the selected or nearest table in a full-screen overlay.
- Keep the header row visible while rows scroll vertically.
- Use Left/Right for columns and Up/Down for rows.
- Display the visible column range, for example `columns 1-4 of 8`.
- Return to the same document position on close.
- Preserve Markdown table content exactly; do not refetch Confluence.

Acceptance criteria:

- Wide tables can be navigated by row and column on narrow terminals.
- Closing the viewer returns to the originating table.
- Esc and Help behavior match other overlays.

## Phase 4: Stacked-Row Reflow

Add an opt-in record view for tables that remain difficult to read horizontally.

- Reflow each data row into labeled fields using the table header.
- Keep this mode opt-in because it weakens cross-row comparison.
- Support moving between records without rebuilding the original Markdown.
- Clearly identify the current record and total record count.

Acceptance criteria:

- Every table cell is readable at narrow widths.
- Empty, duplicate, and multiline headers have deterministic labels.
- Returning to grid view preserves the selected row.

## Non-Goals

- Automatically rewriting stored Confluence tables.
- Fetching remote content while browsing.
- Shrinking text below terminal cell size.
- Making every table fit simultaneously without scrolling or reflow.
