import type { FetchLike, ConfluencePage, ConfluenceSpace } from "./confluence/client"
import { ConfluenceClient } from "./confluence/client"
import { mapConfluenceFolder, mapConfluencePage, mapConfluenceSpace } from "./confluence/mapper"
import { loadAtlassianAuth } from "./config"
import { openIndexRepository, type IndexRepository } from "./index/repository"
import type { IndexedPage, PageLink } from "./model"

export interface SyncConfluenceOptions {
  env?: NodeJS.ProcessEnv
  fetch?: FetchLike
  repository?: IndexRepository
  now?: () => Date
  pageLimit?: number
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
  failures: SyncFailure[]
  complete: boolean
}

export class SyncServiceError extends Error {}

export async function syncConfluence(options: SyncConfluenceOptions = {}): Promise<SyncReport> {
  const env = options.env ?? process.env
  const now = options.now ?? (() => new Date())
  const startedAt = now().toISOString()
  const auth = await loadAtlassianAuth(env)

  if (!auth) throw new SyncServiceError("No lazyconfluence config found. Run `bun run start init` first.")
  if (!auth.apiToken) throw new SyncServiceError(`Atlassian API token missing. Set ${auth.config.atlassian.apiTokenEnv} or run \`bun run start init\`.`)

  const repository = options.repository ?? openIndexRepository({ env })
  const shouldCloseRepository = !options.repository

  try {
    const client = new ConfluenceClient({
      siteUrl: auth.config.atlassian.siteUrl,
      email: auth.config.atlassian.email,
      apiToken: auth.apiToken,
      fetch: options.fetch,
    })
    const spaces = await client.resolveSpaces(auth.config.atlassian.spaceKeys)
    const report: SyncReport = {
      startedAt,
      completedAt: startedAt,
      databasePath: repository.path ?? null,
      spacesRequested: auth.config.atlassian.spaceKeys.length,
      spacesSynced: 0,
      pagesIndexed: 0,
      linksIndexed: 0,
      failures: [],
      complete: true,
    }

    for (const space of spaces) {
      try {
        const result = await syncSpace({ client, repository, space, baseUrl: client.baseUrl, syncedAt: startedAt, pageLimit: options.pageLimit })
        report.spacesSynced += 1
        report.pagesIndexed += result.pagesIndexed
        report.linksIndexed += result.linksIndexed
        report.failures.push(...result.failures)
      } catch (error) {
        report.failures.push({ scope: "space", key: space.key, message: errorMessage(error) })
      }
    }

    report.complete = report.failures.length === 0
    report.completedAt = now().toISOString()

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
}) {
  const listedPages = await input.client.fetchPagesBySpace(input.space.id, { bodyFormat: "storage", limit: input.pageLimit })
  const nodeById = new Map<string, ConfluencePage>()

  for (const page of listedPages) {
    if (page.id) nodeById.set(page.id, page)
  }

  for (const page of listedPages) {
    for (const child of await input.client.fetchDirectChildren(page.id)) {
      if (!child.id || nodeById.has(child.id)) continue
      nodeById.set(child.id, child.parentId ? child : { ...child, parentId: page.id })
    }
  }

  const pages: IndexedPage[] = []
  const links: PageLink[] = []
  const pageFailures: SyncFailure[] = []

  for (const page of nodeById.values()) {
    const ancestors = ancestorsFor(page, nodeById)

    if (page.type === "folder") {
      pages.push(mapConfluenceFolder({ page, space: input.space, baseUrl: input.baseUrl, ancestors }))
      continue
    }

    try {
      const pageWithBody = hasStorageBody(page) ? page : await input.client.fetchPageBody(page.id)
      const mapped = mapConfluencePage({ page: pageWithBody, space: input.space, baseUrl: input.baseUrl, ancestors })

      pages.push(mapped.indexedPage)
      links.push(...mapped.links)
    } catch (error) {
      pageFailures.push({ scope: "page", key: page.id || page.title, message: errorMessage(error) })
    }
  }

  input.repository.upsertSpace(mapConfluenceSpace(input.space, { lastSyncedAt: input.syncedAt, pageCount: pages.length }))
  input.repository.upsertPages(pages)
  input.repository.upsertLinks(links)

  return { pagesIndexed: pages.length, linksIndexed: links.length, failures: pageFailures }
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
