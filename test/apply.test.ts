import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { applyPageCreateToConfluence, applyPageDraftToConfluence } from "../src/apply"
import { createLocalConfig, saveLocalAuth } from "../src/config"
import type { FetchLike } from "../src/confluence/client"
import { mapConfluenceBody } from "../src/confluence/mapper"
import { openIndexRepository, type IndexRepository, type PageBodyArtifact } from "../src/index/repository"
import type { IndexedPage, SpaceSummary } from "../src/model"

describe("apply page draft", () => {
  test("preflights and applies a staged draft to Confluence", async () => {
    const setup = await createApplySetup()
    const repository = openIndexRepository({ path: setup.dbPath })
    const calls: Array<{ url: string; method?: string; body?: string }> = []

    try {
      seedApplyPage(repository, baseStorage)
      seedDraft(repository, baseBodyArtifact("100", "Project Architecture", baseStorage), "# Project Architecture\n\nUpdated body.")

      const result = await applyPageDraftToConfluence("100", {
        env: setup.env,
        repository,
        now: fixedClock(),
        fetch: applyFetch(calls, {
          "/wiki/api/v2/pages/100?body-format=storage": remotePage("100", "Project Architecture", 3, baseStorage),
          "/wiki/api/v2/pages/100": remotePage("100", "Project Architecture", 4, "<p>Updated body.</p>"),
        }),
      })

      expect(result).toMatchObject({ status: "applied", pageId: "100", previousRemoteVersion: 3, remoteVersion: 4 })
      expect(calls.map((call) => `${call.method ?? "GET"} ${new URL(call.url).pathname}${new URL(call.url).search}`)).toEqual([
        "GET /wiki/api/v2/pages/100?body-format=storage",
        "PUT /wiki/api/v2/pages/100",
      ])
      expect(JSON.parse(calls[1]?.body ?? "{}")).toMatchObject({
        id: "100",
        title: "Project Architecture",
        body: { representation: "storage", value: expect.stringContaining("<p>Updated body.</p>") },
        version: { number: 4, message: "Updated from lazyconfluence" },
      })
      expect(repository.getPageDraft("100")).toBeNull()
      expect(repository.getPageBody("100")?.remoteVersion).toBe(4)
      expect(repository.getPage("100")?.contentMarkdown).toContain("Updated body.")
    } finally {
      repository.close()
      await setup.cleanup()
    }
  })

  test("blocks apply when the remote page changed", async () => {
    const setup = await createApplySetup()
    const repository = openIndexRepository({ path: setup.dbPath })
    const calls: Array<{ url: string; method?: string; body?: string }> = []

    try {
      seedApplyPage(repository, baseStorage)
      seedDraft(repository, baseBodyArtifact("100", "Project Architecture", baseStorage), "# Project Architecture\n\nLocal draft.")

      const result = await applyPageDraftToConfluence("100", {
        env: setup.env,
        repository,
        fetch: applyFetch(calls, {
          "/wiki/api/v2/pages/100?body-format=storage": remotePage("100", "Project Architecture", 4, "<p>Remote changed.</p>"),
        }),
      })

      expect(result.status).toBe("conflict")
      expect(result.status === "conflict" ? result.details.join(" ") : "").toContain("Remote version is 4")
      expect(calls.map((call) => call.method ?? "GET")).toEqual(["GET"])
      expect(repository.getPageDraft("100")?.status).toBe("staged")
    } finally {
      repository.close()
      await setup.cleanup()
    }
  })

  test("blocks apply for opaque Confluence macros", async () => {
    const setup = await createApplySetup()
    const repository = openIndexRepository({ path: setup.dbPath })
    let networkCalled = false

    try {
      const macroStorage = '<p>Intro.</p><ac:structured-macro ac:name="toc"><ac:parameter ac:name="printable">true</ac:parameter></ac:structured-macro>'
      seedApplyPage(repository, macroStorage)
      seedDraft(repository, baseBodyArtifact("100", "Project Architecture", macroStorage), "# Project Architecture\n\nEdited body.")

      const result = await applyPageDraftToConfluence("100", {
        env: setup.env,
        repository,
        fetch: async () => {
          networkCalled = true
          throw new Error("network should not be called")
        },
      })

      expect(result.status).toBe("blocked")
      expect(result.status === "blocked" ? result.details.join(" ") : "").toContain("Cannot safely preserve")
      expect(networkCalled).toBe(false)
      expect(repository.getPageDraft("100")?.status).toBe("staged")
    } finally {
      repository.close()
      await setup.cleanup()
    }
  })

  test("creates a staged page in Confluence and local index", async () => {
    const setup = await createApplySetup()
    const repository = openIndexRepository({ path: setup.dbPath })
    const calls: Array<{ url: string; method?: string; body?: string }> = []

    try {
      seedApplyPage(repository, baseStorage)
      repository.upsertPageCreate({
        localId: "create-1",
        spaceKey: "ENG",
        parentPageId: "100",
        title: "Launch Plan",
        draftMarkdown: "# Launch Plan\n",
        createdAt: "2026-07-21T10:00:00Z",
        updatedAt: "2026-07-21T10:00:00Z",
      })

      const result = await applyPageCreateToConfluence("create-1", {
        env: setup.env,
        repository,
        now: fixedClock(),
        fetch: applyFetch(calls, {
          "/wiki/api/v2/spaces?keys=ENG&limit=250": { results: [{ id: "10", key: "ENG", name: "Engineering" }] },
          "/wiki/api/v2/pages": remotePage("101", "Launch Plan", 1, ""),
          "/wiki/api/v2/pages/101?body-format=storage": remotePage("101", "Launch Plan", 1, "<h1>Launch Plan</h1>"),
        }),
      })

      expect(result).toMatchObject({ status: "applied", pageId: "101", title: "Launch Plan", remoteVersion: 1 })
      expect(calls.map((call) => `${call.method ?? "GET"} ${new URL(call.url).pathname}${new URL(call.url).search}`)).toEqual([
        "GET /wiki/api/v2/spaces?keys=ENG&limit=250",
        "POST /wiki/api/v2/pages",
        "GET /wiki/api/v2/pages/101?body-format=storage",
      ])
      expect(JSON.parse(calls[1]?.body ?? "{}")).toMatchObject({
        spaceId: "10",
        parentId: "100",
        status: "current",
        title: "Launch Plan",
        body: { representation: "storage", value: "<h1>Launch Plan</h1>" },
      })
      expect(repository.getPageCreate("create-1")).toBeNull()
      expect(repository.getPage("101")).toMatchObject({ pageId: "101", parentId: "100", title: "Launch Plan", path: ["Project Architecture", "Launch Plan"] })
      expect(repository.getPageBody("101")?.renderedMarkdown).toContain("Launch Plan")
    } finally {
      repository.close()
      await setup.cleanup()
    }
  })

  test("creates a staged root page in Confluence and local index", async () => {
    const setup = await createApplySetup()
    const repository = openIndexRepository({ path: setup.dbPath })
    const calls: Array<{ url: string; method?: string; body?: string }> = []

    try {
      seedApplyPage(repository, baseStorage)
      repository.upsertPageCreate({
        localId: "create-root",
        spaceKey: "ENG",
        parentPageId: null,
        title: "Root Plan",
        draftMarkdown: "# Root Plan\n",
        createdAt: "2026-07-21T10:00:00Z",
        updatedAt: "2026-07-21T10:00:00Z",
      })

      const result = await applyPageCreateToConfluence("create-root", {
        env: setup.env,
        repository,
        now: fixedClock(),
        fetch: applyFetch(calls, {
          "/wiki/api/v2/spaces?keys=ENG&limit=250": { results: [{ id: "10", key: "ENG", name: "Engineering" }] },
          "/wiki/api/v2/pages": remotePage("102", "Root Plan", 1, ""),
          "/wiki/api/v2/pages/102?body-format=storage": remotePage("102", "Root Plan", 1, "<h1>Root Plan</h1>"),
        }),
      })

      expect(result).toMatchObject({ status: "applied", pageId: "102", title: "Root Plan", remoteVersion: 1 })
      expect(JSON.parse(calls[1]?.body ?? "{}")).toEqual({
        spaceId: "10",
        status: "current",
        title: "Root Plan",
        body: { representation: "storage", value: "<h1>Root Plan</h1>" },
      })
      expect(repository.getPageCreate("create-root")).toBeNull()
      expect(repository.getPage("102")).toMatchObject({ pageId: "102", parentId: null, title: "Root Plan", path: ["Root Plan"] })
    } finally {
      repository.close()
      await setup.cleanup()
    }
  })
})

async function createApplySetup() {
  const dir = await mkdtemp(join(tmpdir(), "lazyconfluence-apply-"))
  const env = {
    LAZYCONFLUENCE_CONFIG_HOME: join(dir, "config"),
    LAZYCONFLUENCE_DB_PATH: join(dir, "index.sqlite3"),
  } as NodeJS.ProcessEnv

  await saveLocalAuth(createLocalConfig({ siteUrl: "https://example.atlassian.net", email: "reader@example.com", spaceKeys: ["ENG"] }), "token", env)

  return {
    env,
    dbPath: env.LAZYCONFLUENCE_DB_PATH,
    cleanup: async () => rm(dir, { recursive: true, force: true }),
  }
}

function seedApplyPage(repository: IndexRepository, storageHtml: string) {
  repository.upsertSpace(space)
  repository.upsertPage(page)
  repository.upsertPageBody(baseBodyArtifact("100", "Project Architecture", storageHtml))
}

function seedDraft(repository: IndexRepository, body: PageBodyArtifact, draftMarkdown: string) {
  repository.upsertPageDraft({
    pageId: body.pageId,
    baseRemoteVersion: body.remoteVersion,
    baseSourceHash: body.sourceHash,
    draftMarkdown,
    status: "staged",
    createdAt: "2026-07-21T10:00:00Z",
    updatedAt: "2026-07-21T10:00:00Z",
    stagedAt: "2026-07-21T10:00:00Z",
  })
}

function baseBodyArtifact(pageId: string, title: string, storageHtml: string): PageBodyArtifact {
  const mapped = mapConfluenceBody({ pageId, title, baseUrl: "https://example.atlassian.net/wiki", remoteVersion: 3, sourceRepresentation: "storage", sourceBody: storageHtml })

  return {
    pageId,
    remoteVersion: 3,
    sourceRepresentation: "storage",
    sourceBody: storageHtml,
    sourceHash: mapped.sidecar.sourceHash,
    canonicalDocument: mapped.document,
    sidecar: mapped.sidecar,
    editableMarkdown: mapped.renderedMarkdown,
    renderedMarkdown: mapped.renderedMarkdown,
    updatedAt: "2026-07-21T09:00:00Z",
  }
}

function applyFetch(calls: Array<{ url: string; method?: string; body?: string }>, responses: Record<string, unknown>): FetchLike {
  return async (url, init) => {
    calls.push({ url, method: init?.method, body: init?.body })
    const key = new URL(url).pathname + new URL(url).search
    const body = responses[key]

    if (!body) return response({ message: `missing fixture for ${key}` }, false, 404, "Not Found")
    return response(body)
  }
}

function response(body: unknown, ok = true, status = 200, statusText = "OK") {
  return { ok, status, statusText, json: async () => body }
}

function remotePage(id: string, title: string, version: number, storageHtml: string) {
  return { id, title, version: { number: version, createdAt: "2026-07-21T10:00:00Z" }, body: { storage: { value: storageHtml } } }
}

function fixedClock() {
  return () => new Date("2026-07-21T11:00:00Z")
}

const baseStorage = "<h1>Project Architecture</h1><p>Base body.</p>"

const space: SpaceSummary = { key: "ENG", name: "Engineering", lastSyncedAt: "2026-07-21T09:00:00Z", pageCount: 1, syncState: "fresh" }

const page: IndexedPage = {
  pageId: "100",
  spaceKey: "ENG",
  title: "Project Architecture",
  url: "https://example.atlassian.net/wiki/spaces/ENG/pages/100/Project+Architecture",
  parentId: null,
  path: ["Project Architecture"],
  owner: "Architecture Guild",
  updatedAt: "2026-07-21T09:00:00Z",
  contentMarkdown: "# Project Architecture\n\nBase body.",
  snippet: "Base body.",
}
