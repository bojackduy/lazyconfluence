import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { createLocalConfig, saveLocalAuth } from "../src/config"
import { openIndexRepository } from "../src/index/repository"
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
      expect(output.stdout).toContain("Schema version: 2")
      expect(output.stdout).toContain("Spaces indexed: 2")
      expect(output.stdout).toContain("Pages indexed: 3")
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
      "/wiki/api/v2/pages?space-id=10&limit=100&body-format=storage": {
        results: [confluencePagePayload("100", "Engineering Home", null, "<p>Home page.</p>")],
        _links: {},
      },
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

function confluencePagePayload(id: string, title: string, parentId: string | null, storageHtml: string) {
  return {
    id,
    title,
    parentId,
    ownerId: "owner",
    version: { number: 1, createdAt: "2026-07-21T09:00:00Z" },
    _links: { webui: `/wiki/spaces/ENG/pages/${id}/${title.replace(/\s+/g, "+")}` },
    body: { storage: { value: storageHtml } },
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
