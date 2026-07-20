import type { IndexedPage, SearchResult } from "../model"

export function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim()
}

export function ftsPrefixQuery(query: string) {
  const terms = normalizeSearchText(query).match(/[\p{L}\p{N}_]+/gu) ?? []

  return terms.map((term) => `${term}*`).join(" ")
}

export function scorePageSearchResult(page: IndexedPage, query: string): SearchResult | null {
  const normalizedQuery = normalizeSearchText(query)

  if (!normalizedQuery) return { page, score: 0, matchedIn: "all" }

  const title = normalizeSearchText(page.title)
  const path = normalizeSearchText(page.path.join(" / "))
  const snippet = normalizeSearchText(page.snippet)
  const content = normalizeSearchText(page.contentMarkdown)

  if (title === normalizedQuery) return { page, score: 100, matchedIn: "title" }
  if (title.startsWith(normalizedQuery)) return { page, score: 90, matchedIn: "title" }
  if (title.includes(normalizedQuery)) return { page, score: 80, matchedIn: "title" }
  if (path.includes(normalizedQuery)) return { page, score: 60, matchedIn: "path" }
  if (snippet.includes(normalizedQuery)) return { page, score: 40, matchedIn: "snippet" }
  if (content.includes(normalizedQuery)) return { page, score: 20, matchedIn: "content" }

  return null
}

export function compareSearchResults(a: SearchResult, b: SearchResult) {
  return b.score - a.score || b.page.updatedAt.localeCompare(a.page.updatedAt) || a.page.title.localeCompare(b.page.title)
}

export function pageUrlKey(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ""

  try {
    const url = new URL(trimmed)
    const path = safeDecode(url.pathname)
    const confluencePage = /\/(?:wiki\/)?spaces\/([^/]+)\/pages\/([^/]+)(?:\/|$)/i.exec(path)

    if (confluencePage) {
      return `${url.protocol}//${url.host.toLowerCase()}/spaces/${confluencePage[1]}/pages/${confluencePage[2]}`
    }

    url.hash = ""
    url.search = ""
    url.hostname = url.hostname.toLowerCase()

    return safeDecode(url.toString()).replace(/\/$/, "")
  } catch {
    return safeDecode(trimmed).replace(/[?#].*$/, "").replace(/\/$/, "")
  }
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
