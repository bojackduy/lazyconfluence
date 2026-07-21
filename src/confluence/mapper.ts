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
  treeOrder?: number
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

export interface MappedConfluenceBody {
  document: CanonicalDocument
  sidecar: MappingSidecar
  links: PageLink[]
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
  const mappedBody = mapConfluenceBody({
    pageId: input.page.id,
    title: input.page.title,
    baseUrl: input.baseUrl,
    remoteVersion,
    sourceRepresentation: body.representation,
    sourceBody: body.value,
  })
  const indexedPage: IndexedPage = {
    pageId: input.page.id,
    spaceKey: input.space.key,
    title: input.page.title,
    url: pageWebUrl(input.baseUrl, input.page, input.space),
    parentId: input.page.parentId ?? null,
    path: [...(input.ancestors?.map((ancestor) => ancestor.title) ?? []), input.page.title],
    owner: input.page.ownerId || input.page.authorId || "",
    updatedAt: pageUpdatedAt(input.page, input.syncedAt),
    contentMarkdown: mappedBody.renderedMarkdown,
    snippet: documentSnippet(mappedBody.document),
    treeOrder: pageTreeOrder(input.page, input.treeOrder),
  }

  return {
    document: mappedBody.document,
    sidecar: mappedBody.sidecar,
    indexedPage,
    links: mappedBody.links,
    remoteVersion,
    sourceRepresentation: body.representation,
    sourceBody: body.value,
    renderedMarkdown: mappedBody.renderedMarkdown,
  }
}

export function mapConfluenceBody(input: {
  pageId: string
  title: string
  baseUrl: string
  remoteVersion: number
  sourceRepresentation: SourceRepresentation
  sourceBody: string
}): MappedConfluenceBody {
  const { document, sidecar } = parseConfluenceStorage({
    pageId: input.pageId,
    title: input.title,
    storageHtml: input.sourceBody,
    baseUrl: input.baseUrl,
    remoteVersion: input.remoteVersion,
    sourceRepresentation: input.sourceRepresentation,
  })
  const renderedMarkdown = renderDocumentMarkdown(document)

  return {
    document,
    sidecar,
    links: linksFromDocument(input.pageId, document),
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
    treeOrder: pageTreeOrder(input.page, input.treeOrder),
  }
}

function pageTreeOrder(page: ConfluencePage, fallback = 0) {
  return Number.isFinite(page.position) ? Number(page.position) : fallback
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

function linksFromDocument(pageId: string, document: CanonicalDocument) {
  return documentLinks(document).map((link): PageLink => ({
    fromPageId: pageId,
    targetUrl: link.href,
    targetPageId: null,
    title: link.text || link.href,
    kind: isConfluencePageUrl(link.href) ? "internal" : "external",
  }))
}

function isConfluencePageUrl(url: string) {
  return pageUrlKey(url).includes("/spaces/") && pageUrlKey(url).includes("/pages/")
}
