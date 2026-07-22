import { ConfluenceClient, type FetchLike } from "./confluence/client"
import { mapConfluenceBody, mapConfluencePage } from "./confluence/mapper"
import { markdownToConfluenceStorage } from "./confluence/storage-writer"
import { loadAtlassianAuth } from "./config"
import { documentSnippet } from "./document/projection"
import { openIndexRepository, type IndexRepository, type PageBodyArtifact } from "./index/repository"

export interface ApplyPageDraftOptions {
  env?: NodeJS.ProcessEnv
  fetch?: FetchLike
  repository?: IndexRepository
  now?: () => Date
}

export type ApplyPageDraftResult =
  | {
      status: "applied"
      pageId: string
      title: string
      previousRemoteVersion: number
      remoteVersion: number
      message: string
    }
  | {
      status: "blocked"
      pageId: string
      title: string
      reason: string
      details: string[]
    }
  | {
      status: "conflict"
      pageId: string
      title: string
      localBaseVersion: number
      remoteVersion: number
      details: string[]
    }

export class ApplyPageDraftError extends Error {}

export async function applyPageDraftToConfluence(pageId: string, options: ApplyPageDraftOptions = {}): Promise<ApplyPageDraftResult> {
  const env = options.env ?? process.env
  const now = options.now ?? (() => new Date())
  const repository = options.repository ?? openIndexRepository({ env })
  const shouldCloseRepository = !options.repository

  try {
    const page = repository.getPage(pageId)
    if (!page) throw new ApplyPageDraftError(`Page not found in local index: ${pageId}`)

    const body = repository.getPageBody(pageId)
    if (!body) return blocked(pageId, page.title, "missing-body", [`No editable body artifact found for ${page.title} (${page.pageId}). Run sync first.`])

    const draft = repository.getPageDraft(pageId)
    if (!draft) return blocked(pageId, page.title, "missing-draft", [`No local draft found for ${page.title} (${page.pageId}).`])
    if (draft.draftMarkdown === body.editableMarkdown) return blocked(pageId, page.title, "no-changes", [`Draft for ${page.title} (${page.pageId}) matches the synced page.`])

    const unsafeReasons = unsafeBodyReasons(body)
    if (unsafeReasons.length) return blocked(pageId, page.title, "unsafe-source", unsafeReasons)

    const converted = markdownToConfluenceStorage(draft.draftMarkdown)
    if (converted.blockedReasons.length) return blocked(pageId, page.title, "unsafe-draft", converted.blockedReasons)

    const auth = await loadAtlassianAuth(env)
    if (!auth) return blocked(pageId, page.title, "missing-config", ["No lazyconfluence config found. Run init before applying drafts."])
    if (!auth.apiToken) return blocked(pageId, page.title, "missing-token", [`Atlassian API token missing. Set ${auth.config.atlassian.apiTokenEnv} or run init.`])

    const client = new ConfluenceClient({ siteUrl: auth.config.atlassian.siteUrl, email: auth.config.atlassian.email, apiToken: auth.apiToken, fetch: options.fetch })
    const remote = await client.fetchPageBody(pageId, "storage")
    const remoteVersion = Number(remote.version?.number ?? 0)
    const remoteSourceBody = remote.body?.storage?.value ?? ""
    const remoteMapped = mapConfluenceBody({
      pageId,
      title: remote.title || page.title,
      baseUrl: client.baseUrl,
      remoteVersion,
      sourceRepresentation: "storage",
      sourceBody: remoteSourceBody,
    })
    const conflictDetails = conflictReasons({ localBaseVersion: draft.baseRemoteVersion, localBaseHash: draft.baseSourceHash, remoteVersion, remoteHash: remoteMapped.sidecar.sourceHash })

    if (conflictDetails.length) {
      return {
        status: "conflict",
        pageId,
        title: page.title,
        localBaseVersion: draft.baseRemoteVersion,
        remoteVersion,
        details: conflictDetails,
      }
    }

    const targetVersion = remoteVersion + 1
    const updated = await client.updatePage({
      id: pageId,
      title: remote.title || page.title,
      storageValue: converted.storageHtml,
      versionNumber: targetVersion,
      message: "Updated from lazyconfluence",
    })
    const updatedVersion = Number(updated.version?.number ?? targetVersion)
    const updatedAt = now().toISOString()
    const updatedMapped = mapConfluenceBody({
      pageId,
      title: page.title,
      baseUrl: client.baseUrl,
      remoteVersion: updatedVersion,
      sourceRepresentation: "storage",
      sourceBody: converted.storageHtml,
    })

    repository.upsertPage({
      ...page,
      title: updated.title || page.title,
      contentMarkdown: updatedMapped.renderedMarkdown,
      snippet: documentSnippet(updatedMapped.document),
      updatedAt,
    })
    repository.upsertPageBody({
      pageId,
      remoteVersion: updatedVersion,
      sourceRepresentation: "storage",
      sourceBody: converted.storageHtml,
      sourceHash: updatedMapped.sidecar.sourceHash,
      canonicalDocument: updatedMapped.document,
      sidecar: updatedMapped.sidecar,
      editableMarkdown: updatedMapped.renderedMarkdown,
      renderedMarkdown: updatedMapped.renderedMarkdown,
      updatedAt,
    })
    repository.deleteLinksFromPage(pageId)
    repository.upsertLinks(updatedMapped.links)
    repository.deletePageDraft(pageId)

    return {
      status: "applied",
      pageId,
      title: updated.title || page.title,
      previousRemoteVersion: remoteVersion,
      remoteVersion: updatedVersion,
      message: `Applied draft to Confluence as version ${updatedVersion}.`,
    }
  } finally {
    if (shouldCloseRepository) repository.close()
  }
}

export async function applyPageCreateToConfluence(localId: string, options: ApplyPageDraftOptions = {}): Promise<ApplyPageDraftResult> {
  const env = options.env ?? process.env
  const now = options.now ?? (() => new Date())
  const repository = options.repository ?? openIndexRepository({ env })
  const shouldCloseRepository = !options.repository

  try {
    const create = repository.getPageCreate(localId)
    if (!create) return blocked(localId, "New page", "missing-create", [`No staged page create found for ${localId}.`])

    const parent = repository.getPage(create.parentPageId)
    if (!parent) return blocked(localId, create.title, "missing-parent", [`Parent page not found in local index: ${create.parentPageId}.`])

    const converted = markdownToConfluenceStorage(create.draftMarkdown)
    if (converted.blockedReasons.length) return blocked(localId, create.title, "unsafe-draft", converted.blockedReasons)

    const auth = await loadAtlassianAuth(env)
    if (!auth) return blocked(localId, create.title, "missing-config", ["No lazyconfluence config found. Run init before applying staged creates."])
    if (!auth.apiToken) return blocked(localId, create.title, "missing-token", [`Atlassian API token missing. Set ${auth.config.atlassian.apiTokenEnv} or run init.`])

    const client = new ConfluenceClient({ siteUrl: auth.config.atlassian.siteUrl, email: auth.config.atlassian.email, apiToken: auth.apiToken, fetch: options.fetch })
    const [space] = await client.resolveSpaces([create.spaceKey])
    const created = await client.createPage({
      spaceId: space.id,
      parentId: create.parentPageId,
      title: create.title,
      storageValue: converted.storageHtml,
    })
    const createdWithBody = await client.fetchPageBody(created.id, "storage")
    const updatedAt = now().toISOString()
    const mapped = mapConfluencePage({
      page: {
        ...createdWithBody,
        parentId: createdWithBody.parentId ?? create.parentPageId,
        spaceId: createdWithBody.spaceId ?? space.id,
      },
      space,
      baseUrl: client.baseUrl,
      ancestors: parent.path.map((title, index) => ({ id: index === parent.path.length - 1 ? parent.pageId : title, title })),
      syncedAt: updatedAt,
      treeOrder: repository.getChildren(create.parentPageId).length,
    })

    repository.upsertPage(mapped.indexedPage)
    repository.upsertPageBody({
      pageId: mapped.indexedPage.pageId,
      remoteVersion: mapped.remoteVersion,
      sourceRepresentation: mapped.sourceRepresentation,
      sourceBody: mapped.sourceBody,
      sourceHash: mapped.sidecar.sourceHash,
      canonicalDocument: mapped.document,
      sidecar: mapped.sidecar,
      editableMarkdown: mapped.renderedMarkdown,
      renderedMarkdown: mapped.renderedMarkdown,
      updatedAt,
    })
    repository.upsertLinks(mapped.links)
    repository.deletePageCreate(localId)

    return {
      status: "applied",
      pageId: mapped.indexedPage.pageId,
      title: mapped.indexedPage.title,
      previousRemoteVersion: 0,
      remoteVersion: mapped.remoteVersion,
      message: `Created Confluence page ${mapped.indexedPage.title}.`,
    }
  } finally {
    if (shouldCloseRepository) repository.close()
  }
}

function unsafeBodyReasons(body: PageBodyArtifact) {
  const reasons: string[] = []

  if (body.sourceRepresentation !== "storage") {
    reasons.push(`Only Confluence storage pages can be applied right now; this page uses ${body.sourceRepresentation}.`)
  }

  const unsafeNodes = Object.values(body.sidecar.nodes).filter((node) => node.roundTrip === "opaque" || node.roundTrip === "lossy")
  for (const node of unsafeNodes) {
    reasons.push(`Cannot safely preserve ${node.sourceType} (${node.roundTrip}) yet.`)
  }

  return reasons
}

function conflictReasons(input: { localBaseVersion: number; localBaseHash: string; remoteVersion: number; remoteHash: string }) {
  const reasons: string[] = []

  if (input.localBaseVersion !== input.remoteVersion) reasons.push(`Remote version is ${input.remoteVersion}, but the draft is based on version ${input.localBaseVersion}.`)
  if (input.localBaseHash !== input.remoteHash) reasons.push("Remote page body changed since this draft was created.")

  return reasons
}

function blocked(pageId: string, title: string, reason: string, details: string[]): ApplyPageDraftResult {
  return { status: "blocked", pageId, title, reason, details }
}
