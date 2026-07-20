export type SyncState = "fresh" | "stale" | "not-synced"

export interface SpaceSummary {
  key: string
  name: string
  lastSyncedAt: string | null
  pageCount: number
  syncState: SyncState
}

export interface IndexedPage {
  pageId: string
  spaceKey: string
  title: string
  url: string
  parentId: string | null
  path: string[]
  owner: string
  updatedAt: string
  contentMarkdown: string
  snippet: string
}

export type PageLinkKind = "internal" | "external"

export interface PageLink {
  fromPageId: string
  targetUrl: string
  targetPageId: string | null
  title: string
  kind: PageLinkKind
}

export interface ReaderPage extends IndexedPage {
  children: IndexedPage[]
  outgoingLinks: PageLink[]
  backlinks: PageLink[]
  outline: string[]
}

export interface SearchResult {
  page: IndexedPage
  score: number
  matchedIn: "title" | "path" | "snippet" | "content" | "all"
}

export interface SpaceSearchResult {
  space: SpaceSummary
  score: number
  matchedIn: "key" | "name" | "sync" | "all"
}

export type FocusPane = "navigator" | "document"
