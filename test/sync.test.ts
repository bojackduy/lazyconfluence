import { mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { createLocalConfig, saveLocalAuth } from "../src/config"
import type { FetchLike } from "../src/confluence/client"
import { openIndexRepository } from "../src/index/repository"
import { syncConfluence, SyncServiceError } from "../src/sync"

describe("sync service", () => {
  test("refuses to sync without local config and does not call the network", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lazyconfluence-sync-missing-"))
    let networkCalled = false

    try {
      await syncConfluence({
        env: { LAZYCONFLUENCE_CONFIG_HOME: dir, LAZYCONFLUENCE_DB_PATH: join(dir, "index.sqlite3") } as NodeJS.ProcessEnv,
        fetch: async () => {
          networkCalled = true
          throw new Error("network should not be called")
        },
      })

      throw new Error("sync should have failed")
    } catch (error) {
      expect(error).toBeInstanceOf(SyncServiceError)
      expect(error instanceof Error ? error.message : "").toContain("No lazyconfluence config")
      expect(networkCalled).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("refuses to sync when the token is missing", async () => {
    const setup = await createSyncTestSetup()

    try {
      await writeFile(join(setup.configHome, "atlassian.env"), "export ATLASSIAN_API_TOKEN=\n")

      await syncConfluence({
        env: setup.env,
        fetch: async () => {
          throw new Error("network should not be called")
        },
      })

      throw new Error("sync should have failed")
    } catch (error) {
      expect(error).toBeInstanceOf(SyncServiceError)
      expect(error instanceof Error ? error.message : "").toContain("Atlassian API token missing")
    } finally {
      await setup.cleanup()
    }
  })

  test("syncs Confluence spaces, pages, children, and links into the local index", async () => {
    const setup = await createSyncTestSetup()
    const calls: string[] = []
    const progress: string[] = []

    try {
      const report = await syncConfluence({
        env: setup.env,
        now: fixedClock(),
        onProgress: (event) => progress.push(`${event.type}:${event.message}`),
        fetch: jsonFetch(calls, {
          "/wiki/api/v2/spaces?keys=ENG&limit=250": {
            results: [{ id: "10", key: "ENG", name: "Engineering", homepageId: "100" }],
          },
          "/wiki/api/v2/pages?space-id=10&limit=100&body-format=storage&status=current": {
            results: [
              pagePayload("100", "Engineering Home", null, "<p>Home page.</p>"),
              pagePayload("101", "Project Architecture", "100"),
            ],
            _links: {},
          },
          "/wiki/api/v2/pages?space-id=10&limit=100&body-format=storage&status=archived": { results: [], _links: {} },
          "/wiki/api/v2/pages/100/direct-children?limit=250": {
            results: [{ id: "900", title: "Design Notes", type: "folder" }, pagePayload("101", "Project Architecture", "100")],
            _links: {},
          },
          "/wiki/api/v2/pages/101/direct-children?limit=250": { results: [], _links: {} },
          "/wiki/api/v2/folders/900/direct-children?limit=250": {
            results: [pagePayload("901", "Nested Design", "900")],
            _links: {},
          },
          "/wiki/api/v2/pages/901/direct-children?limit=250": { results: [], _links: {} },
          "/wiki/api/v2/pages/101?body-format=storage": pagePayload(
            "101",
            "Project Architecture",
            "100",
            '<p>Architecture links back to <a href="/wiki/spaces/ENG/pages/100/Engineering+Home">home</a> and <a href="https://developer.atlassian.com/cloud/confluence/rest/v2/">REST API</a>.</p><ac:structured-macro ac:name="toc"><ac:parameter ac:name="printable">true</ac:parameter></ac:structured-macro>',
          ),
          "/wiki/api/v2/pages/901?body-format=storage": pagePayload("901", "Nested Design", "900", "<p>Nested child content.</p>"),
        }),
      })

      expect(progress).toContain("resolving-spaces:Resolving spaces: ENG.")
      expect(progress).toContain("fetching-space-pages:Fetching pages for ENG.")
      expect(progress).toContain("fetched-space-pages:Fetched 2 pages for ENG.")
      expect(progress).toContain("fetching-page-children:Fetching children for 100: Engineering Home.")
      expect(progress).toContain("fetching-page-children:Fetching children for 900: Design Notes.")
      expect(progress).toContain("fetching-page-body:Fetching body for 101: Project Architecture.")
      expect(progress).toContain("fetching-page-body:Fetching body for 901: Nested Design.")
      expect(progress).toContain("writing-space:Writing 4 pages, 2 links, and 3 body artifacts for ENG.")
      expect(progress.at(-1)).toBe("completed:Sync completed.")
      expect(report).toMatchObject({
        complete: true,
        spacesRequested: 1,
        spacesSynced: 1,
        pagesIndexed: 4,
        linksIndexed: 2,
        bodyArtifactsPersisted: 3,
        failures: [],
      })
      expect(calls).toContain("https://example.atlassian.net/wiki/api/v2/pages/101?body-format=storage")

      const repository = openIndexRepository({ path: setup.dbPath })
      try {
        expect(repository.getSpace("ENG")?.pageCount).toBe(4)
        expect(repository.getPage("101")?.path).toEqual(["Engineering Home", "Project Architecture"])
        expect(repository.getChildren("100").map((page) => page.pageId)).toEqual(["900", "101"])
        expect(repository.getChildren("900").map((page) => page.pageId)).toEqual(["901"])
        expect(repository.getOutgoingLinks("101").map((link) => link.kind).sort()).toEqual(["external", "internal"])
        expect(repository.getIncomingLinks("100").map((link) => link.fromPageId)).toEqual(["101"])
        expect(repository.searchPagesInSpace("ENG", "architecture")[0]?.page.pageId).toBe("101")
        const body = repository.getPageBody("101")

        expect(body?.sourceBody).toContain("ac:structured-macro")
        expect(body?.sidecar.nodes["lc_101_0001"]?.roundTrip).toBe("native")
        expect(Object.values(body?.sidecar.nodes ?? {}).some((node) => node.roundTrip === "opaque")).toBe(true)
        expect(body?.renderedMarkdown).toContain("<!-- confluence-opaque")
      } finally {
        repository.close()
      }
    } finally {
      await setup.cleanup()
    }
  })

  test("can sync an explicit subset of configured spaces", async () => {
    const setup = await createSyncTestSetup(["ENG", "OPS"])
    const calls: string[] = []

    try {
      const report = await syncConfluence({
        env: setup.env,
        now: fixedClock(),
        spaceKeys: ["OPS"],
        fetch: jsonFetch(calls, {
          "/wiki/api/v2/spaces?keys=OPS&limit=250": {
            results: [{ id: "20", key: "OPS", name: "Operations", homepageId: "200" }],
          },
          "/wiki/api/v2/pages?space-id=20&limit=100&body-format=storage&status=current": {
            results: [pagePayload("200", "Operations Home", null, "<p>Operations content.</p>")],
            _links: {},
          },
          "/wiki/api/v2/pages?space-id=20&limit=100&body-format=storage&status=archived": { results: [], _links: {} },
          "/wiki/api/v2/pages/200/direct-children?limit=250": { results: [], _links: {} },
        }),
      })

      expect(calls[0]).toBe("https://example.atlassian.net/wiki/api/v2/spaces?keys=OPS&limit=250")
      expect(report.spacesRequested).toBe(1)
      expect(report.spacesSynced).toBe(1)

      const repository = openIndexRepository({ path: setup.dbPath })
      try {
        expect(repository.getSpace("ENG")).toBeNull()
        expect(repository.getSpace("OPS")?.pageCount).toBe(1)
      } finally {
        repository.close()
      }
    } finally {
      await setup.cleanup()
    }
  })

  test("caches Confluence attachment images during explicit sync", async () => {
    const setup = await createSyncTestSetup()
    const calls: string[] = []

    try {
      const report = await syncConfluence({
        env: setup.env,
        now: fixedClock(),
        fetch: jsonFetch(calls, {
          "/wiki/api/v2/spaces?keys=ENG&limit=250": {
            results: [{ id: "10", key: "ENG", name: "Engineering", homepageId: "100" }],
          },
          "/wiki/api/v2/pages?space-id=10&limit=100&body-format=storage&status=current": {
            results: [pagePayload("100", "Engineering Home", null, '<p>Diagram below.</p><ac:image ac:alt="System overview"><ri:attachment ri:filename="diagram.png" /></ac:image>')],
            _links: {},
          },
          "/wiki/api/v2/pages?space-id=10&limit=100&body-format=storage&status=archived": { results: [], _links: {} },
          "/wiki/api/v2/pages/100/direct-children?limit=250": { results: [], _links: {} },
          "/wiki/download/attachments/100/diagram.png": binaryResponse(Buffer.from(tinyPngBase64, "base64"), "image/png"),
        }),
      })

      expect(report.complete).toBe(true)
      expect(calls).toContain("https://example.atlassian.net/wiki/download/attachments/100/diagram.png")

      const repository = openIndexRepository({ path: setup.dbPath })
      try {
        const assets = repository.listMediaAssets("100")
        expect(assets).toHaveLength(1)
        expect(assets[0]).toMatchObject({ pageId: "100", title: "System overview", contentType: "image/png" })
        expect(assets[0]?.cachePath).toContain("media/100/")
        expect(await stat(assets[0]?.cachePath ?? "")).toMatchObject({ size: Buffer.from(tinyPngBase64, "base64").length })
        expect(repository.getPageBody("100")?.renderedMarkdown).toContain("> [image: System overview]")
      } finally {
        repository.close()
      }
    } finally {
      await setup.cleanup()
    }
  })

  test("backfills missing parents and discovers their children", async () => {
    const setup = await createSyncTestSetup()
    const calls: string[] = []

    try {
      const report = await syncConfluence({
        env: setup.env,
        now: fixedClock(),
        fetch: jsonFetch(calls, {
          "/wiki/api/v2/spaces?keys=ENG&limit=250": {
            results: [{ id: "10", key: "ENG", name: "Engineering", homepageId: "root" }],
          },
          "/wiki/api/v2/pages?space-id=10&limit=100&body-format=storage&status=current": {
            results: [pagePayload("backend-docs", "Backend Scraping And Pricing Documentation", "backend-folder", "<p>Backend docs.</p>")],
            _links: {},
          },
          "/wiki/api/v2/pages?space-id=10&limit=100&body-format=storage&status=archived": { results: [], _links: {} },
          "/wiki/api/v2/pages/backend-docs/direct-children?limit=250": { results: [], _links: {} },
          "/wiki/api/v2/pages/backend-folder?body-format=storage": response({ message: "not a page" }, false, 404, "Not Found"),
          "/wiki/api/v2/folders/backend-folder": folderPayload("backend-folder", "Technical Document for Backend", "technical-doc"),
          "/wiki/api/v2/folders/backend-folder/direct-children?limit=250": {
            results: [folderPayload("devex", "DevEx workaround because of poor setup", "backend-folder"), pagePayload("backend-docs", "Backend Scraping And Pricing Documentation", "backend-folder", "<p>Backend docs.</p>")],
            _links: {},
          },
          "/wiki/api/v2/pages/technical-doc?body-format=storage": response({ message: "not a page" }, false, 404, "Not Found"),
          "/wiki/api/v2/folders/technical-doc": folderPayload("technical-doc", "Technical Document", "root"),
          "/wiki/api/v2/folders/technical-doc/direct-children?limit=250": {
            results: [pagePayload("frontend-docs", "Technical Document for Frontend", "technical-doc", "<p>Frontend docs.</p>"), folderPayload("backend-folder", "Technical Document for Backend", "technical-doc")],
            _links: {},
          },
          "/wiki/api/v2/pages/root?body-format=storage": pagePayload("root", "PlayLab Home", null, "<p>Home.</p>"),
          "/wiki/api/v2/pages/root/direct-children?limit=250": {
            results: [pagePayload("technical-doc", "Technical Document", "root", "<p>Technical folder.</p>")],
            _links: {},
          },
          "/wiki/api/v2/folders/devex/direct-children?limit=250": { results: [], _links: {} },
          "/wiki/api/v2/pages/frontend-docs/direct-children?limit=250": { results: [], _links: {} },
        }),
      })

      expect(report).toMatchObject({ complete: true, pagesIndexed: 6, failures: [] })
      expect(calls).toContain("https://example.atlassian.net/wiki/api/v2/folders/backend-folder")
      expect(calls).toContain("https://example.atlassian.net/wiki/api/v2/folders/technical-doc")
      expect(calls).toContain("https://example.atlassian.net/wiki/api/v2/pages/root?body-format=storage")
      expect(calls).toContain("https://example.atlassian.net/wiki/api/v2/folders/backend-folder/direct-children?limit=250")
      expect(calls).toContain("https://example.atlassian.net/wiki/api/v2/folders/technical-doc/direct-children?limit=250")

      const repository = openIndexRepository({ path: setup.dbPath })
      try {
        expect(repository.getPage("backend-docs")?.path).toEqual(["PlayLab Home", "Technical Document", "Technical Document for Backend", "Backend Scraping And Pricing Documentation"])
        expect(repository.getChildren("technical-doc").map((page) => page.pageId)).toEqual(["frontend-docs", "backend-folder"])
        expect(repository.getChildren("backend-folder").map((page) => page.pageId)).toEqual(["devex", "backend-docs"])
      } finally {
        repository.close()
      }
    } finally {
      await setup.cleanup()
    }
  })

  test("falls back to folder children for page-listed folders", async () => {
    const setup = await createSyncTestSetup()
    const calls: string[] = []

    try {
      const report = await syncConfluence({
        env: setup.env,
        now: fixedClock(),
        fetch: jsonFetch(calls, {
          "/wiki/api/v2/spaces?keys=ENG&limit=250": {
            results: [{ id: "10", key: "ENG", name: "Engineering", homepageId: "folderish" }],
          },
          "/wiki/api/v2/pages?space-id=10&limit=100&body-format=storage&status=current": {
            results: [pagePayload("folderish", "Folderish", null)],
            _links: {},
          },
          "/wiki/api/v2/pages?space-id=10&limit=100&body-format=storage&status=archived": { results: [], _links: {} },
          "/wiki/api/v2/pages/folderish/direct-children?limit=250": response({ message: "not a page" }, false, 404, "Not Found"),
          "/wiki/api/v2/folders/folderish/direct-children?limit=250": {
            results: [pagePayload("child", "Child Page", "folderish")],
            _links: {},
          },
          "/wiki/api/v2/pages/child/direct-children?limit=250": { results: [], _links: {} },
          "/wiki/api/v2/pages/child?body-format=storage": pagePayload("child", "Child Page", "folderish", "<p>Child.</p>"),
        }),
      })

      expect(report).toMatchObject({ complete: true, pagesIndexed: 2, bodyArtifactsPersisted: 1, failures: [] })
      expect(calls).toContain("https://example.atlassian.net/wiki/api/v2/pages/folderish/direct-children?limit=250")
      expect(calls).toContain("https://example.atlassian.net/wiki/api/v2/folders/folderish/direct-children?limit=250")
      expect(calls).not.toContain("https://example.atlassian.net/wiki/api/v2/pages/folderish?body-format=storage")

      const repository = openIndexRepository({ path: setup.dbPath })
      try {
        expect(repository.getPage("folderish")?.snippet).toBe("")
        expect(repository.getChildren("folderish").map((page) => page.pageId)).toEqual(["child"])
      } finally {
        repository.close()
      }
    } finally {
      await setup.cleanup()
    }
  })

  test("keeps unsupported Confluence items visible without sync failures", async () => {
    const setup = await createSyncTestSetup()
    const calls: string[] = []

    try {
      const report = await syncConfluence({
        env: setup.env,
        now: fixedClock(),
        fetch: jsonFetch(calls, {
          "/wiki/api/v2/spaces?keys=ENG&limit=250": {
            results: [{ id: "10", key: "ENG", name: "Engineering", homepageId: "100" }],
          },
          "/wiki/api/v2/pages?space-id=10&limit=100&body-format=storage&status=current": {
            results: [pagePayload("100", "Engineering Home", null, "<p>Home.</p>")],
            _links: {},
          },
          "/wiki/api/v2/pages?space-id=10&limit=100&body-format=storage&status=archived": { results: [], _links: {} },
          "/wiki/api/v2/pages/100/direct-children?limit=250": {
            results: [typedPayload("whiteboard", "Stakeholder Flow", "100", "whiteboard", "current"), typedPayload("draft", "Pitch Draft", "100", "page", "draft")],
            _links: {},
          },
        }),
      })

      expect(report).toMatchObject({ complete: true, pagesIndexed: 3, bodyArtifactsPersisted: 1, failures: [] })
      expect(calls).not.toContain("https://example.atlassian.net/wiki/api/v2/pages/whiteboard/direct-children?limit=250")
      expect(calls).not.toContain("https://example.atlassian.net/wiki/api/v2/pages/whiteboard?body-format=storage")
      expect(calls).not.toContain("https://example.atlassian.net/wiki/api/v2/pages/draft/direct-children?limit=250")
      expect(calls).not.toContain("https://example.atlassian.net/wiki/api/v2/pages/draft?body-format=storage")

      const repository = openIndexRepository({ path: setup.dbPath })
      try {
        expect(repository.getPage("whiteboard")?.contentMarkdown).toContain("Unsupported Confluence content type: whiteboard")
        expect(repository.getPage("draft")?.contentMarkdown).toContain("Unsupported Confluence page status: draft")
      } finally {
        repository.close()
      }
    } finally {
      await setup.cleanup()
    }
  })

  test("syncs archived pages into the archived view and prunes missing rows", async () => {
    const setup = await createSyncTestSetup()
    const repository = openIndexRepository({ path: setup.dbPath })
    const calls: string[] = []

    try {
      repository.upsertSpace({ key: "ENG", name: "Engineering", lastSyncedAt: "2026-07-22T00:00:00Z", pageCount: 0, syncState: "fresh" })
      repository.upsertPage({
        pageId: "stale-trash",
        spaceKey: "ENG",
        title: "Already Removed",
        url: "https://example.atlassian.net/wiki/spaces/ENG/pages/stale-trash/Already+Removed",
        parentId: null,
        path: ["Already Removed"],
        owner: "",
        updatedAt: "2026-07-22T00:00:00Z",
        contentMarkdown: "# Already Removed",
        snippet: "Stale local row.",
        remoteStatus: "archived",
      })

      const report = await syncConfluence({
        env: setup.env,
        now: fixedClock(),
        fetch: jsonFetch(calls, {
          "/wiki/api/v2/spaces?keys=ENG&limit=250": {
            results: [{ id: "10", key: "ENG", name: "Engineering", homepageId: "root" }],
          },
          "/wiki/api/v2/pages?space-id=10&limit=100&body-format=storage&status=current": {
            results: [pagePayload("root", "Engineering Home", null, "<p>Home.</p>")],
            _links: {},
          },
          "/wiki/api/v2/pages?space-id=10&limit=100&body-format=storage&status=archived": {
            results: [pagePayloadWithStatus("archived-root", "Archived Root", null, "archived", "<p>Archived root.</p>")],
            _links: {},
          },
          "/wiki/api/v2/pages/root/direct-children?limit=250": {
            results: [pagePayloadWithStatus("archived-child", "Archived Child", "root", "archived")],
            _links: {},
          },
          "/wiki/api/v2/pages/archived-root/direct-children?limit=250": { results: [], _links: {} },
          "/wiki/api/v2/pages/archived-child/direct-children?limit=250": { results: [], _links: {} },
          "/wiki/api/v2/pages/archived-child?body-format=storage": pagePayloadWithStatus("archived-child", "Archived Child", "root", "archived", "<p>Archived child.</p>"),
        }),
      })

      expect(report).toMatchObject({ complete: true, pagesIndexed: 3, bodyArtifactsPersisted: 3, failures: [] })
      expect(repository.getPage("stale-trash")).toBeNull()
      expect(repository.listPagesInSpace("ENG").map((page) => page.pageId)).toEqual(["root"])
      expect(repository.listPagesInSpace("ENG", "archived").map((page) => page.pageId)).toEqual(["archived-root", "archived-child"])
      expect(repository.getPage("archived-child")).toMatchObject({ remoteStatus: "archived" })
      expect(repository.getPageBody("archived-child")?.renderedMarkdown).toContain("Archived child")
    } finally {
      repository.close()
      await setup.cleanup()
    }
  })

  test("keeps detached children visible when missing parent backfill fails", async () => {
    const setup = await createSyncTestSetup()

    try {
      const report = await syncConfluence({
        env: setup.env,
        now: fixedClock(),
        fetch: jsonFetch([], {
          "/wiki/api/v2/spaces?keys=ENG&limit=250": {
            results: [{ id: "10", key: "ENG", name: "Engineering", homepageId: "root" }],
          },
          "/wiki/api/v2/pages?space-id=10&limit=100&body-format=storage&status=current": {
            results: [pagePayload("orphan", "Orphaned Child", "missing-parent", "<p>Still visible.</p>")],
            _links: {},
          },
          "/wiki/api/v2/pages?space-id=10&limit=100&body-format=storage&status=archived": { results: [], _links: {} },
          "/wiki/api/v2/pages/orphan/direct-children?limit=250": { results: [], _links: {} },
          "/wiki/api/v2/pages/missing-parent?body-format=storage": response({ message: "missing" }, false, 404, "Not Found"),
        }),
      })

      expect(report.complete).toBe(false)
      expect(report.failures).toEqual([{ scope: "page", key: "missing-parent", message: expect.stringContaining("Could not fetch missing parent") }])

      const repository = openIndexRepository({ path: setup.dbPath })
      try {
        expect(repository.getPage("orphan")?.parentId).toBe("missing-parent")
        expect(repository.getPage("orphan")?.path).toEqual(["Orphaned Child"])
      } finally {
        repository.close()
      }
    } finally {
      await setup.cleanup()
    }
  })

  test("records body failures while pruning pages missing from a complete scan", async () => {
    const setup = await createSyncTestSetup()
    const repository = openIndexRepository({ path: setup.dbPath })

    try {
      repository.upsertSpace({ key: "ENG", name: "Engineering", lastSyncedAt: "2026-07-20T00:00:00Z", pageCount: 0, syncState: "fresh" })
      repository.upsertPage({
        pageId: "old-page",
        spaceKey: "ENG",
        title: "Old Local Page",
        url: "https://example.atlassian.net/wiki/spaces/ENG/pages/99/Old+Local+Page",
        parentId: null,
        path: ["Old Local Page"],
        owner: "",
        updatedAt: "2026-07-20T00:00:00Z",
        contentMarkdown: "# Old Local Page",
        snippet: "Existing local page absent from the latest remote snapshot.",
      })
    } finally {
      repository.close()
    }

    try {
      const report = await syncConfluence({
        env: setup.env,
        now: fixedClock(),
        fetch: jsonFetch([], {
          "/wiki/api/v2/spaces?keys=ENG&limit=250": {
            results: [{ id: "10", key: "ENG", name: "Engineering", homepageId: "100" }],
          },
          "/wiki/api/v2/pages?space-id=10&limit=100&body-format=storage&status=current": {
            results: [pagePayload("fresh", "Fresh Page", null, "<p>Fresh content.</p>"), pagePayload("bad", "Bad Page", null)],
            _links: {},
          },
          "/wiki/api/v2/pages?space-id=10&limit=100&body-format=storage&status=archived": { results: [], _links: {} },
          "/wiki/api/v2/pages/fresh/direct-children?limit=250": { results: [], _links: {} },
          "/wiki/api/v2/pages/bad/direct-children?limit=250": { results: [], _links: {} },
          "/wiki/api/v2/pages/bad?body-format=storage": response({ message: "boom" }, false, 500, "Server Error"),
        }),
      })

      expect(report.complete).toBe(false)
      expect(report.pagesIndexed).toBe(2)
      expect(report.bodyArtifactsPersisted).toBe(1)
      expect(report.failures).toEqual([{ scope: "page", key: "bad", message: expect.stringContaining("HTTP 500") }])

      const checked = openIndexRepository({ path: setup.dbPath })
      try {
        expect(checked.getPage("old-page")).toBeNull()
        expect(checked.getPage("fresh")?.title).toBe("Fresh Page")
        expect(checked.getPage("bad")?.contentMarkdown).toContain("could not fetch its body")
        expect(checked.getPage("bad")?.snippet).toContain("kept visible")
      } finally {
        checked.close()
      }
    } finally {
      await setup.cleanup()
    }
  })
})

async function createSyncTestSetup(spaceKeys = ["ENG"]) {
  const dir = await mkdtemp(join(tmpdir(), "lazyconfluence-sync-"))
  const configHome = join(dir, "config")
  const dbPath = join(dir, "index.sqlite3")
  const env = { LAZYCONFLUENCE_CONFIG_HOME: configHome, LAZYCONFLUENCE_DB_PATH: dbPath } as NodeJS.ProcessEnv

  await saveLocalAuth(createLocalConfig({ siteUrl: "https://example.atlassian.net", email: "reader@example.com", spaceKeys }), "token", env)

  return {
    configHome,
    dbPath,
    env,
    cleanup: async () => rm(dir, { recursive: true, force: true }),
  }
}

function fixedClock() {
  return () => new Date("2026-07-21T10:00:00Z")
}

function pagePayload(id: string, title: string, parentId: string | null, storageHtml?: string) {
  return {
    id,
    title,
    parentId,
    ownerId: "owner",
    version: { number: 1, createdAt: "2026-07-21T09:00:00Z" },
    _links: { webui: `/wiki/spaces/ENG/pages/${id}/${title.replace(/\s+/g, "+")}` },
    ...(storageHtml ? { body: { storage: { value: storageHtml } } } : {}),
  }
}

function pagePayloadWithStatus(id: string, title: string, parentId: string | null, status: string, storageHtml?: string) {
  return {
    ...pagePayload(id, title, parentId, storageHtml),
    status,
  }
}

function folderPayload(id: string, title: string, parentId: string | null) {
  return {
    id,
    title,
    type: "folder",
    parentId,
    _links: { webui: `/wiki/spaces/ENG/folder/${id}/${title.replace(/\s+/g, "+")}` },
  }
}

function typedPayload(id: string, title: string, parentId: string | null, type: string, status: string) {
  return {
    id,
    title,
    type,
    status,
    parentId,
    _links: { webui: `/wiki/spaces/ENG/pages/${id}/${title.replace(/\s+/g, "+")}` },
  }
}

function jsonFetch(calls: string[], responses: Record<string, unknown>): FetchLike {
  return async (url) => {
    calls.push(url)
    const parsed = new URL(url)
    const body = responses[`${parsed.pathname}${parsed.search}`]

    if (!body) return response({ message: `missing fixture for ${parsed.pathname}${parsed.search}` }, false, 404, "Not Found")
    if (isResponseLike(body)) return body

    return response(body)
  }
}

function response(body: unknown, ok = true, status = 200, statusText = "OK") {
  return {
    ok,
    status,
    statusText,
    json: async () => body,
  }
}

function binaryResponse(bytes: Uint8Array, contentType: string) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({}),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    headers: { get: (name: string) => name.toLowerCase() === "content-type" ? contentType : null },
  }
}

function isResponseLike(value: unknown): value is ReturnType<typeof response> {
  return typeof value === "object" && value !== null && "ok" in value && "json" in value
}

const tinyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"
