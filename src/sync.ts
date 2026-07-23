import { mkdir, writeFile } from "node:fs/promises"
import { dirname, extname, join } from "node:path"
import type { FetchLike, ConfluencePage, ConfluenceSpace } from "./confluence/client"
import { ConfluenceClient, ConfluenceClientError } from "./confluence/client"
import { mapConfluenceFolder, mapConfluencePage, mapConfluenceSpace } from "./confluence/mapper"
import { documentImages } from "./document/projection"
import type { ImageBlock } from "./document/model"
import { loadAtlassianAuth } from "./config"
import { openIndexRepository, type IndexRepository, type PageBodyArtifact } from "./index/repository"
import type { IndexedPage, MediaAsset, PageLink } from "./model"

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

  if (!auth) throw new SyncServiceError("No lazyconfluence config found. Run `lazyconfluence init` first.")
  if (!auth.apiToken) throw new SyncServiceError(`Atlassian API token missing. Set ${auth.config.atlassian.apiTokenEnv} or run \`lazyconfluence init\`.`)

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
  const [currentPages, archivedPages] = await Promise.all([
    input.client.fetchPagesBySpace(input.space.id, { bodyFormat: "storage", limit: input.pageLimit, status: "current" }),
    input.client.fetchPagesBySpace(input.space.id, { bodyFormat: "storage", limit: input.pageLimit, status: "archived" }),
  ])
  const listedPages = mergeConfluencePageList(currentPages, archivedPages)
  emitProgress(input.onProgress, { type: "fetched-space-pages", message: `Fetched ${listedPages.length} page${listedPages.length === 1 ? "" : "s"} for ${input.space.key}.`, spaceKey: input.space.key, spaceName: input.space.name, count: listedPages.length })
  const nodeById = new Map<string, ConfluencePage>()
  const treeOrderById = new Map<string, number>()
  const pageFailures: SyncFailure[] = []

  for (const [index, page] of listedPages.entries()) {
    if (page.id) nodeById.set(page.id, page)
    if (page.id) treeOrderById.set(page.id, pageTreeOrder(page, index))
  }

  await discoverPageChildren({ ...input, seedPages: listedPages, nodeById, treeOrderById, pageFailures })
  await backfillMissingParentPages({ ...input, nodeById, treeOrderById, pageFailures })

  const pages: IndexedPage[] = []
  const links: PageLink[] = []
  const bodyArtifacts: PageBodyArtifact[] = []
  const mediaAssets: MediaAsset[] = []

  for (const page of nodeById.values()) {
    const ancestors = ancestorsFor(page, nodeById)

    if (page.type === "folder") {
      pages.push(mapConfluenceFolder({ page, space: input.space, baseUrl: input.baseUrl, ancestors, syncedAt: input.syncedAt, treeOrder: treeOrderById.get(page.id) ?? 0 }))
      emitProgress(input.onProgress, { type: "indexed-page", message: `Indexed folder ${page.id}: ${page.title}.`, spaceKey: input.space.key, spaceName: input.space.name, pageId: page.id, title: page.title })
      continue
    }

    if (!canSyncPageBody(page)) {
      pages.push(mapUnavailableConfluencePage({ page, space: input.space, baseUrl: input.baseUrl, ancestors, syncedAt: input.syncedAt, treeOrder: treeOrderById.get(page.id) ?? 0 }, unsupportedConfluenceContentMessage(page), "lazyconfluence found this Confluence item, but does not sync this content type yet."))
      emitProgress(input.onProgress, { type: "indexed-page", message: `Indexed unsupported item ${page.id}: ${page.title}.`, spaceKey: input.space.key, spaceName: input.space.name, pageId: page.id, title: page.title })
      continue
    }

    try {
      if (!hasStorageBody(page)) emitProgress(input.onProgress, { type: "fetching-page-body", message: `Fetching body for ${page.id}: ${page.title}.`, spaceKey: input.space.key, spaceName: input.space.name, pageId: page.id, title: page.title })
      const pageWithBody = hasStorageBody(page) ? page : await input.client.fetchPageBody(page.id)
      const mapped = mapConfluencePage({ page: pageWithBody, space: input.space, baseUrl: input.baseUrl, ancestors, syncedAt: input.syncedAt, treeOrder: treeOrderById.get(page.id) ?? 0 })

      pages.push(mapped.indexedPage)
      links.push(...mapped.links)
      mediaAssets.push(...await cacheMediaAssetsForPage({ client: input.client, repository: input.repository, pageId: mapped.indexedPage.pageId, images: documentImages(mapped.document), syncedAt: input.syncedAt }))
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
      const message = errorMessage(error)
      pageFailures.push({ scope: "page", key: page.id || page.title, message })
      pages.push(mapUnavailableConfluencePage({ page, space: input.space, baseUrl: input.baseUrl, ancestors, syncedAt: input.syncedAt, treeOrder: treeOrderById.get(page.id) ?? 0 }, message))
      emitProgress(input.onProgress, { type: "failed-page", message: `Failed page ${page.id || page.title}: ${message}`, spaceKey: input.space.key, spaceName: input.space.name, pageId: page.id, title: page.title })
    }
  }

  emitProgress(input.onProgress, { type: "writing-space", message: `Writing ${pages.length} pages, ${links.length} links, and ${bodyArtifacts.length} body artifacts for ${input.space.key}.`, spaceKey: input.space.key, spaceName: input.space.name, count: pages.length })
  input.repository.upsertSpace(mapConfluenceSpace(input.space, { lastSyncedAt: input.syncedAt, pageCount: pages.length }))
  input.repository.upsertPages(pages)
  for (const body of bodyArtifacts) input.repository.deleteMediaAssetsFromPage(body.pageId)
  input.repository.upsertMediaAssets(mediaAssets)
  input.repository.upsertPageBodies(bodyArtifacts)
  input.repository.upsertLinks(links)
  if (canPruneSyncedSpace(pageFailures)) input.repository.prunePagesInSpace(input.space.key, new Set(pages.map((page) => page.pageId)))

  return { pagesIndexed: pages.length, linksIndexed: links.length, bodyArtifactsPersisted: bodyArtifacts.length, failures: pageFailures }
}

async function cacheMediaAssetsForPage(input: { client: ConfluenceClient; repository: IndexRepository; pageId: string; images: ImageBlock[]; syncedAt: string }): Promise<MediaAsset[]> {
  const assets: MediaAsset[] = []

  for (const image of input.images) {
    const sourceUrl = image.url ?? (image.filename ? input.client.attachmentImageUrl(input.pageId, image.filename) : null)
    let cachePath: string | null = null
    let contentType: string | null = null

    if (image.filename && input.repository.path && input.repository.path !== ":memory:") {
      try {
        const downloaded = await input.client.fetchAttachmentImage(input.pageId, image.filename)
        const targetPath = mediaCachePath(input.repository.path, input.pageId, image.nodeId, image.filename, downloaded.contentType)
        await mkdir(dirname(targetPath), { recursive: true, mode: 0o700 })
        await writeFile(targetPath, downloaded.bytes)
        cachePath = targetPath
        contentType = downloaded.contentType
      } catch {
        // Keep sync local tree/body successful; the TUI will show the image placeholder.
      }
    }

    assets.push({
      pageId: input.pageId,
      nodeId: image.nodeId,
      title: image.title,
      sourceUrl,
      cachePath,
      contentType,
      width: null,
      height: null,
      updatedAt: input.syncedAt,
    })
  }

  return assets
}

function mediaCachePath(databasePath: string, pageId: string, nodeId: string, filename: string, contentType: string | null) {
  const extension = mediaExtension(filename, contentType)
  return join(dirname(databasePath), "media", sanitizePathSegment(pageId), `${sanitizePathSegment(nodeId)}${extension}`)
}

function mediaExtension(filename: string, contentType: string | null) {
  const existing = extname(filename)
  if (existing) return existing.toLowerCase()
  if (contentType === "image/png") return ".png"
  if (contentType === "image/jpeg") return ".jpg"
  if (contentType === "image/gif") return ".gif"
  return ".img"
}

function sanitizePathSegment(value: string) {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "asset"
}

async function discoverPageChildren(input: {
  client: ConfluenceClient
  space: ConfluenceSpace
  spaceKey?: string
  seedPages: ConfluencePage[]
  nodeById: Map<string, ConfluencePage>
  treeOrderById: Map<string, number>
  pageFailures: SyncFailure[]
  onProgress?: (event: SyncProgressEvent) => void
}) {
  const queue = [...input.seedPages]
  const visited = new Set<string>()

  for (let index = 0; index < queue.length; index += 1) {
    const page = queue[index]
    if (!page.id || visited.has(page.id)) continue

    visited.add(page.id)
    if (!canFetchDirectChildren(page)) continue
    emitProgress(input.onProgress, { type: "fetching-page-children", message: `Fetching children for ${page.id}: ${page.title}.`, spaceKey: input.space.key, spaceName: input.space.name, pageId: page.id, title: page.title })

    let pageForChildren = page
    let children: ConfluencePage[]
    try {
      const result = await fetchDirectChildrenForNode(input.client, page)
      pageForChildren = result.page
      children = result.children
      if (pageForChildren !== page) input.nodeById.set(pageForChildren.id, pageForChildren)
    } catch (error) {
      const message = errorMessage(error)
      input.pageFailures.push({ scope: "page", key: page.id, message: `Could not fetch children: ${message}` })
      emitProgress(input.onProgress, { type: "failed-page", message: `Failed children for ${page.id}: ${message}`, spaceKey: input.space.key, spaceName: input.space.name, pageId: page.id, title: page.title })
      continue
    }

    for (const [childIndex, child] of children.entries()) {
      if (!child.id) continue

      const childWithParent = child.parentId ? child : { ...child, parentId: pageForChildren.id }
      const existing = input.nodeById.get(child.id)
      input.treeOrderById.set(child.id, pageTreeOrder(childWithParent, childIndex))

      if (existing) {
        input.nodeById.set(child.id, mergeConfluencePage(existing, childWithParent))
        continue
      }

      input.nodeById.set(child.id, childWithParent)
      queue.push(childWithParent)
    }
  }
}

async function fetchDirectChildrenForNode(client: ConfluenceClient, page: ConfluencePage) {
  try {
    return { page, children: await client.fetchDirectChildren(page.id, 250, confluenceContentType(page)) }
  } catch (error) {
    if (confluenceContentType(page) === "page" && isConfluenceNotFound(error)) {
      const folderPage = { ...page, type: "folder" }
      return { page: folderPage, children: await client.fetchDirectChildren(page.id, 250, "folder") }
    }

    throw error
  }
}

async function backfillMissingParentPages(input: {
  client: ConfluenceClient
  space: ConfluenceSpace
  nodeById: Map<string, ConfluencePage>
  treeOrderById: Map<string, number>
  pageFailures: SyncFailure[]
  onProgress?: (event: SyncProgressEvent) => void
}) {
  const failedParentIds = new Set<string>()

  while (true) {
    const missingParentIds = missingParentPageIds(input.nodeById, failedParentIds)
    if (!missingParentIds.length) return

    const backfilledParents: ConfluencePage[] = []

    for (const parentId of missingParentIds) {
      try {
        emitProgress(input.onProgress, { type: "fetching-page-body", message: `Fetching missing parent ${parentId}.`, spaceKey: input.space.key, spaceName: input.space.name, pageId: parentId })
        const parent = await input.client.fetchPageOrFolder(parentId)
        const existing = input.nodeById.get(parent.id)

        input.nodeById.set(parent.id, existing ? mergeConfluencePage(existing, parent) : parent)
        if (!input.treeOrderById.has(parent.id)) input.treeOrderById.set(parent.id, pageTreeOrder(parent, input.treeOrderById.size))
        backfilledParents.push(input.nodeById.get(parent.id) ?? parent)
      } catch (error) {
        const message = errorMessage(error)
        failedParentIds.add(parentId)
        input.pageFailures.push({ scope: "page", key: parentId, message: `Could not fetch missing parent: ${message}` })
        emitProgress(input.onProgress, { type: "failed-page", message: `Failed missing parent ${parentId}: ${message}`, spaceKey: input.space.key, spaceName: input.space.name, pageId: parentId })
      }
    }

    if (backfilledParents.length) {
      await discoverPageChildren({ ...input, seedPages: backfilledParents, pageFailures: input.pageFailures })
    }
  }
}

function missingParentPageIds(nodeById: Map<string, ConfluencePage>, failedParentIds: Set<string>) {
  const ids = new Set<string>()

  for (const page of nodeById.values()) {
    const parentId = page.parentId || null
    if (parentId && !nodeById.has(parentId) && !failedParentIds.has(parentId)) ids.add(parentId)
  }

  return [...ids]
}

function pageTreeOrder(page: ConfluencePage, fallback: number) {
  return Number.isFinite(page.position) ? Number(page.position) : fallback
}

function confluenceContentType(page: ConfluencePage): "page" | "folder" {
  return page.type === "folder" ? "folder" : "page"
}

function canFetchDirectChildren(page: ConfluencePage) {
  return page.type === "folder" || canSyncPageBody(page)
}

function canSyncPageBody(page: ConfluencePage) {
  return (!page.type || page.type === "page") && (!page.status || page.status === "current" || page.status === "archived")
}

function unsupportedConfluenceContentMessage(page: ConfluencePage) {
  if (page.type && page.type !== "page" && page.type !== "folder") return `Unsupported Confluence content type: ${page.type}`
  if (page.status && page.status !== "current") return `Unsupported Confluence page status: ${page.status}`

  return "Unsupported Confluence content."
}

function isConfluenceNotFound(error: unknown) {
  return error instanceof ConfluenceClientError && error.status === 404
}

function canPruneSyncedSpace(failures: SyncFailure[]) {
  return !failures.some((failure) => failure.message.startsWith("Could not fetch children") || failure.message.startsWith("Could not fetch missing parent"))
}

function mergeConfluencePageList(...lists: ConfluencePage[][]) {
  const byId = new Map<string, ConfluencePage>()

  for (const list of lists) {
    for (const page of list) {
      if (!page.id) continue
      const existing = byId.get(page.id)
      byId.set(page.id, existing ? mergeConfluencePage(existing, page) : page)
    }
  }

  return [...byId.values()]
}

function mergeConfluencePage(existing: ConfluencePage, incoming: ConfluencePage): ConfluencePage {
  return {
    ...incoming,
    ...existing,
    parentId: existing.parentId ?? incoming.parentId ?? null,
    body: existing.body ?? incoming.body,
    _links: existing._links ?? incoming._links,
    version: existing.version ?? incoming.version,
  }
}

function mapUnavailableConfluencePage(input: Parameters<typeof mapConfluenceFolder>[0], message: string, intro = "lazyconfluence found this page in Confluence, but could not fetch its body during the last sync."): IndexedPage {
  const page = mapConfluenceFolder(input)

  return {
    ...page,
    contentMarkdown: [
      `# ${page.title || page.pageId}`,
      "",
      intro,
      "",
      `Page ID: ${page.pageId}`,
      `Error: ${message}`,
      "",
      page.url ? `[Open in Confluence](${page.url})` : "",
    ].filter(Boolean).join("\n"),
    snippet: "Body unavailable from the last sync; page kept visible in the local tree.",
  }
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
