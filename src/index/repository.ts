import type { Database } from "bun:sqlite"
import type { CanonicalDocument, MappingSidecar, SourceRepresentation } from "../document/model"
import type { IndexedPage, PageLink, PageLinkKind, PageStatusFilter, SearchResult, SpaceSummary, SyncState } from "../model"
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
  tree_order: number
  content_type: string
  remote_status: string
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

interface PageDraftRow {
  page_id: string
  base_remote_version: number
  base_source_hash: string
  draft_markdown: string
  status: PageDraftStatus
  created_at: string
  updated_at: string
  staged_at: string | null
}

interface PageCreateRow {
  local_id: string
  space_key: string
  parent_page_id: string | null
  parent_create_id: string | null
  title: string
  draft_markdown: string
  created_at: string
  updated_at: string
}

interface PageDeleteRow {
  page_id: string
  created_at: string
  updated_at: string
}

export type PageDraftStatus = "draft" | "staged"

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

export interface PageDraft {
  pageId: string
  baseRemoteVersion: number
  baseSourceHash: string
  draftMarkdown: string
  status: PageDraftStatus
  createdAt: string
  updatedAt: string
  stagedAt: string | null
}

export interface PageCreate {
  localId: string
  spaceKey: string
  parentPageId: string | null
  parentCreateId: string | null
  title: string
  draftMarkdown: string
  createdAt: string
  updatedAt: string
}

export interface PageDelete {
  pageId: string
  createdAt: string
  updatedAt: string
}

export interface IndexRepositoryStats {
  schemaVersion: number
  spaceCount: number
  pageCount: number
  linkCount: number
  bodyArtifactCount: number
  draftCount: number
  stagedDraftCount: number
  createCount: number
  deleteCount: number
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
          owner, updated_at, content_markdown, snippet, tree_order, content_type, remote_status, indexed_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
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
          tree_order = excluded.tree_order,
          content_type = excluded.content_type,
          remote_status = excluded.remote_status,
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
          page.treeOrder ?? 0,
          page.contentType ?? "page",
          page.remoteStatus ?? "current",
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

  listPagesInSpace(spaceKey: string, status: PageStatusFilter = "current"): IndexedPage[] {
    const filters = ["space_key = ?"]
    const params: string[] = [spaceKey]

    if (status !== "all") {
      filters.push("remote_status = ?")
      params.push(status)
    }

    const rows = this.database.query(`
      SELECT *
      FROM pages
      WHERE ${filters.join(" AND ")}
      ORDER BY path_text COLLATE NOCASE, tree_order, title COLLATE NOCASE
    `).all(...params) as PageRow[]

    return rows.map(pageFromRow)
  }

  getStats(): IndexRepositoryStats {
    return {
      schemaVersion: this.readUserVersion(),
      spaceCount: this.countRows("spaces"),
      pageCount: this.countRows("pages"),
      linkCount: this.countRows("links"),
      bodyArtifactCount: this.countRows("page_bodies"),
      draftCount: this.countRows("page_drafts"),
      stagedDraftCount: this.countRows("page_drafts", "status = 'staged'"),
      createCount: this.countRows("page_creates"),
      deleteCount: this.countRows("page_deletes"),
    }
  }

  getPageBody(pageId: string): PageBodyArtifact | null {
    const row = this.database.query("SELECT * FROM page_bodies WHERE page_id = ?").get(pageId) as PageBodyRow | null

    return row ? pageBodyFromRow(row) : null
  }

  listPageBodies(): PageBodyArtifact[] {
    const rows = this.database.query("SELECT * FROM page_bodies ORDER BY page_id COLLATE NOCASE").all() as PageBodyRow[]

    return rows.map(pageBodyFromRow)
  }

  deleteLinksFromPage(pageId: string) {
    this.database.query("DELETE FROM links WHERE from_page_id = ?").run(pageId)
  }

  upsertPageDraft(draft: PageDraft) {
    this.database.query(`
      INSERT INTO page_drafts (
        page_id, base_remote_version, base_source_hash, draft_markdown,
        status, created_at, updated_at, staged_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(page_id) DO UPDATE SET
        base_remote_version = excluded.base_remote_version,
        base_source_hash = excluded.base_source_hash,
        draft_markdown = excluded.draft_markdown,
        status = excluded.status,
        updated_at = excluded.updated_at,
        staged_at = excluded.staged_at
    `).run(
      draft.pageId,
      draft.baseRemoteVersion,
      draft.baseSourceHash,
      draft.draftMarkdown,
      draft.status,
      draft.createdAt,
      draft.updatedAt,
      draft.stagedAt,
    )
  }

  getPageDraft(pageId: string): PageDraft | null {
    const row = this.database.query("SELECT * FROM page_drafts WHERE page_id = ?").get(pageId) as PageDraftRow | null

    return row ? pageDraftFromRow(row) : null
  }

  listPageDrafts(status?: PageDraftStatus): PageDraft[] {
    const rows = status
      ? this.database.query("SELECT * FROM page_drafts WHERE status = ? ORDER BY updated_at DESC, page_id COLLATE NOCASE").all(status) as PageDraftRow[]
      : this.database.query("SELECT * FROM page_drafts ORDER BY updated_at DESC, page_id COLLATE NOCASE").all() as PageDraftRow[]

    return rows.map(pageDraftFromRow)
  }

  stagePageDraft(pageId: string, stagedAt: string) {
    return this.database.query("UPDATE page_drafts SET status = 'staged', updated_at = ?, staged_at = ? WHERE page_id = ?").run(stagedAt, stagedAt, pageId).changes
  }

  unstagePageDraft(pageId: string, updatedAt: string) {
    return this.database.query("UPDATE page_drafts SET status = 'draft', updated_at = ?, staged_at = NULL WHERE page_id = ?").run(updatedAt, pageId).changes
  }

  deletePageDraft(pageId: string) {
    return this.database.query("DELETE FROM page_drafts WHERE page_id = ?").run(pageId).changes
  }

  upsertPageCreate(create: PageCreate) {
    this.database.query(`
      INSERT INTO page_creates (
        local_id, space_key, parent_page_id, parent_create_id, title, draft_markdown, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(local_id) DO UPDATE SET
        space_key = excluded.space_key,
        parent_page_id = excluded.parent_page_id,
        parent_create_id = excluded.parent_create_id,
        title = excluded.title,
        draft_markdown = excluded.draft_markdown,
        updated_at = excluded.updated_at
    `).run(
      create.localId,
      create.spaceKey,
      create.parentPageId,
      create.parentCreateId,
      create.title,
      create.draftMarkdown,
      create.createdAt,
      create.updatedAt,
    )
  }

  getPageCreate(localId: string): PageCreate | null {
    const row = this.database.query("SELECT * FROM page_creates WHERE local_id = ?").get(localId) as PageCreateRow | null

    return row ? pageCreateFromRow(row) : null
  }

  listPageCreates(spaceKey?: string): PageCreate[] {
    const rows = spaceKey
      ? this.database.query("SELECT * FROM page_creates WHERE space_key = ? ORDER BY updated_at DESC, title COLLATE NOCASE").all(spaceKey) as PageCreateRow[]
      : this.database.query("SELECT * FROM page_creates ORDER BY updated_at DESC, title COLLATE NOCASE").all() as PageCreateRow[]

    return rows.map(pageCreateFromRow)
  }

  deletePageCreate(localId: string) {
    return this.database.query("DELETE FROM page_creates WHERE local_id = ?").run(localId).changes
  }

  reparentPageCreatesFromLocalParent(localId: string, parentPageId: string, updatedAt: string) {
    return this.database.query(`
      UPDATE page_creates
      SET parent_page_id = ?, parent_create_id = NULL, updated_at = ?
      WHERE parent_create_id = ?
    `).run(parentPageId, updatedAt, localId).changes
  }

  upsertPageDelete(deletion: PageDelete) {
    this.database.query(`
      INSERT INTO page_deletes (page_id, created_at, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(page_id) DO UPDATE SET
        updated_at = excluded.updated_at
    `).run(deletion.pageId, deletion.createdAt, deletion.updatedAt)
  }

  getPageDelete(pageId: string): PageDelete | null {
    const row = this.database.query("SELECT * FROM page_deletes WHERE page_id = ?").get(pageId) as PageDeleteRow | null

    return row ? pageDeleteFromRow(row) : null
  }

  listPageDeletes(): PageDelete[] {
    const rows = this.database.query("SELECT * FROM page_deletes ORDER BY updated_at DESC, page_id COLLATE NOCASE").all() as PageDeleteRow[]

    return rows.map(pageDeleteFromRow)
  }

  deletePageDelete(pageId: string) {
    return this.database.query("DELETE FROM page_deletes WHERE page_id = ?").run(pageId).changes
  }

  deletePage(pageId: string) {
    return this.transaction(() => {
      this.database.query("DELETE FROM page_fts WHERE page_id = ?").run(pageId)
      this.database.query("DELETE FROM links WHERE from_page_id = ? OR target_page_id = ?").run(pageId, pageId)
      return this.database.query("DELETE FROM pages WHERE page_id = ?").run(pageId).changes
    })
  }

  prunePagesInSpace(spaceKey: string, keepPageIds: Set<string>) {
    const staleRows = this.database.query("SELECT page_id FROM pages WHERE space_key = ?").all(spaceKey) as Array<{ page_id: string }>
    const stalePageIds = staleRows.map((row) => String(row.page_id)).filter((pageId) => !keepPageIds.has(pageId))
    if (!stalePageIds.length) return 0

    return this.transaction(() => {
      const deleteFts = this.database.query("DELETE FROM page_fts WHERE page_id = ?")
      const deleteLinks = this.database.query("DELETE FROM links WHERE from_page_id = ? OR target_page_id = ?")
      const deletePage = this.database.query("DELETE FROM pages WHERE page_id = ?")
      let deleted = 0

      for (const pageId of stalePageIds) {
        deleteFts.run(pageId)
        deleteLinks.run(pageId, pageId)
        deleted += deletePage.run(pageId).changes
      }

      return deleted
    })
  }

  getChildren(parentPageId: string, status: PageStatusFilter = "current"): IndexedPage[] {
    const filters = ["parent_id = ?"]
    const params: string[] = [parentPageId]

    if (status !== "all") {
      filters.push("remote_status = ?")
      params.push(status)
    }

    const rows = this.database.query(`
      SELECT *
      FROM pages
      WHERE ${filters.join(" AND ")}
      ORDER BY tree_order, title COLLATE NOCASE
    `).all(...params) as PageRow[]

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

  searchPagesInSpace(spaceKey: string, query: string, limit = 20, status: PageStatusFilter = "current"): SearchResult[] {
    return this.searchPages(query, { limit, spaceKey, status })
  }

  searchPagesAcrossSpaces(query: string, limit = 20, status: PageStatusFilter = "current"): SearchResult[] {
    return this.searchPages(query, { limit, status })
  }

  private searchPages(query: string, options: { limit: number; spaceKey?: string; status: PageStatusFilter }): SearchResult[] {
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

    if (options.status !== "all") {
      filters.push("pages.remote_status = ?")
      params.push(options.status)
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

  private selectPagesForEmptySearch(options: { limit: number; spaceKey?: string; status: PageStatusFilter }) {
    const filters: string[] = []
    const params: Array<string | number> = []

    if (options.spaceKey) {
      filters.push("space_key = ?")
      params.push(options.spaceKey)
    }

    if (options.status !== "all") {
      filters.push("remote_status = ?")
      params.push(options.status)
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : ""

    if (options.spaceKey) {
      const rows = this.database.query(`
        SELECT *
        FROM pages
        ${where}
        ORDER BY path_text COLLATE NOCASE, title COLLATE NOCASE
        LIMIT ?
      `).all(...params, options.limit) as PageRow[]

      return rows.map(pageFromRow)
    }

    const rows = this.database.query(`
      SELECT *
      FROM pages
      ${where}
      ORDER BY space_key COLLATE NOCASE, path_text COLLATE NOCASE, title COLLATE NOCASE
      LIMIT ?
    `).all(...params, options.limit) as PageRow[]

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

  private countRows(table: "spaces" | "pages" | "links" | "page_bodies" | "page_drafts" | "page_creates" | "page_deletes", where?: string) {
    const row = this.database.query(`SELECT COUNT(*) AS count FROM ${table}${where ? ` WHERE ${where}` : ""}`).get() as { count: number } | null

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
    treeOrder: Number(row.tree_order ?? 0),
    contentType: String(row.content_type ?? "page"),
    remoteStatus: String(row.remote_status ?? "current"),
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

function pageDraftFromRow(row: PageDraftRow): PageDraft {
  return {
    pageId: String(row.page_id),
    baseRemoteVersion: Number(row.base_remote_version),
    baseSourceHash: String(row.base_source_hash),
    draftMarkdown: String(row.draft_markdown),
    status: row.status === "staged" ? "staged" : "draft",
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    stagedAt: row.staged_at === null ? null : String(row.staged_at),
  }
}

function pageCreateFromRow(row: PageCreateRow): PageCreate {
  return {
    localId: String(row.local_id),
    spaceKey: String(row.space_key),
    parentPageId: row.parent_page_id === null ? null : String(row.parent_page_id),
    parentCreateId: row.parent_create_id === null ? null : String(row.parent_create_id),
    title: String(row.title),
    draftMarkdown: String(row.draft_markdown),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function pageDeleteFromRow(row: PageDeleteRow): PageDelete {
  return {
    pageId: String(row.page_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}
