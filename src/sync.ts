import type { FetchLike, ConfluencePage, ConfluenceSpace } from "./confluence/client"
import { ConfluenceClient } from "./confluence/client"
import { mapConfluenceFolder, mapConfluencePage, mapConfluenceSpace } from "./confluence/mapper"
import { loadAtlassianAuth } from "./config"
import { openIndexRepository, type IndexRepository, type PageBodyArtifact } from "./index/repository"
import type { IndexedPage, PageLink } from "./model"

export interface SyncConfluenceOptions {
  env?: NodeJS.ProcessEnv
  fetch?: FetchLike
  repository?: IndexRepository
  now?: () => Date
  pageLimit?: number
  spaceKeys?: string[]
  onProgress?: (event: SyncProgressEvent) => void
}

export type SyncProgressEventType =
  | "loading-config"
  | "opening-database"
  | "resolving-spaces"
  | "resolved-spaces"
  | "fetching-space-pages"
  | "fetched-space-pages"
  | "fetching-page-children"
  | "fetching-page-body"
  | "indexed-page"
  | "failed-page"
  | "writing-space"
  | "completed-space"
  | "failed-space"
  | "completed"

export interface SyncProgressEvent {
  type: SyncProgressEventType
  message: string
  spaceKey?: string
  spaceName?: string
  pageId?: string
  title?: string
  count?: number
  databasePath?: string | null
}

export interface SyncFailure {
  scope: "config" | "space" | "page"
  key: string
  message: string
}

export interface SyncReport {
  startedAt: string
  completedAt: string
  databasePath: string | null
  spacesRequested: number
  spacesSynced: number
  pagesIndexed: number
  linksIndexed: number
  bodyArtifactsPersisted: number
  failures: SyncFailure[]
  complete: boolean
}

export class SyncServiceError extends Error {}

export async function syncConfluence(options: SyncConfluenceOptions = {}): Promise<SyncReport> {
  const env = options.env ?? process.env
  const now = options.now ?? (() => new Date())
  const startedAt = now().toISOString()
  emitProgress(options.onProgress, { type: "loading-config", message: "Loading local config." })
  const auth = await loadAtlassianAuth(env)

  if (!auth) throw new SyncServiceError("No lazyconfluence config found. Run `bun run start init` first.")
  if (!auth.apiToken) throw new SyncServiceError(`Atlassian API token missing. Set ${auth.config.atlassian.apiTokenEnv} or run \`bun run start init\`.`)

  const repository = options.repository ?? openIndexRepository({ env })
  const shouldCloseRepository = !options.repository
  emitProgress(options.onProgress, { type: "opening-database", message: `Opening local database${repository.path ? `: ${repository.path}` : "."}`, databasePath: repository.path ?? null })

  try {
    const client = new ConfluenceClient({
      siteUrl: auth.config.atlassian.siteUrl,
      email: auth.config.atlassian.email,
      apiToken: auth.apiToken,
      fetch: options.fetch,
    })
    const requestedSpaceKeys = uniqueSpaceKeys(options.spaceKeys?.length ? options.spaceKeys : auth.config.atlassian.spaceKeys)
    emitProgress(options.onProgress, { type: "resolving-spaces", message: `Resolving spaces: ${requestedSpaceKeys.join(", ") || "none"}.`, count: requestedSpaceKeys.length })
    const spaces = await client.resolveSpaces(requestedSpaceKeys)
    emitProgress(options.onProgress, { type: "resolved-spaces", message: `Resolved ${spaces.length} space${spaces.length === 1 ? "" : "s"}.`, count: spaces.length })
    const report: SyncReport = {
      startedAt,
      completedAt: startedAt,
      databasePath: repository.path ?? null,
      spacesRequested: requestedSpaceKeys.length,
      spacesSynced: 0,
      pagesIndexed: 0,
      linksIndexed: 0,
      bodyArtifactsPersisted: 0,
      failures: [],
      complete: true,
    }

    for (const space of spaces) {
      try {
        const result = await syncSpace({ client, repository, space, baseUrl: client.baseUrl, syncedAt: startedAt, pageLimit: options.pageLimit, onProgress: options.onProgress })
        report.spacesSynced += 1
        report.pagesIndexed += result.pagesIndexed
        report.linksIndexed += result.linksIndexed
        report.bodyArtifactsPersisted += result.bodyArtifactsPersisted
        report.failures.push(...result.failures)
        emitProgress(options.onProgress, { type: "completed-space", message: `Completed space ${space.key}: ${result.pagesIndexed} pages, ${result.linksIndexed} links.`, spaceKey: space.key, spaceName: space.name, count: result.pagesIndexed })
      } catch (error) {
        report.failures.push({ scope: "space", key: space.key, message: errorMessage(error) })
        emitProgress(options.onProgress, { type: "failed-space", message: `Failed space ${space.key}: ${errorMessage(error)}`, spaceKey: space.key, spaceName: space.name })
      }
    }

    report.complete = report.failures.length === 0
    report.completedAt = now().toISOString()
    emitProgress(options.onProgress, { type: "completed", message: `Sync ${report.complete ? "completed" : "completed with failures"}.`, count: report.pagesIndexed })

    return report
  } finally {
    if (shouldCloseRepository) repository.close()
  }
}

export function formatSyncReport(report: SyncReport) {
  const lines = [
    `Sync ${report.complete ? "completed" : "completed with failures"}.`,
    `Spaces: ${report.spacesSynced}/${report.spacesRequested}`,
    `Pages indexed: ${report.pagesIndexed}`,
    `Links indexed: ${report.linksIndexed}`,
    `Body artifacts: ${report.bodyArtifactsPersisted}`,
  ]

  if (report.databasePath) lines.push(`Database: ${report.databasePath}`)
  for (const failure of report.failures) lines.push(`${failure.scope} ${failure.key}: ${failure.message}`)

  return lines.join("\n")
}

async function syncSpace(input: {
  client: ConfluenceClient
  repository: IndexRepository
  space: ConfluenceSpace
  baseUrl: string
  syncedAt: string
  pageLimit?: number
  onProgress?: (event: SyncProgressEvent) => void
}) {
  emitProgress(input.onProgress, { type: "fetching-space-pages", message: `Fetching pages for ${input.space.key}.`, spaceKey: input.space.key, spaceName: input.space.name })
  const listedPages = await input.client.fetchPagesBySpace(input.space.id, { bodyFormat: "storage", limit: input.pageLimit })
  emitProgress(input.onProgress, { type: "fetched-space-pages", message: `Fetched ${listedPages.length} page${listedPages.length === 1 ? "" : "s"} for ${input.space.key}.`, spaceKey: input.space.key, spaceName: input.space.name, count: listedPages.length })
  const nodeById = new Map<string, ConfluencePage>()

  for (const page of listedPages) {
    if (page.id) nodeById.set(page.id, page)
  }

  for (const page of listedPages) {
    emitProgress(input.onProgress, { type: "fetching-page-children", message: `Fetching children for ${page.id}: ${page.title}.`, spaceKey: input.space.key, spaceName: input.space.name, pageId: page.id, title: page.title })
    for (const child of await input.client.fetchDirectChildren(page.id)) {
      if (!child.id || nodeById.has(child.id)) continue
      nodeById.set(child.id, child.parentId ? child : { ...child, parentId: page.id })
    }
  }

  const pages: IndexedPage[] = []
  const links: PageLink[] = []
  const bodyArtifacts: PageBodyArtifact[] = []
  const pageFailures: SyncFailure[] = []

  for (const page of nodeById.values()) {
    const ancestors = ancestorsFor(page, nodeById)

    if (page.type === "folder") {
      pages.push(mapConfluenceFolder({ page, space: input.space, baseUrl: input.baseUrl, ancestors }))
      emitProgress(input.onProgress, { type: "indexed-page", message: `Indexed folder ${page.id}: ${page.title}.`, spaceKey: input.space.key, spaceName: input.space.name, pageId: page.id, title: page.title })
      continue
    }

    try {
      if (!hasStorageBody(page)) emitProgress(input.onProgress, { type: "fetching-page-body", message: `Fetching body for ${page.id}: ${page.title}.`, spaceKey: input.space.key, spaceName: input.space.name, pageId: page.id, title: page.title })
      const pageWithBody = hasStorageBody(page) ? page : await input.client.fetchPageBody(page.id)
      const mapped = mapConfluencePage({ page: pageWithBody, space: input.space, baseUrl: input.baseUrl, ancestors })

      pages.push(mapped.indexedPage)
      links.push(...mapped.links)
      bodyArtifacts.push({
        pageId: mapped.indexedPage.pageId,
        remoteVersion: mapped.remoteVersion,
        sourceRepresentation: mapped.sourceRepresentation,
        sourceBody: mapped.sourceBody,
        sourceHash: mapped.sidecar.sourceHash,
        canonicalDocument: mapped.document,
        sidecar: mapped.sidecar,
        editableMarkdown: mapped.renderedMarkdown,
        renderedMarkdown: mapped.renderedMarkdown,
        updatedAt: input.syncedAt,
      })
      emitProgress(input.onProgress, { type: "indexed-page", message: `Indexed page ${mapped.indexedPage.pageId}: ${mapped.indexedPage.title}.`, spaceKey: input.space.key, spaceName: input.space.name, pageId: mapped.indexedPage.pageId, title: mapped.indexedPage.title })
    } catch (error) {
      pageFailures.push({ scope: "page", key: page.id || page.title, message: errorMessage(error) })
      emitProgress(input.onProgress, { type: "failed-page", message: `Failed page ${page.id || page.title}: ${errorMessage(error)}`, spaceKey: input.space.key, spaceName: input.space.name, pageId: page.id, title: page.title })
    }
  }

  emitProgress(input.onProgress, { type: "writing-space", message: `Writing ${pages.length} pages, ${links.length} links, and ${bodyArtifacts.length} body artifacts for ${input.space.key}.`, spaceKey: input.space.key, spaceName: input.space.name, count: pages.length })
  input.repository.upsertSpace(mapConfluenceSpace(input.space, { lastSyncedAt: input.syncedAt, pageCount: pages.length }))
  input.repository.upsertPages(pages)
  input.repository.upsertPageBodies(bodyArtifacts)
  input.repository.upsertLinks(links)

  return { pagesIndexed: pages.length, linksIndexed: links.length, bodyArtifactsPersisted: bodyArtifacts.length, failures: pageFailures }
}

function ancestorsFor(page: ConfluencePage, nodeById: Map<string, ConfluencePage>) {
  const ancestors: Array<{ id: string; title: string }> = []
  const seen = new Set<string>()
  let parentId = page.parentId || null

  while (parentId && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = nodeById.get(parentId)
    if (!parent) break
    ancestors.unshift({ id: parent.id, title: parent.title })
    parentId = parent.parentId || null
  }

  return ancestors
}

function hasStorageBody(page: ConfluencePage) {
  return typeof page.body?.storage?.value === "string" || typeof page.body?.atlas_doc_format?.value === "string"
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown sync error."
}

function emitProgress(onProgress: SyncConfluenceOptions["onProgress"], event: SyncProgressEvent) {
  onProgress?.(event)
}

function uniqueSpaceKeys(spaceKeys: string[]) {
  const seen = new Set<string>()
  const result: string[] = []

  for (const key of spaceKeys) {
    const value = key.trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }

  return result
}
