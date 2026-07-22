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

export class ConfluenceClientError extends Error {}

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

  async fetchPagesBySpace(spaceId: string, options: { bodyFormat?: "storage" | "atlas_doc_format"; limit?: number } = {}) {
    const params: QueryParams = {
      "space-id": [spaceId],
      limit: options.limit ?? 100,
    }
    if (options.bodyFormat) params["body-format"] = options.bodyFormat

    return this.paginatedResults<ConfluencePage>("/api/v2/pages", params)
  }

  async fetchPageBody(pageId: string, bodyFormat: "storage" | "atlas_doc_format" = "storage") {
    const payload = await this.requestJson(`/api/v2/pages/${encodeURIComponent(pageId)}`, { "body-format": bodyFormat })

    return pageFromPayload(payload)
  }

  async fetchDirectChildren(pageId: string, limit = 250) {
    return this.paginatedResults<ConfluencePage>(`/api/v2/pages/${encodeURIComponent(pageId)}/direct-children`, { limit })
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

  private async paginatedResults<T>(path: string, params: QueryParams): Promise<T[]> {
    const results: T[] = []
    let nextPath: string | null = path
    let nextParams: QueryParams = params

    while (nextPath) {
      const payload = await this.requestJson(nextPath, nextParams)
      results.push(...readResults(payload).map(pageFromPayload as (value: unknown) => T))
      nextPath = readNextPath(payload)
      nextParams = {}
    }

    return results
  }

  private async requestJson(pathOrUrl: string, params: QueryParams = {}, init: Omit<FetchInitLike, "signal"> = {}) {
    const url = confluenceApiUrl(this.baseUrl, pathOrUrl, params)
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

    if (!response.ok) throw new ConfluenceClientError(`Confluence returned HTTP ${response.status} ${response.statusText} for ${url}`)

    return response.json()
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
