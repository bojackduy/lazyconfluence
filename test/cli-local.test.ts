import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { createLocalConfig, saveLocalAuth } from "../src/config"
import { openIndexRepository, type PageBodyArtifact } from "../src/index/repository"
import { runCli } from "../src/cli"
import type { IndexedPage, SpaceSummary } from "../src/model"

describe("local CLI integration", () => {
  test("doctor reports local config and SQLite index status without network", async () => {
    const setup = await createCliSetup()

    try {
      seedCliRepository(setup.dbPath)
      const output = await captureCli(() => withProcessEnv(setup.env, () => runCli(["doctor"])))

      expect(output.exitCode).toBeUndefined()
      expect(output.stdout).toContain("lazyconfluence local config")
      expect(output.stdout).toContain("Default space: ENG")
      expect(output.stdout).toContain(`Database: ${setup.dbPath}`)
      expect(output.stdout).toContain("Schema version: 9")
      expect(output.stdout).toContain("Spaces indexed: 2")
      expect(output.stdout).toContain("Pages indexed: 3")
      expect(output.stdout).toContain("Local drafts: 0")
      expect(output.stdout).toContain("Staged drafts: 0")
      expect(output.stdout).toContain("Configured space ENG: 2 local pages")
      expect(output.stdout).toContain("Configured space OPS: 1 local pages")
      expect(output.stdout).toContain("No remote doctor check was run.")
    } finally {
      await setup.cleanup()
    }
  })

  test("search defaults to the configured default space", async () => {
    const setup = await createCliSetup()

    try {
      seedCliRepository(setup.dbPath)
      const output = await captureCli(() => withProcessEnv(setup.env, () => runCli(["search", "observability"])))

      expect(output.exitCode).toBeUndefined()
      expect(output.stdout).toContain("No local results.")
      expect(output.stdout).not.toContain("Observability Guide")
    } finally {
      await setup.cleanup()
    }
  })

  test("search can target one space or all spaces", async () => {
    const setup = await createCliSetup()

    try {
      seedCliRepository(setup.dbPath)
      const scoped = await captureCli(() => withProcessEnv(setup.env, () => runCli(["search", "--space", "OPS", "observability"])))
      const all = await captureCli(() => withProcessEnv(setup.env, () => runCli(["search", "--all", "architecture"])))

      expect(scoped.stdout).toContain("Local search results in OPS")
      expect(scoped.stdout).toContain("[OPS] Architecture Reference Runbook")
      expect(scoped.stdout).toContain("Dashboards, alerts, and traces")
      expect(all.stdout).toContain("Local search results across all spaces")
      expect(all.stdout).toContain("[ENG] Project Architecture")
      expect(all.stdout).toContain("[OPS] Architecture Reference Runbook")
    } finally {
      await setup.cleanup()
    }
  })

  test("sync prints progress by default and supports quiet summary output", async () => {
    const setup = await createCliSetup()
    const responses = {
      "/wiki/api/v2/spaces?keys=ENG&limit=250": {
        results: [{ id: "10", key: "ENG", name: "Engineering", homepageId: "100" }],
      },
      "/wiki/api/v2/pages?space-id=10&limit=100&body-format=storage&status=current": {
        results: [confluencePagePayload("100", "Engineering Home", null, "<p>Home page.</p>")],
        _links: {},
      },
      "/wiki/api/v2/pages?space-id=10&limit=100&body-format=storage&status=archived": { results: [], _links: {} },
      "/wiki/api/v2/pages/100/direct-children?limit=250": { results: [], _links: {} },
    }

    try {
      const output = await withMockFetch(jsonGlobalFetch(responses), () => captureCli(() => withProcessEnv(setup.env, () => runCli(["sync", "--space", "ENG"]))))
      const quiet = await withMockFetch(jsonGlobalFetch(responses), () => captureCli(() => withProcessEnv(setup.env, () => runCli(["sync", "--quiet", "--space", "ENG"]))))

      expect(output.stdout).toContain("Resolving spaces: ENG.")
      expect(output.stdout).toContain("Fetching pages for ENG.")
      expect(output.stdout).toContain("Writing 1 pages, 0 links, and 1 body artifacts for ENG.")
      expect(output.stdout).toContain("Sync completed.")
      expect(quiet.stdout).not.toContain("Resolving spaces: ENG.")
      expect(quiet.stdout).not.toContain("Fetching pages for ENG.")
      expect(quiet.stdout).toContain("Sync completed.")
      expect(output.exitCode).toBeUndefined()
      expect(quiet.exitCode).toBeUndefined()
    } finally {
      await setup.cleanup()
    }
  })

  test("sync reports page body failures without failing the usable local index", async () => {
    const setup = await createCliSetup()
    const responses = {
      "/wiki/api/v2/spaces?keys=ENG&limit=250": {
        results: [{ id: "10", key: "ENG", name: "Engineering", homepageId: "100" }],
      },
      "/wiki/api/v2/pages?space-id=10&limit=100&body-format=storage&status=current": {
        results: [confluencePagePayload("100", "Engineering Home", null, "<p>Home page.</p>"), confluencePageMetadata("bad", "Bad Page", null)],
        _links: {},
      },
      "/wiki/api/v2/pages?space-id=10&limit=100&body-format=storage&status=archived": { results: [], _links: {} },
      "/wiki/api/v2/pages/100/direct-children?limit=250": { results: [], _links: {} },
      "/wiki/api/v2/pages/bad/direct-children?limit=250": { results: [], _links: {} },
      "/wiki/api/v2/pages/bad?body-format=storage": fetchResponse({ message: "boom" }, false, 500, "Server Error"),
    }

    try {
      const output = await withMockFetch(jsonGlobalFetch(responses), () => captureCli(() => withProcessEnv(setup.env, () => runCli(["sync", "--space", "ENG"]))))

      expect(output.exitCode).toBeUndefined()
      expect(output.stdout).toContain("Failed page bad")
      expect(output.stdout).toContain("Sync completed with failures.")
      expect(output.stdout).toContain("Pages indexed: 2")
      expect(output.stdout).toContain("page bad: Confluence returned HTTP 500")
    } finally {
      await setup.cleanup()
    }
  })

  test("repair rebuilds local body artifacts and page projections without network", async () => {
    const setup = await createCliSetup()

    try {
      seedCliRepository(setup.dbPath)
      seedStaleMermaidBody(setup.dbPath)

      const output = await captureCli(() => withProcessEnv(setup.env, () => runCli(["repair"])))

      expect(output.exitCode).toBeUndefined()
      expect(output.stdout).toContain("Repair completed.")
      expect(output.stdout).toContain("Body artifacts scanned: 1")
      expect(output.stdout).toContain("Body artifacts rebuilt: 1")
      expect(output.stdout).toContain("Pages updated: 1")

      const repository = openIndexRepository({ path: setup.dbPath })

      try {
        const body = repository.getPageBody("architecture")
        const page = repository.getPage("architecture")

        expect(body?.renderedMarkdown).toBe("```mermaid\nerDiagram\nretailers {\n  uuid id PK\n}\n```")
        expect(page?.contentMarkdown).toBe(body?.renderedMarkdown)
        expect(page?.snippet).toContain("erDiagram")
      } finally {
        repository.close()
      }
    } finally {
      await setup.cleanup()
    }
  })

  test("draft commands manage local staged edits without network", async () => {
    const setup = await createCliSetup()

    try {
      seedCliRepository(setup.dbPath)
      seedEditableBody(setup.dbPath)
      const draftPath = join(setup.dir, "architecture-draft.md")
      await writeFile(draftPath, "# Project Architecture\n\nLocal-first architecture notes.\n\nEdited locally.\n", "utf8")

      const saved = await captureCli(() => withProcessEnv(setup.env, () => runCli(["draft", "architecture", "--file", draftPath])))
      const listed = await captureCli(() => withProcessEnv(setup.env, () => runCli(["drafts"])))
      const diff = await captureCli(() => withProcessEnv(setup.env, () => runCli(["diff", "architecture"])))
      const preview = await captureCli(() => withProcessEnv(setup.env, () => runCli(["preview", "architecture"])))
      const staged = await captureCli(() => withProcessEnv(setup.env, () => runCli(["stage", "architecture"])))
      const listedStaged = await captureCli(() => withProcessEnv(setup.env, () => runCli(["drafts", "--staged"])))
      const unstaged = await captureCli(() => withProcessEnv(setup.env, () => runCli(["unstage", "architecture"])))
      const discarded = await captureCli(() => withProcessEnv(setup.env, () => runCli(["discard", "architecture"])))
      const empty = await captureCli(() => withProcessEnv(setup.env, () => runCli(["drafts"])))

      expect(saved.exitCode).toBeUndefined()
      expect(saved.stdout).toContain("Saved local draft for Project Architecture (architecture).")
      expect(listed.stdout).toContain("Local drafts:")
      expect(listed.stdout).toContain("[draft] [ENG] Project Architecture (architecture)")
      expect(diff.stdout).toContain("Diff for Project Architecture (architecture):")
      expect(diff.stdout).toContain("--- synced")
      expect(diff.stdout).toContain("+++ draft")
      expect(diff.stdout).toContain("+Edited locally.")
      expect(preview.stdout).toContain("Edited locally.")
      expect(staged.stdout).toContain("Staged draft for Project Architecture (architecture).")
      expect(listedStaged.stdout).toContain("[staged] [ENG] Project Architecture (architecture)")
      expect(unstaged.stdout).toContain("Unstaged draft for Project Architecture (architecture).")
      expect(discarded.stdout).toContain("Discarded local draft for Project Architecture (architecture).")
      expect(empty.stdout).toContain("No local drafts.")
    } finally {
      await setup.cleanup()
    }
  })
})

async function createCliSetup() {
  const dir = await mkdtemp(join(tmpdir(), "lazyconfluence-cli-"))
  const dbPath = join(dir, "index.sqlite3")
  const env = {
    LAZYCONFLUENCE_CONFIG_HOME: join(dir, "config"),
    LAZYCONFLUENCE_DB_PATH: dbPath,
  } as NodeJS.ProcessEnv

  await saveLocalAuth(createLocalConfig({ siteUrl: "https://example.atlassian.net", email: "reader@example.com", spaceKeys: ["ENG", "OPS"] }), "token", env)

  return {
    dir,
    env,
    dbPath,
    cleanup: async () => rm(dir, { recursive: true, force: true }),
  }
}

function seedCliRepository(dbPath: string) {
  const repository = openIndexRepository({ path: dbPath })

  try {
    repository.upsertSpaces(spaces)
    repository.upsertPages(pages)
  } finally {
    repository.close()
  }
}

function seedStaleMermaidBody(dbPath: string) {
  const repository = openIndexRepository({ path: dbPath })

  try {
    repository.upsertPage({ ...pages[0], contentMarkdown: "`erDiagram retailers { uuid id PK }`", snippet: "erDiagram retailers" })
    repository.upsertPageBody(staleMermaidBody)
  } finally {
    repository.close()
  }
}

function seedEditableBody(dbPath: string) {
  const repository = openIndexRepository({ path: dbPath })

  try {
    repository.upsertPageBody(editableArchitectureBody)
  } finally {
    repository.close()
  }
}

async function captureCli(callback: () => Promise<void>) {
  const originalLog = console.log
  const originalError = console.error
  const originalExitCode = process.exitCode
  const stdout: string[] = []
  const stderr: string[] = []

  process.exitCode = undefined
  console.log = (...values: unknown[]) => stdout.push(values.map(String).join(" "))
  console.error = (...values: unknown[]) => stderr.push(values.map(String).join(" "))

  try {
    await callback()

    return { stdout: stdout.join("\n"), stderr: stderr.join("\n"), exitCode: process.exitCode }
  } finally {
    console.log = originalLog
    console.error = originalError
    process.exitCode = originalExitCode
  }
}

async function withProcessEnv(env: NodeJS.ProcessEnv, callback: () => Promise<void>) {
  const originalConfigHome = process.env.LAZYCONFLUENCE_CONFIG_HOME
  const originalDbPath = process.env.LAZYCONFLUENCE_DB_PATH

  process.env.LAZYCONFLUENCE_CONFIG_HOME = env.LAZYCONFLUENCE_CONFIG_HOME
  process.env.LAZYCONFLUENCE_DB_PATH = env.LAZYCONFLUENCE_DB_PATH

  try {
    await callback()
  } finally {
    restoreEnv("LAZYCONFLUENCE_CONFIG_HOME", originalConfigHome)
    restoreEnv("LAZYCONFLUENCE_DB_PATH", originalDbPath)
  }
}

async function withMockFetch<T>(mockFetch: typeof fetch, callback: () => Promise<T>) {
  const originalFetch = globalThis.fetch

  globalThis.fetch = mockFetch

  try {
    return await callback()
  } finally {
    globalThis.fetch = originalFetch
  }
}

function jsonGlobalFetch(responses: Record<string, unknown>) {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    const parsed = new URL(url)
    const body = responses[`${parsed.pathname}${parsed.search}`]

    if (!body) return fetchResponse({ message: `missing fixture for ${parsed.pathname}${parsed.search}` }, false, 404, "Not Found") as Response
    if (isResponseLike(body)) return body as Response

    return fetchResponse(body) as Response
  }) as typeof fetch
}

function fetchResponse(body: unknown, ok = true, status = 200, statusText = "OK") {
  return {
    ok,
    status,
    statusText,
    json: async () => body,
  }
}

function isResponseLike(value: unknown): value is ReturnType<typeof fetchResponse> {
  return typeof value === "object" && value !== null && "ok" in value && "json" in value
}

function confluencePagePayload(id: string, title: string, parentId: string | null, storageHtml: string) {
  return {
    ...confluencePageMetadata(id, title, parentId),
    body: { storage: { value: storageHtml } },
  }
}

function confluencePageMetadata(id: string, title: string, parentId: string | null) {
  return {
    id,
    title,
    parentId,
    ownerId: "owner",
    version: { number: 1, createdAt: "2026-07-21T09:00:00Z" },
    _links: { webui: `/wiki/spaces/ENG/pages/${id}/${title.replace(/\s+/g, "+")}` },
  }
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name]
    return
  }

  process.env[name] = value
}

const spaces: SpaceSummary[] = [
  { key: "ENG", name: "Engineering", lastSyncedAt: "2026-07-21T10:00:00Z", pageCount: 0, syncState: "fresh" },
  { key: "OPS", name: "Operations", lastSyncedAt: "2026-07-21T10:00:00Z", pageCount: 0, syncState: "fresh" },
]

const pages: IndexedPage[] = [
  {
    pageId: "architecture",
    spaceKey: "ENG",
    title: "Project Architecture",
    url: "https://example.atlassian.net/wiki/spaces/ENG/pages/101/Project+Architecture",
    parentId: null,
    path: ["Project Architecture"],
    owner: "Architecture Guild",
    updatedAt: "2026-07-21T09:00:00Z",
    contentMarkdown: "# Project Architecture\n\nLocal-first architecture notes.",
    snippet: "Local-first architecture notes.",
  },
  {
    pageId: "release",
    spaceKey: "ENG",
    title: "Release Checklist",
    url: "https://example.atlassian.net/wiki/spaces/ENG/pages/102/Release+Checklist",
    parentId: null,
    path: ["Release Checklist"],
    owner: "Release Managers",
    updatedAt: "2026-07-21T08:00:00Z",
    contentMarkdown: "# Release Checklist\n\nConfirm rollback notes.",
    snippet: "Confirm rollback notes.",
  },
  {
    pageId: "ops-architecture",
    spaceKey: "OPS",
    title: "Architecture Reference Runbook",
    url: "https://example.atlassian.net/wiki/spaces/OPS/pages/201/Architecture+Reference+Runbook",
    parentId: null,
    path: ["Architecture Reference Runbook"],
    owner: "Operations",
    updatedAt: "2026-07-21T07:00:00Z",
    contentMarkdown: "# Architecture Reference Runbook\n\nDashboards, alerts, and traces for observability.",
    snippet: "Dashboards, alerts, and traces for observability.",
  },
]

const staleMermaidBody: PageBodyArtifact = {
  pageId: "architecture",
  remoteVersion: 7,
  sourceRepresentation: "storage",
  sourceBody: [
    "<p><code>erDiagram</code></p>",
    "<p><code>retailers {</code></p>",
    "<p><code>  uuid id PK</code></p>",
    "<p><code>}</code></p>",
  ].join(""),
  sourceHash: "old-hash",
  canonicalDocument: {
    schemaVersion: 1,
    pageId: "architecture",
    title: "Project Architecture",
    blocks: [
      {
        type: "paragraph",
        nodeId: "old-inline",
        inlines: [{ type: "code", text: "erDiagram retailers { uuid id PK }" }],
      },
    ],
  },
  sidecar: {
    schemaVersion: 1,
    remoteVersion: 7,
    sourceRepresentation: "storage",
    sourceHash: "old-hash",
    nodes: {},
  },
  editableMarkdown: "`erDiagram retailers { uuid id PK }`",
  renderedMarkdown: "`erDiagram retailers { uuid id PK }`",
  updatedAt: "2026-07-21T09:00:00Z",
}

const editableArchitectureBody: PageBodyArtifact = {
  pageId: "architecture",
  remoteVersion: 3,
  sourceRepresentation: "storage",
  sourceBody: "<h1>Project Architecture</h1><p>Local-first architecture notes.</p>",
  sourceHash: "base-hash",
  canonicalDocument: {
    schemaVersion: 1,
    pageId: "architecture",
    title: "Project Architecture",
    blocks: [
      {
        type: "heading",
        nodeId: "heading",
        level: 1,
        inlines: [{ type: "text", text: "Project Architecture" }],
      },
      {
        type: "paragraph",
        nodeId: "paragraph",
        inlines: [{ type: "text", text: "Local-first architecture notes." }],
      },
    ],
  },
  sidecar: {
    schemaVersion: 1,
    remoteVersion: 3,
    sourceRepresentation: "storage",
    sourceHash: "base-hash",
    nodes: {},
  },
  editableMarkdown: "# Project Architecture\n\nLocal-first architecture notes.",
  renderedMarkdown: "# Project Architecture\n\nLocal-first architecture notes.",
  updatedAt: "2026-07-21T09:00:00Z",
}
