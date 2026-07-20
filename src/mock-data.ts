import type { IndexedPage, PageLink, ReaderPage, SearchResult, SpaceSearchResult, SpaceSummary } from "./model"

const readerScrollStressSections = Array.from({ length: 12 }, (_, index) => {
  const section = String(index + 1).padStart(2, "0")

  return `## Scroll Trial ${section}

This section is mock Confluence content for testing reader flow, vertical scrolling, heading density, and how long paragraphs wrap in the terminal. It should feel like realistic internal documentation rather than filler text.

### Decision Context ${section}

The reader should keep the current page comfortable even when a document mixes short notes, dense explanations, tables, and action-oriented lists. The goal is to judge spacing, contrast, and scroll behavior before the data comes from SQLite.

- The current heading should be easy to find in the outline.
- Dense body copy should not visually crash into the side rail.
- Lists should remain readable after several screens of content.
- Related links should stay secondary to the document itself.

### Operational Notes ${section}

| Case | What to check | Expected feel |
| --- | --- | --- |
| Long paragraph | Wrapping and line spacing | Calm |
| Repeated headings | Outline density | Useful |
| Mixed list/table content | Visual rhythm | Scannable |

When the repository layer arrives, this same page shape should be possible with real Confluence records. The UI should not need to know whether the source was mock data, a fixture, or a local database row.
`
}).join("\n")

export const mockSpaces: SpaceSummary[] = [
  {
    key: "ENG",
    name: "Engineering Handbook",
    lastSyncedAt: "2026-07-21T09:30:00Z",
    pageCount: 4,
    syncState: "fresh",
  },
  {
    key: "OPS",
    name: "Operations Runbooks",
    lastSyncedAt: "2026-07-18T16:10:00Z",
    pageCount: 4,
    syncState: "stale",
  },
  {
    key: "ARCH",
    name: "Architecture Decisions",
    lastSyncedAt: "2026-07-21T08:15:00Z",
    pageCount: 5,
    syncState: "fresh",
  },
  {
    key: "PLAT",
    name: "Platform Services",
    lastSyncedAt: "2026-07-20T21:45:00Z",
    pageCount: 4,
    syncState: "fresh",
  },
  {
    key: "TEAM",
    name: "Team Handbook",
    lastSyncedAt: "2026-07-11T13:05:00Z",
    pageCount: 3,
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

${readerScrollStressSections}
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

${readerScrollStressSections}
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
  {
    pageId: "incident-response",
    spaceKey: "OPS",
    title: "Incident Response",
    url: "https://example.atlassian.net/wiki/spaces/OPS/pages/201/Incident+Response",
    parentId: "ops-home",
    path: ["Operations Home", "Incident Response"],
    owner: "Operations",
    updatedAt: "2026-07-18T09:20:00Z",
    snippet: "How to triage, communicate, mitigate, and close production incidents.",
    contentMarkdown: `# Incident Response

## Severity

Use severity to communicate impact quickly. Do not debate exact labels during mitigation.

## Roles

- Incident commander
- Communications lead
- Subject matter owner

## Closeout

Capture timeline, customer impact, root cause, and follow-up work before closing the incident.
`,
  },
  {
    pageId: "database-saturation",
    spaceKey: "OPS",
    title: "Database Saturation Runbook",
    url: "https://example.atlassian.net/wiki/spaces/OPS/pages/202/Database+Saturation+Runbook",
    parentId: "ops-home",
    path: ["Operations Home", "Database Saturation Runbook"],
    owner: "Database Reliability",
    updatedAt: "2026-07-17T22:10:00Z",
    snippet: "Checks for connection exhaustion, slow queries, lock contention, and emergency capacity relief.",
    contentMarkdown: `# Database Saturation Runbook

## First Checks

- Confirm whether saturation is CPU, IO, locks, or connection count.
- Check active deploys before restarting services.
- Capture the top queries before killing sessions.

## Recovery Options

Prefer reducing load before adding capacity. If writes are blocked, page the owning service team.
`,
  },
  {
    pageId: "rollback-production",
    spaceKey: "OPS",
    title: "Rollback Production",
    url: "https://example.atlassian.net/wiki/spaces/OPS/pages/203/Rollback+Production",
    parentId: "incident-response",
    path: ["Operations Home", "Incident Response", "Rollback Production"],
    owner: "Release Managers",
    updatedAt: "2026-07-16T17:45:00Z",
    snippet: "Rollback criteria, command checklist, and communication template for production changes.",
    contentMarkdown: `# Rollback Production

## Criteria

Rollback when customer impact is growing, mitigation is unclear, or the release owner asks for reversal.

## Checklist

1. Announce rollback start.
2. Run the rollback command from the release record.
3. Watch health checks until the service stabilizes.
4. Announce rollback completion.
`,
  },
  {
    pageId: "arch-home",
    spaceKey: "ARCH",
    title: "Architecture Home",
    url: "https://example.atlassian.net/wiki/spaces/ARCH/pages/300/Architecture+Home",
    parentId: null,
    path: ["Architecture Home"],
    owner: "Architecture Guild",
    updatedAt: "2026-07-21T08:15:00Z",
    snippet: "Decision records, standards, migration plans, and templates for architecture work.",
    contentMarkdown: `# Architecture Home

## What Belongs Here

Architecture pages should explain tradeoffs, decision context, ownership, and consequences.

## Current Reading Path

- Decision Log
- API Standards
- Migration Plan
- ADR Template
`,
  },
  {
    pageId: "decision-log",
    spaceKey: "ARCH",
    title: "Decision Log",
    url: "https://example.atlassian.net/wiki/spaces/ARCH/pages/301/Decision+Log",
    parentId: "arch-home",
    path: ["Architecture Home", "Decision Log"],
    owner: "Architecture Guild",
    updatedAt: "2026-07-20T18:20:00Z",
    snippet: "A chronological list of architecture decisions and their current status.",
    contentMarkdown: `# Decision Log

| Decision | Status | Owner |
| --- | --- | --- |
| Local-first Confluence browsing | Accepted | Developer Experience |
| API writes in V1 | Rejected | Product |
| Space-first navigation | Accepted | Architecture Guild |

## Review Rhythm

Review stale decisions monthly and link them from impacted implementation pages.
`,
  },
  {
    pageId: "api-standards",
    spaceKey: "ARCH",
    title: "API Standards",
    url: "https://example.atlassian.net/wiki/spaces/ARCH/pages/302/API+Standards",
    parentId: "arch-home",
    path: ["Architecture Home", "API Standards"],
    owner: "Platform Team",
    updatedAt: "2026-07-19T12:00:00Z",
    snippet: "Guidelines for versioning, pagination, error payloads, and idempotency.",
    contentMarkdown: `# API Standards

## Pagination

Prefer cursor pagination for mutable collections and document the ordering guarantee.

## Errors

Errors should include a stable code, a human message, and optional field-level details.

## Idempotency

Write endpoints that create external side effects should support idempotency keys.
`,
  },
  {
    pageId: "migration-plan",
    spaceKey: "ARCH",
    title: "Migration Plan",
    url: "https://example.atlassian.net/wiki/spaces/ARCH/pages/303/Migration+Plan",
    parentId: "decision-log",
    path: ["Architecture Home", "Decision Log", "Migration Plan"],
    owner: "Architecture Guild",
    updatedAt: "2026-07-18T15:30:00Z",
    snippet: "A staged migration outline with readiness gates and rollback boundaries.",
    contentMarkdown: `# Migration Plan

## Phases

1. Mirror data.
2. Compare read paths.
3. Shift low-risk traffic.
4. Freeze writes for final cutover.

## Rollback Boundary

Each phase must document the latest safe rollback point.
`,
  },
  {
    pageId: "adr-template",
    spaceKey: "ARCH",
    title: "ADR Template",
    url: "https://example.atlassian.net/wiki/spaces/ARCH/pages/304/ADR+Template",
    parentId: "decision-log",
    path: ["Architecture Home", "Decision Log", "ADR Template"],
    owner: "Architecture Guild",
    updatedAt: "2026-07-15T10:00:00Z",
    snippet: "Template for recording context, decision, consequences, and alternatives.",
    contentMarkdown: `# ADR Template

## Context

What problem are we solving and why now?

## Decision

What are we choosing?

## Consequences

What improves, what gets worse, and what must be revisited?
`,
  },
  {
    pageId: "plat-home",
    spaceKey: "PLAT",
    title: "Platform Home",
    url: "https://example.atlassian.net/wiki/spaces/PLAT/pages/400/Platform+Home",
    parentId: null,
    path: ["Platform Home"],
    owner: "Platform Team",
    updatedAt: "2026-07-20T21:45:00Z",
    snippet: "Service catalog, ownership notes, runtime conventions, and observability entry points.",
    contentMarkdown: `# Platform Home

## Start Here

Use this space to understand platform services, runtime ownership, and operational dashboards.
`,
  },
  {
    pageId: "service-catalog",
    spaceKey: "PLAT",
    title: "Service Catalog",
    url: "https://example.atlassian.net/wiki/spaces/PLAT/pages/401/Service+Catalog",
    parentId: "plat-home",
    path: ["Platform Home", "Service Catalog"],
    owner: "Platform Team",
    updatedAt: "2026-07-20T17:10:00Z",
    snippet: "Catalog of platform services, owning teams, tier, runtime, and production dashboard links.",
    contentMarkdown: `# Service Catalog

| Service | Tier | Owner |
| --- | --- | --- |
| Identity Gateway | 1 | Platform Auth |
| Event Router | 1 | Platform Messaging |
| Document Indexer | 2 | Developer Experience |
`,
  },
  {
    pageId: "runtime-ownership",
    spaceKey: "PLAT",
    title: "Runtime Ownership",
    url: "https://example.atlassian.net/wiki/spaces/PLAT/pages/402/Runtime+Ownership",
    parentId: "plat-home",
    path: ["Platform Home", "Runtime Ownership"],
    owner: "Platform SRE",
    updatedAt: "2026-07-19T09:25:00Z",
    snippet: "How teams declare owners, escalation paths, and operational responsibility for runtimes.",
    contentMarkdown: `# Runtime Ownership

## Required Metadata

- Owning team
- Primary Slack channel
- Escalation path
- Dashboard URL

## Review

Ownership records should be reviewed during quarterly service audits.
`,
  },
  {
    pageId: "observability",
    spaceKey: "PLAT",
    title: "Observability",
    url: "https://example.atlassian.net/wiki/spaces/PLAT/pages/403/Observability",
    parentId: "runtime-ownership",
    path: ["Platform Home", "Runtime Ownership", "Observability"],
    owner: "Platform SRE",
    updatedAt: "2026-07-18T14:10:00Z",
    snippet: "Dashboards, alerts, logging conventions, and service health review practices.",
    contentMarkdown: `# Observability

## Dashboards

Every tier-one service should expose latency, error rate, saturation, and business health panels.

## Alerts

Alert on user impact, not internal noise.
`,
  },
  {
    pageId: "team-home",
    spaceKey: "TEAM",
    title: "Team Home",
    url: "https://example.atlassian.net/wiki/spaces/TEAM/pages/500/Team+Home",
    parentId: null,
    path: ["Team Home"],
    owner: "Engineering Managers",
    updatedAt: "2026-07-11T13:05:00Z",
    snippet: "Team norms, onboarding material, recurring meeting notes, and working agreements.",
    contentMarkdown: `# Team Home

## Norms

Keep decisions written, reviews kind, and project status visible.
`,
  },
  {
    pageId: "onboarding",
    spaceKey: "TEAM",
    title: "Onboarding",
    url: "https://example.atlassian.net/wiki/spaces/TEAM/pages/501/Onboarding",
    parentId: "team-home",
    path: ["Team Home", "Onboarding"],
    owner: "Developer Experience",
    updatedAt: "2026-07-10T11:00:00Z",
    snippet: "First-week checklist for new engineers joining the team.",
    contentMarkdown: `# Onboarding

## First Week

- Set up development tools.
- Read the engineering handbook.
- Pair on one small change.
`,
  },
  {
    pageId: "meeting-notes",
    spaceKey: "TEAM",
    title: "Meeting Notes",
    url: "https://example.atlassian.net/wiki/spaces/TEAM/pages/502/Meeting+Notes",
    parentId: "team-home",
    path: ["Team Home", "Meeting Notes"],
    owner: "Engineering Managers",
    updatedAt: "2026-07-08T09:40:00Z",
    snippet: "Recurring team meeting notes and action items for weekly rituals.",
    contentMarkdown: `# Meeting Notes

## Weekly Sync

Keep notes short, link decisions, and assign owners to action items.
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
  {
    fromPageId: "ops-home",
    targetUrl: "https://example.atlassian.net/wiki/spaces/OPS/pages/201/Incident+Response",
    targetPageId: "incident-response",
    title: "Incident Response",
    kind: "internal",
  },
  {
    fromPageId: "incident-response",
    targetUrl: "https://example.atlassian.net/wiki/spaces/OPS/pages/203/Rollback+Production",
    targetPageId: "rollback-production",
    title: "Rollback Production",
    kind: "internal",
  },
  {
    fromPageId: "database-saturation",
    targetUrl: "https://example.atlassian.net/wiki/spaces/PLAT/pages/403/Observability",
    targetPageId: "observability",
    title: "Observability",
    kind: "internal",
  },
  {
    fromPageId: "arch-home",
    targetUrl: "https://example.atlassian.net/wiki/spaces/ARCH/pages/301/Decision+Log",
    targetPageId: "decision-log",
    title: "Decision Log",
    kind: "internal",
  },
  {
    fromPageId: "decision-log",
    targetUrl: "https://example.atlassian.net/wiki/spaces/ARCH/pages/304/ADR+Template",
    targetPageId: "adr-template",
    title: "ADR Template",
    kind: "internal",
  },
  {
    fromPageId: "api-standards",
    targetUrl: "https://example.atlassian.net/wiki/spaces/ENG/pages/101/Project+Architecture",
    targetPageId: "architecture",
    title: "Project Architecture",
    kind: "internal",
  },
  {
    fromPageId: "plat-home",
    targetUrl: "https://example.atlassian.net/wiki/spaces/PLAT/pages/401/Service+Catalog",
    targetPageId: "service-catalog",
    title: "Service Catalog",
    kind: "internal",
  },
  {
    fromPageId: "runtime-ownership",
    targetUrl: "https://example.atlassian.net/wiki/spaces/PLAT/pages/403/Observability",
    targetPageId: "observability",
    title: "Observability",
    kind: "internal",
  },
  {
    fromPageId: "team-home",
    targetUrl: "https://example.atlassian.net/wiki/spaces/TEAM/pages/501/Onboarding",
    targetPageId: "onboarding",
    title: "Onboarding",
    kind: "internal",
  },
]

export function getPagesForSpace(spaceKey: string) {
  return mockPages.filter((page) => page.spaceKey === spaceKey)
}

export function searchPagesInSpace(spaceKey: string, query: string): SearchResult[] {
  const pages = getPagesForSpace(spaceKey)
  const normalizedQuery = normalizeSearchText(query)

  if (!normalizedQuery) {
    return pages.map((page, index) => ({ page, score: pages.length - index, matchedIn: "all" }))
  }

  return pages
    .map((page) => scorePage(page, normalizedQuery))
    .filter((result): result is SearchResult => result !== null)
    .sort((a, b) => b.score - a.score || a.page.title.localeCompare(b.page.title))
}

export function searchSpaces(query: string): SpaceSearchResult[] {
  const normalizedQuery = normalizeSearchText(query)

  if (!normalizedQuery) {
    return mockSpaces.map((space, index) => ({ space, score: mockSpaces.length - index, matchedIn: "all" }))
  }

  return mockSpaces
    .map((space) => scoreSpace(space, normalizedQuery))
    .filter((result): result is SpaceSearchResult => result !== null)
    .sort((a, b) => b.score - a.score || a.space.key.localeCompare(b.space.key))
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

function scorePage(page: IndexedPage, normalizedQuery: string): SearchResult | null {
  const title = normalizeSearchText(page.title)
  const path = normalizeSearchText(page.path.join(" / "))
  const snippet = normalizeSearchText(page.snippet)
  const content = normalizeSearchText(page.contentMarkdown)

  if (title === normalizedQuery) return { page, score: 100, matchedIn: "title" }
  if (title.startsWith(normalizedQuery)) return { page, score: 90, matchedIn: "title" }
  if (title.includes(normalizedQuery)) return { page, score: 80, matchedIn: "title" }
  if (path.includes(normalizedQuery)) return { page, score: 60, matchedIn: "path" }
  if (snippet.includes(normalizedQuery)) return { page, score: 40, matchedIn: "snippet" }
  if (content.includes(normalizedQuery)) return { page, score: 20, matchedIn: "content" }

  return null
}

function scoreSpace(space: SpaceSummary, normalizedQuery: string): SpaceSearchResult | null {
  const key = normalizeSearchText(space.key)
  const name = normalizeSearchText(space.name)
  const sync = normalizeSearchText(space.syncState)

  if (key === normalizedQuery) return { space, score: 100, matchedIn: "key" }
  if (key.startsWith(normalizedQuery)) return { space, score: 90, matchedIn: "key" }
  if (name === normalizedQuery) return { space, score: 80, matchedIn: "name" }
  if (name.includes(normalizedQuery)) return { space, score: 70, matchedIn: "name" }
  if (sync.includes(normalizedQuery)) return { space, score: 30, matchedIn: "sync" }

  return null
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim()
}
