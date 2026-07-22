import { randomUUID } from "node:crypto"
import { applyPageCreateToConfluence, applyPageDraftToConfluence, type ApplyPageDraftResult } from "../apply"
import type { FetchLike } from "../confluence/client"
import { formatMarkdownDiff, readEditableDraftInput, savePageDraft, type EditableDraftInput } from "../editing"
import { openIndexRepository, type IndexRepository, type PageCreate, type PageDraft, type PageDraftStatus } from "../index/repository"
import type { IndexedPage, ReaderPage, SearchResult, SpaceSearchResult, SpaceSummary } from "../model"

export const emptyPageId = "__lazyconfluence_empty__"

export interface TuiDataSource {
  applyPageDraft: (pageId: string, draftMarkdown: string) => Promise<ApplyPageDraftResult>
  applyStagedDrafts: (pageIds: string[]) => Promise<ApplyPageDraftResult[]>
  applyStagedChanges: (changeKeys: string[]) => Promise<ApplyPageDraftResult[]>
  close?: () => void
  discardPageDraft: (pageId: string) => "discarded" | "missing"
  discardPageDrafts: (pageIds: string[]) => number
  discardStagedChanges: (changeKeys: string[]) => number
  formatPageDraftDiff: (pageId: string, draftMarkdown: string) => string
  getDefaultSpaceKey: () => string | null
  getDefaultPageId: (spaceKey?: string) => string | null
  getEditableDraftInput: (pageId: string) => EditableDraftInput
  getEditablePageInput: (pageId: string) => TuiEditablePageInput
  getPageDraftStatus: (pageId: string) => PageDraftStatus | null
  getPagesForSpace: (spaceKey: string) => IndexedPage[]
  getReaderPage: (pageId: string) => ReaderPage | null
  listStagedDraftChanges: (spaceKey: string) => TuiDraftChange[]
  listStagedChanges: (spaceKey: string) => TuiStagedChange[]
  listSpaces: () => SpaceSummary[]
  savePageDraft: (pageId: string, draftMarkdown: string) => SaveTuiPageDraftResult
  searchPagesInSpace: (spaceKey: string, query: string) => SearchResult[]
  searchSpaces: (query: string) => SpaceSearchResult[]
  stagePageCreate: (input: { spaceKey: string; parentPageId: string; title: string }) => TuiCreateChange
  stagePageBuffer: (pageId: string, markdown: string) => "staged" | "unchanged"
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

export interface TuiDraftChange {
  kind: "update"
  changeKey: string
  page: IndexedPage
  draft: PageDraft
  title: string
  updatedAt: string
  diffMarkdown: string
}

export interface TuiCreateChange {
  kind: "create"
  changeKey: string
  create: PageCreate
  parentPage: IndexedPage
  title: string
  updatedAt: string
  diffMarkdown: string
}

export type TuiStagedChange = TuiDraftChange | TuiCreateChange

export type TuiEditablePageInput =
  | { kind: "update"; page: IndexedPage; markdown: string; draftStatus: PageDraftStatus | null }
  | { kind: "create"; page: IndexedPage; markdown: string; draftStatus: "staged" }

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
    applyStagedDrafts: async (pageIds) => {
      const results: ApplyPageDraftResult[] = []

      for (const pageId of pageIds) {
        results.push(await applyPageDraftToConfluence(pageId, { repository, env: options.env, fetch: options.fetch, now }))
      }

      return results
    },
    applyStagedChanges: async (changeKeys) => {
      const results: ApplyPageDraftResult[] = []

      for (const changeKey of changeKeys) {
        const parsed = parseChangeKey(changeKey)
        if (!parsed) continue
        results.push(parsed.kind === "update"
          ? await applyPageDraftToConfluence(parsed.id, { repository, env: options.env, fetch: options.fetch, now })
          : await applyPageCreateToConfluence(parsed.id, { repository, env: options.env, fetch: options.fetch, now }))
      }

      return results
    },
    close: () => repository.close(),
    discardPageDraft: (pageId) => repository.deletePageDraft(pageId) > 0 ? "discarded" : "missing",
    discardPageDrafts: (pageIds) => pageIds.reduce((count, pageId) => count + repository.deletePageDraft(pageId), 0),
    discardStagedChanges: (changeKeys) => changeKeys.reduce((count, changeKey) => {
      const parsed = parseChangeKey(changeKey)
      if (!parsed) return count

      return count + (parsed.kind === "update" ? repository.deletePageDraft(parsed.id) : repository.deletePageCreate(parsed.id))
    }, 0),
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
    getEditablePageInput: (pageId) => readEditablePageInput(repository, pageId),
    getPageDraftStatus: (pageId) => createIdFromPageId(pageId) ? "staged" : repository.getPageDraft(pageId)?.status ?? null,
    getPagesForSpace: (spaceKey) => listPagesWithCreates(repository, spaceKey),
    getReaderPage: (pageId) => {
      const createId = createIdFromPageId(pageId)
      if (createId) return createReaderPage(repository, createId)

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
    listStagedDraftChanges: (spaceKey) => repository.listPageDrafts("staged")
      .map((draft) => draftChangeFor(repository, draft))
      .filter((change): change is TuiDraftChange => change !== null && change.page.spaceKey === spaceKey),
    listStagedChanges: (spaceKey) => [
      ...repository.listPageDrafts("staged")
        .map((draft) => draftChangeFor(repository, draft))
        .filter((change): change is TuiDraftChange => change !== null && change.page.spaceKey === spaceKey),
      ...repository.listPageCreates(spaceKey)
        .map((create) => createChangeFor(repository, create))
        .filter((change): change is TuiCreateChange => change !== null),
    ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.title.localeCompare(right.title)),
    listSpaces: () => repository.listSpaces(),
    savePageDraft: (pageId, draftMarkdown) => saveTuiPageDraft(repository, pageId, draftMarkdown, now),
    searchPagesInSpace: (spaceKey, query) => repository.searchPagesInSpace(spaceKey, query, 20),
    searchSpaces: (query) => searchSpaces(repository.listSpaces(), query),
    stagePageCreate: (input) => {
      const title = input.title.trim()
      if (!title) throw new Error("New page title is required.")

      const parentPage = repository.getPage(input.parentPageId)
      if (!parentPage) throw new Error(`Parent page not found in local index: ${input.parentPageId}`)
      if (parentPage.spaceKey !== input.spaceKey) throw new Error(`Parent page ${parentPage.title} is not in ${input.spaceKey}.`)

      const timestamp = now().toISOString()
      const create: PageCreate = {
        localId: randomUUID(),
        spaceKey: input.spaceKey,
        parentPageId: input.parentPageId,
        title,
        draftMarkdown: `# ${title}\n`,
        createdAt: timestamp,
        updatedAt: timestamp,
      }

      repository.upsertPageCreate(create)

      const change = createChangeFor(repository, create)
      if (!change) throw new Error("Failed to stage new page create.")

      return change
    },
    stagePageBuffer: (pageId, markdown) => {
      const createId = createIdFromPageId(pageId)
      if (!createId) return stageExistingPageDraft(repository, pageId, markdown, now)

      const create = repository.getPageCreate(createId)
      if (!create) throw new Error(`Staged page create not found: ${createId}`)

      const normalizedMarkdown = markdown.endsWith("\n") ? markdown : `${markdown}\n`
      if (normalizedMarkdown === create.draftMarkdown) return "unchanged"

      repository.upsertPageCreate({ ...create, draftMarkdown: normalizedMarkdown, updatedAt: now().toISOString() })
      return "staged"
    },
    stagePageDraft: (pageId, draftMarkdown) => {
      return stageExistingPageDraft(repository, pageId, draftMarkdown, now)
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

function stageExistingPageDraft(repository: IndexRepository, pageId: string, draftMarkdown: string, now: () => Date) {
  const saved = saveTuiPageDraft(repository, pageId, draftMarkdown, now)
  if (saved.status !== "saved") return "unchanged"

  repository.stagePageDraft(pageId, now().toISOString())
  return "staged"
}

function readEditablePageInput(repository: IndexRepository, pageId: string): TuiEditablePageInput {
  const createId = createIdFromPageId(pageId)
  if (createId) {
    const create = repository.getPageCreate(createId)
    if (!create) throw new Error(`Staged page create not found: ${createId}`)

    const page = virtualPageForCreate(repository, create)
    if (!page) throw new Error(`Parent page not found for staged create: ${create.parentPageId}`)

    return { kind: "create", page, markdown: create.draftMarkdown, draftStatus: "staged" }
  }

  const input = readEditableDraftInput(repository, pageId)
  return { kind: "update", page: input.page, markdown: input.draft?.draftMarkdown ?? input.body.editableMarkdown, draftStatus: input.draft?.status ?? null }
}

function listPagesWithCreates(repository: IndexRepository, spaceKey: string) {
  const pages = repository.listPagesInSpace(spaceKey)
  const virtualCreates = repository.listPageCreates(spaceKey)
    .map((create) => virtualPageForCreate(repository, create))
    .filter((page): page is IndexedPage => page !== null)

  return [...pages, ...virtualCreates]
}

function createReaderPage(repository: IndexRepository, createId: string): ReaderPage | null {
  const create = repository.getPageCreate(createId)
  if (!create) return null

  const page = virtualPageForCreate(repository, create)
  if (!page) return null

  return {
    ...page,
    children: [],
    outgoingLinks: [],
    backlinks: [],
    outline: extractOutline(create.draftMarkdown),
  }
}

function virtualPageForCreate(repository: IndexRepository, create: PageCreate): IndexedPage | null {
  const parentPage = repository.getPage(create.parentPageId)

  if (!parentPage) return null

  return {
    pageId: createChangeKey(create.localId),
    spaceKey: create.spaceKey,
    title: create.title,
    url: `local://page-create/${create.localId}`,
    parentId: create.parentPageId,
    path: [...parentPage.path, create.title],
    owner: "local draft",
    updatedAt: create.updatedAt,
    contentMarkdown: create.draftMarkdown,
    snippet: extractSnippet(create.draftMarkdown, "New local page."),
    treeOrder: Number.MAX_SAFE_INTEGER,
  }
}

function draftChangeFor(repository: IndexRepository, draft: PageDraft): TuiDraftChange | null {
  const page = repository.getPage(draft.pageId)
  const body = repository.getPageBody(draft.pageId)

  if (!page || !body) return null

  return {
    kind: "update",
    changeKey: updateChangeKey(draft.pageId),
    page,
    draft,
    title: page.title,
    updatedAt: draft.updatedAt,
    diffMarkdown: formatMarkdownDiff(body.editableMarkdown, draft.draftMarkdown),
  }
}

function createChangeFor(repository: IndexRepository, create: PageCreate): TuiCreateChange | null {
  const parentPage = repository.getPage(create.parentPageId)

  if (!parentPage) return null

  return {
    kind: "create",
    changeKey: createChangeKey(create.localId),
    create,
    parentPage,
    title: create.title,
    updatedAt: create.updatedAt,
    diffMarkdown: ["--- new page", "+++ staged", ...create.draftMarkdown.split("\n").map((line) => `+${line}`)].join("\n"),
  }
}

function updateChangeKey(pageId: string) {
  return `update:${pageId}`
}

function createChangeKey(localId: string) {
  return `create:${localId}`
}

function parseChangeKey(changeKey: string): { kind: "update" | "create"; id: string } | null {
  const separator = changeKey.indexOf(":")
  if (separator < 0) return null

  const kind = changeKey.slice(0, separator)
  const id = changeKey.slice(separator + 1)
  if (!id || (kind !== "update" && kind !== "create")) return null

  return { kind, id }
}

function createIdFromPageId(pageId: string) {
  const parsed = parseChangeKey(pageId)

  return parsed?.kind === "create" ? parsed.id : null
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
