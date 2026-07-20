# OpenTUI Reference

This project uses OpenTUI for the terminal UI direction.

Future agents must load the `opentui` skill before changing terminal UI, keymap, renderer, markdown rendering, scrollbox, or UI test code.

## Required Skill Usage

Before editing UI files, use the `opentui` skill and consult the relevant docs.

Relevant skill docs by area:

- Getting started: `docs/getting-started.mdx`.
- Renderer and lifecycle: `docs/core-concepts/renderer.mdx`, `docs/core-concepts/lifecycle.mdx`.
- Solid bindings: `docs/bindings/solid.mdx`.
- Layout: `docs/core-concepts/layout.mdx`.
- Keyboard and input: `docs/core-concepts/keyboard.mdx`.
- Keymap layers and commands: `docs/keymap/overview.mdx`.
- Rich document display: `docs/components/markdown.mdx`.
- Scrollable content: `docs/components/scrollbox.mdx`.
- Text styling and selection: `docs/components/text.mdx`.
- UI testing: `docs/core-concepts/testing.mdx`.

Do not guess OpenTUI APIs from memory.

## OpenCode Reference

`~/Code/opencode` is a read-only UI reference.

Useful patterns to study:

- Renderer setup and cleanup.
- Solid-style component composition.
- Theme token shape.
- Keymap registration, mode layers, and command discovery.
- Scrollable rich text surfaces.
- Markdown rendering with code blocks and tables.
- Dialog and overlay behavior.
- Terminal selection and browser-open behavior.

Avoid copying:

- Plugin runtime.
- AI-session architecture.
- Large global context stack.
- OpenCode-specific commands.
- Broad application framework that this project does not need.

The goal is a smaller document-focused TUI, not an OpenCode clone.

## UI Files Covered By This Requirement

Any task editing these files or directories must load the `opentui` skill first:

```text
src/main.tsx
src/tui/
src/tui/app.tsx
src/tui/keymap.ts
src/tui/commands.ts
src/tui/theme.ts
src/tui/components/
```

## Desired UI Characteristics

- Document-first layout.
- Calm default screen with power features in overlays.
- Rich markdown reading with readable headings, tables, links, and code blocks.
- Intent-specific search and find modes.
- Lazy-family keyboard muscle memory.
- Predictable escape and focus behavior.
- Usable narrow-terminal mode.
- Copy/select behavior should not fight the terminal.

## Review Checklist For UI Changes

- [ ] The `opentui` skill was loaded before coding.
- [ ] The UI reads local data only.
- [ ] The UI does not call Confluence directly.
- [ ] The keymap has clear command names.
- [ ] `esc` closes overlays or exits transient modes predictably.
- [ ] The layout is usable in a narrow terminal.
- [ ] Markdown content is rendered as a reader, not plain logs.
- [ ] Any browser-open behavior is explicit.
