# lazyconfluence Planning Docs

This directory is the current source of truth for the product and build plan.

Root-level notes may contain stale implementation direction. Start here unless the user explicitly says otherwise.

## Product Goal

Build a terminal-first Confluence document browser that feels fast, readable, and keyboard-native.

The app should feel like a focused Confluence reader, not a generic search tool. The user should choose a space, browse the page tree, read a richly rendered document, follow related pages, and open the canonical page in the browser when needed.

## Core Experience

The main experience is centered on one active Confluence space.

Within that space, the user can:

- Browse the space tree.
- Search pages in that space.
- Read a selected page in a rich terminal document view.
- See metadata such as space, parent path, owner, and updated time.
- See child pages, outgoing links, and backlinks.
- Follow internal links when the target page is indexed.
- Open the selected page in the browser.
- Move backward through navigation history.

Multiple spaces are supported, but they should not permanently crowd the main reading view. Space browsing should happen through a fast overlay or all-spaces overview.

## Main Screen Shape

```text
+-- ACTIVE SPACE / Parent / Current Page -------------------------------------+
| Page title                                                    sync status     |
| Space name . parent path . owner . updated time                               |
+-----------------------------+------------------------------------------------+
| NAVIGATOR                   | DOCUMENT                                       |
|                             |                                                |
| > Space Home                | # Current Page                                 |
|   Recently updated          |                                                |
|   Pinned / useful pages     | Rich page content appears here.                |
|                             |                                                |
|   Section                   | Headings, lists, tables, links, and code       |
|     Current Page            | should be readable and pleasant.               |
|     Child Page              |                                                |
|     Runbooks                | ## Section                                     |
|                             |                                                |
|                             | - Important note                               |
|                             | - Related decision                             |
+-----------------------------+--------------------------+---------------------+
| RELATED                                                | OUTLINE             |
| -> Outgoing page                                       | > Context           |
| <- Backlink page                                       |   Decision          |
| -> External link                                       |   Rollout           |
+--------------------------------------------------------+---------------------+
| / page search | f find in doc | s space | p actions | h back | l follow | q |
+------------------------------------------------------------------------------+
```

The navigator and document are the primary panes. Related links and outline support reading and movement without taking over the screen.

## Narrow Screen Shape

On small terminals, switch to a mode-based layout instead of squeezing every pane at once.

```text
+-- Current Page -------------------------------------------------------------+
| Space / Parent path                                                          |
+------------------------------------------------------------------------------+
| # Current Page                                                               |
|                                                                              |
| Rich document content...                                                     |
|                                                                              |
+------------------------------------------------------------------------------+
| doc | nav | links | outline | search                                         |
+------------------------------------------------------------------------------+
```

## Search Lenses

Search is intent-specific. Do not rely on one global search bar for everything.

Planned lenses:

- Page search in the active space.
- Page search across all configured spaces.
- Find text inside the current document.
- Action or command discovery.
- Space switcher search.

## Space Switcher Shape

```text
+-- Switch Space -------------------------------------------------------------+
| Search spaces: arch_                                                         |
|                                                                              |
| > ARCH   Architecture              recently updated                          |
|   PLAT   Platform                  recently updated                          |
|   ENG    Engineering               recently updated                          |
|   OPS    Operations                recently updated                          |
+------------------------------------------------------------------------------+
| enter switch | / filter | esc close                                          |
+------------------------------------------------------------------------------+
```

## Keyboard Intent

Use lazy-family keyboard muscle memory only where it serves document browsing.

- `q` quits.
- `?` opens help.
- `/` searches pages in the active space.
- `f` finds text in the current document.
- `s` opens the space switcher.
- `p` opens action or command discovery.
- `enter` opens or activates the selected thing.
- `o` opens the selected page in the browser.
- `r` syncs or refreshes content.
- `h` goes back or moves left.
- `j` moves down.
- `k` moves up.
- `l` drills into or follows the selected thing.
- `b` goes back in navigation history.
- `tab` moves to the next pane or mode.
- `esc` exits overlays, find, or search.

## First Useful Milestone

The first useful product milestone should let a user:

- Set up access to selected spaces.
- Sync content explicitly.
- Choose an active space.
- Browse that space's tree.
- Search pages in that space.
- Read selected pages locally in the terminal.
- Open selected pages in the browser.
- Follow indexed internal links.
- Return using history.

## Doc Map

- `BUILD_PLAN.md` explains the implementation architecture and integration order.
- `HANDOFF.md` summarizes the current implementation state and next execution order.
- `OPENTUI_REFERENCE.md` explains how future agents should use the `opentui` skill and OpenCode reference material.
- `TASK_TRACKER.md` tracks task state and integration order.
- `subagents/*.md` are copy-pasteable task briefs for parallel agents.

## Read-Only References

- `lazylens/` is read-only reference material for Confluence behavior and local indexing.
- `~/Code/opencode` is read-only reference material for a polished OpenTUI application.

Never edit either reference while working on this project.
