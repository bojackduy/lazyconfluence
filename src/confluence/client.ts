export interface ConfluenceClientOptions {
  siteUrl: string
  email: string
  apiToken: string
  fetch?: FetchLike
  requestTimeoutMs?: number
}

export type FetchLike = (url: string, init?: FetchInitLike) => Promise<JsonResponseLike>

export interface FetchInitLike {
  method?: string
  headers?: Record<string, string>
  body?: string
  signal?: AbortSignal
}

export interface JsonResponseLike {
  ok: boolean
  status: number
  statusText: string
  json: () => Promise<unknown>
  arrayBuffer?: () => Promise<ArrayBuffer>
  headers?: { get: (name: string) => string | null } | Record<string, string | undefined>
}

export interface ConfluenceSpace {
  id: string
  key: string
  name: string
  homepageId?: string
}

export interface ConfluencePage {
  id: string
  title: string
  type?: string
  status?: string
  parentId?: string | null
  spaceId?: string
  ownerId?: string
  authorId?: string
  createdAt?: string
  updatedAt?: string
  modifiedAt?: string
  position?: number
  body?: {
    storage?: {
      value?: string
      representation?: string
    }
    atlas_doc_format?: {
      value?: string
      representation?: string
    }
  }
  version?: {
    number?: number
    createdAt?: string
  }
  _links?: {
    webui?: string
    base?: string
    next?: string
  }
}

export interface UpdateConfluencePageInput {
  id: string
  title: string
  storageValue: string
  versionNumber: number
  message?: string
}

export interface CreateConfluencePageInput {
  spaceId: string
  parentId?: string | null
  title: string
  storageValue: string
}

export interface ConfluenceBinaryAsset {
  url: string
  bytes: Uint8Array
  contentType: string | null
}

export interface ConfluenceAttachment {
  id: string
  title: string
  mediaType: string | null
  _links?: {
    download?: string
    webui?: string
  }
}

export class ConfluenceClientError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
  }
}

export class ConfluenceClient {
  readonly baseUrl: string
  private readonly headers: Record<string, string>
  private readonly fetchJson: FetchLike
  private readonly requestTimeoutMs: number

  constructor(options: ConfluenceClientOptions) {
    this.baseUrl = normalizeConfluenceBaseUrl(options.siteUrl)
    this.headers = buildConfluenceAuthHeaders(options.email, options.apiToken)
    this.fetchJson = options.fetch ?? fetch
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000
  }

  async resolveSpaces(spaceKeys: string[]) {
    const keys = dedupe(spaceKeys)
    if (!keys.length) return []

    const payload = await this.requestJson("/api/v2/spaces", { keys, limit: 250 })
    const spaces = readResults(payload).map(spaceFromPayload)
    const foundKeys = new Set(spaces.map((space) => space.key))
    const missingKeys = keys.filter((key) => !foundKeys.has(key))

    if (missingKeys.length) throw new ConfluenceClientError(`Confluence space key(s) not found: ${missingKeys.join(", ")}`)

    return spaces
  }

  async fetchPagesBySpace(spaceId: string, options: { bodyFormat?: "storage" | "atlas_doc_format"; limit?: number; status?: "current" | "archived" } = {}) {
    const params: QueryParams = {
      "space-id": [spaceId],
      limit: options.limit ?? 100,
    }
    if (options.bodyFormat) params["body-format"] = options.bodyFormat
    if (options.status) params.status = options.status

    return this.paginatedResults("/api/v2/pages", params, pageFromPayload)
  }

  async fetchPageBody(pageId: string, bodyFormat: "storage" | "atlas_doc_format" = "storage") {
    const payload = await this.requestJson(`/api/v2/pages/${encodeURIComponent(pageId)}`, { "body-format": bodyFormat })

    return pageFromPayload(payload)
  }

  async fetchFolder(folderId: string) {
    const payload = await this.requestJson(`/api/v2/folders/${encodeURIComponent(folderId)}`)

    return pageFromPayload(payload)
  }

  async fetchPageOrFolder(pageId: string, bodyFormat: "storage" | "atlas_doc_format" = "storage") {
    try {
      return await this.fetchPageBody(pageId, bodyFormat)
    } catch (error) {
      if (error instanceof ConfluenceClientError && error.status === 404) return this.fetchFolder(pageId)
      throw error
    }
  }

  async fetchDirectChildren(contentId: string, limit = 250, contentType: "page" | "folder" = "page") {
    const resource = contentType === "folder" ? "folders" : "pages"
    return this.paginatedResults(`/api/v2/${resource}/${encodeURIComponent(contentId)}/direct-children`, { limit }, pageFromPayload)
  }

  attachmentImageUrl(pageId: string, filename: string) {
    return confluenceApiUrl(this.baseUrl, `/download/attachments/${encodeURIComponent(pageId)}/${encodeURIComponent(filename)}`)
  }

  async fetchAttachmentImage(pageId: string, filename: string): Promise<ConfluenceBinaryAsset> {
    const attachment = await this.fetchAttachmentByFilename(pageId, filename)
    const downloadPath = attachment?._links?.download
    if (!downloadPath) throw new ConfluenceClientError(`Confluence attachment not found for page ${pageId}: ${filename}`)

    const url = confluenceApiUrl(this.baseUrl, downloadPath)
    const response = await this.request(url)
    if (!response.arrayBuffer) throw new ConfluenceClientError(`Confluence attachment response did not include binary data for ${url}`)

    return { url, bytes: new Uint8Array(await response.arrayBuffer()), contentType: readHeader(response, "content-type") ?? attachment.mediaType }
  }

  async updatePage(input: UpdateConfluencePageInput) {
    const payload = {
      id: input.id,
      status: "current",
      title: input.title,
      body: {
        representation: "storage",
        value: input.storageValue,
      },
      version: {
        number: input.versionNumber,
        message: input.message ?? "Updated from lazyconfluence",
      },
    }
    const response = await this.requestJson(`/api/v2/pages/${encodeURIComponent(input.id)}`, {}, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })

    return pageFromPayload(response)
  }

  async createPage(input: CreateConfluencePageInput) {
    const payload = {
      spaceId: input.spaceId,
      status: "current",
      title: input.title,
      body: {
        representation: "storage",
        value: input.storageValue,
      },
      ...(input.parentId ? { parentId: input.parentId } : {}),
    }
    const response = await this.requestJson("/api/v2/pages", {}, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })

    return pageFromPayload(response)
  }

  async deletePage(pageId: string) {
    await this.requestJson(`/api/v2/pages/${encodeURIComponent(pageId)}`, {}, { method: "DELETE" })
  }

  private async fetchAttachmentByFilename(pageId: string, filename: string) {
    const attachments = await this.paginatedResults(`/api/v2/pages/${encodeURIComponent(pageId)}/attachments`, { limit: 250 }, attachmentFromPayload)
    const normalizedFilename = normalizeAttachmentTitle(filename)

    return attachments.find((attachment) => normalizeAttachmentTitle(attachment.title) === normalizedFilename) ?? null
  }

  private async paginatedResults<T>(path: string, params: QueryParams, mapResult: (value: unknown) => T): Promise<T[]> {
    const results: T[] = []
    let nextPath: string | null = path
    let nextParams: QueryParams = params

    while (nextPath) {
      const payload = await this.requestJson(nextPath, nextParams)
      results.push(...readResults(payload).map(mapResult))
      nextPath = readNextPath(payload)
      nextParams = {}
    }

    return results
  }

  private async requestJson(pathOrUrl: string, params: QueryParams = {}, init: Omit<FetchInitLike, "signal"> = {}) {
    const url = confluenceApiUrl(this.baseUrl, pathOrUrl, params)
    const response = await this.request(url, init)

    if (response.status === 204) return {}

    return response.json()
  }

  private async request(url: string, init: Omit<FetchInitLike, "signal"> = {}) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs)

    let response: JsonResponseLike
    try {
      response = await this.fetchJson(url, { ...init, headers: { ...this.headers, ...init.headers }, signal: controller.signal })
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        throw new ConfluenceClientError(`Confluence request timed out after ${this.requestTimeoutMs}ms for ${url}`)
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }

    if (!response.ok) throw new ConfluenceClientError(`Confluence returned HTTP ${response.status} ${response.statusText} for ${url}`, response.status)

    return response
  }
}

type QueryParams = Record<string, string | number | boolean | Array<string | number | boolean>>

export function normalizeConfluenceBaseUrl(value: string) {
  const url = new URL(value.trim())
  if (url.protocol !== "https:") throw new Error("Confluence site URL must use https.")

  url.hash = ""
  url.search = ""
  url.pathname = url.pathname.replace(/\/+$/, "")

  if (!url.pathname || url.pathname === "/") url.pathname = "/wiki"
  if (url.pathname !== "/wiki") throw new Error("Confluence site URL must be the site root or /wiki root.")

  return url.toString().replace(/\/$/, "")
}

export function buildConfluenceAuthHeaders(email: string, apiToken: string) {
  const token = Buffer.from(`${email}:${apiToken}`, "utf8").toString("base64")

  return {
    Accept: "application/json",
    Authorization: `Basic ${token}`,
  }
}

export function absoluteConfluenceWebUrl(baseUrl: string, pathOrUrl: string) {
  if (!pathOrUrl) return normalizeConfluenceBaseUrl(baseUrl)

  try {
    return new URL(pathOrUrl).toString()
  } catch {
    const normalizedBase = normalizeConfluenceBaseUrl(baseUrl)
    const path = normalizedBase.endsWith("/wiki") && pathOrUrl.startsWith("/wiki/") ? pathOrUrl.slice("/wiki".length) : pathOrUrl

    return new URL(path.replace(/^\/+/, ""), `${normalizedBase}/`).toString()
  }
}

export function confluenceApiUrl(baseUrl: string, pathOrUrl: string, params: QueryParams = {}) {
  const normalizedBase = normalizeConfluenceBaseUrl(baseUrl)
  let url: URL

  try {
    url = new URL(pathOrUrl)
  } catch {
    const path = normalizedBase.endsWith("/wiki") && pathOrUrl.startsWith("/wiki/") ? pathOrUrl.slice("/wiki".length) : pathOrUrl
    url = new URL(path.replace(/^\/+/, ""), `${normalizedBase}/`)
  }

  for (const [key, value] of Object.entries(params)) {
    const values = Array.isArray(value) ? value : [value]
    for (const item of values) url.searchParams.append(key, String(item))
  }

  return url.toString()
}

function readResults(payload: unknown) {
  if (typeof payload !== "object" || payload === null || !("results" in payload) || !Array.isArray(payload.results)) return []

  return payload.results
}

function readNextPath(payload: unknown) {
  if (typeof payload !== "object" || payload === null || !("_links" in payload)) return null
  const links = payload._links
  if (typeof links !== "object" || links === null || !("next" in links)) return null
  const next = links.next

  return typeof next === "string" && next ? next : null
}

function readHeader(response: JsonResponseLike, name: string) {
  const headers = response.headers
  if (!headers) return null
  if (typeof headers.get === "function") return headers.get(name)

  const headerRecord = headers as Record<string, string | undefined>

  return headerRecord[name] ?? headerRecord[name.toLowerCase()] ?? null
}

function spaceFromPayload(value: unknown): ConfluenceSpace {
  const payload = asRecord(value)

  return {
    id: String(payload.id ?? ""),
    key: String(payload.key ?? ""),
    name: String(payload.name ?? payload.key ?? ""),
    homepageId: payload.homepageId === undefined || payload.homepageId === null ? undefined : String(payload.homepageId),
  }
}

function pageFromPayload(value: unknown): ConfluencePage {
  const payload = asRecord(value)

  return payload as unknown as ConfluencePage
}

function attachmentFromPayload(value: unknown): ConfluenceAttachment {
  const payload = asRecord(value)
  const links = asRecord(payload._links)

  return {
    id: String(payload.id ?? ""),
    title: String(payload.title ?? ""),
    mediaType: typeof payload.mediaType === "string" ? payload.mediaType : null,
    _links: {
      download: typeof links.download === "string" ? links.download : undefined,
      webui: typeof links.webui === "string" ? links.webui : undefined,
    },
  }
}

function normalizeAttachmentTitle(value: string) {
  return value.trim().normalize("NFC")
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError"
}

function dedupe(values: string[]) {
  const seen = new Set<string>()
  const result: string[] = []

  for (const value of values) {
    const key = value.trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(key)
  }

  return result
}
