import { openIndexRepository, type IndexRepository } from "../index/repository"
import type { IndexedPage, ReaderPage, SearchResult, SpaceSearchResult, SpaceSummary } from "../model"

export const emptyPageId = "__lazyconfluence_empty__"

export interface TuiDataSource {
  close?: () => void
  getDefaultSpaceKey: () => string | null
  getDefaultPageId: (spaceKey?: string) => string | null
  getPagesForSpace: (spaceKey: string) => IndexedPage[]
  getReaderPage: (pageId: string) => ReaderPage | null
  listSpaces: () => SpaceSummary[]
  searchPagesInSpace: (spaceKey: string, query: string) => SearchResult[]
  searchSpaces: (query: string) => SpaceSearchResult[]
}

export function createRepositoryTuiDataSource(repository: IndexRepository = openIndexRepository()): TuiDataSource {
  return {
    close: () => repository.close(),
    getDefaultSpaceKey: () => repository.listSpaces()[0]?.key ?? null,
    getDefaultPageId: (spaceKey) => {
      const key = spaceKey ?? repository.listSpaces()[0]?.key
      if (!key) return null

      const pages = repository.listPagesInSpace(key)
      return pages.find((page) => page.parentId === null)?.pageId ?? pages[0]?.pageId ?? null
    },
    getPagesForSpace: (spaceKey) => repository.listPagesInSpace(spaceKey),
    getReaderPage: (pageId) => {
      const page = repository.getPage(pageId)
      if (!page) return null

      const body = repository.getPageBody(page.pageId)
      const contentMarkdown = body?.renderedMarkdown || page.contentMarkdown

      return {
        ...page,
        contentMarkdown,
        children: repository.getChildren(page.pageId),
        outgoingLinks: repository.getOutgoingLinks(page.pageId),
        backlinks: repository.getIncomingLinks(page.pageId),
        outline: extractOutline(contentMarkdown),
      }
    },
    listSpaces: () => repository.listSpaces(),
    searchPagesInSpace: (spaceKey, query) => repository.searchPagesInSpace(spaceKey, query, 20),
    searchSpaces: (query) => searchSpaces(repository.listSpaces(), query),
  }
}

export function emptySpaceSummary(spaceKey = "LOCAL"): SpaceSummary {
  return {
    key: spaceKey,
    name: "Local index",
    lastSyncedAt: null,
    pageCount: 0,
    syncState: "not-synced",
  }
}

export function emptyReaderPage(space: SpaceSummary): ReaderPage {
  return {
    pageId: emptyPageId,
    spaceKey: space.key,
    title: "No local pages indexed",
    url: "",
    parentId: null,
    path: [space.name],
    owner: "lazyconfluence",
    updatedAt: "1970-01-01T00:00:00.000Z",
    snippet: "Run sync first, then reopen the TUI.",
    contentMarkdown: [
      "# No local pages indexed",
      "",
      "The terminal UI reads only from your local SQLite index.",
      "",
      "Run `bun run start sync` to fetch configured spaces, then reopen `bun run start`.",
    ].join("\n"),
    children: [],
    outgoingLinks: [],
    backlinks: [],
    outline: [],
  }
}

function searchSpaces(spaces: SpaceSummary[], query: string): SpaceSearchResult[] {
  const normalizedQuery = normalizeSearchText(query)

  if (!normalizedQuery) {
    return spaces.map((space, index) => ({ space, score: spaces.length - index, matchedIn: "all" }))
  }

  return spaces
    .map((space) => scoreSpace(space, normalizedQuery))
    .filter((result): result is SpaceSearchResult => result !== null)
    .sort((a, b) => b.score - a.score || a.space.key.localeCompare(b.space.key))
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

function extractOutline(markdown: string) {
  return markdown
    .split("\n")
    .filter((line) => line.startsWith("##"))
    .map((line) => line.replace(/^#+\s*/, ""))
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim()
}
