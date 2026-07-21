import { applyPageDraftToConfluence, type ApplyPageDraftResult } from "../apply"
import type { FetchLike } from "../confluence/client"
import { formatMarkdownDiff, readEditableDraftInput, savePageDraft, type EditableDraftInput } from "../editing"
import { openIndexRepository, type IndexRepository, type PageDraftStatus } from "../index/repository"
import type { IndexedPage, ReaderPage, SearchResult, SpaceSearchResult, SpaceSummary } from "../model"

export const emptyPageId = "__lazyconfluence_empty__"

export interface TuiDataSource {
  applyPageDraft: (pageId: string, draftMarkdown: string) => Promise<ApplyPageDraftResult>
  close?: () => void
  discardPageDraft: (pageId: string) => "discarded" | "missing"
  formatPageDraftDiff: (pageId: string, draftMarkdown: string) => string
  getDefaultSpaceKey: () => string | null
  getDefaultPageId: (spaceKey?: string) => string | null
  getEditableDraftInput: (pageId: string) => EditableDraftInput
  getPageDraftStatus: (pageId: string) => PageDraftStatus | null
  getPagesForSpace: (spaceKey: string) => IndexedPage[]
  getReaderPage: (pageId: string) => ReaderPage | null
  listSpaces: () => SpaceSummary[]
  savePageDraft: (pageId: string, draftMarkdown: string) => SaveTuiPageDraftResult
  searchPagesInSpace: (spaceKey: string, query: string) => SearchResult[]
  searchSpaces: (query: string) => SpaceSearchResult[]
  stagePageDraft: (pageId: string, draftMarkdown: string) => "staged" | "unchanged"
  unstagePageDraft: (pageId: string) => "unstaged" | "missing"
}

export interface TuiDataSourceOptions {
  env?: NodeJS.ProcessEnv
  fetch?: FetchLike
  now?: () => Date
}

export type SaveTuiPageDraftResult =
  | { status: "saved"; pageTitle: string }
  | { status: "cleared"; pageTitle: string }
  | { status: "unchanged"; pageTitle: string }

export function createRepositoryTuiDataSource(repository: IndexRepository = openIndexRepository(), options: TuiDataSourceOptions = {}): TuiDataSource {
  const now = options.now ?? (() => new Date())

  return {
    applyPageDraft: async (pageId, draftMarkdown) => {
      const saved = saveTuiPageDraft(repository, pageId, draftMarkdown, now)
      if (saved.status !== "saved") {
        const input = readEditableDraftInput(repository, pageId)
        return { status: "blocked", pageId, title: input.page.title, reason: "no-changes", details: [`Draft for ${input.page.title} (${input.page.pageId}) has no changes to apply.`] }
      }

      repository.stagePageDraft(pageId, now().toISOString())
      return applyPageDraftToConfluence(pageId, { repository, env: options.env, fetch: options.fetch, now })
    },
    close: () => repository.close(),
    discardPageDraft: (pageId) => repository.deletePageDraft(pageId) > 0 ? "discarded" : "missing",
    formatPageDraftDiff: (pageId, draftMarkdown) => {
      const input = readEditableDraftInput(repository, pageId)
      return formatMarkdownDiff(input.body.editableMarkdown, draftMarkdown)
    },
    getDefaultSpaceKey: () => repository.listSpaces()[0]?.key ?? null,
    getDefaultPageId: (spaceKey) => {
      const key = spaceKey ?? repository.listSpaces()[0]?.key
      if (!key) return null

      const pages = repository.listPagesInSpace(key)
      return pages.find((page) => page.parentId === null)?.pageId ?? pages[0]?.pageId ?? null
    },
    getEditableDraftInput: (pageId) => readEditableDraftInput(repository, pageId),
    getPageDraftStatus: (pageId) => repository.getPageDraft(pageId)?.status ?? null,
    getPagesForSpace: (spaceKey) => repository.listPagesInSpace(spaceKey),
    getReaderPage: (pageId) => {
      const page = repository.getPage(pageId)
      if (!page) return null

      const draft = repository.getPageDraft(page.pageId)
      const body = repository.getPageBody(page.pageId)
      const contentMarkdown = draft?.draftMarkdown || body?.renderedMarkdown || page.contentMarkdown

      return {
        ...page,
        contentMarkdown,
        children: repository.getChildren(page.pageId),
        outgoingLinks: repository.getOutgoingLinks(page.pageId),
        backlinks: repository.getIncomingLinks(page.pageId),
        outline: extractOutline(contentMarkdown),
        snippet: draft ? extractSnippet(contentMarkdown, page.snippet) : page.snippet,
      }
    },
    listSpaces: () => repository.listSpaces(),
    savePageDraft: (pageId, draftMarkdown) => saveTuiPageDraft(repository, pageId, draftMarkdown, now),
    searchPagesInSpace: (spaceKey, query) => repository.searchPagesInSpace(spaceKey, query, 20),
    searchSpaces: (query) => searchSpaces(repository.listSpaces(), query),
    stagePageDraft: (pageId, draftMarkdown) => {
      const saved = saveTuiPageDraft(repository, pageId, draftMarkdown, now)
      if (saved.status !== "saved") return "unchanged"

      repository.stagePageDraft(pageId, now().toISOString())
      return "staged"
    },
    unstagePageDraft: (pageId) => repository.unstagePageDraft(pageId, now().toISOString()) > 0 ? "unstaged" : "missing",
  }
}

function saveTuiPageDraft(repository: IndexRepository, pageId: string, draftMarkdown: string, now: () => Date): SaveTuiPageDraftResult {
  const input = readEditableDraftInput(repository, pageId)

  if (draftMarkdown === input.body.editableMarkdown) {
    const deleted = repository.deletePageDraft(pageId)
    return { status: deleted > 0 ? "cleared" : "unchanged", pageTitle: input.page.title }
  }

  savePageDraft(repository, input.page, input.body, input.draft, draftMarkdown, now)
  return { status: "saved", pageTitle: input.page.title }
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
      "Run `lazyconfluence sync` to fetch configured spaces, then reopen `lazyconfluence`.",
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

function extractSnippet(markdown: string, fallback: string) {
  return markdown
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#") && !line.startsWith("```"))
    ?.replace(/[`*_>\-[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim() || fallback
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim()
}
