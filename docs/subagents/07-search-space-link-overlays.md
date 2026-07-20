# 07 Search, Spaces, And Link Overlays

## Mission

Implement intent-specific overlays for page search, all-space search, document find, space switching, commands, help, and link navigation.

## Must Read

- `docs/README.md`
- `docs/BUILD_PLAN.md`
- `docs/OPENTUI_REFERENCE.md`
- `AGENTS.md`

Load the `opentui` skill before editing UI or keymap code.

## Owns

- `src/tui/components/overlays.tsx`
- `src/tui/components/search.tsx`
- `src/tui/components/related.tsx` for link interactions only
- `src/tui/components/outline.tsx` for outline interactions only
- `src/tui/keymap.ts` for overlay bindings only
- `src/tui/state.ts` for overlay state only

## Depends On

- 03 Keymap And Command System
- 05 Local Index And Search
- 06 Reader UI And Document Detail

## Scope

- Implement page search overlay for active space.
- Add all-space search scope toggle.
- Implement space switcher overlay.
- Implement in-document find overlay.
- Implement command/action discovery overlay.
- Implement help overlay.
- Render outgoing links and incoming links as navigable items.
- Distinguish indexed internal pages from external URLs.
- Follow indexed internal links locally.
- Open external links in browser.
- Implement outline jump behavior.
- Wire `/`, `f`, `s`, `p`, `?`, `esc`, `enter`, `n`, and `N`.

## Acceptance Criteria

- Search behavior is split by intent.
- Page search and document find do not conflict.
- Space switching does not permanently crowd the main view.
- Internal links navigate locally when indexed.
- External links open in the browser only through explicit action.
- No remote calls happen from TUI components.
- No files under `lazylens/` are changed.

## Checklist

- [ ] OpenTUI skill loaded.
- [ ] Page search overlay exists.
- [ ] All-space scope exists.
- [ ] Space switcher exists.
- [ ] Document find exists.
- [ ] Command discovery exists.
- [ ] Help overlay exists.
- [ ] Link navigation exists.
- [ ] Outline navigation exists.
- [ ] Verification commands pass.
- [ ] `docs/TASK_TRACKER.md` is updated.

## Subagent Prompt

```text
Implement docs/subagents/07-search-space-link-overlays.md. Load the opentui skill first. Add intent-specific search, find, space switcher, command, help, link, and outline overlays. Keep scopes separate and do not introduce remote calls into UI code.
```
