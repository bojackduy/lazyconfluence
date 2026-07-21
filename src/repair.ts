import { mapConfluenceBody } from "./confluence/mapper"
import { loadAtlassianAuth } from "./config"
import { documentSnippet } from "./document/projection"
import { openIndexRepository, type IndexRepository, type PageBodyArtifact } from "./index/repository"

export interface RepairBodyArtifactsOptions {
  env?: NodeJS.ProcessEnv
  repository?: IndexRepository
  baseUrl?: string
  now?: () => Date
}

export interface RepairFailure {
  pageId: string
  message: string
}

export interface RepairBodyArtifactsReport {
  startedAt: string
  completedAt: string
  databasePath: string | null
  bodyArtifactsScanned: number
  bodyArtifactsRebuilt: number
  pagesUpdated: number
  linksIndexed: number
  failures: RepairFailure[]
  complete: boolean
}

export class RepairServiceError extends Error {}

export async function repairBodyArtifacts(options: RepairBodyArtifactsOptions = {}): Promise<RepairBodyArtifactsReport> {
  const env = options.env ?? process.env
  const now = options.now ?? (() => new Date())
  const startedAt = now().toISOString()
  const baseUrl = options.baseUrl ?? (await loadAtlassianAuth(env))?.config.atlassian.siteUrl

  if (!baseUrl) throw new RepairServiceError("No lazyconfluence config found. Run `bun run start init` first.")

  const repository = options.repository ?? openIndexRepository({ env })
  const shouldCloseRepository = !options.repository

  try {
    const bodyArtifacts = repository.listPageBodies()
    const report: RepairBodyArtifactsReport = {
      startedAt,
      completedAt: startedAt,
      databasePath: repository.path ?? null,
      bodyArtifactsScanned: bodyArtifacts.length,
      bodyArtifactsRebuilt: 0,
      pagesUpdated: 0,
      linksIndexed: 0,
      failures: [],
      complete: true,
    }

    for (const body of bodyArtifacts) {
      try {
        const page = repository.getPage(body.pageId)
        if (!page) {
          report.failures.push({ pageId: body.pageId, message: "Page row is missing for this body artifact." })
          continue
        }

        const rebuilt = rebuildBodyArtifact({ body, title: page.title, baseUrl, rebuiltAt: startedAt })
        repository.upsertPage({ ...page, contentMarkdown: rebuilt.artifact.renderedMarkdown, snippet: documentSnippet(rebuilt.artifact.canonicalDocument) })
        repository.upsertPageBody(rebuilt.artifact)
        repository.deleteLinksFromPage(body.pageId)
        report.linksIndexed += repository.upsertLinks(rebuilt.links)
        report.bodyArtifactsRebuilt += 1
        report.pagesUpdated += 1
      } catch (error) {
        report.failures.push({ pageId: body.pageId, message: errorMessage(error) })
      }
    }

    report.complete = report.failures.length === 0
    report.completedAt = now().toISOString()

    return report
  } finally {
    if (shouldCloseRepository) repository.close()
  }
}

export function formatRepairReport(report: RepairBodyArtifactsReport) {
  const lines = [
    `Repair ${report.complete ? "completed" : "completed with failures"}.`,
    `Body artifacts scanned: ${report.bodyArtifactsScanned}`,
    `Body artifacts rebuilt: ${report.bodyArtifactsRebuilt}`,
    `Pages updated: ${report.pagesUpdated}`,
    `Links indexed: ${report.linksIndexed}`,
  ]

  if (report.databasePath) lines.push(`Database: ${report.databasePath}`)
  for (const failure of report.failures) lines.push(`page ${failure.pageId}: ${failure.message}`)

  return lines.join("\n")
}

function rebuildBodyArtifact(input: { body: PageBodyArtifact; title: string; baseUrl: string; rebuiltAt: string }) {
  const mapped = mapConfluenceBody({
    pageId: input.body.pageId,
    title: input.title,
    baseUrl: input.baseUrl,
    remoteVersion: input.body.remoteVersion,
    sourceRepresentation: input.body.sourceRepresentation,
    sourceBody: input.body.sourceBody,
  })

  return {
    artifact: {
      ...input.body,
      sourceHash: mapped.sidecar.sourceHash,
      canonicalDocument: mapped.document,
      sidecar: mapped.sidecar,
      editableMarkdown: mapped.renderedMarkdown,
      renderedMarkdown: mapped.renderedMarkdown,
      updatedAt: input.rebuiltAt,
    },
    links: mapped.links,
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown repair error."
}
