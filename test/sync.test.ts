import { mkdtemp, rm, writeFile } from "node:fs/promises"
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
          "/wiki/api/v2/pages?space-id=10&limit=100&body-format=storage": {
            results: [
              pagePayload("100", "Engineering Home", null, "<p>Home page.</p>"),
              pagePayload("101", "Project Architecture", "100"),
            ],
            _links: {},
          },
          "/wiki/api/v2/pages/100/direct-children?limit=250": {
            results: [{ id: "900", title: "Design Notes", type: "folder" }, pagePayload("101", "Project Architecture", "100")],
            _links: {},
          },
          "/wiki/api/v2/pages/101/direct-children?limit=250": { results: [], _links: {} },
          "/wiki/api/v2/pages/900/direct-children?limit=250": {
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
          "/wiki/api/v2/pages?space-id=20&limit=100&body-format=storage": {
            results: [pagePayload("200", "Operations Home", null, "<p>Operations content.</p>")],
            _links: {},
          },
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

  test("records page failures while preserving existing local pages", async () => {
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
        snippet: "Existing local page that must not be pruned.",
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
          "/wiki/api/v2/pages?space-id=10&limit=100&body-format=storage": {
            results: [pagePayload("fresh", "Fresh Page", null, "<p>Fresh content.</p>"), pagePayload("bad", "Bad Page", null)],
            _links: {},
          },
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
        expect(checked.getPage("old-page")?.title).toBe("Old Local Page")
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

function isResponseLike(value: unknown): value is ReturnType<typeof response> {
  return typeof value === "object" && value !== null && "ok" in value && "json" in value
}
