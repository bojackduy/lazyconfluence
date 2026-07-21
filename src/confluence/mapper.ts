import type { IndexedPage, PageLink, SpaceSummary } from "../model"
import type { CanonicalDocument, MappingSidecar, SourceRepresentation } from "../document/model"
import { documentLinks, documentSnippet, renderDocumentMarkdown } from "../document/projection"
import { pageUrlKey } from "../index/search"
import { absoluteConfluenceWebUrl, normalizeConfluenceBaseUrl, type ConfluencePage, type ConfluenceSpace } from "./client"
import { parseConfluenceStorage } from "./html"

export interface ConfluencePageMappingInput {
  page: ConfluencePage
  space: ConfluenceSpace
  baseUrl: string
  ancestors?: Array<{ id: string; title: string }>
  syncedAt?: string
}

export interface MappedConfluencePage {
  document: CanonicalDocument
  sidecar: MappingSidecar
  indexedPage: IndexedPage
  links: PageLink[]
  remoteVersion: number
  sourceRepresentation: SourceRepresentation
  sourceBody: string
  renderedMarkdown: string
}

export function mapConfluenceSpace(space: ConfluenceSpace, options: { lastSyncedAt?: string | null; pageCount?: number } = {}): SpaceSummary {
  return {
    key: space.key,
    name: space.name,
    lastSyncedAt: options.lastSyncedAt ?? null,
    pageCount: options.pageCount ?? 0,
    syncState: options.lastSyncedAt ? "fresh" : "not-synced",
  }
}

export function mapConfluencePage(input: ConfluencePageMappingInput): MappedConfluencePage {
  const body = readPageBody(input.page)
  const remoteVersion = Number(input.page.version?.number ?? 0)
  const { document, sidecar } = parseConfluenceStorage({
    pageId: input.page.id,
    title: input.page.title,
    storageHtml: body.value,
    baseUrl: input.baseUrl,
    remoteVersion,
    sourceRepresentation: body.representation,
  })
  const renderedMarkdown = renderDocumentMarkdown(document)
  const indexedPage: IndexedPage = {
    pageId: input.page.id,
    spaceKey: input.space.key,
    title: input.page.title,
    url: pageWebUrl(input.baseUrl, input.page, input.space),
    parentId: input.page.parentId ?? null,
    path: [...(input.ancestors?.map((ancestor) => ancestor.title) ?? []), input.page.title],
    owner: input.page.ownerId || input.page.authorId || "",
    updatedAt: pageUpdatedAt(input.page, input.syncedAt),
    contentMarkdown: renderedMarkdown,
    snippet: documentSnippet(document),
  }

  return {
    document,
    sidecar,
    indexedPage,
    links: documentLinks(document).map((link): PageLink => ({
      fromPageId: input.page.id,
      targetUrl: link.href,
      targetPageId: null,
      title: link.text || link.href,
      kind: isConfluencePageUrl(link.href) ? "internal" : "external",
    })),
    remoteVersion,
    sourceRepresentation: body.representation,
    sourceBody: body.value,
    renderedMarkdown,
  }
}

export function mapConfluenceFolder(input: ConfluencePageMappingInput): IndexedPage {
  return {
    pageId: input.page.id,
    spaceKey: input.space.key,
    title: input.page.title,
    url: pageWebUrl(input.baseUrl, input.page, input.space),
    parentId: input.page.parentId ?? null,
    path: [...(input.ancestors?.map((ancestor) => ancestor.title) ?? []), input.page.title],
    owner: input.page.ownerId || input.page.authorId || "",
    updatedAt: pageUpdatedAt(input.page, input.syncedAt),
    contentMarkdown: "",
    snippet: "",
  }
}

function pageUpdatedAt(page: ConfluencePage, fallback?: string) {
  return firstValidDate([page.version?.createdAt, page.updatedAt, page.modifiedAt, page.createdAt, fallback]) ?? ""
}

function firstValidDate(values: Array<string | undefined>) {
  return values.find((value) => typeof value === "string" && value.trim() && Number.isFinite(Date.parse(value)))
}

function readPageBody(page: ConfluencePage): { representation: SourceRepresentation; value: string } {
  const storage = page.body?.storage?.value
  if (typeof storage === "string") return { representation: "storage", value: storage }

  const adf = page.body?.atlas_doc_format?.value
  if (typeof adf === "string") return { representation: "atlas_doc_format", value: adf }

  return { representation: "storage", value: "" }
}

function pageWebUrl(baseUrl: string, page: ConfluencePage, space: ConfluenceSpace) {
  if (page._links?.webui) return absoluteConfluenceWebUrl(baseUrl, page._links.webui)

  return absoluteConfluenceWebUrl(normalizeConfluenceBaseUrl(baseUrl), `/spaces/${space.key}/pages/${page.id}`)
}

function isConfluencePageUrl(url: string) {
  return pageUrlKey(url).includes("/spaces/") && pageUrlKey(url).includes("/pages/")
}
