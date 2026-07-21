import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { App } from "../src/tui/app"
import { createLocalConfig } from "../src/config"
import type { CredentialStatus } from "../src/config"
import { openIndexRepository } from "../src/index/repository"
import type { IndexedPage, SpaceSummary } from "../src/model"

describe("main TUI layout", () => {
  test("renders navigator and document labels in a headless frame", async () => {
    const setup = await createTuiTestSetup()

    try {
      const output = await withProcessEnv(setup.env, async () => {
        const rendered = await testRender(() => <App credentialStatus={readyStatus} />, { width: 120, height: 36 })

        await rendered.renderOnce()

        const frame = rendered.captureCharFrame()
        rendered.renderer.destroy()

        return frame
      })

      expect(output).toContain("NAVIGATOR")
      expect(output).toContain("DOCUMENT")
      expect(output).toContain("j/k move")
      expect(output).toContain("h/l fold")
      expect(output).toContain("s spaces")
      expect(output).toContain("d/u scroll doc")
      expect(output).toContain("▾ ▣ Local Engineering Home")
      expect(output).toContain("• Real Synced Architecture")
      expect(output).toContain("Real Synced Architecture")
      expect(output).toContain("Local synced content from SQLite")
      expect(output).toContain("code: typescript")
      expect(output).toContain("const answer = 42")
      expect(output).not.toContain("Start here for engineering norms")
    } finally {
      await setup.cleanup()
    }
  })

  test("renders pages with missing updated timestamps without crashing", async () => {
    const setup = await createTuiTestSetup({ home: { ...home, updatedAt: "" } })

    try {
      const output = await withProcessEnv(setup.env, async () => {
        const rendered = await testRender(() => <App credentialStatus={readyStatus} />, { width: 120, height: 36 })

        await rendered.renderOnce()

        const frame = rendered.captureCharFrame()
        rendered.renderer.destroy()

        return frame
      })

      expect(output).toContain("Local Engineering Home")
      expect(output).toContain("Updated: unknown")
    } finally {
      await setup.cleanup()
    }
  })

  test("renders locally orphaned pages instead of hiding them", async () => {
    const setup = await createTuiTestSetup({ extraPages: [orphanedRunbook] })

    try {
      const output = await withProcessEnv(setup.env, async () => {
        const rendered = await testRender(() => <App credentialStatus={readyStatus} />, { width: 120, height: 36 })

        await rendered.renderOnce()

        const frame = rendered.captureCharFrame()
        rendered.renderer.destroy()

        return frame
      })

      expect(output).toContain("Orphaned Runbook")
      expect(output).toContain("• Orphaned Runbook")
    } finally {
      await setup.cleanup()
    }
  })
})

async function createTuiTestSetup(overrides: { home?: IndexedPage; architecture?: IndexedPage; extraPages?: IndexedPage[] } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "lazyconfluence-tui-"))
  const dbPath = join(dir, "index.sqlite3")
  const repository = openIndexRepository({ path: dbPath })

  try {
    repository.upsertSpace(space)
    repository.upsertPages([overrides.home ?? home, overrides.architecture ?? architecture, ...(overrides.extraPages ?? [])])
  } finally {
    repository.close()
  }

  return {
    env: { LAZYCONFLUENCE_DB_PATH: dbPath } as NodeJS.ProcessEnv,
    cleanup: async () => rm(dir, { recursive: true, force: true }),
  }
}

async function withProcessEnv<T>(env: NodeJS.ProcessEnv, callback: () => Promise<T>) {
  const originalDbPath = process.env.LAZYCONFLUENCE_DB_PATH

  process.env.LAZYCONFLUENCE_DB_PATH = env.LAZYCONFLUENCE_DB_PATH

  try {
    return await callback()
  } finally {
    restoreEnv("LAZYCONFLUENCE_DB_PATH", originalDbPath)
  }
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name]
    return
  }

  process.env[name] = value
}

const readyStatus: CredentialStatus = {
  kind: "ready",
  auth: {
    config: createLocalConfig({ siteUrl: "https://example.atlassian.net", email: "reader@example.com", spaceKeys: ["ENG"] }),
    apiToken: "token",
    paths: {
      configDir: "/tmp/lazyconfluence",
      configFile: "/tmp/lazyconfluence/config.json",
      credentialFile: "/tmp/lazyconfluence/atlassian.env",
    },
  },
}

const space: SpaceSummary = {
  key: "ENG",
  name: "Local Engineering",
  lastSyncedAt: "2026-07-21T10:00:00Z",
  pageCount: 0,
  syncState: "fresh",
}

const home: IndexedPage = {
  pageId: "local-home",
  spaceKey: "ENG",
  title: "Local Engineering Home",
  url: "https://example.atlassian.net/wiki/spaces/ENG/pages/100/Local+Engineering+Home",
  parentId: null,
  path: ["Local Engineering Home"],
  owner: "Platform Team",
  updatedAt: "2026-07-21T09:00:00Z",
  contentMarkdown: "# Local Engineering Home\n\nLocal synced content from SQLite with `inline metadata`.\n\n```ts\nconst answer = 42\n```\n\n| Area | Owner |\n| --- | --- |\n| Sync | Platform |",
  snippet: "Local synced content from SQLite.",
}

const architecture: IndexedPage = {
  pageId: "real-architecture",
  spaceKey: "ENG",
  title: "Real Synced Architecture",
  url: "https://example.atlassian.net/wiki/spaces/ENG/pages/101/Real+Synced+Architecture",
  parentId: "local-home",
  path: ["Local Engineering Home", "Real Synced Architecture"],
  owner: "Architecture Guild",
  updatedAt: "2026-07-21T09:30:00Z",
  contentMarkdown: "# Real Synced Architecture\n\nRepository-backed page.",
  snippet: "Repository-backed page.",
}

const orphanedRunbook: IndexedPage = {
  pageId: "orphaned-runbook",
  spaceKey: "ENG",
  title: "Orphaned Runbook",
  url: "https://example.atlassian.net/wiki/spaces/ENG/pages/102/Orphaned+Runbook",
  parentId: "missing-parent",
  path: ["Missing Parent", "Orphaned Runbook"],
  owner: "Operations Guild",
  updatedAt: "2026-07-21T09:45:00Z",
  contentMarkdown: "# Orphaned Runbook\n\nThis page should still be reachable.",
  snippet: "This page should still be reachable.",
}
