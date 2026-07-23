import { randomUUID } from "node:crypto"
import { applyPageCreateToConfluence, applyPageDeleteToConfluence, applyPageDraftToConfluence, type ApplyPageDraftResult } from "../apply"
import type { FetchLike } from "../confluence/client"
import { formatMarkdownDiff, readEditableDraftInput, savePageDraft, type EditableDraftInput } from "../editing"
import { openIndexRepository, type IndexRepository, type PageBodyArtifact, type PageCreate, type PageDelete, type PageDraft, type PageDraftStatus } from "../index/repository"
import { compareSearchResults, scorePageSearchResult } from "../index/search"
import { getDefaultPageId as getDefaultMockPageId, getPagesForSpace as getMockPagesForSpace, getReaderPage as getMockReaderPage, mockPages, mockSpaces, searchPagesInSpace as searchMockPagesInSpace, searchSpaces as searchMockSpaces } from "../mock-data"
import type { IndexedPage, PageViewMode, ReaderPage, SearchResult, SpaceSearchResult, SpaceSummary } from "../model"

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
  getDefaultPageId: (spaceKey?: string, view?: PageViewMode) => string | null
  getEditableDraftInput: (pageId: string) => EditableDraftInput
  getEditablePageInput: (pageId: string) => TuiEditablePageInput
  getPageDraftStatus: (pageId: string) => PageDraftStatus | null
  getPagesForSpace: (spaceKey: string, view?: PageViewMode) => IndexedPage[]
  getReaderPage: (pageId: string, view?: PageViewMode) => ReaderPage | null
  listStagedDraftChanges: (spaceKey: string) => TuiDraftChange[]
  listStagedChanges: (spaceKey: string) => TuiStagedChange[]
  listSpaces: () => SpaceSummary[]
  savePageDraft: (pageId: string, draftMarkdown: string) => SaveTuiPageDraftResult
  searchPagesInSpace: (spaceKey: string, query: string, view?: PageViewMode) => SearchResult[]
  searchSpaces: (query: string) => SpaceSearchResult[]
  stagePageCreate: (input: { spaceKey: string; parentPageId: string | null; title: string }) => TuiCreateChange
  stagePageDelete: (pageId: string) => TuiDeleteChange
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
  parentPage: IndexedPage | null
  title: string
  updatedAt: string
  diffMarkdown: string
}

export interface TuiDeleteChange {
  kind: "delete"
  changeKey: string
  page: IndexedPage
  deletion: PageDelete
  title: string
  updatedAt: string
  diffMarkdown: string
}

export type TuiStagedChange = TuiDraftChange | TuiCreateChange | TuiDeleteChange

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
      const resultsByChangeKey = new Map<string, ApplyPageDraftResult>()

      for (const changeKey of orderChangeKeysForApply(repository, changeKeys)) {
        const parsed = parseChangeKey(changeKey)
        if (!parsed) continue
        const result = parsed.kind === "update"
          ? await applyPageDraftToConfluence(parsed.id, { repository, env: options.env, fetch: options.fetch, now })
          : parsed.kind === "create"
            ? await applyPageCreateToConfluence(parsed.id, { repository, env: options.env, fetch: options.fetch, now })
            : await applyPageDeleteToConfluence(parsed.id, { repository, env: options.env, fetch: options.fetch, now })
        resultsByChangeKey.set(changeKey, result)
      }

      return changeKeys.map((changeKey) => resultsByChangeKey.get(changeKey)).filter((result): result is ApplyPageDraftResult => result !== undefined)
    },
    close: () => repository.close(),
    discardPageDraft: (pageId) => repository.deletePageDraft(pageId) > 0 ? "discarded" : "missing",
    discardPageDrafts: (pageIds) => pageIds.reduce((count, pageId) => count + repository.deletePageDraft(pageId), 0),
    discardStagedChanges: (changeKeys) => changeKeys.reduce((count, changeKey) => {
      const parsed = parseChangeKey(changeKey)
      if (!parsed) return count

      return count + (parsed.kind === "update" ? repository.deletePageDraft(parsed.id) : parsed.kind === "create" ? repository.deletePageCreate(parsed.id) : repository.deletePageDelete(parsed.id))
    }, 0),
    formatPageDraftDiff: (pageId, draftMarkdown) => {
      const input = readEditableDraftInput(repository, pageId)
      return formatMarkdownDiff(input.body.editableMarkdown, draftMarkdown)
    },
    getDefaultSpaceKey: () => repository.listSpaces()[0]?.key ?? null,
    getDefaultPageId: (spaceKey, view = "current") => {
      const key = spaceKey ?? repository.listSpaces()[0]?.key
      if (!key) return null

      const pages = listPagesWithCreates(repository, key, view)
      return pages.find((page) => page.parentId === null)?.pageId ?? pages[0]?.pageId ?? null
    },
    getEditableDraftInput: (pageId) => readEditableDraftInput(repository, pageId),
    getEditablePageInput: (pageId) => readEditablePageInput(repository, pageId),
    getPageDraftStatus: (pageId) => createIdFromPageId(pageId) || repository.getPageDelete(pageId) ? "staged" : repository.getPageDraft(pageId)?.status ?? null,
    getPagesForSpace: (spaceKey, view = "current") => listPagesWithCreates(repository, spaceKey, view),
    getReaderPage: (pageId, view = "current") => {
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
        children: listChildrenWithCreates(repository, page.pageId, view),
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
      ...repository.listPageDeletes()
        .map((deletion) => deleteChangeFor(repository, deletion))
        .filter((change): change is TuiDeleteChange => change !== null && change.page.spaceKey === spaceKey),
    ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.title.localeCompare(right.title)),
    listSpaces: () => repository.listSpaces(),
    savePageDraft: (pageId, draftMarkdown) => saveTuiPageDraft(repository, pageId, draftMarkdown, now),
    searchPagesInSpace: (spaceKey, query, view = "current") => searchPagesWithCreates(repository, spaceKey, query, 20, view),
    searchSpaces: (query) => searchSpaces(repository.listSpaces(), query),
    stagePageCreate: (input) => {
      const title = input.title.trim()
      if (!title) throw new Error("New page title is required.")

      const space = repository.getSpace(input.spaceKey)
      if (!space) throw new Error(`Space not found in local index: ${input.spaceKey}`)

      const parentCreateId = input.parentPageId ? createIdFromPageId(input.parentPageId) : null
      const parentCreate = parentCreateId ? repository.getPageCreate(parentCreateId) : null
      const parentPageId = input.parentPageId && !parentCreateId ? input.parentPageId : null
      const parentPage = parentPageId ? repository.getPage(parentPageId) : null
      if (parentCreateId && !parentCreate) throw new Error(`Parent local page not found: ${input.parentPageId}`)
      if (parentCreate && parentCreate.spaceKey !== input.spaceKey) throw new Error(`Parent local page ${parentCreate.title} is not in ${input.spaceKey}.`)
      if (parentPageId && !parentPage) throw new Error(`Parent page not found in local index: ${parentPageId}`)
      if (parentPage && parentPage.spaceKey !== input.spaceKey) throw new Error(`Parent page ${parentPage.title} is not in ${input.spaceKey}.`)
      if (parentPage && !isEditableRemotePage(parentPage)) throw new Error(`${parentPage.title} is ${remoteStatusLabel(parentPage)} in Confluence and cannot receive new child pages from lazyconfluence.`)

      const timestamp = now().toISOString()
      const create: PageCreate = {
        localId: randomUUID(),
        spaceKey: input.spaceKey,
        parentPageId,
        parentCreateId,
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
    stagePageDelete: (pageId) => {
      if (createIdFromPageId(pageId)) throw new Error("Local-only pages are staged creates. Open Overview and discard the create to remove it.")

      const page = repository.getPage(pageId)
      if (!page) throw new Error(`Page not found in local index: ${pageId}`)
      if (!isEditableRemotePage(page)) throw new Error(`${page.title} is ${remoteStatusLabel(page)} in Confluence and is read-only in lazyconfluence.`)

      const children = [
        ...repository.getChildren(pageId, "all"),
        ...repository.listPageCreates(page.spaceKey).filter((create) => create.parentPageId === pageId).map((create) => virtualPageForCreate(repository, create)).filter((child): child is IndexedPage => child !== null),
      ].sort(compareTreePages)
      if (children.length) throw new Error(`Delete child pages first: ${children.map((child) => child.title).join(", ")}.`)

      const timestamp = now().toISOString()
      const deletion: PageDelete = { pageId, createdAt: repository.getPageDelete(pageId)?.createdAt ?? timestamp, updatedAt: timestamp }
      repository.deletePageDraft(pageId)
      repository.upsertPageDelete(deletion)

      const change = deleteChangeFor(repository, deletion)
      if (!change) throw new Error("Failed to stage page delete.")

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

export const createProdTuiSource = createRepositoryTuiDataSource

export function createMockTuiDataSource(): TuiDataSource {
  return {
    applyPageDraft: async (pageId) => demoBlockedResult(pageId),
    applyStagedDrafts: async (pageIds) => pageIds.map((pageId) => demoBlockedResult(pageId)),
    applyStagedChanges: async (changeKeys) => changeKeys.map((changeKey) => demoBlockedResult(changeKey)),
    close: () => {},
    discardPageDraft: () => "missing",
    discardPageDrafts: () => 0,
    discardStagedChanges: () => 0,
    formatPageDraftDiff: (pageId, draftMarkdown) => {
      const input = readMockEditableDraftInput(pageId)
      return formatMarkdownDiff(input.body.editableMarkdown, draftMarkdown)
    },
    getDefaultSpaceKey: () => mockSpaces[0]?.key ?? null,
    getDefaultPageId: (spaceKey, view = "current") => view === "archived" ? null : getDefaultMockPageId(spaceKey ?? mockSpaces[0]?.key),
    getEditableDraftInput: (pageId) => readMockEditableDraftInput(pageId),
    getEditablePageInput: (pageId) => {
      const input = readMockEditableDraftInput(pageId)
      return { kind: "update", page: input.page, markdown: input.body.editableMarkdown, draftStatus: null }
    },
    getPageDraftStatus: () => null,
    getPagesForSpace: (spaceKey, view = "current") => view === "archived" ? [] : getMockPagesForSpace(spaceKey),
    getReaderPage: (pageId, view = "current") => pageId === emptyPageId || view === "archived" ? null : getMockReaderPage(pageId),
    listStagedDraftChanges: () => [],
    listStagedChanges: () => [],
    listSpaces: () => mockSpaces,
    savePageDraft: (pageId) => ({ status: "unchanged", pageTitle: mockPageTitle(pageId) }),
    searchPagesInSpace: (spaceKey, query, view = "current") => view === "archived" ? [] : searchMockPagesInSpace(spaceKey, query),
    searchSpaces: (query) => searchMockSpaces(query),
    stagePageCreate: () => {
      throw demoReadOnlyError()
    },
    stagePageDelete: () => {
      throw demoReadOnlyError()
    },
    stagePageBuffer: () => {
      throw demoReadOnlyError()
    },
    stagePageDraft: () => {
      throw demoReadOnlyError()
    },
    unstagePageDraft: () => "missing",
  }
}

export const createDevTuiSource = createMockTuiDataSource

function readMockEditableDraftInput(pageId: string): EditableDraftInput {
  const page = mockPages.find((candidate) => candidate.pageId === pageId)
  if (!page) throw new Error(`Unknown demo page: ${pageId}`)

  return {
    page,
    body: mockBodyArtifact(page),
    draft: null,
  }
}

function mockBodyArtifact(page: IndexedPage): PageBodyArtifact {
  return {
    pageId: page.pageId,
    remoteVersion: 1,
    sourceRepresentation: "storage",
    sourceBody: page.contentMarkdown,
    sourceHash: `mock:${page.pageId}`,
    canonicalDocument: {
      schemaVersion: 1,
      pageId: page.pageId,
      title: page.title,
      blocks: [],
    },
    sidecar: {
      schemaVersion: 1,
      remoteVersion: 1,
      sourceRepresentation: "storage",
      sourceHash: `mock:${page.pageId}`,
      nodes: {},
    },
    editableMarkdown: page.contentMarkdown,
    renderedMarkdown: page.contentMarkdown,
    updatedAt: page.updatedAt,
  }
}

function demoBlockedResult(pageId: string): ApplyPageDraftResult {
  return {
    status: "blocked",
    pageId,
    title: mockPageTitle(pageId),
    reason: "demo-mode",
    details: ["Demo mode is read-only and uses synthetic Confluence data only."],
  }
}

function mockPageTitle(pageId: string) {
  return mockPages.find((page) => page.pageId === pageId)?.title ?? pageId
}

function demoReadOnlyError() {
  return new Error("Demo mode is read-only and uses synthetic Confluence data only.")
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
  if (!isEditableRemotePage(input.page)) throw new Error(`${input.page.title} is ${remoteStatusLabel(input.page)} in Confluence and is read-only in lazyconfluence.`)
  return { kind: "update", page: input.page, markdown: input.draft?.draftMarkdown ?? input.body.editableMarkdown, draftStatus: input.draft?.status ?? null }
}

function listPagesWithCreates(repository: IndexRepository, spaceKey: string, view: PageViewMode = "current") {
  const pages = repository.listPagesInSpace(spaceKey, view)
  const virtualCreates = view === "current" ? repository.listPageCreates(spaceKey)
    .map((create) => virtualPageForCreate(repository, create))
    .filter((page): page is IndexedPage => page !== null) : []

  return [...pages, ...virtualCreates]
}

function listChildrenWithCreates(repository: IndexRepository, parentPageId: string, view: PageViewMode = "current") {
  const children = repository.getChildren(parentPageId, view)
  const virtualCreates = view === "current" ? repository.listPageCreates()
    .filter((create) => create.parentPageId === parentPageId)
    .map((create) => virtualPageForCreate(repository, create))
    .filter((page): page is IndexedPage => page !== null) : []

  return [...children, ...virtualCreates].sort(compareTreePages)
}

function listCreateChildren(repository: IndexRepository, parentCreateId: string) {
  return repository.listPageCreates()
    .filter((create) => create.parentCreateId === parentCreateId)
    .map((create) => virtualPageForCreate(repository, create))
    .filter((page): page is IndexedPage => page !== null)
    .sort(compareTreePages)
}

function searchPagesWithCreates(repository: IndexRepository, spaceKey: string, query: string, limit: number, view: PageViewMode = "current"): SearchResult[] {
  const byPageId = new Map<string, SearchResult>()

  for (const result of repository.searchPagesInSpace(spaceKey, query, limit, view)) {
    byPageId.set(result.page.pageId, result)
  }

  if (view !== "current") return [...byPageId.values()].sort(compareSearchResults).slice(0, limit)

  for (const create of repository.listPageCreates(spaceKey)) {
    const page = virtualPageForCreate(repository, create)
    if (!page) continue

    const result = scorePageSearchResult(page, query)
    if (!result) continue

    byPageId.set(page.pageId, { ...result, score: result.score + 5 })
  }

  return [...byPageId.values()].sort(compareSearchResults).slice(0, limit)
}

function createReaderPage(repository: IndexRepository, createId: string): ReaderPage | null {
  const create = repository.getPageCreate(createId)
  if (!create) return null

  const page = virtualPageForCreate(repository, create)
  if (!page) return null

  return {
    ...page,
    children: listCreateChildren(repository, createId),
    outgoingLinks: [],
    backlinks: [],
    outline: extractOutline(create.draftMarkdown),
  }
}

function virtualPageForCreate(repository: IndexRepository, create: PageCreate, seen = new Set<string>()): IndexedPage | null {
  if (seen.has(create.localId)) return null
  seen.add(create.localId)

  const parentPage = create.parentPageId ? repository.getPage(create.parentPageId) : null
  const parentCreate = create.parentCreateId ? repository.getPageCreate(create.parentCreateId) : null
  const parentCreatePage = parentCreate ? virtualPageForCreate(repository, parentCreate, seen) : null

  if (create.parentPageId && !parentPage) return null
  if (create.parentCreateId && !parentCreatePage) return null

  const parent = parentPage ?? parentCreatePage

  return {
    pageId: createChangeKey(create.localId),
    spaceKey: create.spaceKey,
    title: create.title,
    url: `local://page-create/${create.localId}`,
    parentId: create.parentCreateId ? createChangeKey(create.parentCreateId) : create.parentPageId,
    path: parent ? [...parent.path, create.title] : [create.title],
    owner: "local draft",
    updatedAt: create.updatedAt,
    contentMarkdown: create.draftMarkdown,
    snippet: extractSnippet(create.draftMarkdown, "New local page."),
    treeOrder: Number.MAX_SAFE_INTEGER,
    contentType: "page",
    remoteStatus: "current",
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
  const parentPage = create.parentPageId
    ? repository.getPage(create.parentPageId)
    : create.parentCreateId
      ? virtualPageForCreate(repository, repository.getPageCreate(create.parentCreateId) ?? create)
      : null

  if (create.parentPageId && !parentPage) return null
  if (create.parentCreateId && (!parentPage || parentPage.pageId === createChangeKey(create.localId))) return null

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

function deleteChangeFor(repository: IndexRepository, deletion: PageDelete): TuiDeleteChange | null {
  const page = repository.getPage(deletion.pageId)
  if (!page) return null

  const bodyMarkdown = repository.getPageBody(page.pageId)?.editableMarkdown ?? page.contentMarkdown

  return {
    kind: "delete",
    changeKey: deleteChangeKey(deletion.pageId),
    page,
    deletion,
    title: page.title,
    updatedAt: deletion.updatedAt,
    diffMarkdown: formatMarkdownDiff(bodyMarkdown, ""),
  }
}

function updateChangeKey(pageId: string) {
  return `update:${pageId}`
}

function createChangeKey(localId: string) {
  return `create:${localId}`
}

function deleteChangeKey(pageId: string) {
  return `delete:${pageId}`
}

function parseChangeKey(changeKey: string): { kind: "update" | "create" | "delete"; id: string } | null {
  const separator = changeKey.indexOf(":")
  if (separator < 0) return null

  const kind = changeKey.slice(0, separator)
  const id = changeKey.slice(separator + 1)
  if (!id || (kind !== "update" && kind !== "create" && kind !== "delete")) return null

  return { kind, id }
}

function orderChangeKeysForApply(repository: IndexRepository, changeKeys: string[]) {
  const selected = new Set(changeKeys)
  const ordered: string[] = []
  const visited = new Set<string>()

  const visit = (changeKey: string) => {
    if (visited.has(changeKey)) return
    visited.add(changeKey)

    const parsed = parseChangeKey(changeKey)
    if (parsed?.kind === "create") {
      const create = repository.getPageCreate(parsed.id)
      const parentKey = create?.parentCreateId ? createChangeKey(create.parentCreateId) : null
      if (parentKey && selected.has(parentKey)) visit(parentKey)
    }

    ordered.push(changeKey)
  }

  for (const changeKey of changeKeys) visit(changeKey)
  return ordered
}

function compareTreePages(left: IndexedPage, right: IndexedPage) {
  return (left.treeOrder ?? 0) - (right.treeOrder ?? 0) || left.title.localeCompare(right.title)
}

function isEditableRemotePage(page: IndexedPage) {
  return (page.remoteStatus ?? "current") === "current" && (page.contentType ?? "page") === "page"
}

function remoteStatusLabel(page: IndexedPage) {
  return page.remoteStatus ?? "current"
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
