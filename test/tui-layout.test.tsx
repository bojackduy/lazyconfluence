import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { App, ImageViewerOverlay, NewPageOverlay, StagedChangesOverlay, documentHorizontalScrollDeltaForKey, imageRenderModeForCapabilities, nextFocusPaneForKey, nextNavigatorSelectionForCollapse, nextPageViewModeForKey, type SearchKeyLike } from "../src/tui/app"
import { createLocalConfig } from "../src/config"
import type { CredentialStatus } from "../src/config"
import { openIndexRepository } from "../src/index/repository"
import type { PageBodyArtifact, PageDraft } from "../src/index/repository"
import { createDevTuiRuntime } from "../src/tui/runtime"
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
      expect(output).toContain("Overview 0")
      expect(output).toContain("c overview")
      expect(output).toContain("e edit")
      expect(output).toContain("Tab panes")
      expect(output).toContain("N root")
      expect(output).toContain("D delete")
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

  test("renders synthetic dev pages without the local index", async () => {
    const rendered = await testRender(() => <App runtime={createDevTuiRuntime()} disableTreeSitter />, { width: 120, height: 36 })

    await rendered.renderOnce()

    const frame = rendered.captureCharFrame()
    rendered.renderer.destroy()

    expect(frame).toContain("Engineering Home")
    expect(frame).toContain("Project Architecture")
    expect(frame).toContain("Start here for engineering norms")
    expect(frame).toContain("DEV mock")
    expect(frame).not.toContain("Local synced content from SQLite")
  })

  test("renders synthetic dev archived empty state without a mock page crash", async () => {
    const rendered = await testRender(() => <App runtime={createDevTuiRuntime()} disableTreeSitter initialPageViewMode="archived" />, { width: 120, height: 36 })

    try {
      await rendered.renderOnce()
      const frame = rendered.captureCharFrame()

      expect(frame).toContain("[Archived]")
      expect(frame).toContain("No local pages indexed")
      expect(frame).toContain("DEV mock")
    } finally {
      rendered.renderer.destroy()
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

  test("separates archived pages behind the navigator archived tab", async () => {
    const setup = await createTuiTestSetup({ extraPages: [archivedArchitecture] })

    try {
      const output = await withProcessEnv(setup.env, async () => {
        const rendered = await testRender(() => <App credentialStatus={readyStatus} disableTreeSitter />, { width: 120, height: 36 })

        try {
          await rendered.renderOnce()
          return rendered.captureCharFrame()
        } finally {
          rendered.renderer.destroy()
        }
      })

      expect(output).toContain("[Current]")
      expect(output).toContain("Archived")
      expect(output).not.toContain("Archived Architecture")
    } finally {
      await setup.cleanup()
    }
  })

  test("renders archived pages in archived navigator mode", async () => {
    const setup = await createTuiTestSetup({ extraPages: [archivedArchitecture] })

    try {
      const output = await withProcessEnv(setup.env, async () => {
        const rendered = await testRender(() => <App credentialStatus={readyStatus} disableTreeSitter initialPageViewMode="archived" />, { width: 120, height: 36 })

        try {
          await rendered.renderOnce()
          return rendered.captureCharFrame()
        } finally {
          rendered.renderer.destroy()
        }
      })

      expect(output).toContain("[Archived]")
      expect(output).toContain("Archived Architecture")
      expect(output).toContain("Archived in Confluence")
      expect(output).toContain("read-only")
    } finally {
      await setup.cleanup()
    }
  })

  test("renders prod archived empty state when no archived rows exist", async () => {
    const setup = await createTuiTestSetup()

    try {
      const output = await withProcessEnv(setup.env, async () => {
        const rendered = await testRender(() => <App credentialStatus={readyStatus} disableTreeSitter initialPageViewMode="archived" />, { width: 120, height: 36 })

        try {
          await rendered.renderOnce()
          return rendered.captureCharFrame()
        } finally {
          rendered.renderer.destroy()
        }
      })

      expect(output).toContain("[Archived]")
      expect(output).toContain("No local pages indexed")
      expect(output).toContain("PROD local")
      expect(output).not.toContain("Real Synced Architecture")
    } finally {
      await setup.cleanup()
    }
  })

  test("renders cached image previews from image placeholders", async () => {
    const setup = await createTuiTestSetup({ home: { ...home, contentMarkdown: imageMarkdown, snippet: "Diagram below." } })
    const imagePath = join(dirname(setup.dbPath), "system-overview.png")
    let repository: ReturnType<typeof openIndexRepository> | null = openIndexRepository({ path: setup.dbPath })

    try {
      await writeFile(imagePath, Buffer.from(tinyPngBase64, "base64"))
      const imageAsset = {
        pageId: "local-home",
        nodeId: "image-node",
        title: "System overview",
        sourceUrl: null,
        cachePath: imagePath,
        contentType: "image/png",
        width: 1,
        height: 1,
        updatedAt: "2026-07-23T12:00:00Z",
      }
      repository.upsertMediaAsset(imageAsset)
      repository.close()
      repository = null

      const output = await withProcessEnv(setup.env, async () => {
        const rendered = await testRender(() => <App credentialStatus={readyStatus} disableTreeSitter />, { width: 120, height: 36 })
        const viewerRendered = await testRender(() => (
          <ImageViewerOverlay
            visible
            pageTitle="Local Engineering Home"
            images={[{ kind: "image", nodeId: "image-node", label: "System overview", details: "Attachment on this Confluence page.", asset: imageAsset }]}
            selectedIndex={0}
            renderMode="cell-color"
            left={2}
            top={2}
            width={80}
            height={24}
            onClose={() => {}}
          />
        ), { width: 120, height: 36 })

        try {
          await rendered.renderOnce()
          await rendered.flush()
          const inlineFrame = rendered.captureCharFrame()

          await viewerRendered.renderOnce()
          await viewerRendered.flush()
          const viewerFrame = viewerRendered.captureCharFrame()

          return { inlineFrame, viewerFrame }
        } finally {
          rendered.renderer.destroy()
          viewerRendered.renderer.destroy()
        }
      })

      expect(output.inlineFrame).toContain("IMAGE PREVIEW")
      expect(output.inlineFrame).toContain("System overview")
      expect(output.inlineFrame).toContain("cached PNG 1x1")
      expect(output.inlineFrame).toContain("color cells")
      expect(output.inlineFrame).toContain("▀")
      expect(output.inlineFrame).not.toContain("Kitty native")
      expect(output.inlineFrame).not.toContain("╰─▀")
      expect(output.viewerFrame).toContain("IMAGE VIEWER")
      expect(output.viewerFrame).toContain("System overview")
      expect(output.viewerFrame).toContain("1 of 1")
      expect(output.viewerFrame).toContain("color cells")
      expect(output.viewerFrame).toContain("cached PNG 1x1")
    } finally {
      repository?.close()
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

  test("opening the editor with e does not insert e into the staged buffer", async () => {
    const setup = await createTuiTestSetup({ bodyArtifacts: [homeBody] })
    const repository = openIndexRepository({ path: setup.dbPath })
    const dataSource = createRepositoryTuiDataSource(repository)

    try {
      const rendered = await testRender(() => <App credentialStatus={readyStatus} dataSource={dataSource} disableTreeSitter />, { width: 120, height: 36 })

      try {
        await rendered.renderOnce()
        rendered.mockInput.pressKey("e")
        await rendered.flush()
        rendered.mockInput.pressKey("t", { ctrl: true })
        await rendered.flush()

        expect(repository.getPageDraft("local-home")).toBeNull()
        await rendered.waitForVisualIdle({ quietFrames: 2, maxFrames: 8 })
      } finally {
        rendered.renderer.destroy()
      }
    } finally {
      dataSource.close?.()
      await setup.cleanup()
    }
  })

  test("focus keys keep h/l document-local and map Tab between panes", () => {
    expect(nextFocusPaneForKey("navigator", key("tab", "\t"))).toBe("document")
    expect(nextFocusPaneForKey("document", key("tab", "\t"))).toBe("navigator")
    expect(nextFocusPaneForKey("document", key("tab", "\x1B[Z", { shift: true }))).toBe("navigator")
    expect(nextFocusPaneForKey("navigator", key("tab", "\x1B[Z", { shift: true }))).toBe("document")
    expect(nextFocusPaneForKey("document", key("h", "h"))).toBe("document")
    expect(nextFocusPaneForKey("document", key("left", "\x1B[D"))).toBe("document")
    expect(nextFocusPaneForKey("navigator", key("l", "l"))).toBe("navigator")
    expect(nextFocusPaneForKey("navigator", key("return", "\r"))).toBe("document")
  })

  test("a toggles current and archived page views", () => {
    expect(nextPageViewModeForKey("current", key("a", "a"))).toBe("archived")
    expect(nextPageViewModeForKey("archived", key("a", "a"))).toBe("current")
    expect(nextPageViewModeForKey("current", key("j", "j"))).toBeNull()
  })

  test("document h/l keys scroll horizontally", () => {
    expect(documentHorizontalScrollDeltaForKey(key("h", "h"))).toBe(-8)
    expect(documentHorizontalScrollDeltaForKey(key("left", "\x1B[D"))).toBe(-8)
    expect(documentHorizontalScrollDeltaForKey(key("l", "l"))).toBe(8)
    expect(documentHorizontalScrollDeltaForKey(key("right", "\x1B[C"))).toBe(8)
    expect(documentHorizontalScrollDeltaForKey(key("j", "j"))).toBe(0)
  })

  test("image render mode progressively falls back from native protocols to cells", () => {
    const previousKittyWindowId = process.env.KITTY_WINDOW_ID
    const previousTmux = process.env.TMUX
    const previousZellij = process.env.ZELLIJ
    const previousWindowsTerminal = process.env.WT_SESSION
    try {
      delete process.env.KITTY_WINDOW_ID
      delete process.env.TMUX
      delete process.env.ZELLIJ
      delete process.env.WT_SESSION

      expect(imageRenderModeForCapabilities(null)).toBe("cell-color")
      expect(imageRenderModeForCapabilities({ kitty_graphics: true, sixel: true, rgb: true })).toBe("cell-color")
      expect(imageRenderModeForCapabilities({ kitty_graphics: true, sixel: true, rgb: true }, { nativeProtocols: true })).toBe("cell-color")
      process.env.KITTY_WINDOW_ID = "1"
      expect(imageRenderModeForCapabilities({ kitty_graphics: true, sixel: true, rgb: true }, { nativeProtocols: true })).toBe("kitty")
      process.env.TMUX = "tmux"
      expect(imageRenderModeForCapabilities({ kitty_graphics: true, sixel: true, rgb: true, multiplexer: "tmux" }, { nativeProtocols: true })).toBe("cell-color")
      expect(imageRenderModeForCapabilities({ kitty_graphics: false, sixel: true, rgb: true }, { nativeProtocols: true })).toBe("cell-color")
      expect(imageRenderModeForCapabilities({ kitty_graphics: false, sixel: false, rgb: true })).toBe("cell-color")
      expect(imageRenderModeForCapabilities({ kitty_graphics: false, sixel: false, rgb: false })).toBe("cell-mono")
    } finally {
      restoreEnv("KITTY_WINDOW_ID", previousKittyWindowId)
      restoreEnv("TMUX", previousTmux)
      restoreEnv("ZELLIJ", previousZellij)
      restoreEnv("WT_SESSION", previousWindowsTerminal)
    }
  })

  test("navigator collapse does not select missing detached parents", () => {
    const knownPages = new Map([["visible-parent", home]])

    expect(nextNavigatorSelectionForCollapse({ page: { parentId: "visible-parent" }, hasChildren: false, expanded: false }, knownPages)).toBe("visible-parent")
    expect(nextNavigatorSelectionForCollapse({ page: { parentId: "missing-parent" }, hasChildren: false, expanded: false }, knownPages)).toBeNull()
    expect(nextNavigatorSelectionForCollapse({ page: { parentId: null }, hasChildren: false, expanded: false }, knownPages)).toBeNull()
    expect(nextNavigatorSelectionForCollapse({ page: { parentId: "visible-parent" }, hasChildren: true, expanded: true }, knownPages)).toBeNull()
  })

  test("TUI staged changes are scoped to the current space", async () => {
    const setup = await createTuiTestSetup({ bodyArtifacts: [homeBody] })
    const repository = openIndexRepository({ path: setup.dbPath })
    const dataSource = createRepositoryTuiDataSource(repository)

    try {
      repository.upsertSpace(otherSpace)
      repository.upsertPage(otherPage)
      repository.upsertPageBody(otherBody)

      dataSource.stagePageDraft("local-home", "# Local Engineering Home\n\nCurrent space staged draft.")
      dataSource.stagePageDraft("ops-home", "# Ops Home\n\nOther space staged draft.")
      const createChange = dataSource.stagePageCreate({ spaceKey: "ENG", parentPageId: "local-home", title: "Launch Plan" })

      const currentSpaceChanges = dataSource.listStagedDraftChanges("ENG")
      const stagedChanges = dataSource.listStagedChanges("ENG")

      expect(currentSpaceChanges).toHaveLength(1)
      expect(currentSpaceChanges[0]?.page.pageId).toBe("local-home")
      expect(currentSpaceChanges[0]?.diffMarkdown).toContain("+Current space staged draft.")
      expect(stagedChanges.map((change) => change.kind).sort()).toEqual(["create", "update"])
      expect(stagedChanges.find((change) => change.changeKey === createChange.changeKey)?.diffMarkdown).toContain("+# Launch Plan")
      expect(dataSource.getPagesForSpace("ENG").map((page) => page.pageId)).toContain(createChange.changeKey)
      expect(dataSource.getReaderPage(createChange.changeKey)).toMatchObject({ pageId: createChange.changeKey, parentId: "local-home", title: "Launch Plan", contentMarkdown: "# Launch Plan\n" })
      expect(dataSource.getReaderPage("local-home")?.children.map((page) => page.pageId)).toContain(createChange.changeKey)
      expect(dataSource.searchPagesInSpace("ENG", "launch").map((result) => result.page.pageId)).toContain(createChange.changeKey)
      expect(dataSource.getEditablePageInput(createChange.changeKey)).toMatchObject({ kind: "create", markdown: "# Launch Plan\n" })
      expect(dataSource.stagePageBuffer(createChange.changeKey, "# Launch Plan\n\nDraft locally first.")).toBe("staged")
      expect(repository.getPageCreate(createChange.create.localId)?.draftMarkdown).toBe("# Launch Plan\n\nDraft locally first.\n")
      expect(dataSource.listStagedDraftChanges("OPS")).toHaveLength(1)

      expect(dataSource.discardStagedChanges(stagedChanges.map((change) => change.changeKey))).toBe(2)
      expect(dataSource.listStagedDraftChanges("ENG")).toHaveLength(0)
      expect(dataSource.listStagedChanges("ENG")).toHaveLength(0)
      expect(dataSource.listStagedDraftChanges("OPS")).toHaveLength(1)
    } finally {
      dataSource.close?.()
      await setup.cleanup()
    }
  })

  test("TUI staged root creates are searchable local root pages", async () => {
    const setup = await createTuiTestSetup({ bodyArtifacts: [homeBody] })
    const repository = openIndexRepository({ path: setup.dbPath })
    const dataSource = createRepositoryTuiDataSource(repository)

    try {
      const createChange = dataSource.stagePageCreate({ spaceKey: "ENG", parentPageId: null, title: "Root Launch Plan" })
      const page = dataSource.getReaderPage(createChange.changeKey)

      expect(page).toMatchObject({ pageId: createChange.changeKey, parentId: null, title: "Root Launch Plan", path: ["Root Launch Plan"] })
      expect(dataSource.getPagesForSpace("ENG").filter((candidate) => candidate.parentId === null).map((candidate) => candidate.pageId)).toContain(createChange.changeKey)
      expect(dataSource.searchPagesInSpace("ENG", "root launch").map((result) => result.page.pageId)).toContain(createChange.changeKey)
      const stagedCreate = dataSource.listStagedChanges("ENG").find((change) => change.changeKey === createChange.changeKey)
      expect(stagedCreate?.kind).toBe("create")
      if (stagedCreate?.kind === "create") expect(stagedCreate.parentPage).toBeNull()
    } finally {
      dataSource.close?.()
      await setup.cleanup()
    }
  })

  test("TUI can stage a child under a local-only created page", async () => {
    const setup = await createTuiTestSetup({ bodyArtifacts: [homeBody] })
    const repository = openIndexRepository({ path: setup.dbPath })
    const dataSource = createRepositoryTuiDataSource(repository)

    try {
      const parent = dataSource.stagePageCreate({ spaceKey: "ENG", parentPageId: null, title: "Local Parent" })
      const child = dataSource.stagePageCreate({ spaceKey: "ENG", parentPageId: parent.changeKey, title: "Local Child" })

      expect(child.create).toMatchObject({ parentPageId: null, parentCreateId: parent.create.localId })
      expect(dataSource.getReaderPage(parent.changeKey)?.children.map((page) => page.pageId)).toContain(child.changeKey)
      expect(dataSource.getReaderPage(child.changeKey)).toMatchObject({ pageId: child.changeKey, parentId: parent.changeKey, path: ["Local Parent", "Local Child"] })
      expect(dataSource.searchPagesInSpace("ENG", "local child").map((result) => result.page.pageId)).toContain(child.changeKey)
    } finally {
      dataSource.close?.()
      await setup.cleanup()
    }
  })

  test("TUI stages synced page deletes and blocks pages with children", async () => {
    const setup = await createTuiTestSetup({ bodyArtifacts: [homeBody] })
    const repository = openIndexRepository({ path: setup.dbPath })
    const dataSource = createRepositoryTuiDataSource(repository)

    try {
      expect(() => dataSource.stagePageDelete("local-home")).toThrow("Delete child pages first")

      const change = dataSource.stagePageDelete("real-architecture")

      expect(change).toMatchObject({ kind: "delete", changeKey: "delete:real-architecture", title: "Real Synced Architecture" })
      expect(dataSource.listStagedChanges("ENG").map((staged) => staged.kind)).toContain("delete")
      expect(dataSource.getPageDraftStatus("real-architecture")).toBe("staged")
      expect(dataSource.discardStagedChanges([change.changeKey])).toBe(1)
      expect(repository.getPageDelete("real-architecture")).toBeNull()
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

  test("TUI renders staged creates as local navigator pages", async () => {
    const setup = await createTuiTestSetup({ bodyArtifacts: [homeBody] })
    const repository = openIndexRepository({ path: setup.dbPath })
    const dataSource = createRepositoryTuiDataSource(repository)

    try {
      dataSource.stagePageCreate({ spaceKey: "ENG", parentPageId: "local-home", title: "Launch Plan" })

      const output = await withProcessEnv(setup.env, async () => {
        const rendered = await testRender(() => <App credentialStatus={readyStatus} dataSource={dataSource} disableTreeSitter />, { width: 120, height: 36 })

        try {
          await rendered.renderOnce()
          return rendered.captureCharFrame()
        } finally {
          rendered.renderer.destroy()
        }
      })

      expect(output).toContain("Launch Plan")
    } finally {
      dataSource.close?.()
      await setup.cleanup()
    }
  })

  test("renders current-space overview controls and selected staged diff", async () => {
    const rendered = await testRender(() => (
      <StagedChangesOverlay
        visible
        activeSpaceName="Local Engineering"
        changes={[{ kind: "update", changeKey: "update:local-home", page: home, draft: stagedHomeDraft, title: home.title, updatedAt: stagedHomeDraft.updatedAt, diffMarkdown: ["--- synced", "+++ draft", "@@", "-Old body", "+New body"].join("\n") }]}
        selectedIndex={0}
        selectedChangeKeys={new Set(["update:local-home"])}
        message="Apply blocked: Cannot safely preserve opaque Confluence content."
        applying={false}
        left={1}
        top={1}
        width={80}
        height={18}
        onToggle={() => { }}
        onApply={() => { }}
        onDiscard={() => { }}
        onClose={() => { }}
      />
    ), { width: 90, height: 24 })

    try {
      await rendered.renderOnce()
      const output = rendered.captureCharFrame()

      expect(output).toContain("OVERVIEW")
      expect(output).toContain("Local Engineering")
      expect(output).toContain("PAGES")
      expect(output).toContain("[x] [update] Local")
      expect(output).toContain("Local Engineering Home")
      expect(output).toContain("ID: local-home")
      expect(output).toContain("Apply blocked: Cannot safely preserve opaque Confluence content.")
      expect(output).toContain("+++ draft")
      expect(output).toContain("Toggle")
      expect(output).toContain("Apply")
      expect(output).toContain("Discard")
      expect(output).toContain("Close")
    } finally {
      rendered.renderer.destroy()
    }
  })

  test("renders the new page title popup", async () => {
    const rendered = await testRender(() => <NewPageOverlay visible title="Launch Plan" parentPage={home} left={1} width={60} />, { width: 80, height: 16 })

    try {
      await rendered.renderOnce()
      const output = rendered.captureCharFrame()

      expect(output).toContain("NEW PAGE")
      expect(output).toContain("type: page")
      expect(output).toContain("Parent: Local Engineering Home")
      expect(output).toContain("Title: Launch Plan")
      expect(output).toContain("enter stage create")
    } finally {
      rendered.renderer.destroy()
    }
  })

  test("renders the new page placeholder with the cursor before the prompt", async () => {
    const rendered = await testRender(() => <NewPageOverlay visible title="" parentPage={home} left={1} width={60} />, { width: 80, height: 16 })

    try {
      await rendered.renderOnce()
      const output = rendered.captureCharFrame()

      expect(output).toContain("Title: type a title")
      expect(output).not.toContain("Title: type a title_")
    } finally {
      rendered.renderer.destroy()
    }
  })

  test("renders the new root page popup", async () => {
    const rendered = await testRender(() => <NewPageOverlay visible title="Root Plan" parentPage={null} left={1} width={60} />, { width: 80, height: 16 })

    try {
      await rendered.renderOnce()
      const output = rendered.captureCharFrame()

      expect(output).toContain("NEW PAGE")
      expect(output).toContain("Parent: Space root")
      expect(output).toContain("Title: Root Plan")
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

function key(name: string, sequence: string, overrides: Partial<SearchKeyLike> = {}): SearchKeyLike {
  return { name, sequence, ctrl: false, meta: false, ...overrides }
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

const otherSpace: SpaceSummary = {
  key: "OPS",
  name: "Operations",
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

const imageMarkdown = [
  "# Local Engineering Home",
  "",
  "Diagram below.",
  "",
  "> [image: System overview]",
  "> Attachment on this Confluence page.",
  '<!-- confluence-opaque node="image-node" type="ac:image" -->',
].join("\n")

const tinyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"

const otherPage: IndexedPage = {
  pageId: "ops-home",
  spaceKey: "OPS",
  title: "Ops Home",
  url: "https://example.atlassian.net/wiki/spaces/OPS/pages/200/Ops+Home",
  parentId: null,
  path: ["Ops Home"],
  owner: "Operations Guild",
  updatedAt: "2026-07-21T09:00:00Z",
  contentMarkdown: "# Ops Home\n\nOps content.",
  snippet: "Ops content.",
}

const otherBody: PageBodyArtifact = {
  pageId: "ops-home",
  remoteVersion: 2,
  sourceRepresentation: "storage",
  sourceBody: "<h1>Ops Home</h1><p>Ops content.</p>",
  sourceHash: "ops-source-hash",
  canonicalDocument: {
    schemaVersion: 1,
    pageId: "ops-home",
    title: "Ops Home",
    blocks: [
      { type: "heading", nodeId: "ops-heading", level: 1, inlines: [{ type: "text", text: "Ops Home" }] },
      { type: "paragraph", nodeId: "ops-paragraph", inlines: [{ type: "text", text: "Ops content." }] },
    ],
  },
  sidecar: {
    schemaVersion: 1,
    remoteVersion: 2,
    sourceRepresentation: "storage",
    sourceHash: "ops-source-hash",
    nodes: {},
  },
  editableMarkdown: "# Ops Home\n\nOps content.",
  renderedMarkdown: "# Ops Home\n\nOps content.",
  updatedAt: "2026-07-21T10:00:00Z",
}

const stagedHomeDraft: PageDraft = {
  pageId: "local-home",
  baseRemoteVersion: 4,
  baseSourceHash: "home-source-hash",
  draftMarkdown: "# Local Engineering Home\n\nNew body",
  status: "staged",
  createdAt: "2026-07-21T10:00:00Z",
  updatedAt: "2026-07-21T11:00:00Z",
  stagedAt: "2026-07-21T11:00:00Z",
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

const archivedArchitecture: IndexedPage = {
  pageId: "archived-architecture",
  spaceKey: "ENG",
  title: "Archived Architecture",
  url: "https://example.atlassian.net/wiki/spaces/ENG/pages/104/Archived+Architecture",
  parentId: "local-home",
  path: ["Local Engineering Home", "Archived Architecture"],
  owner: "Architecture Guild",
  updatedAt: "2026-07-20T09:30:00Z",
  contentMarkdown: "# Archived Architecture\n\nOld architecture notes.",
  snippet: "Old architecture notes.",
  treeOrder: 2,
  contentType: "page",
  remoteStatus: "archived",
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
