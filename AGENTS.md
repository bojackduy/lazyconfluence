# AGENTS.md

Guidance for agents working in this repository.

## Current Catch-Up Path

Read these files first, in order:

1. `docs/README.md` for the product and UX direction.
2. `docs/BUILD_PLAN.md` for the current implementation direction.
3. `docs/OPENTUI_REFERENCE.md` before any terminal UI work.
4. `docs/TASK_TRACKER.md` for current task status.
5. The relevant `docs/subagents/*.md` task brief.

This repository is still early. Older notes may contain stale implementation direction. Prefer the files above unless the user explicitly says otherwise.

## Project Purpose

`lazyconfluence` is a terminal-first Confluence document browser.

The product should help a user quickly answer:

- Where is this Confluence page?
- Which space and parent page owns it?
- Is this page worth opening?
- What does the page say without leaving the terminal?
- What child pages, outgoing links, and backlinks relate to it?
- How do I jump between spaces without losing keyboard flow?

## Working Area

All product work belongs in the repository root.

Do not put new product code, generated files, experiments, or formatted output inside submodules.

## Read-Only Submodule

`lazylens/` is a git submodule and is read-only reference material.

Never edit anything under `lazylens/`.

Do not:

- Patch, format, delete, rename, or generate files inside `lazylens/`.
- Run commands that may rewrite files inside `lazylens/`.
- Commit changes inside the submodule.
- Update the submodule pointer unless the user explicitly asks for that.
- Treat the reference project as product code for this repository.

If a task seems to require changing `lazylens/`, stop and ask the user. The intended workflow is to read it, learn from it, and build equivalent product behavior outside the submodule.

## Product Rules

- Keep normal browsing local-first after content has been synced.
- Remote refresh should happen only when the user explicitly asks for sync or refresh.
- Optimize for reading Confluence documents beautifully in the terminal, not just listing search results.
- Start with one active Confluence space at a time.
- Support multiple configured spaces through a fast space switcher or all-spaces overview.
- Keep lazy-family keyboard muscle memory, but do not clone another app's layout exactly.
- Make search intent-specific: page search, all-space search, in-document find, and command/action discovery are separate workflows.
- Keep secrets out of repository files and user-visible config examples.
- Do not add unrelated product areas such as issue tracking, generic provider support, or a web app unless the user explicitly changes the scope.

## OpenTUI Guidance

When working on terminal UI code, load and follow the `opentui` skill before editing.

Use that skill's docs for renderer setup, Solid bindings, layout, keyboard handling, keymap layers, markdown rendering, scrollboxes, lifecycle cleanup, and UI testing. Do not guess OpenTUI APIs from memory.

## Future-Agent Expectations

- Preserve the user-approved product direction in `docs/README.md`.
- Make surgical changes that directly support the current requested phase.
- Avoid speculative abstractions and broad refactors.
- Ask when product intent is unclear instead of silently choosing.
- Keep `lazylens/` clean and unchanged.
