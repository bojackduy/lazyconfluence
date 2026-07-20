import type { IndexedPage, PageLink, ReaderPage, SpaceSummary } from "./model"

export const mockSpaces: SpaceSummary[] = [
  {
    key: "ENG",
    name: "Engineering Handbook",
    lastSyncedAt: "2026-07-21T09:30:00Z",
    pageCount: 12,
    syncState: "fresh",
  },
  {
    key: "OPS",
    name: "Operations Runbooks",
    lastSyncedAt: "2026-07-18T16:10:00Z",
    pageCount: 8,
    syncState: "stale",
  },
]

export const mockPages: IndexedPage[] = [
  {
    pageId: "eng-home",
    spaceKey: "ENG",
    title: "Engineering Home",
    url: "https://example.atlassian.net/wiki/spaces/ENG/pages/100/Engineering+Home",
    parentId: null,
    path: ["Engineering Home"],
    owner: "Platform Team",
    updatedAt: "2026-07-20T14:22:00Z",
    snippet: "Start here for engineering norms, current programs, and frequently used runbooks.",
    contentMarkdown: `# Engineering Home

Welcome to the engineering space. This page is the launchpad for how we build, review, operate, and document software.

## Current Focus

| Area | Status | Owner |
| --- | --- | --- |
| Terminal reader prototype | Active | Developer Experience |
| API sync contract | Waiting | Platform |
| Incident learning loop | Active | Operations |

## Start Here

- Read **Project Architecture** before changing service boundaries.
- Use **Release Checklist** for production releases.
- Keep decisions linked from the pages they affect.

## Reader Stress Cases

This mock page intentionally includes a table, links, nested sections, and code so the terminal reader can be judged before real Confluence data exists.

\`\`\`ts
type PageIntent = "browse" | "read" | "follow-link" | "open-browser"

function chooseNextPage(intent: PageIntent) {
  return intent === "browse" ? "Project Architecture" : "Current page"
}
\`\`\`

## Useful Links

- [Project Architecture](https://example.atlassian.net/wiki/spaces/ENG/pages/101/Project+Architecture)
- [Release Checklist](https://example.atlassian.net/wiki/spaces/ENG/pages/102/Release+Checklist)
- [Atlassian documentation](https://developer.atlassian.com/cloud/confluence/rest/v2/)
`,
  },
  {
    pageId: "architecture",
    spaceKey: "ENG",
    title: "Project Architecture",
    url: "https://example.atlassian.net/wiki/spaces/ENG/pages/101/Project+Architecture",
    parentId: "eng-home",
    path: ["Engineering Home", "Project Architecture"],
    owner: "Architecture Guild",
    updatedAt: "2026-07-19T11:05:00Z",
    snippet: "How lazyconfluence separates UI, local data, sync, and Confluence mapping.",
    contentMarkdown: `# Project Architecture

The application is local-first after explicit sync. The TUI reads local records and never calls Confluence directly.

## Layers

1. CLI handles user intent.
2. TUI renders local state.
3. Repository returns spaces, pages, links, search results, and tree relationships.
4. Sync owns all remote Confluence calls.

## UI Contract

The reader needs a selected page, its siblings or nearby tree nodes, children, related links, and an outline. This mock screen is designed around that future repository contract.

## Non Goals

- No web app.
- No generic provider abstraction in V1.
- No background remote refresh while browsing.
`,
  },
  {
    pageId: "release-checklist",
    spaceKey: "ENG",
    title: "Release Checklist",
    url: "https://example.atlassian.net/wiki/spaces/ENG/pages/102/Release+Checklist",
    parentId: "eng-home",
    path: ["Engineering Home", "Release Checklist"],
    owner: "Release Managers",
    updatedAt: "2026-07-17T18:40:00Z",
    snippet: "A compact checklist for production releases and rollback readiness.",
    contentMarkdown: `# Release Checklist

## Before Release

- Confirm tests are green.
- Confirm owner approval.
- Confirm dashboards and rollback notes are linked.

## During Release

- Announce start.
- Watch errors, latency, and saturation.
- Keep the rollback command visible.

## After Release

- Update the release page.
- Link incidents or follow-ups.
`,
  },
  {
    pageId: "deep-dive",
    spaceKey: "ENG",
    title: "Deep Dive: Reader Edge Cases",
    url: "https://example.atlassian.net/wiki/spaces/ENG/pages/103/Deep+Dive+Reader+Edge+Cases",
    parentId: "architecture",
    path: ["Engineering Home", "Project Architecture", "Deep Dive: Reader Edge Cases"],
    owner: "Developer Experience",
    updatedAt: "2026-07-16T10:00:00Z",
    snippet: "Long page for scroll behavior, outline density, and link-heavy content.",
    contentMarkdown: `# Deep Dive: Reader Edge Cases

## Long Content

This page exists to make sure scrolling, focus, and dense outlines feel right.

### Section A

Readers need clear heading contrast without turning the terminal into a color demo.

### Section B

Dense paragraphs should wrap calmly and preserve terminal selection behavior.

### Section C

Links should be visible, but opening a browser must remain explicit.

### Section D

When the database arrives, this page should come from the same reader contract.

### Section E

The navigator should make the current location obvious even several levels down.
`,
  },
  {
    pageId: "ops-home",
    spaceKey: "OPS",
    title: "Operations Home",
    url: "https://example.atlassian.net/wiki/spaces/OPS/pages/200/Operations+Home",
    parentId: null,
    path: ["Operations Home"],
    owner: "Operations",
    updatedAt: "2026-07-18T09:00:00Z",
    snippet: "Operational entry point with runbooks and incident response pages.",
    contentMarkdown: `# Operations Home

This space is intentionally present in the mocks so the UI can later show stale sync and multi-space switching cases.

## Runbooks

- API outage
- Database saturation
- Rollback production
`,
  },
]

export const mockLinks: PageLink[] = [
  {
    fromPageId: "eng-home",
    targetUrl: "https://example.atlassian.net/wiki/spaces/ENG/pages/101/Project+Architecture",
    targetPageId: "architecture",
    title: "Project Architecture",
    kind: "internal",
  },
  {
    fromPageId: "eng-home",
    targetUrl: "https://example.atlassian.net/wiki/spaces/ENG/pages/102/Release+Checklist",
    targetPageId: "release-checklist",
    title: "Release Checklist",
    kind: "internal",
  },
  {
    fromPageId: "eng-home",
    targetUrl: "https://developer.atlassian.com/cloud/confluence/rest/v2/",
    targetPageId: null,
    title: "Atlassian REST API docs",
    kind: "external",
  },
  {
    fromPageId: "architecture",
    targetUrl: "https://example.atlassian.net/wiki/spaces/ENG/pages/103/Deep+Dive+Reader+Edge+Cases",
    targetPageId: "deep-dive",
    title: "Deep Dive: Reader Edge Cases",
    kind: "internal",
  },
]

export function getPagesForSpace(spaceKey: string) {
  return mockPages.filter((page) => page.spaceKey === spaceKey)
}

export function getReaderPage(pageId: string): ReaderPage {
  const page = mockPages.find((candidate) => candidate.pageId === pageId)

  if (!page) {
    throw new Error(`Unknown mock page: ${pageId}`)
  }

  const children = mockPages.filter((candidate) => candidate.parentId === page.pageId)
  const outgoingLinks = mockLinks.filter((link) => link.fromPageId === page.pageId)
  const backlinks = mockLinks.filter((link) => link.targetPageId === page.pageId)

  return {
    ...page,
    children,
    outgoingLinks,
    backlinks,
    outline: extractOutline(page.contentMarkdown),
  }
}

export function getDefaultPageId(spaceKey = "ENG") {
  return mockPages.find((page) => page.spaceKey === spaceKey && page.parentId === null)?.pageId ?? mockPages[0].pageId
}

export function extractOutline(markdown: string) {
  return markdown
    .split("\n")
    .filter((line) => line.startsWith("##"))
    .map((line) => line.replace(/^#+\s*/, ""))
}
