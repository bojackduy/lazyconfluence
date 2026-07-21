import type { Database } from "bun:sqlite"
import type { CanonicalDocument, MappingSidecar, SourceRepresentation } from "../document/model"
import type { IndexedPage, PageLink, PageLinkKind, SearchResult, SpaceSummary, SyncState } from "../model"
import { openIndexDatabase, type IndexDatabase, type OpenIndexDatabaseOptions } from "./db"
import { compareSearchResults, ftsPrefixQuery, normalizeSearchText, pageUrlKey, scorePageSearchResult } from "./search"

interface PageRow {
  page_id: string
  space_key: string
  title: string
  url: string
  parent_id: string | null
  path_json: string
  owner: string
  updated_at: string
  content_markdown: string
  snippet: string
}

interface LinkRow {
  from_page_id: string
  target_url: string
  target_page_id: string | null
  title: string
  kind: PageLinkKind
}

interface SpaceRow {
  key: string
  name: string
  last_synced_at: string | null
  sync_state: SyncState
  page_count: number
}

interface PageBodyRow {
  page_id: string
  remote_version: number
  source_representation: SourceRepresentation
  source_body: string
  source_hash: string
  canonical_json: string
  sidecar_json: string
  editable_markdown: string
  rendered_markdown: string
  updated_at: string
}

export interface PageBodyArtifact {
  pageId: string
  remoteVersion: number
  sourceRepresentation: SourceRepresentation
  sourceBody: string
  sourceHash: string
  canonicalDocument: CanonicalDocument
  sidecar: MappingSidecar
  editableMarkdown: string
  renderedMarkdown: string
  updatedAt: string
}

export interface IndexRepositoryStats {
  schemaVersion: number
  spaceCount: number
  pageCount: number
  linkCount: number
  bodyArtifactCount: number
}

export class IndexRepository {
  constructor(
    private readonly database: Database,
    private readonly closeDatabase?: () => void,
    readonly path?: string,
  ) {}

  close() {
    if (this.closeDatabase) {
      this.closeDatabase()
      return
    }

    this.database.close()
  }

  upsertSpace(space: SpaceSummary) {
    return this.upsertSpaces([space])
  }

  upsertSpaces(spaces: SpaceSummary[]) {
    const statement = this.database.query(`
      INSERT INTO spaces (key, name, last_synced_at, sync_state)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        name = excluded.name,
        last_synced_at = excluded.last_synced_at,
        sync_state = excluded.sync_state
    `)

    for (const space of spaces) {
      statement.run(space.key, space.name, space.lastSyncedAt, space.syncState)
    }

    return spaces.length
  }

  upsertPage(page: IndexedPage) {
    return this.upsertPages([page])
  }

  upsertPages(pages: IndexedPage[]) {
    if (!pages.length) return 0

    return this.transaction(() => {
      const pageStatement = this.database.query(`
        INSERT INTO pages (
          page_id, space_key, title, url, url_key, parent_id, path_json, path_text,
          owner, updated_at, content_markdown, snippet, indexed_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(page_id) DO UPDATE SET
          space_key = excluded.space_key,
          title = excluded.title,
          url = excluded.url,
          url_key = excluded.url_key,
          parent_id = excluded.parent_id,
          path_json = excluded.path_json,
          path_text = excluded.path_text,
          owner = excluded.owner,
          updated_at = excluded.updated_at,
          content_markdown = excluded.content_markdown,
          snippet = excluded.snippet,
          indexed_at = CURRENT_TIMESTAMP
      `)
      const deleteFtsStatement = this.database.query("DELETE FROM page_fts WHERE page_id = ?")
      const insertFtsStatement = this.database.query("INSERT INTO page_fts (title, path, snippet, content, page_id) VALUES (?, ?, ?, ?, ?)")

      for (const page of pages) {
        const pathText = page.path.join(" / ")

        pageStatement.run(
          page.pageId,
          page.spaceKey,
          page.title,
          page.url,
          pageUrlKey(page.url),
          page.parentId,
          JSON.stringify(page.path),
          pathText,
          page.owner,
          page.updatedAt,
          page.contentMarkdown,
          page.snippet,
        )
        deleteFtsStatement.run(page.pageId)
        insertFtsStatement.run(page.title, pathText, page.snippet, page.contentMarkdown, page.pageId)
      }

      this.reconcileInternalLinks()

      return pages.length
    })
  }

  upsertLink(link: PageLink) {
    return this.upsertLinks([link])
  }

  upsertLinks(links: PageLink[]) {
    if (!links.length) return 0

    return this.transaction(() => {
      const statement = this.database.query(`
        INSERT INTO links (from_page_id, target_url, target_url_key, target_page_id, title, kind)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(from_page_id, target_url) DO UPDATE SET
          target_url_key = excluded.target_url_key,
          target_page_id = excluded.target_page_id,
          title = excluded.title,
          kind = excluded.kind
      `)

      for (const link of links) {
        const targetPageId = this.resolveTargetPageId(link)

        statement.run(
          link.fromPageId,
          link.targetUrl,
          pageUrlKey(link.targetUrl),
          targetPageId,
          link.title,
          targetPageId ? "internal" : link.kind,
        )
      }

      this.reconcileInternalLinks()

      return links.length
    })
  }

  upsertPageBody(body: PageBodyArtifact) {
    return this.upsertPageBodies([body])
  }

  upsertPageBodies(bodies: PageBodyArtifact[]) {
    if (!bodies.length) return 0

    const statement = this.database.query(`
      INSERT INTO page_bodies (
        page_id, remote_version, source_representation, source_body, source_hash,
        canonical_json, sidecar_json, editable_markdown, rendered_markdown, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(page_id) DO UPDATE SET
        remote_version = excluded.remote_version,
        source_representation = excluded.source_representation,
        source_body = excluded.source_body,
        source_hash = excluded.source_hash,
        canonical_json = excluded.canonical_json,
        sidecar_json = excluded.sidecar_json,
        editable_markdown = excluded.editable_markdown,
        rendered_markdown = excluded.rendered_markdown,
        updated_at = excluded.updated_at
    `)

    for (const body of bodies) {
      statement.run(
        body.pageId,
        body.remoteVersion,
        body.sourceRepresentation,
        body.sourceBody,
        body.sourceHash,
        JSON.stringify(body.canonicalDocument),
        JSON.stringify(body.sidecar),
        body.editableMarkdown,
        body.renderedMarkdown,
        body.updatedAt,
      )
    }

    return bodies.length
  }

  getSpace(key: string): SpaceSummary | null {
    const row = this.database.query(`
      SELECT spaces.key,
             spaces.name,
             spaces.last_synced_at,
             spaces.sync_state,
             COUNT(pages.page_id) AS page_count
      FROM spaces
      LEFT JOIN pages ON pages.space_key = spaces.key
      WHERE spaces.key = ?
      GROUP BY spaces.key, spaces.name, spaces.last_synced_at, spaces.sync_state
    `).get(key) as SpaceRow | null

    return row ? spaceFromRow(row) : null
  }

  listSpaces(): SpaceSummary[] {
    const rows = this.database.query(`
      SELECT spaces.key,
             spaces.name,
             spaces.last_synced_at,
             spaces.sync_state,
             COUNT(pages.page_id) AS page_count
      FROM spaces
      LEFT JOIN pages ON pages.space_key = spaces.key
      GROUP BY spaces.key, spaces.name, spaces.last_synced_at, spaces.sync_state
      ORDER BY spaces.key COLLATE NOCASE
    `).all() as SpaceRow[]

    return rows.map(spaceFromRow)
  }

  getPage(pageId: string): IndexedPage | null {
    const row = this.database.query("SELECT * FROM pages WHERE page_id = ?").get(pageId) as PageRow | null

    return row ? pageFromRow(row) : null
  }

  listPagesInSpace(spaceKey: string): IndexedPage[] {
    const rows = this.database.query(`
      SELECT *
      FROM pages
      WHERE space_key = ?
      ORDER BY path_text COLLATE NOCASE, title COLLATE NOCASE
    `).all(spaceKey) as PageRow[]

    return rows.map(pageFromRow)
  }

  getStats(): IndexRepositoryStats {
    return {
      schemaVersion: this.readUserVersion(),
      spaceCount: this.countRows("spaces"),
      pageCount: this.countRows("pages"),
      linkCount: this.countRows("links"),
      bodyArtifactCount: this.countRows("page_bodies"),
    }
  }

  getPageBody(pageId: string): PageBodyArtifact | null {
    const row = this.database.query("SELECT * FROM page_bodies WHERE page_id = ?").get(pageId) as PageBodyRow | null

    return row ? pageBodyFromRow(row) : null
  }

  getChildren(parentPageId: string): IndexedPage[] {
    const rows = this.database.query(`
      SELECT *
      FROM pages
      WHERE parent_id = ?
      ORDER BY path_text COLLATE NOCASE, title COLLATE NOCASE
    `).all(parentPageId) as PageRow[]

    return rows.map(pageFromRow)
  }

  getOutgoingLinks(pageId: string): PageLink[] {
    const rows = this.database.query(`
      SELECT from_page_id, target_url, target_page_id, title, kind
      FROM links
      WHERE from_page_id = ?
      ORDER BY title COLLATE NOCASE, target_url COLLATE NOCASE
    `).all(pageId) as LinkRow[]

    return rows.map(linkFromRow)
  }

  getIncomingLinks(pageId: string): PageLink[] {
    const page = this.getPage(pageId)
    if (!page) return []

    const rows = this.database.query(`
      SELECT from_page_id, target_url, target_page_id, title, kind
      FROM links
      WHERE target_page_id = ? OR target_url_key = ?
      ORDER BY title COLLATE NOCASE, from_page_id COLLATE NOCASE
    `).all(pageId, pageUrlKey(page.url)) as LinkRow[]

    return rows.map(linkFromRow)
  }

  matchPageUrl(url: string): IndexedPage | null {
    const row = this.database.query("SELECT * FROM pages WHERE url_key = ?").get(pageUrlKey(url)) as PageRow | null

    return row ? pageFromRow(row) : null
  }

  searchPagesInSpace(spaceKey: string, query: string, limit = 20): SearchResult[] {
    return this.searchPages(query, { limit, spaceKey })
  }

  searchPagesAcrossSpaces(query: string, limit = 20): SearchResult[] {
    return this.searchPages(query, { limit })
  }

  private searchPages(query: string, options: { limit: number; spaceKey?: string }): SearchResult[] {
    const normalizedQuery = normalizeSearchText(query)

    if (!normalizedQuery) {
      const pages = this.selectPagesForEmptySearch(options)

      return pages.map((page, index) => ({ page, score: pages.length - index, matchedIn: "all" }))
    }

    const ftsQuery = ftsPrefixQuery(query)
    if (!ftsQuery) return []

    const filters = ["page_fts MATCH ?"]
    const params: Array<string | number | boolean | null> = [ftsQuery]

    if (options.spaceKey) {
      filters.push("pages.space_key = ?")
      params.push(options.spaceKey)
    }

    const rows = this.database.query(`
      SELECT pages.*
      FROM page_fts
      JOIN pages ON pages.page_id = page_fts.page_id
      WHERE ${filters.join(" AND ")}
      ORDER BY bm25(page_fts), pages.updated_at DESC, pages.title COLLATE NOCASE
      LIMIT ?
    `).all(...params, options.limit) as PageRow[]

    return rows
      .map((row) => pageFromRow(row))
      .map((page): SearchResult => scorePageSearchResult(page, query) ?? { page, score: 1, matchedIn: "content" })
      .sort(compareSearchResults)
  }

  private selectPagesForEmptySearch(options: { limit: number; spaceKey?: string }) {
    if (options.spaceKey) {
      const rows = this.database.query(`
        SELECT *
        FROM pages
        WHERE space_key = ?
        ORDER BY path_text COLLATE NOCASE, title COLLATE NOCASE
        LIMIT ?
      `).all(options.spaceKey, options.limit) as PageRow[]

      return rows.map(pageFromRow)
    }

    const rows = this.database.query(`
      SELECT *
      FROM pages
      ORDER BY space_key COLLATE NOCASE, path_text COLLATE NOCASE, title COLLATE NOCASE
      LIMIT ?
    `).all(options.limit) as PageRow[]

    return rows.map(pageFromRow)
  }

  private resolveTargetPageId(link: PageLink) {
    if (link.targetPageId && this.getPage(link.targetPageId)) return link.targetPageId

    return this.matchPageUrl(link.targetUrl)?.pageId ?? null
  }

  private reconcileInternalLinks() {
    this.database.run(`
      UPDATE links
      SET target_page_id = (
            SELECT pages.page_id
            FROM pages
            WHERE pages.url_key = links.target_url_key
          ),
          kind = 'internal'
      WHERE EXISTS (
        SELECT 1
        FROM pages
        WHERE pages.url_key = links.target_url_key
      )
    `)
  }

  private transaction<T>(callback: () => T): T {
    this.database.run("BEGIN IMMEDIATE")

    try {
      const result = callback()
      this.database.run("COMMIT")

      return result
    } catch (error) {
      this.database.run("ROLLBACK")
      throw error
    }
  }

  private readUserVersion() {
    const row = this.database.query("PRAGMA user_version").get() as { user_version: number } | null

    return Number(row?.user_version ?? 0)
  }

  private countRows(table: "spaces" | "pages" | "links" | "page_bodies") {
    const row = this.database.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number } | null

    return Number(row?.count ?? 0)
  }
}

export function openIndexRepository(input: string | OpenIndexDatabaseOptions = {}) {
  const handle: IndexDatabase = openIndexDatabase(input)

  return new IndexRepository(handle.database, () => handle.close(), handle.path)
}

function pageFromRow(row: PageRow): IndexedPage {
  return {
    pageId: String(row.page_id),
    spaceKey: String(row.space_key),
    title: String(row.title),
    url: String(row.url),
    parentId: row.parent_id === null ? null : String(row.parent_id),
    path: parsePath(row.path_json, row.title),
    owner: String(row.owner),
    updatedAt: String(row.updated_at),
    contentMarkdown: String(row.content_markdown),
    snippet: String(row.snippet),
  }
}

function linkFromRow(row: LinkRow): PageLink {
  return {
    fromPageId: String(row.from_page_id),
    targetUrl: String(row.target_url),
    targetPageId: row.target_page_id === null ? null : String(row.target_page_id),
    title: String(row.title),
    kind: row.kind === "internal" ? "internal" : "external",
  }
}

function spaceFromRow(row: SpaceRow): SpaceSummary {
  return {
    key: String(row.key),
    name: String(row.name),
    lastSyncedAt: row.last_synced_at === null ? null : String(row.last_synced_at),
    pageCount: Number(row.page_count),
    syncState: row.sync_state,
  }
}

function parsePath(value: string, fallbackTitle: string) {
  try {
    const path = JSON.parse(value) as unknown

    if (Array.isArray(path)) return path.map(String)
  } catch {
    // Fall through to the safest display path for a corrupted row.
  }

  return [fallbackTitle]
}

function pageBodyFromRow(row: PageBodyRow): PageBodyArtifact {
  return {
    pageId: String(row.page_id),
    remoteVersion: Number(row.remote_version),
    sourceRepresentation: row.source_representation,
    sourceBody: String(row.source_body),
    sourceHash: String(row.source_hash),
    canonicalDocument: JSON.parse(row.canonical_json) as CanonicalDocument,
    sidecar: JSON.parse(row.sidecar_json) as MappingSidecar,
    editableMarkdown: String(row.editable_markdown),
    renderedMarkdown: String(row.rendered_markdown),
    updatedAt: String(row.updated_at),
  }
}
