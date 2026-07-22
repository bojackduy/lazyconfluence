import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import type { PageBodyArtifact } from "../src/index/repository"
import type { IndexedPage, PageLink, SpaceSummary } from "../src/model"
import { resolveIndexDatabasePath } from "../src/index/db"
import { openIndexRepository } from "../src/index/repository"

type Repository = ReturnType<typeof openIndexRepository>

describe("local index repository", () => {
  test("opens and creates a configured local database path", async () => {
    const dataHome = await mkdtemp(join(tmpdir(), "lazyconfluence-index-home-"))
    const dbPath = resolveIndexDatabasePath({ LAZYCONFLUENCE_DATA_HOME: dataHome } as NodeJS.ProcessEnv)
    const repository = openIndexRepository({ path: dbPath })

    try {
      const info = await stat(dbPath)

      expect(info.isFile()).toBe(true)
      expect(repository.path).toBe(dbPath)
    } finally {
      repository.close()
      await rm(dataHome, { recursive: true, force: true })
    }
  })

  test("upserts spaces, pages, links, and relationship queries", async () => {
    await withSeededRepository((repository) => {
      expect(repository.getSpace("ENG")?.pageCount).toBe(3)
      expect(repository.getPage("architecture")?.title).toBe("Project Architecture")
      expect(repository.listPagesInSpace("ENG").map((page) => page.pageId)).toEqual(["eng-home", "architecture", "release-checklist"])
      expect(repository.getChildren("eng-home").map((page) => page.pageId)).toEqual(["release-checklist", "architecture"])

      const outgoing = repository.getOutgoingLinks("eng-home")
      const internal = outgoing.find((link) => link.title === "Project Architecture")
      const external = outgoing.find((link) => link.title === "Atlassian docs")

      expect(internal?.kind).toBe("internal")
      expect(internal?.targetPageId).toBe("architecture")
      expect(external?.kind).toBe("external")
      expect(external?.targetPageId).toBeNull()

      const backlinks = repository.getIncomingLinks("architecture")

      expect(backlinks.map((link) => link.fromPageId).sort()).toEqual(["eng-home", "ops-runbook"])
    })
  })

  test("searches pages in one active space and across all spaces", async () => {
    await withSeededRepository((repository) => {
      const activeSpaceResults = repository.searchPagesInSpace("ENG", "release")

      expect(activeSpaceResults[0]?.page.pageId).toBe("release-checklist")
      expect(activeSpaceResults.every((result) => result.page.spaceKey === "ENG")).toBe(true)
      expect(repository.searchPagesInSpace("ENG", "observability")).toEqual([])

      const allSpaceResults = repository.searchPagesAcrossSpaces("observability")

      expect(allSpaceResults[0]?.page.pageId).toBe("observability")
      expect(allSpaceResults[0]?.page.spaceKey).toBe("OPS")
      expect(allSpaceResults[0]?.page.title).toBe("Observability Guide")
      expect(allSpaceResults[0]?.page.path).toEqual(["Operations Home", "Observability Guide"])
      expect(allSpaceResults[0]?.page.snippet).toContain("Dashboards")
    })
  })

  test("matches Confluence URLs back to indexed pages", async () => {
    await withSeededRepository((repository) => {
      const matched = repository.matchPageUrl("https://example.atlassian.net/wiki/spaces/ENG/pages/101/Project+Architecture?focusedCommentId=123#decision-context")

      expect(matched?.pageId).toBe("architecture")
      expect(repository.matchPageUrl("https://example.atlassian.net/wiki/spaces/ENG/pages/999/Missing")).toBeNull()
    })
  })

  test("persists canonical body artifacts separately from search projection", async () => {
    await withSeededRepository((repository) => {
      repository.upsertPageBody(architectureBody)

      const body = repository.getPageBody("architecture")

      expect(body?.sourceRepresentation).toBe("storage")
      expect(body?.sourceBody).toContain("ac:structured-macro")
      expect(body?.canonicalDocument.blocks[0]?.type).toBe("heading")
      expect(body?.sidecar.nodes.opaque.roundTrip).toBe("opaque")
      expect(body?.editableMarkdown).toContain("<!-- confluence-opaque")
      expect(repository.getPage("architecture")?.contentMarkdown).toBe(architecture.contentMarkdown)
    })
  })

  test("persists local page drafts and staged lifecycle", async () => {
    await withSeededRepository((repository) => {
      repository.upsertPageBody(architectureBody)
      repository.upsertPageDraft({
        pageId: "architecture",
        baseRemoteVersion: 7,
        baseSourceHash: "source-hash",
        draftMarkdown: "# Project Architecture\n\nEdited locally.",
        status: "draft",
        createdAt: "2026-07-21T11:00:00Z",
        updatedAt: "2026-07-21T11:00:00Z",
        stagedAt: null,
      })

      expect(repository.getStats()).toMatchObject({ draftCount: 1, stagedDraftCount: 0 })
      expect(repository.getPageDraft("architecture")?.status).toBe("draft")
      expect(repository.listPageDrafts().map((draft) => draft.pageId)).toEqual(["architecture"])
      expect(repository.listPageDrafts("draft")).toHaveLength(1)

      repository.stagePageDraft("architecture", "2026-07-21T11:05:00Z")

      expect(repository.getPageDraft("architecture")).toMatchObject({ status: "staged", stagedAt: "2026-07-21T11:05:00Z" })
      expect(repository.getStats()).toMatchObject({ draftCount: 1, stagedDraftCount: 1 })
      expect(repository.listPageDrafts("staged")).toHaveLength(1)

      repository.unstagePageDraft("architecture", "2026-07-21T11:10:00Z")

      expect(repository.getPageDraft("architecture")).toMatchObject({ status: "draft", stagedAt: null })

      repository.deletePageDraft("architecture")

      expect(repository.getPageDraft("architecture")).toBeNull()
      expect(repository.getStats()).toMatchObject({ draftCount: 0, stagedDraftCount: 0 })
    })
  })

  test("persists staged page creates", async () => {
    await withSeededRepository((repository) => {
      repository.upsertPageCreate({
        localId: "create-1",
        spaceKey: "ENG",
        parentPageId: "eng-home",
        title: "New Runbook",
        draftMarkdown: "# New Runbook\n",
        createdAt: "2026-07-22T09:00:00Z",
        updatedAt: "2026-07-22T09:00:00Z",
      })

      expect(repository.getStats()).toMatchObject({ createCount: 1 })
      expect(repository.getPageCreate("create-1")?.title).toBe("New Runbook")
      expect(repository.listPageCreates("ENG").map((create) => create.localId)).toEqual(["create-1"])
      expect(repository.listPageCreates("OPS")).toEqual([])

      repository.upsertPageCreate({
        localId: "create-root",
        spaceKey: "ENG",
        parentPageId: null,
        title: "Root Plan",
        draftMarkdown: "# Root Plan\n",
        createdAt: "2026-07-22T09:05:00Z",
        updatedAt: "2026-07-22T09:05:00Z",
      })

      expect(repository.getPageCreate("create-root")?.parentPageId).toBeNull()
      expect(repository.listPageCreates("ENG").map((create) => create.localId)).toEqual(["create-root", "create-1"])

      repository.deletePageCreate("create-1")
      repository.deletePageCreate("create-root")

      expect(repository.getPageCreate("create-1")).toBeNull()
      expect(repository.getStats()).toMatchObject({ createCount: 0 })
    })
  })
})

async function withSeededRepository(callback: (repository: Repository) => void | Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "lazyconfluence-index-"))
  const repository = openIndexRepository({ path: join(dir, "index.sqlite3") })

  try {
    seedRepository(repository)
    await callback(repository)
  } finally {
    repository.close()
    await rm(dir, { recursive: true, force: true })
  }
}

function seedRepository(repository: Repository) {
  repository.upsertSpaces(spaces)
  repository.upsertPages([engHome, opsRunbook])
  repository.upsertLinks([homeToArchitecture, homeToExternal, opsToArchitecture])
  repository.upsertPages([architecture, releaseChecklist, observability])
}

const spaces: SpaceSummary[] = [
  {
    key: "ENG",
    name: "Engineering Handbook",
    lastSyncedAt: "2026-07-21T09:30:00Z",
    pageCount: 0,
    syncState: "fresh",
  },
  {
    key: "OPS",
    name: "Operations Runbooks",
    lastSyncedAt: "2026-07-18T16:10:00Z",
    pageCount: 0,
    syncState: "stale",
  },
]

const engHome: IndexedPage = {
  pageId: "eng-home",
  spaceKey: "ENG",
  title: "Engineering Home",
  url: "https://example.atlassian.net/wiki/spaces/ENG/pages/100/Engineering+Home",
  parentId: null,
  path: ["Engineering Home"],
  owner: "Platform Team",
  updatedAt: "2026-07-20T14:22:00Z",
  snippet: "Start here for engineering norms and current programs.",
  contentMarkdown: "# Engineering Home\n\nRead Project Architecture before changing service boundaries.",
}

const architecture: IndexedPage = {
  pageId: "architecture",
  spaceKey: "ENG",
  title: "Project Architecture",
  url: "https://example.atlassian.net/wiki/spaces/ENG/pages/101/Project+Architecture",
  parentId: "eng-home",
  path: ["Engineering Home", "Project Architecture"],
  owner: "Architecture Guild",
  updatedAt: "2026-07-19T11:05:00Z",
  snippet: "How lazyconfluence separates UI, local data, sync, and Confluence mapping.",
  contentMarkdown: "# Project Architecture\n\nThe application is local-first after explicit sync.",
  treeOrder: 1,
}

const releaseChecklist: IndexedPage = {
  pageId: "release-checklist",
  spaceKey: "ENG",
  title: "Release Checklist",
  url: "https://example.atlassian.net/wiki/spaces/ENG/pages/102/Release+Checklist",
  parentId: "eng-home",
  path: ["Engineering Home", "Release Checklist"],
  owner: "Release Managers",
  updatedAt: "2026-07-17T18:40:00Z",
  snippet: "A compact checklist for production releases and rollback readiness.",
  contentMarkdown: "# Release Checklist\n\nConfirm tests, owners, dashboards, and rollback notes.",
  treeOrder: 0,
}

const opsRunbook: IndexedPage = {
  pageId: "ops-runbook",
  spaceKey: "OPS",
  title: "Architecture Reference Runbook",
  url: "https://example.atlassian.net/wiki/spaces/OPS/pages/200/Architecture+Reference+Runbook",
  parentId: null,
  path: ["Architecture Reference Runbook"],
  owner: "Operations",
  updatedAt: "2026-07-18T09:00:00Z",
  snippet: "Operational page that links back to architecture.",
  contentMarkdown: "# Architecture Reference Runbook\n\nUse the architecture page during incidents.",
}

const observability: IndexedPage = {
  pageId: "observability",
  spaceKey: "OPS",
  title: "Observability Guide",
  url: "https://example.atlassian.net/wiki/spaces/OPS/pages/201/Observability+Guide",
  parentId: "ops-runbook",
  path: ["Operations Home", "Observability Guide"],
  owner: "Operations",
  updatedAt: "2026-07-18T09:20:00Z",
  snippet: "Dashboards, alerts, and traces for production services.",
  contentMarkdown: "# Observability Guide\n\nUse dashboards and alerts to inspect production health.",
}

const homeToArchitecture: PageLink = {
  fromPageId: "eng-home",
  targetUrl: "https://example.atlassian.net/wiki/spaces/ENG/pages/101/Project+Architecture?focusedCommentId=abc#context",
  targetPageId: null,
  title: "Project Architecture",
  kind: "external",
}

const homeToExternal: PageLink = {
  fromPageId: "eng-home",
  targetUrl: "https://developer.atlassian.com/cloud/confluence/rest/v2/",
  targetPageId: null,
  title: "Atlassian docs",
  kind: "external",
}

const opsToArchitecture: PageLink = {
  fromPageId: "ops-runbook",
  targetUrl: "https://example.atlassian.net/wiki/spaces/ENG/pages/101/Project+Architecture",
  targetPageId: null,
  title: "Project Architecture",
  kind: "internal",
}

const architectureBody: PageBodyArtifact = {
  pageId: "architecture",
  remoteVersion: 7,
  sourceRepresentation: "storage",
  sourceBody: '<h1>Project Architecture</h1><ac:structured-macro ac:name="toc" />',
  sourceHash: "source-hash",
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
        type: "unsupported",
        nodeId: "opaque",
        sourceType: "ac:structured-macro:toc",
        fallbackText: "",
      },
    ],
  },
  sidecar: {
    schemaVersion: 1,
    remoteVersion: 7,
    sourceRepresentation: "storage",
    sourceHash: "source-hash",
    nodes: {
      opaque: {
        sourcePath: "storage.blocks[1]",
        sourceHash: "macro-hash",
        sourceType: "ac:structured-macro:toc",
        raw: '<ac:structured-macro ac:name="toc" />',
        roundTrip: "opaque",
      },
    },
  },
  editableMarkdown: '# Project Architecture\n\n<!-- confluence-opaque node="opaque" type="ac:structured-macro:toc" -->',
  renderedMarkdown: '# Project Architecture\n\n<!-- confluence-opaque node="opaque" type="ac:structured-macro:toc" -->',
  updatedAt: "2026-07-21T10:00:00Z",
}
