import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { App, ReviewDraftOverlay } from "../src/tui/app"
import { createLocalConfig } from "../src/config"
import type { CredentialStatus } from "../src/config"
import { openIndexRepository } from "../src/index/repository"
import type { PageBodyArtifact } from "../src/index/repository"
import { createRepositoryTuiDataSource } from "../src/tui/data"
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
      expect(output).toContain("e edit")
      expect(output).toContain("d/u scroll doc")
      expect(output).toContain("▾ ▣ Local Engineering Home")
      expect(output).toContain("• Real Synced Architecture")
      expect(output).toContain("Real Synced Architecture")
      expect(output).toContain("ID: local-home")
      expect(output).toContain("Space: ENG")
      expect(output).toContain("Parent: root")
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

  test("keeps navigator siblings in synced tree order", async () => {
    const setup = await createTuiTestSetup({ architecture: { ...architecture, treeOrder: 1 }, extraPages: [zebraFirstChild] })

    try {
      const output = await withProcessEnv(setup.env, async () => {
        const rendered = await testRender(() => <App credentialStatus={readyStatus} />, { width: 120, height: 36 })

        await rendered.renderOnce()

        const frame = rendered.captureCharFrame()
        rendered.renderer.destroy()

        return frame
      })

      expect(output.indexOf("Zebra First Child")).toBeGreaterThan(-1)
      expect(output.indexOf("Real Synced Architecture")).toBeGreaterThan(-1)
      expect(output.indexOf("Zebra First Child")).toBeLessThan(output.indexOf("Real Synced Architecture"))
    } finally {
      await setup.cleanup()
    }
  })

  test("TUI surfaces local draft state", async () => {
    const setup = await createTuiTestSetup({ bodyArtifacts: [homeBody] })
    const repository = openIndexRepository({ path: setup.dbPath })
    const dataSource = createRepositoryTuiDataSource(repository)

    try {
      dataSource.savePageDraft("local-home", "# Local Engineering Home\n\nEdited from TUI.\n")
      expect(repository.getPageDraft("local-home")).toMatchObject({ status: "draft", draftMarkdown: "# Local Engineering Home\n\nEdited from TUI.\n" })

      const output = await withProcessEnv(setup.env, async () => {
        const rendered = await testRender(() => <App credentialStatus={readyStatus} dataSource={dataSource} />, { width: 120, height: 36 })

        try {
          await rendered.renderOnce()
          return rendered.captureCharFrame()
        } finally {
          rendered.renderer.destroy()
        }
      })

      expect(output).toContain("draft")
      expect(output).toContain("e edit")
    } finally {
      dataSource.close?.()
      await setup.cleanup()
    }
  })

  test("TUI draft source saves, stages, diffs, unstages, and discards local drafts", async () => {
    const setup = await createTuiTestSetup({ bodyArtifacts: [homeBody] })
    const repository = openIndexRepository({ path: setup.dbPath })
    const dataSource = createRepositoryTuiDataSource(repository)

    try {
      const markdown = "# Local Engineering Home\n\nEdited from in-app editor."

      expect(dataSource.savePageDraft("local-home", markdown)).toMatchObject({ status: "saved", pageTitle: "Local Engineering Home" })
      expect(repository.getPageDraft("local-home")).toMatchObject({ status: "draft", draftMarkdown: markdown })

      expect(dataSource.stagePageDraft("local-home", markdown)).toBe("staged")
      expect(repository.getPageDraft("local-home")?.status).toBe("staged")

      const diff = dataSource.formatPageDraftDiff("local-home", markdown)
      expect(diff).toContain("+++ draft")
      expect(diff).toContain("+Edited from in-app editor.")

      expect(dataSource.unstagePageDraft("local-home")).toBe("unstaged")
      expect(repository.getPageDraft("local-home")?.status).toBe("draft")

      expect(dataSource.discardPageDraft("local-home")).toBe("discarded")
      expect(repository.getPageDraft("local-home")).toBeNull()

      expect(dataSource.savePageDraft("local-home", homeBody.editableMarkdown)).toMatchObject({ status: "unchanged" })
      expect(repository.getPageDraft("local-home")).toBeNull()
    } finally {
      dataSource.close?.()
      await setup.cleanup()
    }
  })

  test("reader previews saved draft content when a draft exists", async () => {
    const setup = await createTuiTestSetup({ bodyArtifacts: [homeBody] })
    const repository = openIndexRepository({ path: setup.dbPath })
    const dataSource = createRepositoryTuiDataSource(repository)

    try {
      dataSource.savePageDraft("local-home", "# Local Engineering Home\n\nDraft preview from local editor.")

      const output = await withProcessEnv(setup.env, async () => {
        const rendered = await testRender(() => <App credentialStatus={readyStatus} dataSource={dataSource} />, { width: 120, height: 36 })

        try {
          await rendered.renderOnce()
          return rendered.captureCharFrame()
        } finally {
          rendered.renderer.destroy()
        }
      })

      expect(output).toContain("Draft preview from local editor.")
      expect(output).not.toContain("Local synced content from SQLite")
    } finally {
      dataSource.close?.()
      await setup.cleanup()
    }
  })

  test("renders draft review controls and apply feedback", async () => {
    const rendered = await testRender(() => (
      <ReviewDraftOverlay
        visible
        pageTitle="Local Engineering Home"
        pageId="local-home"
        draftStatus="staged"
        dirty={false}
        message="Apply blocked: Cannot safely preserve opaque Confluence content."
        applying={false}
        diffMarkdown={["--- synced", "+++ draft", "@@", "-Old body", "+New body"].join("\n")}
        width={80}
        height={18}
        onApply={() => {}}
        onStage={() => {}}
        onDiscard={() => {}}
        onClose={() => {}}
      />
    ), { width: 90, height: 24 })

    try {
      await rendered.renderOnce()
      const output = rendered.captureCharFrame()

      expect(output).toContain("REVIEW DRAFT")
      expect(output).toContain("ID: local-home")
      expect(output).toContain("Draft: staged")
      expect(output).toContain("Apply blocked: Cannot safely preserve opaque Confluence content.")
      expect(output).toContain("+++ draft")
      expect(output).toContain("Apply")
      expect(output).toContain("Unstage")
      expect(output).toContain("Discard")
      expect(output).toContain("Close")
    } finally {
      rendered.renderer.destroy()
    }
  })
})

async function createTuiTestSetup(overrides: { home?: IndexedPage; architecture?: IndexedPage; extraPages?: IndexedPage[]; bodyArtifacts?: PageBodyArtifact[] } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "lazyconfluence-tui-"))
  const dbPath = join(dir, "index.sqlite3")
  const repository = openIndexRepository({ path: dbPath })

  try {
    repository.upsertSpace(space)
    repository.upsertPages([overrides.home ?? home, overrides.architecture ?? architecture, ...(overrides.extraPages ?? [])])
    repository.upsertPageBodies(overrides.bodyArtifacts ?? [])
  } finally {
    repository.close()
  }

  return {
    env: { LAZYCONFLUENCE_DB_PATH: dbPath } as NodeJS.ProcessEnv,
    dbPath,
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

const homeBody: PageBodyArtifact = {
  pageId: "local-home",
  remoteVersion: 4,
  sourceRepresentation: "storage",
  sourceBody: "<h1>Local Engineering Home</h1><p>Local synced content from SQLite.</p>",
  sourceHash: "home-source-hash",
  canonicalDocument: {
    schemaVersion: 1,
    pageId: "local-home",
    title: "Local Engineering Home",
    blocks: [
      {
        type: "heading",
        nodeId: "heading",
        level: 1,
        inlines: [{ type: "text", text: "Local Engineering Home" }],
      },
      {
        type: "paragraph",
        nodeId: "paragraph",
        inlines: [{ type: "text", text: "Local synced content from SQLite." }],
      },
    ],
  },
  sidecar: {
    schemaVersion: 1,
    remoteVersion: 4,
    sourceRepresentation: "storage",
    sourceHash: "home-source-hash",
    nodes: {},
  },
  editableMarkdown: "# Local Engineering Home\n\nLocal synced content from SQLite.",
  renderedMarkdown: "# Local Engineering Home\n\nLocal synced content from SQLite.",
  updatedAt: "2026-07-21T10:00:00Z",
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
  treeOrder: 0,
}

const zebraFirstChild: IndexedPage = {
  pageId: "zebra-first-child",
  spaceKey: "ENG",
  title: "Zebra First Child",
  url: "https://example.atlassian.net/wiki/spaces/ENG/pages/103/Zebra+First+Child",
  parentId: "local-home",
  path: ["Local Engineering Home", "Zebra First Child"],
  owner: "Architecture Guild",
  updatedAt: "2026-07-21T09:20:00Z",
  contentMarkdown: "# Zebra First Child\n\nThis page comes first in Confluence order.",
  snippet: "This page comes first in Confluence order.",
  treeOrder: 0,
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
