# Product Plan

This document captures the current product path for `lazyconfluence` without choosing implementation details.

## Product Goal

Build a terminal-first Confluence document browser that feels fast, readable, and keyboard-native.

The app should not feel like a generic search tool. It should feel like a focused Confluence reader: choose a space, browse the page tree, read a document with rich formatting, follow related pages, and open the canonical page in the browser when needed.

## Core Experience

The main experience is centered on one active Confluence space.

Within that active space, the user can:

- Browse the space tree.
- Search pages in that space.
- Read a selected page in a rich terminal document view.
- See page metadata such as space, parent path, owner, and updated time.
- See child pages, outgoing links, and backlinks.
- Follow internal links when the target page is indexed.
- Open the selected page in the browser.
- Move backward through navigation history.

Multiple spaces are supported, but they should not permanently crowd the main reading view. Space browsing should happen through a fast overlay or overview.

## Main Screen Shape

The main screen should be document-first.

```text
+-- ACTIVE SPACE / Parent / Current Page -------------------------------------+
| Page title                                                    sync status     |
| Space name · parent path · owner · updated time                               |
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

On small terminals, the app should switch to a mode-based layout instead of squeezing every pane at once.

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

The user should be able to switch between document, navigator, links, outline, and search modes.

## Space Browsing

The app is one-space-first, but it must make switching spaces fast.

Space switcher shape:

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

There should also be an all-spaces overview for users who do not remember which space owns a page.

## Search Lenses

Search should be intent-specific. One global search bar is not enough.

The planned lenses are:

- Page search in the active space.
- Page search across all configured spaces.
- Find text inside the current document.
- Action or command discovery.
- Space switcher search.

Page search in active space:

```text
+-- Search Pages In Active Space --------------------------------------------+
| Query: auth token_                                             scope: space   |
+------------------------------------------------------------------------------+
| > Auth Model                         Platform / Auth                         |
|   Token Rotation Runbook             Platform / Runbooks                     |
|   API Decision                       Platform                                |
|   Troubleshooting                    Operations                              |
+------------------------------------------------------------------------------+
| enter open | tab change scope | esc close                                    |
+------------------------------------------------------------------------------+
```

Find inside current document:

```text
+-- Find In Document ---------------------------------------------------------+
| token_                                                     7 matches          |
| n next | N previous | esc close                                              |
+------------------------------------------------------------------------------+
```

## Keyboard Intent

Use lazy-family keyboard muscle memory, but only where it serves document browsing.

Important shortcuts:

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

The first useful product milestone is not feature-complete. It should let a user:

- Set up access to selected spaces.
- Sync content explicitly.
- Choose an active space.
- Browse that space's tree.
- Search pages in that space.
- Read selected pages locally in the terminal.
- Open selected pages in the browser.
- Follow indexed internal links.
- Return using history.

That is enough to validate the core product.

## Product Constraints

- Normal navigation must not require live remote calls.
- Sync and refresh must be explicit user actions.
- The reader should prioritize useful rendered content over raw source details.
- Store enough local content to make document reading useful.
- Do not store secrets in project files or plain user config examples.
- Do not expand into unrelated collaboration products before the Confluence reader is good.
- Keep the interface calm by default and put power features in overlays.

## Open Questions

- How much page content should be stored locally by default?
- Should pinned or favorite pages be local-only, synced from Confluence metadata, or both?
- What is the default first screen after sync: last page, active space home, or recent pages?
- Should all-space search be a separate shortcut or a scope toggle inside page search?
