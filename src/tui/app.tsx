import { render, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import {
  BoxRenderable,
  CodeRenderable,
  TextAttributes,
  TextRenderable,
  type TextareaRenderable,
  destroyTreeSitterClient,
  getTreeSitterClient,
  infoStringToFiletype,
  type MarkdownOptions,
  type RenderContext,
  type ScrollBoxRenderable,
  type TreeSitterClient,
} from "@opentui/core"
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import type { IndexedPage, ReaderPage, SearchResult, SpaceSearchResult } from "../model"
import { loadCredentialStatus, type CredentialStatus } from "../config"
import type { PageDraftStatus } from "../index/repository"
import type { ApplyPageDraftResult } from "../apply"
import { createRepositoryTuiDataSource, emptyPageId, emptyReaderPage, emptySpaceSummary, type SaveTuiPageDraftResult, type TuiDataSource } from "./data"
import { markdownStyle, theme } from "./theme"

type TreeRow = {
  page: IndexedPage
  depth: number
  hasChildren: boolean
  expanded: boolean
  detached: boolean
}

type SearchKeyLike = {
  name: string
  sequence: string
  ctrl: boolean
  meta: boolean
}

type CredentialWarning = Exclude<CredentialStatus, { kind: "ready" }>

export type PageSearchKeyAction = "append" | "delete" | "submit" | "close" | "next" | "previous" | "ignore"

export async function renderTui() {
  render(() => <App />, {
    targetFps: 30,
    exitOnCtrlC: true,
    backgroundColor: theme.bg,
    consoleMode: "disabled",
  })
}

export function App(props: { credentialStatus?: CredentialStatus; dataSource?: TuiDataSource } = {}) {
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const dataSource = props.dataSource ?? createRepositoryTuiDataSource()
  const initialSpaceKey = dataSource.getDefaultSpaceKey() ?? "LOCAL"
  const initialPageId = dataSource.getDefaultPageId(initialSpaceKey) ?? emptyPageId
  const [credentialStatus, setCredentialStatus] = createSignal<CredentialStatus | null>(props.credentialStatus ?? null)
  const [activeSpaceKey, setActiveSpaceKey] = createSignal(initialSpaceKey)
  const [selectedPageId, setSelectedPageId] = createSignal(initialPageId)
  const [expandedPageIds, setExpandedPageIds] = createSignal(new Set(initialPageId === emptyPageId ? [] : [initialPageId]))
  const [focusPane, setFocusPane] = createSignal<"navigator" | "document">("navigator")
  const [pageSearchOpen, setPageSearchOpen] = createSignal(false)
  const [pageSearchQuery, setPageSearchQuery] = createSignal("")
  const [pageSearchSelectedIndex, setPageSearchSelectedIndex] = createSignal(0)
  const [spaceSwitcherOpen, setSpaceSwitcherOpen] = createSignal(false)
  const [spaceSwitcherQuery, setSpaceSwitcherQuery] = createSignal("")
  const [spaceSwitcherSelectedIndex, setSpaceSwitcherSelectedIndex] = createSignal(0)
  const [draftRevision, setDraftRevision] = createSignal(0)
  const [editorOpen, setEditorOpen] = createSignal(false)
  const [editorPageId, setEditorPageId] = createSignal<string | null>(null)
  const [editorPageTitle, setEditorPageTitle] = createSignal("")
  const [editorInitialMarkdown, setEditorInitialMarkdown] = createSignal("")
  const [editorOriginalMarkdown, setEditorOriginalMarkdown] = createSignal("")
  const [editorMarkdown, setEditorMarkdown] = createSignal("")
  const [editorDiffOpen, setEditorDiffOpen] = createSignal(false)
  const [editorDiffMarkdown, setEditorDiffMarkdown] = createSignal("")
  const [editorApplying, setEditorApplying] = createSignal(false)
  const [editorCloseArmed, setEditorCloseArmed] = createSignal(false)
  const [editorDiscardArmed, setEditorDiscardArmed] = createSignal(false)
  const [editStatusMessage, setEditStatusMessage] = createSignal("")
  const [treeSitterClient, setTreeSitterClient] = createSignal<TreeSitterClient | undefined>()
  let documentScrollbox: ScrollBoxRenderable | undefined

  const spaces = createMemo(() => dataSource.listSpaces())
  const space = createMemo(() => spaces().find((candidate) => candidate.key === activeSpaceKey()) ?? emptySpaceSummary(activeSpaceKey()))
  const pages = createMemo(() => dataSource.getPagesForSpace(activeSpaceKey()))
  const pageById = createMemo(() => new Map(pages().map((page) => [page.pageId, page])))
  const treeRows = createMemo(() => buildTreeRows(pages(), expandedPageIds()))
  const selectedIndex = createMemo(() => treeRows().findIndex((row) => row.page.pageId === selectedPageId()))
  const selectedRow = createMemo(() => treeRows().find((row) => row.page.pageId === selectedPageId()))
  const readerPage = createMemo(() => {
    draftRevision()
    return dataSource.getReaderPage(selectedPageId()) ?? emptyReaderPage(space())
  })
  const draftStatus = createMemo(() => {
    draftRevision()
    return dataSource.getPageDraftStatus(selectedPageId())
  })
  const editorDraftStatus = createMemo(() => {
    draftRevision()
    const pageId = editorPageId()
    return pageId ? dataSource.getPageDraftStatus(pageId) : null
  })
  const editorDirty = createMemo(() => editorOpen() && editorMarkdown() !== editorOriginalMarkdown())
  const pageSearchResults = createMemo(() => dataSource.searchPagesInSpace(activeSpaceKey(), pageSearchQuery()))
  const spaceSwitcherResults = createMemo(() => dataSource.searchSpaces(spaceSwitcherQuery()))
  const isNarrow = createMemo(() => dimensions().width < 96)
  const halfPageScrollAmount = createMemo(() => Math.max(6, Math.floor((dimensions().height - 9) / 2)))
  const credentialWarning = createMemo<CredentialWarning | null>(() => {
    const status = credentialStatus()
    if (!status || status.kind === "ready") return null
    return status
  })

  onMount(() => {
    if (props.credentialStatus) return

    let cancelled = false
    void loadCredentialStatus().then((status) => {
      if (!cancelled) setCredentialStatus(status)
    })

    onCleanup(() => {
      cancelled = true
    })
  })

  onMount(() => {
    const client = getTreeSitterClient()
    let cancelled = false

    void client.initialize().then(() => {
      if (!cancelled) setTreeSitterClient(client)
    }).catch(() => {
      if (!cancelled) setTreeSitterClient(undefined)
    })

    onCleanup(() => {
      cancelled = true
      void destroyTreeSitterClient()
    })
  })

  onCleanup(() => {
    if (!props.dataSource) dataSource.close?.()
  })

  createEffect(() => {
    const ancestors = getAncestorPageIds(selectedPageId(), pageById())

    if (ancestors.every((pageId) => expandedPageIds().has(pageId))) return

    setExpandedPageIds((current) => {
      const next = new Set(current)

      for (const pageId of ancestors) next.add(pageId)
      return next
    })
  })

  createEffect(() => {
    const maxIndex = Math.max(0, pageSearchResults().length - 1)

    if (pageSearchSelectedIndex() > maxIndex) setPageSearchSelectedIndex(maxIndex)
  })

  createEffect(() => {
    const maxIndex = Math.max(0, spaceSwitcherResults().length - 1)

    if (spaceSwitcherSelectedIndex() > maxIndex) setSpaceSwitcherSelectedIndex(maxIndex)
  })

  const openPageSearch = () => {
    setSpaceSwitcherOpen(false)
    setPageSearchOpen(true)
    setPageSearchQuery("")
    setPageSearchSelectedIndex(0)
  }

  const closePageSearch = () => {
    setPageSearchOpen(false)
    setPageSearchQuery("")
    setPageSearchSelectedIndex(0)
  }

  const openSpaceSwitcher = () => {
    setPageSearchOpen(false)
    setSpaceSwitcherOpen(true)
    setSpaceSwitcherQuery("")
    setSpaceSwitcherSelectedIndex(Math.max(0, dataSource.searchSpaces("").findIndex((result) => result.space.key === activeSpaceKey())))
  }

  const closeSpaceSwitcher = () => {
    setSpaceSwitcherOpen(false)
    setSpaceSwitcherQuery("")
    setSpaceSwitcherSelectedIndex(0)
  }

  const selectPageSearchResult = () => {
    const result = pageSearchResults()[pageSearchSelectedIndex()]

    if (!result) return
    setSelectedPageId(result.page.pageId)
    documentScrollbox?.scrollTo(0)
    setFocusPane("document")
    closePageSearch()
  }

  const movePageSearchSelection = (direction: number) => {
    setPageSearchSelectedIndex((current) => Math.max(0, Math.min(pageSearchResults().length - 1, current + direction)))
  }

  const selectSpaceSwitcherResult = () => {
    const result = spaceSwitcherResults()[spaceSwitcherSelectedIndex()]

    if (!result) return

    const defaultPageId = dataSource.getDefaultPageId(result.space.key) ?? emptyPageId
    setActiveSpaceKey(result.space.key)
    setSelectedPageId(defaultPageId)
    setExpandedPageIds(new Set(defaultPageId === emptyPageId ? [] : [defaultPageId]))
    documentScrollbox?.scrollTo(0)
    setFocusPane("navigator")
    closeSpaceSwitcher()
  }

  const moveSpaceSwitcherSelection = (direction: number) => {
    setSpaceSwitcherSelectedIndex((current) => Math.max(0, Math.min(spaceSwitcherResults().length - 1, current + direction)))
  }

  const scrollDocumentBy = (lines: number) => {
    documentScrollbox?.scrollBy(lines)
    setFocusPane("document")
  }

  const openEditorForSelectedPage = () => {
    if (editorOpen()) return
    const pageId = selectedPageId()

    if (pageId === emptyPageId) {
      setEditStatusMessage("No page selected to edit.")
      return
    }

    try {
      const input = dataSource.getEditableDraftInput(pageId)
      const markdown = input.draft?.draftMarkdown ?? input.body.editableMarkdown

      setEditorPageId(pageId)
      setEditorPageTitle(input.page.title)
      setEditorInitialMarkdown(markdown)
      setEditorOriginalMarkdown(markdown)
      setEditorMarkdown(markdown)
      setEditorDiffMarkdown("")
      setEditorDiffOpen(false)
      setEditorCloseArmed(false)
      setEditorDiscardArmed(false)
      setEditorOpen(true)
      setFocusPane("document")
      setEditStatusMessage(`Editing local draft for ${input.page.title}.`)
    } catch (error) {
      setEditStatusMessage(errorMessage(error))
    }
  }

  const saveEditorDraft = () => {
    const pageId = editorPageId()
    if (!pageId) return

    try {
      const result = dataSource.savePageDraft(pageId, editorMarkdown())

      setDraftRevision((revision) => revision + 1)
      setEditorOriginalMarkdown(editorMarkdown())
      setEditorCloseArmed(false)
      setEditorDiscardArmed(false)
      setEditStatusMessage(editorSaveMessage(result))
    } catch (error) {
      setEditStatusMessage(errorMessage(error))
    }
  }

  const toggleEditorStage = () => {
    const pageId = editorPageId()
    if (!pageId) return

    try {
      if (editorDraftStatus() === "staged" && !editorDirty()) {
        const result = dataSource.unstagePageDraft(pageId)
        setDraftRevision((revision) => revision + 1)
        setEditStatusMessage(result === "unstaged" ? `Draft unstaged for ${editorPageTitle()}.` : `No staged draft for ${editorPageTitle()}.`)
        return
      }

      const result = dataSource.stagePageDraft(pageId, editorMarkdown())
      setDraftRevision((revision) => revision + 1)
      setEditorOriginalMarkdown(editorMarkdown())
      setEditorCloseArmed(false)
      setEditorDiscardArmed(false)
      setEditStatusMessage(result === "staged" ? `Draft staged for ${editorPageTitle()}.` : `No draft changes to stage for ${editorPageTitle()}.`)
    } catch (error) {
      setEditStatusMessage(errorMessage(error))
    }
  }

  const discardEditorDraft = () => {
    const pageId = editorPageId()
    if (!pageId) return

    if (editorDirty() && !editorDiscardArmed()) {
      setEditorDiscardArmed(true)
      setEditStatusMessage("Unsaved editor changes. Press Ctrl+R again to discard the draft and close.")
      return
    }

    try {
      const result = dataSource.discardPageDraft(pageId)
      setDraftRevision((revision) => revision + 1)
      closeEditorImmediately(result === "discarded" ? `Draft discarded for ${editorPageTitle()}.` : `No saved draft for ${editorPageTitle()}.`)
    } catch (error) {
      setEditStatusMessage(errorMessage(error))
    }
  }

  const closeEditor = () => {
    if (editorDiffOpen()) {
      setEditorDiffOpen(false)
      return
    }

    if (editorDirty() && !editorCloseArmed()) {
      setEditorCloseArmed(true)
      setEditStatusMessage("Unsaved editor buffer. Press Esc again to close without saving, or Ctrl+S to save.")
      return
    }

    closeEditorImmediately(`Closed editor for ${editorPageTitle()}.`)
  }

  const closeEditorImmediately = (message: string) => {
    setEditorOpen(false)
    setEditorPageId(null)
    setEditorPageTitle("")
    setEditorInitialMarkdown("")
    setEditorOriginalMarkdown("")
    setEditorMarkdown("")
    setEditorDiffMarkdown("")
    setEditorDiffOpen(false)
    setEditorApplying(false)
    setEditorCloseArmed(false)
    setEditorDiscardArmed(false)
    setEditStatusMessage(message)
  }

  const showEditorDiff = () => {
    const pageId = editorPageId()
    if (!pageId) return

    try {
      setEditorDiffMarkdown(dataSource.formatPageDraftDiff(pageId, editorMarkdown()))
      setEditorDiffOpen(true)
      setEditStatusMessage(`Showing local diff for ${editorPageTitle()}.`)
    } catch (error) {
      setEditStatusMessage(errorMessage(error))
    }
  }

  const applyEditorDraft = () => {
    const pageId = editorPageId()
    if (!pageId || editorApplying()) return

    setEditorDiffOpen(true)
    setEditorApplying(true)
    setEditStatusMessage(`Applying ${editorPageTitle()} to Confluence...`)

    void dataSource.applyPageDraft(pageId, editorMarkdown()).then((result) => {
      setDraftRevision((revision) => revision + 1)
      if (result.status === "applied") {
        closeEditorImmediately(result.message)
        return
      }

      setEditStatusMessage(applyResultMessage(result))
    }).catch((error) => {
      setEditStatusMessage(errorMessage(error))
    }).finally(() => {
      setEditorApplying(false)
    })
  }

  const setEditorMarkdownFromTextarea = (markdown: string) => {
    setEditorMarkdown(markdown)
    setEditorCloseArmed(false)
    setEditorDiscardArmed(false)
  }

  const expandSelectedPage = () => {
    const row = selectedRow()

    if (row?.hasChildren && !row.expanded) {
      setExpandedPageIds((current) => new Set(current).add(row.page.pageId))
      return
    }

    setFocusPane("document")
  }

  const collapseSelectedPage = () => {
    const row = selectedRow()

    if (row?.hasChildren && row.expanded) {
      setExpandedPageIds((current) => {
        const next = new Set(current)
        next.delete(row.page.pageId)
        return next
      })
      return
    }

    if (row?.page.parentId) setSelectedPageId(row.page.parentId)
  }

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      renderer.destroy()
      return
    }

    if (editorOpen()) {
      if (editorDiffOpen() && isPlainKey(key, "a")) applyEditorDraft()
      else if (editorDiffOpen() && isPlainKey(key, "s")) toggleEditorStage()
      else if (editorDiffOpen() && isPlainKey(key, "d")) discardEditorDraft()
      else if (key.name === "escape") closeEditor()
      else if (key.ctrl && key.name === "s") saveEditorDraft()
      else if (key.ctrl && key.name === "t") toggleEditorStage()
      else if (key.ctrl && key.name === "o") showEditorDiff()
      else if (key.ctrl && key.name === "r") discardEditorDraft()
      return
    }

    if (pageSearchOpen()) {
      const action = pageSearchKeyAction(key)

      if (action === "close") closePageSearch()
      else if (action === "submit") selectPageSearchResult()
      else if (action === "next") movePageSearchSelection(1)
      else if (action === "previous") movePageSearchSelection(-1)
      else if (action === "delete") setPageSearchQuery((query) => query.slice(0, -1))
      else if (action === "append") setPageSearchQuery((query) => query + key.sequence)
      return
    }

    if (spaceSwitcherOpen()) {
      const action = pageSearchKeyAction(key)

      if (action === "close") closeSpaceSwitcher()
      else if (action === "submit") selectSpaceSwitcherResult()
      else if (action === "next") moveSpaceSwitcherSelection(1)
      else if (action === "previous") moveSpaceSwitcherSelection(-1)
      else if (action === "delete") setSpaceSwitcherQuery((query) => query.slice(0, -1))
      else if (action === "append") setSpaceSwitcherQuery((query) => query + key.sequence)
      return
    }

    if (key.name === "q" || key.name === "escape") {
      renderer.destroy()
      return
    }

    if (key.name === "/") {
      openPageSearch()
      return
    }

    if (key.name === "s") {
      openSpaceSwitcher()
      return
    }

    if (isPlainKey(key, "e")) {
      openEditorForSelectedPage()
      return
    }

    if (key.name === "tab") {
      setFocusPane((pane) => (pane === "navigator" ? "document" : "navigator"))
      return
    }

    if (key.name === "d") {
      scrollDocumentBy(halfPageScrollAmount())
      return
    }

    if (key.name === "u") {
      scrollDocumentBy(-halfPageScrollAmount())
      return
    }

    if (focusPane() === "navigator") {
      if (key.name === "j" || key.name === "down") moveSelection(1, treeRows(), selectedIndex(), setSelectedPageId)
      if (key.name === "k" || key.name === "up") moveSelection(-1, treeRows(), selectedIndex(), setSelectedPageId)
      if (key.name === "l" || key.name === "right") expandSelectedPage()
      if (key.name === "h" || key.name === "left") collapseSelectedPage()
      if (key.name === "return") setFocusPane("document")
      return
    }

    if (focusPane() === "document") {
      if (key.name === "j" || key.name === "down") scrollDocumentBy(1)
      if (key.name === "k" || key.name === "up") scrollDocumentBy(-1)
      if (key.name === "h" || key.name === "left") setFocusPane("navigator")
      return
    }

    if (key.name === "h" || key.name === "left") setFocusPane("navigator")
  })

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={theme.bg}>
      <Header page={readerPage()} spaceName={space().name} syncState={space().syncState} draftStatus={draftStatus()} />
      <Show when={credentialWarning()} fallback={<box height={0} />}>{(status) => <CredentialNotice status={status()} />}</Show>
      <box flexGrow={1} minHeight={0} flexDirection={isNarrow() ? "column" : "row"} paddingX={1}>
        <Navigator rows={treeRows()} selectedPageId={selectedPageId()} focused={focusPane() === "navigator"} />
        <Reader page={readerPage()} focused={focusPane() === "document"} narrow={isNarrow()} treeSitterClient={treeSitterClient()} setDocumentScrollbox={(scrollbox) => { documentScrollbox = scrollbox }} />
      </box>
      <StatusBar focusPane={focusPane()} editorOpen={editorOpen()} editorDirty={editorDirty()} editMessage={editStatusMessage()} />
      <Show when={editorOpen()} fallback={<box height={0} />}>
        <EditorOverlay
          pageTitle={editorPageTitle()}
          pageId={editorPageId() ?? ""}
          initialMarkdown={editorInitialMarkdown()}
          dirty={editorDirty()}
          draftStatus={editorDraftStatus()}
          message={editStatusMessage()}
          diffOpen={editorDiffOpen()}
          diffMarkdown={editorDiffMarkdown()}
          applying={editorApplying()}
          left={dimensions().width < 72 ? 1 : 4}
          top={2}
          width={Math.max(32, dimensions().width - (dimensions().width < 72 ? 2 : 8))}
          height={Math.max(10, dimensions().height - 4)}
          onMarkdownChange={setEditorMarkdownFromTextarea}
          onApply={applyEditorDraft}
          onStage={toggleEditorStage}
          onDiscard={discardEditorDraft}
          onCloseReview={() => setEditorDiffOpen(false)}
        />
      </Show>
      <PageSearchOverlay
        visible={pageSearchOpen()}
        query={pageSearchQuery()}
        results={pageSearchResults()}
        selectedIndex={pageSearchSelectedIndex()}
        activeSpaceName={space().name}
        left={dimensions().width < 72 ? 2 : 8}
        width={Math.max(32, dimensions().width - (dimensions().width < 72 ? 4 : 16))}
        height={Math.min(18, Math.max(10, dimensions().height - 8))}
      />
      <SpaceSwitcherOverlay
        visible={spaceSwitcherOpen()}
        query={spaceSwitcherQuery()}
        results={spaceSwitcherResults()}
        selectedIndex={spaceSwitcherSelectedIndex()}
        activeSpaceKey={activeSpaceKey()}
        left={dimensions().width < 72 ? 2 : 8}
        width={Math.max(32, dimensions().width - (dimensions().width < 72 ? 4 : 16))}
        height={Math.min(16, Math.max(10, dimensions().height - 8))}
      />
    </box>
  )
}

function CredentialNotice(props: { status: CredentialWarning }) {
  return (
    <box height={4} backgroundColor="#1f1607" paddingX={1} flexDirection="column">
      <text height={1} fg={theme.warn} attributes={1}>{props.status.title}</text>
      <text height={1} fg={theme.text}>{props.status.detail}</text>
      <For each={props.status.help.slice(0, 2)}>{(item) => <text height={1} fg={theme.subtle}>{item}</text>}</For>
    </box>
  )
}

function Header(props: { page: ReaderPage; spaceName: string; syncState: string; draftStatus: PageDraftStatus | null }) {
  const syncColor = () => (props.syncState === "fresh" ? theme.good : props.syncState === "stale" ? theme.warn : theme.danger)
  const statusColor = () => (props.draftStatus === "staged" ? theme.good : props.draftStatus === "draft" ? theme.warn : syncColor())
  const statusText = () => props.draftStatus ? `${props.draftStatus} · ${props.syncState}` : props.syncState

  return (
    <box height={6} border borderStyle="single" borderColor={theme.border} paddingX={1} flexDirection="column">
      <box height={1} flexDirection="row" justifyContent="space-between" width="100%">
        <text height={1} fg={theme.text} attributes={1}>{props.page.title}</text>
        <text height={1} fg={statusColor()}>{statusText()}</text>
      </box>
      <text height={1} fg={theme.muted}>{props.spaceName} / {props.page.path.join(" / ")}</text>
      <text height={1} fg={theme.subtle}>ID: {props.page.pageId}  Space: {props.page.spaceKey}  Parent: {props.page.parentId ?? "root"}</text>
      <text height={1} fg={theme.subtle}>Owner: {props.page.owner}  Updated: {formatDate(props.page.updatedAt)}</text>
    </box>
  )
}

function Navigator(props: { rows: TreeRow[]; selectedPageId: string; focused: boolean }) {
  return (
    <box
      width={36}
      minWidth={28}
      maxWidth={44}
      height="100%"
      border
      borderStyle="rounded"
      borderColor={props.focused ? theme.borderActive : theme.border}
      backgroundColor={theme.panel}
      paddingX={1}
      paddingY={1}
      flexDirection="column"
    >
      <text height={1} fg={props.focused ? theme.accent : theme.muted} attributes={1}>NAVIGATOR</text>
      <text height={1} fg={theme.subtle}>j/k move  h/l fold  enter read</text>
      <box height={1} />
      <scrollbox flexGrow={1} minHeight={0} scrollbarOptions={{ showArrows: false }}>
        <box flexDirection="column" width="100%">
          <For each={props.rows}>{(row) => <NavigatorRow row={row} selected={row.page.pageId === props.selectedPageId} />}</For>
        </box>
      </scrollbox>
    </box>
  )
}

function NavigatorRow(props: { row: TreeRow; selected: boolean }) {
  const indicator = () => {
    if (!props.row.hasChildren) return " "
    return props.row.expanded ? "▾" : "▸"
  }

  const prefix = () => `${"  ".repeat(props.row.depth)}${indicator()} `
  const documentKind = () => navigatorDocumentKind(props.row)
  const symbol = () => navigatorDocumentKindSymbols[documentKind()]
  const symbolColor = () => props.row.detached ? theme.warn : navigatorDocumentKindColors[documentKind()]
  const titleColor = () => props.selected ? theme.text : props.row.detached ? theme.warn : theme.muted

  return (
    <box height={1} width="100%" backgroundColor={props.selected ? theme.accentSoft : undefined} paddingLeft={0} paddingRight={1} flexDirection="row">
      <text height={1} width={props.row.depth * 2 + 2} fg={theme.subtle}>{prefix()}</text>
      <text height={1} width={2} fg={props.selected ? theme.text : symbolColor()}>{symbol()}</text>
      <text height={1} flexGrow={1} minWidth={0} fg={titleColor()}>{props.row.page.title}</text>
    </box>
  )
}

type NavigatorDocumentKind = "folder" | "page" | "live" | "canvas" | "unknown"

const navigatorDocumentKindSymbols: Record<NavigatorDocumentKind, string> = {
  folder: "▣",
  page: "•",
  live: "✦",
  canvas: "□",
  unknown: "?",
}

const navigatorDocumentKindColors: Record<NavigatorDocumentKind, string> = {
  folder: theme.accent,
  page: theme.muted,
  live: theme.good,
  canvas: "#c4b5fd",
  unknown: theme.danger,
}

function navigatorDocumentKind(row: TreeRow): NavigatorDocumentKind {
  if (!row.page.title.trim()) return "unknown"
  if (row.hasChildren) return "folder"

  const searchText = `${row.page.title} ${row.page.url} ${row.page.snippet}`.toLowerCase()

  if (searchText.includes("whiteboard") || searchText.includes("canvas")) return "canvas"
  if (searchText.includes("live doc") || searchText.includes("live-doc") || searchText.includes("live_document")) return "live"
  return "page"
}

function Reader(props: { page: ReaderPage; focused: boolean; narrow: boolean; treeSitterClient?: TreeSitterClient; setDocumentScrollbox: (scrollbox: ScrollBoxRenderable) => void }) {
  const renderer = useRenderer()
  const renderCodeBlock = createReadableCodeBlockRenderer(renderer)

  return (
    <box
      flexGrow={1}
      minWidth={0}
      marginLeft={props.narrow ? 0 : 1}
      height="100%"
      border
      borderStyle="rounded"
      borderColor={props.focused ? theme.borderActive : theme.border}
      backgroundColor={theme.panelAlt}
      paddingX={1}
      paddingY={1}
      flexDirection="column"
    >
      <box flexDirection={props.narrow ? "column" : "row"} flexGrow={1} minHeight={0}>
        <box flexGrow={1} minWidth={0} height="100%" flexDirection="column">
          <text height={1} fg={props.focused ? theme.accent : theme.muted} attributes={1}>DOCUMENT</text>
          <text height={1} fg={theme.subtle}>{props.page.snippet}</text>
          <box height={1} />
          <scrollbox id="document-scrollbox" ref={props.setDocumentScrollbox} flexGrow={1} minHeight={0} scrollbarOptions={{ showArrows: false }}>
            <markdown
              content={props.page.contentMarkdown}
              syntaxStyle={markdownStyle}
              fg={theme.text}
              bg={theme.panelAlt}
              width="100%"
              conceal
              concealCode={false}
              treeSitterClient={props.treeSitterClient}
              renderNode={renderCodeBlock}
              tableOptions={{ style: "grid", widthMode: "full", columnFitter: "balanced", wrapMode: "word", cellPaddingX: 1, borderStyle: "rounded", borderColor: theme.codeBorder, selectable: true }}
            />
          </scrollbox>
        </box>
        <SideRail page={props.page} narrow={props.narrow} />
      </box>
    </box>
  )
}

function createReadableCodeBlockRenderer(renderer: RenderContext): NonNullable<MarkdownOptions["renderNode"]> {
  return (token, context) => {
    if (token.type !== "code") return undefined

    const language = readableCodeLanguage(token.lang)
    const filetype = infoStringToFiletype(token.lang ?? "")
    const card = new BoxRenderable(renderer, {
      width: "100%",
      border: true,
      borderStyle: "rounded",
      borderColor: theme.codeBorder,
      backgroundColor: theme.codeBg,
      paddingX: 1,
      flexDirection: "column",
      marginBottom: 1,
    })

    card.add(new TextRenderable(renderer, { height: 1, width: "100%", content: language, fg: theme.subtle, attributes: TextAttributes.DIM }))
    card.add(new CodeRenderable(renderer, {
      content: token.text || " ",
      filetype,
      syntaxStyle: context.syntaxStyle,
      fg: theme.codeText,
      bg: theme.codeBg,
      conceal: context.concealCode,
      drawUnstyledText: true,
      treeSitterClient: context.treeSitterClient,
      width: "100%",
      wrapMode: "word",
    }))

    return card
  }
}

function readableCodeLanguage(language: string | undefined) {
  const normalized = infoStringToFiletype(language ?? "")
  return normalized ? `code: ${normalized}` : "code"
}

function SideRail(props: { page: ReaderPage; narrow: boolean }) {
  return (
    <box width={props.narrow ? "100%" : 30} minWidth={props.narrow ? 0 : 24} marginLeft={props.narrow ? 0 : 1} height={props.narrow ? 10 : "100%"} flexDirection="column">
      <InfoPanel title="OUTLINE" items={props.page.outline} empty="No headings" />
      <InfoPanel title="RELATED" items={relatedItems(props.page)} empty="No links yet" />
    </box>
  )
}

function InfoPanel(props: { title: string; items: string[]; empty: string }) {
  return (
    <box border borderStyle="single" borderColor={theme.border} paddingX={1} paddingY={1} flexGrow={1} minHeight={0} flexDirection="column">
      <text height={1} fg={theme.muted} attributes={1}>{props.title}</text>
      <Show when={props.items.length > 0} fallback={<text height={1} fg={theme.subtle}>{props.empty}</text>}>
        <For each={props.items.slice(0, 8)}>{(item) => <text height={1} fg={theme.text}>- {item}</text>}</For>
      </Show>
    </box>
  )
}

function StatusBar(props: { focusPane: string; editorOpen: boolean; editorDirty: boolean; editMessage: string }) {
  const hint = () => {
    if (props.editorOpen) return "Ctrl+S save | Ctrl+T stage | Ctrl+O review | Ctrl+R discard | Esc close"
    if (props.focusPane === "document") return "/ page search | s spaces | e edit | j/k scroll line | d/u scroll doc | h navigator | q quit"
    return "/ page search | s spaces | e edit | j/k move | h/l fold tree | d/u scroll doc | q quit"
  }
  const status = () => {
    if (props.editorOpen) return props.editMessage || `editing local draft: ${props.editorDirty ? "dirty" : "saved"}`
    return props.editMessage ? props.editMessage : `focus: ${props.focusPane}`
  }

  return (
    <box height={1} backgroundColor={theme.accentSoft} paddingX={1} flexDirection="row" justifyContent="space-between">
      <text height={1} fg={theme.text}>{status()}</text>
      <text height={1} fg={theme.muted}>{hint()}</text>
    </box>
  )
}

function EditorOverlay(props: {
  pageTitle: string
  pageId: string
  initialMarkdown: string
  dirty: boolean
  draftStatus: PageDraftStatus | null
  message: string
  diffOpen: boolean
  diffMarkdown: string
  applying: boolean
  left: number
  top: number
  width: number
  height: number
  onMarkdownChange: (markdown: string) => void
  onApply: () => void
  onStage: () => void
  onDiscard: () => void
  onCloseReview: () => void
}) {
  let textarea: TextareaRenderable | undefined

  const statusText = () => {
    const persisted = props.draftStatus ?? "synced"
    return `${props.dirty ? "unsaved" : "clean"} · ${persisted}`
  }

  const updateMarkdown = (value?: unknown) => {
    props.onMarkdownChange(typeof value === "string" ? value : textarea?.plainText ?? "")
  }

  return (
    <box
      position="absolute"
      left={props.left}
      top={props.top}
      width={props.width}
      height={props.height}
      border
      borderStyle="rounded"
      borderColor={theme.borderActive}
      backgroundColor={theme.bg}
      paddingX={2}
      paddingY={1}
      flexDirection="column"
      zIndex={40}
    >
      <box height={1} flexDirection="row" justifyContent="space-between" width="100%">
        <text height={1} fg={theme.accent} attributes={1}>LOCAL DRAFT EDITOR</text>
        <text height={1} fg={props.dirty ? theme.warn : theme.good}>{statusText()}</text>
      </box>
      <text height={1} fg={theme.text}>{props.pageTitle}</text>
      <text height={1} fg={theme.subtle}>ID: {props.pageId}  {props.message || "Edit Markdown locally. Nothing is sent to Confluence until Apply is approved."}</text>
      <box height={1} />
      <textarea
        ref={(node) => { textarea = node }}
        initialValue={props.initialMarkdown}
        focused={!props.diffOpen}
        flexGrow={1}
        minHeight={0}
        width="100%"
        wrapMode="word"
        backgroundColor={theme.codeBg}
        focusedBackgroundColor={theme.codeBg}
        textColor={theme.text}
        focusedTextColor={theme.text}
        cursorColor={theme.accent}
        selectionBg={theme.accentSoft}
        placeholder="No editable Markdown for this page."
        onContentChange={updateMarkdown}
      />
      <box height={1} />
      <text height={1} fg={theme.muted}>Ctrl+S save  Ctrl+T stage/unstage  Ctrl+O review/apply  Ctrl+R discard  Esc close</text>
      <ReviewDraftOverlay
        visible={props.diffOpen}
        pageTitle={props.pageTitle}
        pageId={props.pageId}
        draftStatus={props.draftStatus}
        dirty={props.dirty}
        message={props.message}
        applying={props.applying}
        diffMarkdown={props.diffMarkdown}
        width={Math.max(24, props.width - 6)}
        height={Math.max(8, props.height - 7)}
        onApply={props.onApply}
        onStage={props.onStage}
        onDiscard={props.onDiscard}
        onClose={props.onCloseReview}
      />
    </box>
  )
}

export function ReviewDraftOverlay(props: {
  visible: boolean
  pageTitle: string
  pageId: string
  draftStatus: PageDraftStatus | null
  dirty: boolean
  message: string
  applying: boolean
  diffMarkdown: string
  width: number
  height: number
  onApply: () => void
  onStage: () => void
  onDiscard: () => void
  onClose: () => void
}) {
  const lines = createMemo(() => props.diffMarkdown.split("\n"))

  return (
    <box
      visible={props.visible}
      position="absolute"
      left={2}
      top={3}
      width={props.width}
      height={props.height}
      border
      borderStyle="rounded"
      borderColor={theme.warn}
      backgroundColor="#07111f"
      paddingX={1}
      paddingY={1}
      flexDirection="column"
      zIndex={45}
    >
      <box height={1} flexDirection="row" justifyContent="space-between" width="100%">
        <text height={1} fg={theme.warn} attributes={1}>REVIEW DRAFT</text>
        <text height={1} fg={theme.muted}>{props.applying ? "Applying..." : "a apply  s stage  d discard  esc close"}</text>
      </box>
      <text height={1} fg={theme.text}>{props.pageTitle}</text>
      <text height={1} fg={theme.subtle}>ID: {props.pageId}  Draft: {props.draftStatus ?? "unsaved"}  Buffer: {props.dirty ? "dirty" : "clean"}</text>
      <text height={1} fg={reviewMessageColor(props.message)}>{props.message || "Approve applies this draft to remote Confluence after conflict checks."}</text>
      <scrollbox flexGrow={1} minHeight={0} scrollbarOptions={{ showArrows: false }}>
        <box flexDirection="column" width="100%">
          <For each={lines()}>{(line) => <text height={1} width="100%" content={line || " "} fg={diffLineColor(line)} />}</For>
        </box>
      </scrollbox>
      <box height={3} flexDirection="row" gap={1} paddingTop={1}>
        <ReviewButton label={props.applying ? "Applying" : "Apply"} color={theme.good} disabled={props.applying} onPress={props.onApply} />
        <ReviewButton label={props.draftStatus === "staged" && !props.dirty ? "Unstage" : "Stage"} color={theme.accent} disabled={props.applying} onPress={props.onStage} />
        <ReviewButton label="Discard" color={theme.danger} disabled={props.applying} onPress={props.onDiscard} />
        <ReviewButton label="Close" color={theme.muted} disabled={props.applying} onPress={props.onClose} />
      </box>
    </box>
  )
}

function ReviewButton(props: { label: string; color: string; disabled?: boolean; onPress: () => void }) {
  return (
    <box height={3} width={14} border borderStyle="rounded" borderColor={props.disabled ? theme.border : props.color} alignItems="center" justifyContent="center" onMouseDown={() => { if (!props.disabled) props.onPress() }}>
      <text height={1} fg={props.disabled ? theme.subtle : props.color}>{props.label}</text>
    </box>
  )
}

function PageSearchOverlay(props: { visible: boolean; query: string; results: SearchResult[]; selectedIndex: number; activeSpaceName: string; left: number; width: number; height: number }) {
  return (
    <box
      visible={props.visible}
      position="absolute"
      left={props.left}
      top={5}
      width={props.width}
      height={props.height}
      border
      borderStyle="rounded"
      borderColor={theme.borderActive}
      backgroundColor="#08111f"
      paddingX={2}
      paddingY={1}
      flexDirection="column"
      zIndex={20}
    >
      <box height={1} flexDirection="row" justifyContent="space-between" width="100%">
        <text height={1} fg={theme.accent} attributes={1}>PAGE SEARCH</text>
        <text height={1} fg={theme.muted}>{props.activeSpaceName}</text>
      </box>
      <text height={1} fg={theme.text}>/ {props.query || "type title, path, or content"}_</text>
      <text height={1} fg={theme.subtle}>{props.results.length} result{props.results.length === 1 ? "" : "s"}  type to search  up/down move  enter open  esc close</text>
      <box height={1} />
      <Show when={props.results.length > 0} fallback={<EmptySearchState query={props.query} />}>
        <scrollbox flexGrow={1} minHeight={0} scrollbarOptions={{ showArrows: false }}>
          <box flexDirection="column" width="100%">
            <For each={props.results.slice(0, 8)}>
              {(result, index) => <SearchResultRow result={result} selected={index() === props.selectedIndex} />}
            </For>
          </box>
        </scrollbox>
      </Show>
    </box>
  )
}

function SpaceSwitcherOverlay(props: { visible: boolean; query: string; results: SpaceSearchResult[]; selectedIndex: number; activeSpaceKey: string; left: number; width: number; height: number }) {
  return (
    <box
      visible={props.visible}
      position="absolute"
      left={props.left}
      top={5}
      width={props.width}
      height={props.height}
      border
      borderStyle="rounded"
      borderColor={theme.borderActive}
      backgroundColor="#08111f"
      paddingX={2}
      paddingY={1}
      flexDirection="column"
      zIndex={30}
    >
      <box height={1} flexDirection="row" justifyContent="space-between" width="100%">
        <text height={1} fg={theme.accent} attributes={1}>SWITCH SPACE</text>
        <text height={1} fg={theme.muted}>active: {props.activeSpaceKey}</text>
      </box>
      <text height={1} fg={theme.text}>s {props.query || "type space key or name"}_</text>
      <text height={1} fg={theme.subtle}>{props.results.length} space{props.results.length === 1 ? "" : "s"}  type to filter  up/down move  enter switch  esc close</text>
      <box height={1} />
      <Show when={props.results.length > 0} fallback={<EmptySpaceState query={props.query} />}>
        <scrollbox flexGrow={1} minHeight={0} scrollbarOptions={{ showArrows: false }}>
          <box flexDirection="column" width="100%">
            <For each={props.results.slice(0, 8)}>
              {(result, index) => <SpaceResultRow result={result} selected={index() === props.selectedIndex} active={result.space.key === props.activeSpaceKey} />}
            </For>
          </box>
        </scrollbox>
      </Show>
    </box>
  )
}

function SearchResultRow(props: { result: SearchResult; selected: boolean }) {
  const marker = () => (props.selected ? "▶" : " ")

  return (
    <box height={3} width="100%" backgroundColor={props.selected ? theme.accentSoft : undefined} paddingX={1} flexDirection="column">
      <text height={1} fg={props.selected ? theme.text : theme.muted}>{marker()} {props.result.page.title}  ·  {props.result.matchedIn}</text>
      <text height={1} fg={theme.subtle}>  {props.result.page.path.join(" / ")}</text>
      <text height={1} fg={theme.muted}>  {props.result.page.snippet}</text>
    </box>
  )
}

function EmptySearchState(props: { query: string }) {
  return (
    <box flexGrow={1} alignItems="center" justifyContent="center">
      <text fg={theme.muted}>No pages match "{props.query}" in this space.</text>
    </box>
  )
}

function SpaceResultRow(props: { result: SpaceSearchResult; selected: boolean; active: boolean }) {
  const marker = () => (props.selected ? "▶" : props.active ? "●" : " ")
  const syncColor = () => (props.result.space.syncState === "fresh" ? theme.good : props.result.space.syncState === "stale" ? theme.warn : theme.danger)

  return (
    <box height={3} width="100%" backgroundColor={props.selected ? theme.accentSoft : undefined} paddingX={1} flexDirection="column">
      <text height={1} fg={props.selected ? theme.text : theme.muted}>{marker()} {props.result.space.key}  ·  {props.result.space.name}</text>
      <text height={1} fg={syncColor()}>  {props.result.space.syncState}  ·  {props.result.space.pageCount} pages  ·  matched {props.result.matchedIn}</text>
      <text height={1} fg={theme.subtle}>  last synced {formatOptionalDate(props.result.space.lastSyncedAt)}</text>
    </box>
  )
}

function EmptySpaceState(props: { query: string }) {
  return (
    <box flexGrow={1} alignItems="center" justifyContent="center">
      <text fg={theme.muted}>No spaces match "{props.query}".</text>
    </box>
  )
}

function buildTreeRows(pages: IndexedPage[], expandedPageIds: Set<string>) {
  const byParent = new Map<string | null, IndexedPage[]>()
  const pageIds = new Set(pages.map((page) => page.pageId))

  for (const page of pages) {
    const siblings = byParent.get(page.parentId) ?? []
    siblings.push(page)
    byParent.set(page.parentId, siblings)
  }

  for (const siblings of byParent.values()) {
    siblings.sort(compareTreePages)
  }

  const rows: TreeRow[] = []
  const visited = new Set<string>()
  const rootPages = pages
    .filter((page) => page.parentId === null || !pageIds.has(page.parentId))
    .sort(compareTreePages)
  const reachablePageIds = new Set<string>()

  const markReachable = (page: IndexedPage) => {
    if (reachablePageIds.has(page.pageId)) return

    reachablePageIds.add(page.pageId)
    for (const child of byParent.get(page.pageId) ?? []) markReachable(child)
  }

  const visit = (page: IndexedPage, depth: number, detached: boolean) => {
    if (visited.has(page.pageId)) return

    visited.add(page.pageId)
    const hasChildren = (byParent.get(page.pageId)?.length ?? 0) > 0
    const expanded = hasChildren && expandedPageIds.has(page.pageId)

    rows.push({ page, depth, hasChildren, expanded, detached })
    if (expanded) {
      for (const child of byParent.get(page.pageId) ?? []) visit(child, depth + 1, false)
    }
  }

  for (const page of rootPages) markReachable(page)
  for (const page of rootPages) visit(page, 0, page.parentId !== null && !pageIds.has(page.parentId))
  for (const page of pages) {
    if (!reachablePageIds.has(page.pageId)) visit(page, 0, true)
  }

  return rows
}

function compareTreePages(left: IndexedPage, right: IndexedPage) {
  return (left.treeOrder ?? 0) - (right.treeOrder ?? 0) || left.title.localeCompare(right.title)
}

function getAncestorPageIds(pageId: string, pageById: Map<string, IndexedPage>) {
  const ancestors: string[] = []
  let current = pageById.get(pageId)
  const seen = new Set<string>()

  while (current?.parentId && !seen.has(current.parentId)) {
    ancestors.unshift(current.parentId)
    seen.add(current.parentId)
    current = pageById.get(current.parentId)
  }

  return ancestors
}

function moveSelection(direction: number, rows: TreeRow[], selectedIndex: number, setSelectedPageId: (pageId: string) => void) {
  const nextIndex = Math.max(0, Math.min(rows.length - 1, selectedIndex + direction))
  const nextRow = rows[nextIndex]

  if (nextRow) setSelectedPageId(nextRow.page.pageId)
}

export function pageSearchKeyAction(key: SearchKeyLike): PageSearchKeyAction {
  if (key.name === "escape") return "close"
  if (key.name === "return") return "submit"
  if (key.name === "backspace") return "delete"
  if (isSearchCharacter(key)) return "append"
  if (key.name === "down" || (key.ctrl && (key.name === "j" || key.name === "n"))) return "next"
  if (key.name === "up" || (key.ctrl && (key.name === "k" || key.name === "p"))) return "previous"
  return "ignore"
}

function isSearchCharacter(key: SearchKeyLike) {
  if (key.ctrl || key.meta) return false
  if (["return", "tab", "escape", "backspace"].includes(key.name)) return false
  return key.sequence.length === 1 && key.sequence >= " "
}

function isPlainKey(key: SearchKeyLike, value: string) {
  return !key.ctrl && !key.meta && (key.name === value || key.sequence === value)
}

function editorSaveMessage(result: SaveTuiPageDraftResult) {
  if (result.status === "saved") return `Draft saved for ${result.pageTitle}.`
  if (result.status === "cleared") return `Draft cleared for ${result.pageTitle}; content matches synced page.`
  return `No draft changes for ${result.pageTitle}.`
}

function applyResultMessage(result: Exclude<ApplyPageDraftResult, { status: "applied" }>) {
  if (result.status === "conflict") return `Conflict: ${result.details.join(" ")}`
  return `Apply blocked: ${result.details.join(" ")}`
}

function reviewMessageColor(message: string) {
  if (/\b(conflict|blocked|failed|missing|cannot)\b/i.test(message)) return theme.danger
  if (/\b(appl|stage|save|review)\b/i.test(message)) return theme.good
  return theme.subtle
}

function diffLineColor(line: string) {
  if (line.startsWith("+++") || line.startsWith("---")) return theme.accent
  if (line.startsWith("+")) return theme.good
  if (line.startsWith("-")) return theme.danger
  return theme.text
}

function relatedItems(page: ReaderPage) {
  return [
    ...page.children.map((child) => `child: ${child.title}`),
    ...page.outgoingLinks.map((link) => `${link.kind === "internal" ? "->" : "external"} ${link.title}`),
    ...page.backlinks.map((link) => `<- ${link.title}`),
  ]
}

const dateFormatter = new Intl.DateTimeFormat("en", { month: "short", day: "2-digit", year: "numeric" })

function formatDate(value: string) {
  const timestamp = Date.parse(value)

  if (!Number.isFinite(timestamp)) return "unknown"

  return dateFormatter.format(new Date(timestamp))
}

function formatOptionalDate(value: string | null) {
  return value ? formatDate(value) : "never"
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown TUI edit error."
}
