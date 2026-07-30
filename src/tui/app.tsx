import { readFileSync, statSync } from "node:fs"
import { render, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import {
  BoxRenderable,
  CliRenderEvents,
  CodeRenderable,
  type CliRenderer,
  type InputRenderable,
  type OptimizedBuffer,
  RGBA,
  TextAttributes,
  TextRenderable,
  type TextareaRenderable,
  destroyTreeSitterClient,
  getTreeSitterClient,
  infoStringToFiletype,
  type MarkdownOptions,
  type RenderContext,
  type ScrollBoxRenderable,
  type TerminalCapabilities,
  type TreeSitterClient,
} from "@opentui/core"
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { decodeImageFile, type DecodedImage } from "../media/image"
import { openBrowserUrl, type BrowserOpenResult } from "../browser"
import type { FocusPane, IndexedPage, MediaAsset, PageLink, PageViewMode, ReaderPage, SearchResult, SpaceSearchResult } from "../model"
import { loadCredentialStatus, type CredentialStatus } from "../config"
import type { PageDraftStatus } from "../index/repository"
import type { ApplyPageDraftResult } from "../apply"
import { defaultRuntimeEnv, runtimeEnvFromLegacyDemo, type RuntimeEnv } from "../runtime/env"
import { popNavigationLocation, pushNavigationLocation, type NavigationLocation } from "./history"
import { emptyPageId, emptyReaderPage, emptySpaceSummary } from "./data"
import { commandForId, commandsForContext, type CommandContext, type TuiCommand } from "./commands"
import { iterm2ImageCommand } from "./iterm2"
import { kittyDeleteImageCommand, kittyGraphicsCommand, kittyGraphicsPngCommand, kittyImageId } from "./kitty"
import { imageDebugEnabled, imageDebugLogPath, logImageDebug } from "./image-debug"
import { inputDebugEnabled, inputDebugLogPath, logInputDebug } from "./input-debug"
import { splitReaderImagePlaceholders, type ReaderContentPart } from "./media"
import { createTuiRuntime, type TuiRuntime } from "./runtime"
import { sixelImageCommand } from "./sixel"
import type { TuiSource, TuiStagedChange } from "./source"
import { markdownStyle, theme } from "./theme"
import { isPlainKey, isShiftTabKey, isTabKey, resolveKeyCommand, textInputKeyAction, type TextInputAction, type TuiKey } from "./keymap"

type TreeRow = {
  page: IndexedPage
  depth: number
  hasChildren: boolean
  expanded: boolean
  detached: boolean
}

type NavigatorCollapseRow = {
  page: { parentId: string | null }
  hasChildren: boolean
  expanded: boolean
}

type ReaderImagePart = Extract<ReaderContentPart, { kind: "image" }>
type CellPixelSize = { width: number; height: number }
type NavigationTarget = Pick<NavigationLocation, "spaceKey" | "pageViewMode" | "pageId" | "expandedPageIds"> & { focusPane?: FocusPane }
type SideRailPanel = "outline" | "related"

export type OutlineNavigationItem = { title: string; level: number; line: number }
export type RelatedNavigationItem =
  | { kind: "child"; label: string; pageId: string }
  | { kind: "internal"; label: string; pageId: string }
  | { kind: "backlink"; label: string; pageId: string }
  | { kind: "external"; label: string; url: string }

export type DocumentFindMatch = { line: number; column: number; preview: string }

const documentHorizontalScrollColumns = 8

export type SearchKeyLike = TuiKey

type CredentialWarning = Exclude<CredentialStatus, { kind: "ready" }>

export type PageSearchKeyAction = TextInputAction

export type ImageRenderMode = "kitty" | "iterm2" | "sixel" | "cell-color" | "cell-mono" | "placeholder"

type ImageTerminalCapabilities = Pick<TerminalCapabilities, "kitty_graphics" | "sixel" | "rgb"> & Partial<Pick<TerminalCapabilities, "multiplexer" | "terminal">>

export interface RenderTuiOptions {
  env?: RuntimeEnv
  demo?: boolean
}

export async function renderTui(options: RenderTuiOptions = {}) {
  const runtime = createTuiRuntime({ env: options.env ?? (options.demo === undefined ? defaultRuntimeEnv() : runtimeEnvFromLegacyDemo(options.demo)) })

  render(() => <App runtime={runtime} />, {
    targetFps: 30,
    exitOnCtrlC: true,
    backgroundColor: theme.bg,
    consoleMode: "disabled",
  })
}

export function App(props: { browserOpener?: (url: string) => BrowserOpenResult; credentialStatus?: CredentialStatus; dataSource?: TuiSource; disableTreeSitter?: boolean; initialPageViewMode?: PageViewMode; runtime?: TuiRuntime; runtimeLabel?: string } = {}) {
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  logInputDebug("tui_render_start", {
    inputDebugLog: inputDebugLogPath() ?? undefined,
    rendererScreenMode: renderer.screenMode,
    rendererUseMouse: renderer.useMouse,
    rendererUseKittyKeyboard: renderer.useKittyKeyboard,
  })
  const ownedRuntime = props.runtime ?? (props.dataSource ? null : createTuiRuntime({ env: "prod" }))
  const dataSource = props.dataSource ?? ownedRuntime?.source
  if (!dataSource) throw new Error("App requires a TUI data source.")
  const runtimeLabel = props.runtimeLabel ?? ownedRuntime?.label ?? "custom source"
  const browserOpener = props.browserOpener ?? openBrowserUrl
  const commandPaletteWidth = createMemo(() => {
    const terminalWidth = dimensions().width
    return Math.max(32, Math.min(84, terminalWidth - (terminalWidth < 72 ? 2 : 8)))
  })
  const commandPaletteLeft = createMemo(() => Math.max(1, Math.floor((dimensions().width - commandPaletteWidth()) / 2)))
  const initialSpaceKey = dataSource.getDefaultSpaceKey() ?? "LOCAL"
  const initialPageId = dataSource.getDefaultPageId(initialSpaceKey) ?? emptyPageId
  const [credentialStatus, setCredentialStatus] = createSignal<CredentialStatus | null>(props.credentialStatus ?? ownedRuntime?.credentialStatus ?? null)
  const [activeSpaceKey, setActiveSpaceKey] = createSignal(initialSpaceKey)
  const initialPageViewMode = props.initialPageViewMode ?? "current"
  const initialViewPageId = dataSource.getDefaultPageId(initialSpaceKey, initialPageViewMode) ?? emptyPageId
  const [pageViewMode, setPageViewMode] = createSignal<PageViewMode>(initialPageViewMode)
  const initialSelectedPageId = initialPageViewMode === "current" ? initialPageId : initialViewPageId
  const [selectedPageId, setSelectedPageId] = createSignal(initialSelectedPageId)
  const [expandedPageIds, setExpandedPageIds] = createSignal(new Set(initialSelectedPageId === emptyPageId ? [] : [initialSelectedPageId]))
  const [navigationHistory, setNavigationHistory] = createSignal<NavigationLocation[]>([])
  const [focusPane, setFocusPane] = createSignal<FocusPane>("navigator")
  const [sideRailSelectedIndex, setSideRailSelectedIndex] = createSignal(0)
  const [pageSearchOpen, setPageSearchOpen] = createSignal(false)
  const [pageSearchQuery, setPageSearchQuery] = createSignal("")
  const [pageSearchSelectedIndex, setPageSearchSelectedIndex] = createSignal(0)
  const [allSpaceSearchOpen, setAllSpaceSearchOpen] = createSignal(false)
  const [allSpaceSearchQuery, setAllSpaceSearchQuery] = createSignal("")
  const [allSpaceSearchSelectedIndex, setAllSpaceSearchSelectedIndex] = createSignal(0)
  const [documentFindOpen, setDocumentFindOpen] = createSignal(false)
  const [documentFindQuery, setDocumentFindQuery] = createSignal("")
  const [documentFindSelectedIndex, setDocumentFindSelectedIndex] = createSignal(0)
  const [newPageOpen, setNewPageOpen] = createSignal(false)
  const [newPageTitle, setNewPageTitle] = createSignal("")
  const [newPageParentPageId, setNewPageParentPageId] = createSignal<string | null>(null)
  const [spaceSwitcherOpen, setSpaceSwitcherOpen] = createSignal(false)
  const [spaceSwitcherQuery, setSpaceSwitcherQuery] = createSignal("")
  const [spaceSwitcherSelectedIndex, setSpaceSwitcherSelectedIndex] = createSignal(0)
  const [commandPaletteOpen, setCommandPaletteOpen] = createSignal(false)
  const [commandPaletteQuery, setCommandPaletteQuery] = createSignal("")
  const [commandPaletteSelectedIndex, setCommandPaletteSelectedIndex] = createSignal(0)
  const [draftRevision, setDraftRevision] = createSignal(0)
  const [pageReloading, setPageReloading] = createSignal(false)
  const [editorOpen, setEditorOpen] = createSignal(false)
  const [editorPageId, setEditorPageId] = createSignal<string | null>(null)
  const [editorPageTitle, setEditorPageTitle] = createSignal("")
  const [editorInitialMarkdown, setEditorInitialMarkdown] = createSignal("")
  const [editorOriginalMarkdown, setEditorOriginalMarkdown] = createSignal("")
  const [editorMarkdown, setEditorMarkdown] = createSignal("")
  const [editorInputFocused, setEditorInputFocused] = createSignal(false)
  const [changesOpen, setChangesOpen] = createSignal(false)
  const [changesSelectedIndex, setChangesSelectedIndex] = createSignal(0)
  const [selectedChangeKeys, setSelectedChangeKeys] = createSignal(new Set<string>())
  const [changesApplying, setChangesApplying] = createSignal(false)
  const [changesMessage, setChangesMessage] = createSignal("")
  const [editStatusMessage, setEditStatusMessage] = createSignal("")
  const [imageViewerOpen, setImageViewerOpen] = createSignal(false)
  const [imageViewerSelectedIndex, setImageViewerSelectedIndex] = createSignal(0)
  const [helpOpen, setHelpOpen] = createSignal(false)
  const [terminalCapabilities, setTerminalCapabilities] = createSignal<TerminalCapabilities | null>(renderer.capabilities)
  const [terminalCellPixels, setTerminalCellPixels] = createSignal<CellPixelSize | null>(null)
  const [treeSitterClient, setTreeSitterClient] = createSignal<TreeSitterClient | undefined>()
  const readerImageRenderables = new Map<string, BoxRenderable>()
  let documentScrollbox: ScrollBoxRenderable | undefined
  let helpScrollbox: ScrollBoxRenderable | undefined
  let editorFocusTimer: ReturnType<typeof setTimeout> | undefined
  let historyRestoreTimer: ReturnType<typeof setTimeout> | undefined
  let transientStatusTimer: ReturnType<typeof setTimeout> | undefined

  const spaces = createMemo(() => dataSource.listSpaces())
  const space = createMemo(() => spaces().find((candidate) => candidate.key === activeSpaceKey()) ?? emptySpaceSummary(activeSpaceKey()))
  const pages = createMemo(() => {
    draftRevision()
    return dataSource.getPagesForSpace(activeSpaceKey(), pageViewMode())
  })
  const pageById = createMemo(() => new Map(pages().map((page) => [page.pageId, page])))
  const treeRows = createMemo(() => buildTreeRows(pages(), expandedPageIds()))
  const selectedIndex = createMemo(() => treeRows().findIndex((row) => row.page.pageId === selectedPageId()))
  const selectedRow = createMemo(() => treeRows().find((row) => row.page.pageId === selectedPageId()))
  const newPageParentPage = createMemo(() => {
    const parentPageId = newPageParentPageId()
    return parentPageId ? pageById().get(parentPageId) ?? null : null
  })
  const readerPage = createMemo(() => {
    draftRevision()
    if (selectedPageId() === emptyPageId) return emptyReaderPage(space())

    return dataSource.getReaderPage(selectedPageId(), pageViewMode()) ?? emptyReaderPage(space())
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
  const pageSearchResults = createMemo(() => {
    draftRevision()
    return dataSource.searchPagesInSpace(activeSpaceKey(), pageSearchQuery(), pageViewMode())
  })
  const allSpaceSearchResults = createMemo(() => {
    draftRevision()
    return dataSource.searchPagesAcrossSpaces(allSpaceSearchQuery(), pageViewMode())
  })
  const documentFindMatches = createMemo(() => findDocumentMatches(readerPage().contentMarkdown, documentFindQuery()))
  const spaceSwitcherResults = createMemo(() => dataSource.searchSpaces(spaceSwitcherQuery()))
  const commandPaletteResults = createMemo(() => searchPaletteCommands(commandsForContext(["main"]), commandPaletteQuery()))
  const stagedChanges = createMemo(() => {
    draftRevision()
    return dataSource.listStagedChanges(activeSpaceKey())
  })
  const readerImageParts = createMemo(() => readerImagePartsForPage(readerPage()))
  const outlineNavigationItems = createMemo(() => documentOutlineItems(readerPage().contentMarkdown))
  const relatedNavigationItems = createMemo(() => relatedNavigationItemsForPage(readerPage(), dataSource.getPageById))
  const inlineImageRenderDecision = createMemo(() => imageRenderModeDecisionForCapabilities(terminalCapabilities()))
  const viewerImageRenderDecision = createMemo(() => imageRenderModeDecisionForCapabilities(terminalCapabilities(), { nativeProtocols: true }))
  const inlineImageRenderMode = createMemo(() => inlineImageRenderDecision().mode)
  const viewerImageRenderMode = createMemo(() => viewerImageRenderDecision().mode)
  const isNarrow = createMemo(() => dimensions().width < 96)
  const helpCommands = commandsForContext(["main", "navigator", "document", "changes", "image-viewer"])
  const halfPageScrollAmount = createMemo(() => Math.max(6, Math.floor((dimensions().height - 9) / 2)))
  const credentialWarning = createMemo<CredentialWarning | null>(() => {
    const status = credentialStatus()
    if (!status || status.kind === "ready") return null
    return status
  })

  onMount(() => {
    if (credentialStatus()) return

    let cancelled = false
    void loadCredentialStatus().then((status) => {
      if (!cancelled) setCredentialStatus(status)
    })

    onCleanup(() => {
      cancelled = true
    })
  })

  onMount(() => {
    const updateCapabilities = (capabilities: TerminalCapabilities | null) => setTerminalCapabilities(capabilities)
    renderer.on(CliRenderEvents.CAPABILITIES, updateCapabilities)

    onCleanup(() => renderer.off(CliRenderEvents.CAPABILITIES, updateCapabilities))
  })

  createEffect(() => {
    if (terminalCellPixels()) return
    if (viewerImageRenderMode() !== "sixel") return

    let cancelled = false
    void detectTerminalCellPixels(renderer).then((size) => {
      if (!cancelled && size) setTerminalCellPixels(size)
    })

    onCleanup(() => {
      cancelled = true
    })
  })

  createEffect(() => {
    if (!documentFindOpen()) return

    const match = documentFindMatches()[documentFindSelectedIndex()]
    if (match) documentScrollbox?.scrollTo(match.line)
  })

  let lastImageModeDebugKey = ""
  createEffect(() => {
    const capabilities = terminalCapabilities()
    const inline = inlineImageRenderDecision()
    const viewer = viewerImageRenderDecision()
    const key = JSON.stringify({ capabilities: summarizeImageCapabilities(capabilities), inline, viewer })
    if (key === lastImageModeDebugKey) return

    lastImageModeDebugKey = key
    logImageDebug("image_mode_decision", {
      context: "inline",
      mode: inline.mode,
      reason: inline.reason,
      ...summarizeImageCapabilities(capabilities),
    })
    logImageDebug("image_mode_decision", {
      context: "viewer",
      mode: viewer.mode,
      reason: viewer.reason,
      ...summarizeImageCapabilities(capabilities),
    })
  })

  let lastImageViewerStateDebugKey = ""
  createEffect(() => {
    const images = readerImageParts()
    const selectedImage = images[imageViewerSelectedIndex()]
    const state = {
      open: imageViewerOpen(),
      selectedIndex: imageViewerSelectedIndex(),
      imageCount: images.length,
      pageId: readerPage().pageId,
      pageTitle: readerPage().title,
      nodeId: selectedImage?.nodeId,
      label: selectedImage?.label,
      renderMode: viewerImageRenderMode(),
    }
    const key = JSON.stringify(state)
    if (key === lastImageViewerStateDebugKey) return

    lastImageViewerStateDebugKey = key
    logImageDebug("viewer_state", state)
  })

  onMount(() => {
    if (props.disableTreeSitter) return

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
    clearEditorFocusTimer()
    clearHistoryRestoreTimer()
    clearTransientStatusTimer()
    if (!props.dataSource) dataSource.close?.()
  })

  const clearEditorFocusTimer = () => {
    if (!editorFocusTimer) return

    clearTimeout(editorFocusTimer)
    editorFocusTimer = undefined
  }

  const clearHistoryRestoreTimer = () => {
    if (!historyRestoreTimer) return
    clearTimeout(historyRestoreTimer)
    historyRestoreTimer = undefined
  }

  const clearTransientStatusTimer = () => {
    if (!transientStatusTimer) return

    clearTimeout(transientStatusTimer)
    transientStatusTimer = undefined
  }

  const setTransientStatusMessage = (message: string, duration = 4_000) => {
    clearTransientStatusTimer()
    setEditStatusMessage(message)
    transientStatusTimer = setTimeout(() => {
      transientStatusTimer = undefined
      if (editStatusMessage() === message) setEditStatusMessage("")
    }, duration)
  }

  const focusEditorInputAfterOpen = (pageId: string) => {
    clearEditorFocusTimer()
    setEditorInputFocused(false)
    editorFocusTimer = setTimeout(() => {
      editorFocusTimer = undefined
      if (editorPageId() === pageId) setEditorInputFocused(true)
    }, 0)
  }

  createEffect(() => {
    const pageId = selectedPageId()
    if (pageId === emptyPageId || pageById().has(pageId)) return

    const defaultPageId = dataSource.getDefaultPageId(activeSpaceKey(), pageViewMode()) ?? emptyPageId
    setSelectedPageId(defaultPageId)
    setExpandedPageIds(new Set(defaultPageId === emptyPageId ? [] : [defaultPageId]))
    documentScrollbox?.scrollTo(0)
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
    const maxIndex = Math.max(0, allSpaceSearchResults().length - 1)

    if (allSpaceSearchSelectedIndex() > maxIndex) setAllSpaceSearchSelectedIndex(maxIndex)
  })

  createEffect(() => {
    const maxIndex = Math.max(0, spaceSwitcherResults().length - 1)

    if (spaceSwitcherSelectedIndex() > maxIndex) setSpaceSwitcherSelectedIndex(maxIndex)
  })

  createEffect(() => {
    const maxIndex = Math.max(0, (focusPane() === "outline" ? outlineNavigationItems() : relatedNavigationItems()).length - 1)
    if (sideRailSelectedIndex() > maxIndex) setSideRailSelectedIndex(maxIndex)
  })

  createEffect(() => {
    const changes = stagedChanges()
    const maxIndex = Math.max(0, changes.length - 1)

    if (changesSelectedIndex() > maxIndex) setChangesSelectedIndex(maxIndex)

    setSelectedChangeKeys((current) => {
      const available = new Set(changes.map((change) => change.changeKey))
      const next = new Set([...current].filter((pageId) => available.has(pageId)))

      return next
    })
  })

  createEffect(() => {
    const images = readerImageParts()
    if (!imageViewerOpen()) return

    if (!images.length) {
      setImageViewerOpen(false)
      setImageViewerSelectedIndex(0)
      return
    }

    if (imageViewerSelectedIndex() >= images.length) setImageViewerSelectedIndex(images.length - 1)
  })

  const openPageSearch = () => {
    setDocumentFindOpen(false)
    setAllSpaceSearchOpen(false)
    setSpaceSwitcherOpen(false)
    setCommandPaletteOpen(false)
    setChangesOpen(false)
    setNewPageOpen(false)
    setPageSearchOpen(true)
    setPageSearchQuery("")
    setPageSearchSelectedIndex(0)
  }

  const openAllSpaceSearch = () => {
    setDocumentFindOpen(false)
    setPageSearchOpen(false)
    setSpaceSwitcherOpen(false)
    setCommandPaletteOpen(false)
    setChangesOpen(false)
    setNewPageOpen(false)
    setAllSpaceSearchOpen(true)
    setAllSpaceSearchQuery("")
    setAllSpaceSearchSelectedIndex(0)
  }

  const openDocumentFind = () => {
    setPageSearchOpen(false)
    setAllSpaceSearchOpen(false)
    setSpaceSwitcherOpen(false)
    setCommandPaletteOpen(false)
    setChangesOpen(false)
    setNewPageOpen(false)
    setDocumentFindQuery("")
    setDocumentFindSelectedIndex(0)
    setDocumentFindOpen(true)
    setFocusPane("document")
  }

  const openSelectedPageInBrowser = () => {
    const page = readerPage()
    openUrlInBrowser(page.url, page.title)
  }

  const openUrlInBrowser = (url: string, label: string) => {
    const result = browserOpener(url)
    setEditStatusMessage(result.status === "opened" ? `Opened ${label} in your browser.` : result.reason)
  }

  const closeDocumentFind = () => {
    setDocumentFindOpen(false)
    setDocumentFindQuery("")
    setDocumentFindSelectedIndex(0)
  }

  const updateDocumentFindQuery = (query: string) => {
    setDocumentFindQuery(query)
    setDocumentFindSelectedIndex(0)
  }

  const moveDocumentFindSelection = (direction: number) => {
    const matches = documentFindMatches()
    if (!matches.length) return

    setDocumentFindSelectedIndex((current) => nextDocumentFindIndex(current, direction, matches.length))
  }

  const handleDocumentFindInputKey = (key: SearchKeyLike) => {
    const command = resolveKeyCommand(key, "document-find")

    if (command === "close-overlay") closeDocumentFind()
    else if (command === "search-next") moveDocumentFindSelection(1)
    else if (command === "search-previous") moveDocumentFindSelection(-1)

    return command === "close-overlay" || command === "search-next" || command === "search-previous"
  }

  const switchPageView = (view: PageViewMode) => {
    if (pageViewMode() === view) return

    const defaultPageId = dataSource.getDefaultPageId(activeSpaceKey(), view) ?? emptyPageId
    setPageViewMode(view)
    setSelectedPageId(defaultPageId)
    setExpandedPageIds(new Set(defaultPageId === emptyPageId ? [] : [defaultPageId]))
    documentScrollbox?.scrollTo(0)
    setFocusPane("navigator")
    setEditStatusMessage(view === "archived" ? "Archived view is read-only." : "Current view selected.")
  }

  const togglePageView = () => {
    switchPageView(pageViewMode() === "current" ? "archived" : "current")
  }

  const currentNavigationLocation = (): NavigationLocation => ({
    spaceKey: activeSpaceKey(),
    pageViewMode: pageViewMode(),
    pageId: selectedPageId(),
    expandedPageIds: [...expandedPageIds()],
    scrollLeft: documentScrollbox?.scrollLeft ?? 0,
    scrollTop: documentScrollbox?.scrollTop ?? 0,
  })

  const navigateToPage = (target: NavigationTarget) => {
    const current = currentNavigationLocation()
    const changed = current.spaceKey !== target.spaceKey || current.pageViewMode !== target.pageViewMode || current.pageId !== target.pageId
    if (changed) setNavigationHistory((history) => pushNavigationLocation(history, current))

    setActiveSpaceKey(target.spaceKey)
    setPageViewMode(target.pageViewMode)
    setSelectedPageId(target.pageId)
    setExpandedPageIds(new Set(target.expandedPageIds))
    documentScrollbox?.scrollTo(0)
    setFocusPane(target.focusPane ?? "document")
  }

  const goBack = () => {
    const result = popNavigationLocation(navigationHistory())
    if (!result.location) {
      setEditStatusMessage("No earlier page in history.")
      return
    }

    const location = result.location
    setNavigationHistory(result.history)
    const available = dataSource.getPagesForSpace(location.spaceKey, location.pageViewMode)
    const pageExists = available.some((page) => page.pageId === location.pageId)
    const pageId = pageExists ? location.pageId : dataSource.getDefaultPageId(location.spaceKey, location.pageViewMode) ?? emptyPageId

    setActiveSpaceKey(location.spaceKey)
    setPageViewMode(location.pageViewMode)
    setSelectedPageId(pageId)
    setExpandedPageIds(new Set(location.expandedPageIds))
    setFocusPane("document")
    clearHistoryRestoreTimer()
    historyRestoreTimer = setTimeout(() => {
      historyRestoreTimer = undefined
      documentScrollbox?.scrollTo({ x: location.scrollLeft, y: location.scrollTop })
    }, 0)
    setEditStatusMessage(pageExists ? `Returned to ${pageId}.` : "The previous page is no longer available; opened the space default instead.")
  }

  const moveSideRailSelection = (direction: number) => {
    const items = focusPane() === "outline" ? outlineNavigationItems() : relatedNavigationItems()
    if (!items.length) return
    setSideRailSelectedIndex((current) => Math.max(0, Math.min(items.length - 1, current + direction)))
  }

  const switchSideRailPanel = (panel: SideRailPanel) => {
    if (focusPane() === panel) return
    setFocusPane(panel)
    setSideRailSelectedIndex(0)
  }

  const activateSideRailItem = () => {
    if (focusPane() === "outline") {
      const item = outlineNavigationItems()[sideRailSelectedIndex()]
      if (!item) return
      documentScrollbox?.scrollTo(item.line)
      setFocusPane("document")
      return
    }

    const item = relatedNavigationItems()[sideRailSelectedIndex()]
    if (!item) return

    const page = item.kind === "external" ? dataSource.getPageByUrl(item.url) : dataSource.getPageById(item.pageId)
    if (!page) {
      if (item.kind === "external") {
        openUrlInBrowser(item.url, item.label)
        return
      }
      setEditStatusMessage(`${item.label} is no longer in the local index.`)
      return
    }

    navigateToPage({
      spaceKey: page.spaceKey,
      pageViewMode: isArchivedPage(page) ? "archived" : "current",
      pageId: page.pageId,
      expandedPageIds: [page.pageId],
    })
  }

  const closePageSearch = () => {
    setPageSearchOpen(false)
    setPageSearchQuery("")
    setPageSearchSelectedIndex(0)
  }

  const closeAllSpaceSearch = () => {
    setAllSpaceSearchOpen(false)
    setAllSpaceSearchQuery("")
    setAllSpaceSearchSelectedIndex(0)
  }

  const handlePageSearchInputKey = (key: SearchKeyLike) => {
    const action = pageSearchKeyAction(key)

    if (action === "close") closePageSearch()
    else if (action === "submit") selectPageSearchResult()
    else if (action === "next") movePageSearchSelection(1)
    else if (action === "previous") movePageSearchSelection(-1)

    return action === "close" || action === "submit" || action === "next" || action === "previous"
  }

  const handleAllSpaceSearchInputKey = (key: SearchKeyLike) => {
    const action = pageSearchKeyAction(key)

    if (action === "close") closeAllSpaceSearch()
    else if (action === "submit") selectAllSpaceSearchResult()
    else if (action === "next") moveAllSpaceSearchSelection(1)
    else if (action === "previous") moveAllSpaceSearchSelection(-1)

    return action === "close" || action === "submit" || action === "next" || action === "previous"
  }

  const openSpaceSwitcher = () => {
    setPageSearchOpen(false)
    setAllSpaceSearchOpen(false)
    setChangesOpen(false)
    setNewPageOpen(false)
    setCommandPaletteOpen(false)
    setSpaceSwitcherOpen(true)
    setSpaceSwitcherQuery("")
    setSpaceSwitcherSelectedIndex(Math.max(0, dataSource.searchSpaces("").findIndex((result) => result.space.key === activeSpaceKey())))
  }

  const closeSpaceSwitcher = () => {
    setSpaceSwitcherOpen(false)
    setSpaceSwitcherQuery("")
    setSpaceSwitcherSelectedIndex(0)
  }

  const openCommandPalette = () => {
    setPageSearchOpen(false)
    setAllSpaceSearchOpen(false)
    setDocumentFindOpen(false)
    setSpaceSwitcherOpen(false)
    setChangesOpen(false)
    setNewPageOpen(false)
    setCommandPaletteQuery("")
    setCommandPaletteSelectedIndex(0)
    setCommandPaletteOpen(true)
  }

  const closeCommandPalette = () => {
    setCommandPaletteOpen(false)
    setCommandPaletteQuery("")
    setCommandPaletteSelectedIndex(0)
  }

  const moveCommandPaletteSelection = (direction: number) => {
    const results = commandPaletteResults()
    if (!results.length) {
      setCommandPaletteSelectedIndex(0)
      return
    }

    setCommandPaletteSelectedIndex((current) => Math.max(0, Math.min(results.length - 1, current + direction)))
  }

  const runSelectedPaletteCommand = () => {
    const command = commandPaletteResults()[commandPaletteSelectedIndex()]
    if (!command) return
    if (!command.available) {
      setEditStatusMessage(command.unavailableReason ?? `${command.label} is not available yet.`)
      return
    }

    closeCommandPalette()

    if (command.id === "quit") renderer.destroy()
    else if (command.id === "show-help") setHelpOpen(true)
    else if (command.id === "open-command-palette") openCommandPalette()
    else if (command.id === "open-page-search") openPageSearch()
    else if (command.id === "open-all-space-search") openAllSpaceSearch()
    else if (command.id === "open-document-find") openDocumentFind()
    else if (command.id === "open-space-switcher") openSpaceSwitcher()
    else if (command.id === "open-browser") openSelectedPageInBrowser()
    else if (command.id === "go-back") goBack()
    else if (command.id === "open-overview") openChanges()
    else if (command.id === "toggle-page-view") togglePageView()
    else if (command.id === "edit-page") openEditorForSelectedPage()
    else if (command.id === "open-image-viewer") openImageViewer()
    else if (command.id === "stage-delete") stageDeleteSelectedPage()
    else if (command.id === "focus-next-pane") setFocusPane((current) => current === "navigator" ? "document" : current === "document" ? "outline" : current === "outline" ? "related" : "navigator")
    else if (command.id === "focus-previous-pane") setFocusPane((current) => current === "navigator" ? "related" : current === "related" ? "outline" : current === "outline" ? "document" : "navigator")
    else if (command.id === "page-down") scrollDocumentBy(halfPageScrollAmount())
    else if (command.id === "page-up") scrollDocumentBy(-halfPageScrollAmount())
  }

  const handleCommandPaletteInputKey = (key: SearchKeyLike) => {
    const command = resolveKeyCommand(key, "command-palette")

    if (command === "close-overlay") closeCommandPalette()
    else if (command === "search-submit") runSelectedPaletteCommand()
    else if (command === "search-next") moveCommandPaletteSelection(1)
    else if (command === "search-previous") moveCommandPaletteSelection(-1)

    return command === "close-overlay" || command === "search-submit" || command === "search-next" || command === "search-previous"
  }

  const handleSpaceSwitcherInputKey = (key: SearchKeyLike) => {
    const action = pageSearchKeyAction(key)

    if (action === "close") closeSpaceSwitcher()
    else if (action === "submit") selectSpaceSwitcherResult()
    else if (action === "next") moveSpaceSwitcherSelection(1)
    else if (action === "previous") moveSpaceSwitcherSelection(-1)

    return action === "close" || action === "submit" || action === "next" || action === "previous"
  }

  const openChanges = (focusChangeKey?: string) => {
    setPageSearchOpen(false)
    setAllSpaceSearchOpen(false)
    setNewPageOpen(false)
    setSpaceSwitcherOpen(false)
    setImageViewerOpen(false)

    const changes = stagedChanges()
    const focusIndex = focusChangeKey ? changes.findIndex((change) => change.changeKey === focusChangeKey) : -1

    setChangesSelectedIndex(focusIndex >= 0 ? focusIndex : 0)
    setSelectedChangeKeys(new Set(changes.map((change) => change.changeKey)))
    setChangesMessage(changes.length ? `${changes.length} staged change${changes.length === 1 ? "" : "s"} in ${space().name}.` : `No staged changes in ${space().name}.`)
    setChangesOpen(true)
  }

  const closeChanges = () => {
    setChangesOpen(false)
  }

  const moveChangesSelection = (direction: number) => {
    setChangesSelectedIndex((current) => Math.max(0, Math.min(stagedChanges().length - 1, current + direction)))
  }

  const toggleSelectedChange = () => {
    const change = stagedChanges()[changesSelectedIndex()]
    if (!change) return

    setSelectedChangeKeys((current) => {
      const next = new Set(current)

      if (next.has(change.changeKey)) next.delete(change.changeKey)
      else next.add(change.changeKey)

      return next
    })
  }

  const selectedChangeIds = () => stagedChanges()
    .filter((change) => selectedChangeKeys().has(change.changeKey))
    .map((change) => change.changeKey)

  const applySelectedChanges = () => {
    const changeKeys = selectedChangeIds()
    if (!changeKeys.length || changesApplying()) {
      setChangesMessage("Select at least one staged change to apply.")
      return
    }

    setChangesApplying(true)
    setChangesMessage(`Applying ${changeKeys.length} selected staged change${changeKeys.length === 1 ? "" : "s"}...`)

    void dataSource.applyStagedChanges(changeKeys).then((results) => {
      const selectedCreateIndex = changeKeys.findIndex((changeKey) => changeKey === selectedPageId() && changeKey.startsWith("create:"))
      const selectedCreateResult = selectedCreateIndex >= 0 ? results[selectedCreateIndex] : null
      const selectedDeleteIndex = changeKeys.findIndex((changeKey) => changeKey === `delete:${selectedPageId()}`)
      const selectedDeleteResult = selectedDeleteIndex >= 0 ? results[selectedDeleteIndex] : null
      const selectedDeletedPage = selectedDeleteIndex >= 0 ? pageById().get(selectedPageId()) : null

      setDraftRevision((revision) => revision + 1)
      if (selectedCreateResult?.status === "applied") setSelectedPageId(selectedCreateResult.pageId)
      if (selectedDeleteResult?.status === "applied") setSelectedPageId(selectedDeletedPage?.parentId ?? dataSource.getDefaultPageId(activeSpaceKey()) ?? emptyPageId)
      setChangesMessage(applyBatchMessage(results))
      setSelectedChangeKeys(new Set(stagedChanges().map((change) => change.changeKey)))
    }).catch((error) => {
      setChangesMessage(errorMessage(error))
    }).finally(() => {
      setChangesApplying(false)
    })
  }

  const discardSelectedChanges = () => {
    const changeKeys = selectedChangeIds()
    if (!changeKeys.length || changesApplying()) {
      setChangesMessage("Select at least one staged change to discard.")
      return
    }

    const selectedDiscardedCreate = stagedChanges().find((change) => change.kind === "create" && change.changeKey === selectedPageId() && changeKeys.includes(change.changeKey))
    const discarded = dataSource.discardStagedChanges(changeKeys)
    setDraftRevision((revision) => revision + 1)
    if (selectedDiscardedCreate?.kind === "create") {
      const parentCreateSelected = selectedDiscardedCreate.create.parentCreateId ? changeKeys.includes(`create:${selectedDiscardedCreate.create.parentCreateId}`) : false
      setSelectedPageId(parentCreateSelected ? dataSource.getDefaultPageId(activeSpaceKey()) ?? emptyPageId : selectedDiscardedCreate.create.parentCreateId ? `create:${selectedDiscardedCreate.create.parentCreateId}` : selectedDiscardedCreate.create.parentPageId ?? dataSource.getDefaultPageId(activeSpaceKey()) ?? emptyPageId)
    }
    setChangesMessage(`Discarded ${discarded} staged change${discarded === 1 ? "" : "s"}.`)
    setSelectedChangeKeys(new Set(stagedChanges().map((change) => change.changeKey)))
  }

  const stageDeleteSelectedPage = () => {
    const pageId = selectedPageId()
    if (pageId === emptyPageId) {
      setEditStatusMessage("No page selected to delete.")
      return
    }

    if (pageId.startsWith("create:")) {
      setEditStatusMessage("Local-only page is already staged as a create. Open Overview and discard it to remove it.")
      openChanges(pageId)
      return
    }

    const page = pageById().get(pageId)
    if (page && !isEditableRemotePage(page)) {
      setEditStatusMessage(`${page.title} is ${remoteStatusLabel(page)} in Confluence and is read-only in lazyconfluence.`)
      return
    }

    try {
      const change = dataSource.stagePageDelete(pageId)
      setDraftRevision((revision) => revision + 1)
      setTransientStatusMessage(`Staged delete for ${change.title}. Open Overview to apply/discard.`)
    } catch (error) {
      setEditStatusMessage(errorMessage(error))
    }
  }

  const reloadCurrentPage = async () => {
    if (pageReloading()) return

    const pageId = selectedPageId()
    if (pageId === emptyPageId) {
      setEditStatusMessage("No page selected to reload.")
      return
    }

    setPageReloading(true)
    setEditStatusMessage(`Reloading ${readerPage().title} from Confluence...`)
    try {
      const result = await dataSource.reloadPage(pageId)
      if (result.status === "blocked") {
        setEditStatusMessage(result.reason === "local-draft"
          ? `${result.pageTitle} has a local draft; stage, apply, or discard it before reloading.`
          : "Demo mode cannot reload Confluence pages.")
        return
      }

      setDraftRevision((revision) => revision + 1)
      setEditStatusMessage(`Reloaded ${result.pageTitle} from Confluence.`)
    } catch (error) {
      setEditStatusMessage(`Could not reload ${readerPage().title}: ${errorMessage(error)}`)
    } finally {
      setPageReloading(false)
    }
  }

  const openNewPage = () => {
    if (pageViewMode() !== "current") {
      setEditStatusMessage("Archived view is read-only. Switch to Current to create pages.")
      return
    }

    const parentPage = selectedRow()?.page
    if (!parentPage || parentPage.pageId === emptyPageId) {
      if (pages().length > 0) {
        setEditStatusMessage("Select a parent page in the navigator before creating a child page, or press N for a root page.")
        return
      }

      openRootNewPage()
      return
    }

    openNewPageWithParent(parentPage.pageId)
  }

  const openRootNewPage = () => {
    if (pageViewMode() !== "current") {
      setEditStatusMessage("Archived view is read-only. Switch to Current to create pages.")
      return
    }

    openNewPageWithParent(null)
  }

  const openNewPageWithParent = (parentPageId: string | null) => {
    setPageSearchOpen(false)
    setAllSpaceSearchOpen(false)
    setSpaceSwitcherOpen(false)
    setChangesOpen(false)
    setImageViewerOpen(false)
    setNewPageTitle("")
    setNewPageParentPageId(parentPageId)
    setNewPageOpen(true)
    setFocusPane("navigator")
  }

  const closeNewPage = () => {
    setNewPageOpen(false)
    setNewPageTitle("")
    setNewPageParentPageId(null)
  }

  const submitNewPage = () => {
    const parentPageId = newPageParentPageId()

    try {
      const change = dataSource.stagePageCreate({ spaceKey: activeSpaceKey(), parentPageId, title: newPageTitle() })

      setDraftRevision((revision) => revision + 1)
      closeNewPage()
      setSelectedPageId(change.changeKey)
      if (parentPageId) setExpandedPageIds((current) => new Set(current).add(parentPageId))
      documentScrollbox?.scrollTo(0)
      setTransientStatusMessage(`Created local page ${change.title}. Press e to edit or c Overview to apply/discard.`)
    } catch (error) {
      setEditStatusMessage(errorMessage(error))
    }
  }

  const selectPageSearchResult = () => {
    const result = pageSearchResults()[pageSearchSelectedIndex()]

    if (!result) return
    navigateToPage({
      spaceKey: activeSpaceKey(),
      pageViewMode: pageViewMode(),
      pageId: result.page.pageId,
      expandedPageIds: [...expandedPageIds()],
    })
    closePageSearch()
  }

  const selectAllSpaceSearchResult = () => {
    const result = allSpaceSearchResults()[allSpaceSearchSelectedIndex()]

    if (!result) return
    navigateToPage({
      spaceKey: result.page.spaceKey,
      pageViewMode: pageViewMode(),
      pageId: result.page.pageId,
      expandedPageIds: [result.page.pageId],
    })
    closeAllSpaceSearch()
  }

  const movePageSearchSelection = (direction: number) => {
    setPageSearchSelectedIndex((current) => Math.max(0, Math.min(pageSearchResults().length - 1, current + direction)))
  }

  const moveAllSpaceSearchSelection = (direction: number) => {
    setAllSpaceSearchSelectedIndex((current) => Math.max(0, Math.min(allSpaceSearchResults().length - 1, current + direction)))
  }

  const selectSpaceSwitcherResult = () => {
    const result = spaceSwitcherResults()[spaceSwitcherSelectedIndex()]

    if (!result) return

    const defaultPageId = dataSource.getDefaultPageId(result.space.key) ?? emptyPageId
    navigateToPage({
      spaceKey: result.space.key,
      pageViewMode: "current",
      pageId: defaultPageId,
      expandedPageIds: defaultPageId === emptyPageId ? [] : [defaultPageId],
      focusPane: "navigator",
    })
    closeSpaceSwitcher()
  }

  const moveSpaceSwitcherSelection = (direction: number) => {
    setSpaceSwitcherSelectedIndex((current) => Math.max(0, Math.min(spaceSwitcherResults().length - 1, current + direction)))
  }

  const scrollDocumentBy = (lines: number) => {
    documentScrollbox?.scrollBy(lines)
    setFocusPane("document")
  }

  const scrollDocumentHorizontallyBy = (columns: number) => {
    documentScrollbox?.scrollBy({ x: columns, y: 0 })
    setFocusPane("document")
  }

  const setReaderImageRenderable = (nodeId: string, renderable: BoxRenderable) => {
    readerImageRenderables.set(nodeId, renderable)
  }

  const nearestReaderImageSelection = (images: ReaderImagePart[]) => {
    const viewport = documentScrollbox?.viewport
    const positions = readerImagePositions(images, readerImageRenderables)

    if (!viewport) return { index: 0, reason: "missing-scrollbox", positionCount: positions.length }
    if (!positions.length) return { index: 0, reason: "missing-image-positions", viewportTop: viewport.screenY, viewportHeight: viewport.height, positionCount: 0 }

    const index = nearestImageIndexForViewport(images, positions, viewport.screenY, viewport.height)
    const selectedPosition = positions.find((position) => position.nodeId === images[index]?.nodeId)
    const viewportCenter = viewport.screenY + viewport.height / 2

    return {
      index,
      reason: "nearest-scroll-image",
      viewportTop: viewport.screenY,
      viewportHeight: viewport.height,
      viewportCenter,
      positionCount: positions.length,
      selectedImageTop: selectedPosition?.top,
      selectedImageHeight: selectedPosition?.height,
      selectedImageDistance: selectedPosition ? distanceToViewportCenter(selectedPosition, viewportCenter) : undefined,
    }
  }

  const openImageViewer = () => {
    const images = readerImageParts()
    const selection = nearestReaderImageSelection(images)
    logImageDebug("viewer_open_requested", {
      ...imageInputDebugState(),
      renderMode: viewerImageRenderMode(),
      selectionReason: selection.reason,
      selectedIndex: selection.index,
      viewportTop: selection.viewportTop,
      viewportHeight: selection.viewportHeight,
      viewportCenter: selection.viewportCenter,
      imagePositionCount: selection.positionCount,
      selectedImageTop: selection.selectedImageTop,
      selectedImageHeight: selection.selectedImageHeight,
      selectedImageDistance: selection.selectedImageDistance,
    })

    if (!images.length) {
      setEditStatusMessage("No image placeholders are available on this page.")
      logImageDebug("viewer_open_skipped", { reason: "no-image-placeholders", pageId: readerPage().pageId, pageTitle: readerPage().title })
      return
    }

    setPageSearchOpen(false)
    setAllSpaceSearchOpen(false)
    setSpaceSwitcherOpen(false)
    setChangesOpen(false)
    setNewPageOpen(false)
    setImageViewerSelectedIndex(selection.index)
    setImageViewerOpen(true)
    setFocusPane("document")
    setEditStatusMessage(`Viewing image: ${images[selection.index]?.label ?? "image"}. Esc closes the viewer.`)
    logImageDebug("viewer_open", {
      pageId: readerPage().pageId,
      pageTitle: readerPage().title,
      imageCount: images.length,
      selectedIndex: selection.index,
      nodeId: images[selection.index]?.nodeId,
      label: images[selection.index]?.label,
      renderMode: viewerImageRenderMode(),
      selectionReason: selection.reason,
      viewportTop: selection.viewportTop,
      viewportHeight: selection.viewportHeight,
      viewportCenter: selection.viewportCenter,
      imagePositionCount: selection.positionCount,
      selectedImageTop: selection.selectedImageTop,
      selectedImageHeight: selection.selectedImageHeight,
      selectedImageDistance: selection.selectedImageDistance,
      debugLog: imageDebugEnabled() ? imageDebugLogPath() : undefined,
    })
  }

  const closeImageViewer = () => {
    logImageDebug("viewer_close", { pageId: readerPage().pageId, pageTitle: readerPage().title })
    setImageViewerOpen(false)
    setEditStatusMessage("Closed image viewer.")
  }

  const moveImageViewerSelection = (direction: number) => {
    const images = readerImageParts()
    if (!images.length) return

    setImageViewerSelectedIndex((current) => (current + direction + images.length) % images.length)
  }

  const imageInputDebugState = () => ({
    focusPane: focusPane(),
    pageId: readerPage().pageId,
    pageTitle: readerPage().title,
    imageCount: readerImageParts().length,
    imageViewerOpen: imageViewerOpen(),
    changesOpen: changesOpen(),
    helpOpen: helpOpen(),
    newPageOpen: newPageOpen(),
    editorOpen: editorOpen(),
    pageSearchOpen: pageSearchOpen(),
    documentFindOpen: documentFindOpen(),
    spaceSwitcherOpen: spaceSwitcherOpen(),
    commandPaletteOpen: commandPaletteOpen(),
  })

  const keyRouteForDebug = (key: SearchKeyLike) => {
    if (key.ctrl && key.name === "c") return "destroy"
    if (imageViewerOpen()) return "image-viewer"
    if (changesOpen()) return "changes-overlay"
    if (helpOpen()) return "help-overlay"
    if (newPageOpen()) return "new-page-overlay"
    if (editorOpen()) return "editor"
    if (documentFindOpen()) return "document-find"
    if (pageSearchOpen()) return "page-search"
    if (allSpaceSearchOpen()) return "all-space-search"
    if (spaceSwitcherOpen()) return "space-switcher"
    if (commandPaletteOpen()) return "command-palette"
    if (resolveKeyCommand(key, focusPane())) return "command"
    return "main"
  }

  const inputDebugState = () => ({
    focusPane: focusPane(),
    selectedPageId: selectedPageId(),
    pageSearchOpen: pageSearchOpen(),
    allSpaceSearchOpen: allSpaceSearchOpen(),
    documentFindOpen: documentFindOpen(),
    spaceSwitcherOpen: spaceSwitcherOpen(),
    commandPaletteOpen: commandPaletteOpen(),
    imageViewerOpen: imageViewerOpen(),
    changesOpen: changesOpen(),
    editorOpen: editorOpen(),
    helpOpen: helpOpen(),
  })

  let pendingInputFrame: ReturnType<typeof inputDebugState> | null = null

  const openEditorForSelectedPage = () => {
    if (editorOpen()) return
    const pageId = selectedPageId()

    if (pageId === emptyPageId) {
      setEditStatusMessage("No page selected to edit.")
      return
    }

    const page = pageById().get(pageId)
    if (page && !isEditableRemotePage(page)) {
      setEditStatusMessage(`${page.title} is ${remoteStatusLabel(page)} in Confluence and is read-only in lazyconfluence.`)
      return
    }

    try {
      const input = dataSource.getEditablePageInput(pageId)
      const markdown = input.markdown

      setEditorPageId(pageId)
      setEditorPageTitle(input.page.title)
      setEditorInitialMarkdown(markdown)
      setEditorOriginalMarkdown(markdown)
      setEditorMarkdown(markdown)
      setEditorInputFocused(false)
      setEditorOpen(true)
      setFocusPane("document")
      setEditStatusMessage(`Editing ${input.page.title}. Press Ctrl+T to stage, or Esc to leave staged changes untouched.`)
      focusEditorInputAfterOpen(pageId)
    } catch (error) {
      setEditStatusMessage(errorMessage(error))
    }
  }

  const stageEditorBuffer = () => {
    const pageId = editorPageId()
    if (!pageId) return

    try {
      const result = dataSource.stagePageBuffer(pageId, editorMarkdown())
      setDraftRevision((revision) => revision + 1)
      closeEditorImmediately(result === "staged" ? `Staged changes for ${editorPageTitle()}. Open Overview to review/apply/discard.` : `No buffer changes staged for ${editorPageTitle()}.`, result === "staged")
    } catch (error) {
      setEditStatusMessage(errorMessage(error))
    }
  }

  const closeEditor = () => {
    closeEditorImmediately(`Closed editor for ${editorPageTitle()}; staged changes were not changed.`)
  }

  const closeEditorImmediately = (message: string, transient = false) => {
    clearEditorFocusTimer()
    setEditorOpen(false)
    setEditorInputFocused(false)
    setEditorPageId(null)
    setEditorPageTitle("")
    setEditorInitialMarkdown("")
    setEditorOriginalMarkdown("")
    setEditorMarkdown("")
    if (transient) setTransientStatusMessage(message)
    else setEditStatusMessage(message)
  }

  const setEditorMarkdownFromTextarea = (markdown: string) => {
    setEditorMarkdown(markdown)
  }

  const expandSelectedPage = () => {
    const row = selectedRow()

    if (row?.hasChildren && !row.expanded) {
      setExpandedPageIds((current) => new Set(current).add(row.page.pageId))
    }
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

    const nextPageId = nextNavigatorSelectionForCollapse(row, pageById())
    if (nextPageId) setSelectedPageId(nextPageId)
  }

  const handleKeyPress = (key: SearchKeyLike) => {
    const route = keyRouteForDebug(key)
    logInputDebug("app_key_handler", { ...keyDebugData(key), route, ...inputDebugState() })
    logImageDebug("key_press", {
      ...keyDebugData(key),
      ...imageInputDebugState(),
      route,
    })

    if (isPlainKey(key, "i")) {
      logImageDebug("image_key_route", {
        ...keyDebugData(key),
        ...imageInputDebugState(),
        route,
        renderMode: viewerImageRenderMode(),
      })
    }

    if (key.ctrl && key.name === "c") {
      renderer.destroy()
      return
    }

    if (helpOpen()) {
      const command = resolveKeyCommand(key, "help")
      logInputDebug("command_resolved", { route, command: command ?? "unmatched" })
      if (command === "close-overlay") setHelpOpen(false)
      else if (command === "move-down") helpScrollbox?.scrollBy(1)
      else if (command === "move-up") helpScrollbox?.scrollBy(-1)
      else if (command === "page-down") helpScrollbox?.scrollBy(1, "viewport")
      else if (command === "page-up") helpScrollbox?.scrollBy(-1, "viewport")
      return
    }

    if (imageViewerOpen()) {
      const command = resolveKeyCommand(key, "image-viewer")
      logInputDebug("command_resolved", { route, command: command ?? "unmatched" })
      if (command === "close-overlay") closeImageViewer()
      else if (command === "next-image") moveImageViewerSelection(1)
      else if (command === "previous-image") moveImageViewerSelection(-1)
      return
    }

    if (changesOpen()) {
      const command = resolveKeyCommand(key, "changes")
      logInputDebug("command_resolved", { route, command: command ?? "unmatched" })
      if (command === "close-overlay") closeChanges()
      else if (command === "move-down") moveChangesSelection(1)
      else if (command === "move-up") moveChangesSelection(-1)
      else if (command === "toggle-change") toggleSelectedChange()
      else if (command === "apply-changes") applySelectedChanges()
      else if (command === "discard-changes") discardSelectedChanges()
      return
    }

    if (newPageOpen()) {
      const action = pageSearchKeyAction(key)
      logInputDebug("command_resolved", { route, command: action })

      if (action === "close") closeNewPage()
      else if (action === "submit") submitNewPage()
      else if (action === "delete") setNewPageTitle((title) => title.slice(0, -1))
      else if (action === "append") setNewPageTitle((title) => title + key.sequence)
      return
    }

    if (editorOpen()) {
      const command = resolveKeyCommand(key, "editor")
      logInputDebug("command_resolved", { route, command: command ?? "unmatched" })
      if (command === "close-overlay") closeEditor()
      else if (command === "stage-editor") stageEditorBuffer()
      return
    }

    if (documentFindOpen()) {
      logInputDebug("command_resolved", { route, command: textInputKeyAction(key) })
      handleDocumentFindInputKey(key)
      return
    }

    if (pageSearchOpen()) {
      logInputDebug("command_resolved", { route, command: textInputKeyAction(key) })
      handlePageSearchInputKey(key)
      return
    }

    if (allSpaceSearchOpen()) {
      logInputDebug("command_resolved", { route, command: textInputKeyAction(key) })
      handleAllSpaceSearchInputKey(key)
      return
    }

    if (spaceSwitcherOpen()) {
      logInputDebug("command_resolved", { route, command: textInputKeyAction(key) })
      handleSpaceSwitcherInputKey(key)
      return
    }

    if (commandPaletteOpen()) {
      logInputDebug("command_resolved", { route, command: textInputKeyAction(key) })
      handleCommandPaletteInputKey(key)
      return
    }

    const command = resolveKeyCommand(key, focusPane())
    logInputDebug("command_resolved", { route, command: command ?? "unmatched" })

    if (command === "quit") {
      renderer.destroy()
      return
    }

    if (command === "show-help") {
      helpScrollbox?.scrollTo(0)
      setHelpOpen(true)
      return
    }

    if (command === "open-command-palette") {
      openCommandPalette()
      return
    }

    if (command === "open-browser") {
      openSelectedPageInBrowser()
      return
    }

    if (command === "go-back") {
      goBack()
      return
    }

    if (command === "refresh") {
      void reloadCurrentPage()
      return
    }

    if (command && !commandForId(command)?.available) {
      setEditStatusMessage(commandForId(command)?.unavailableReason ?? "This command is not available yet.")
      return
    }

    if (command === "open-page-search") {
      openPageSearch()
      return
    }

    if (command === "open-all-space-search") {
      openAllSpaceSearch()
      return
    }

    if (command === "open-document-find") {
      openDocumentFind()
      return
    }

    if (command === "open-space-switcher") {
      openSpaceSwitcher()
      return
    }

    if (command === "open-overview") {
      openChanges()
      return
    }

    if (command === "toggle-page-view") {
      togglePageView()
      return
    }

    if (command === "edit-page") {
      openEditorForSelectedPage()
      return
    }

    if (command === "open-image-viewer") {
      openImageViewer()
      return
    }

    if (command === "stage-delete") {
      stageDeleteSelectedPage()
      return
    }

    if (command === "create-root-page") {
      openRootNewPage()
      return
    }

    if (command === "create-child-page") {
      openNewPage()
      return
    }

    if (command === "focus-next-pane" || command === "focus-previous-pane") {
      setFocusPane(nextFocusPaneForKey(focusPane(), key))
      return
    }

    if (command === "page-down") {
      scrollDocumentBy(halfPageScrollAmount())
      return
    }

    if (command === "page-up") {
      scrollDocumentBy(-halfPageScrollAmount())
      return
    }

    if (focusPane() === "navigator") {
      if (command === "move-down") moveSelection(1, treeRows(), selectedIndex(), setSelectedPageId)
      if (command === "move-up") moveSelection(-1, treeRows(), selectedIndex(), setSelectedPageId)
      if (command === "move-right") expandSelectedPage()
      if (command === "move-left") collapseSelectedPage()
      if (command === "activate") setFocusPane(nextFocusPaneForKey(focusPane(), key))
      return
    }

    if (focusPane() === "document") {
      const horizontalDelta = documentHorizontalScrollDeltaForKey(key)

      if (command === "move-down") scrollDocumentBy(1)
      if (command === "move-up") scrollDocumentBy(-1)
      if (horizontalDelta !== 0) scrollDocumentHorizontallyBy(horizontalDelta)
      return
    }

    if (focusPane() === "outline" || focusPane() === "related") {
      if (command === "move-down") moveSideRailSelection(1)
      if (command === "move-up") moveSideRailSelection(-1)
      if (command === "move-left") switchSideRailPanel("outline")
      if (command === "move-right") switchSideRailPanel("related")
      if (command === "activate") activateSideRailItem()
      return
    }
  }

  if (inputDebugEnabled()) {
    const logRawInput = (chunk: string | Buffer) => {
      const sequence = typeof chunk === "string" ? chunk : chunk.toString("utf8")
      logInputDebug("raw_stdin", {
        byteLength: Buffer.byteLength(sequence),
        sequence: readableKeySequence(sequence),
        sequenceHex: keySequenceHex(sequence),
      })
    }
    const logParsedKey = (key: SearchKeyLike) => {
      pendingInputFrame = inputDebugState()
      logInputDebug("renderer_keypress", { ...keyDebugData(key), ...pendingInputFrame })
    }
    const logInputFrame = () => {
      if (!pendingInputFrame) return
      logInputDebug("renderer_frame", { beforeFocusPane: pendingInputFrame.focusPane, ...inputDebugState() })
      pendingInputFrame = null
    }

    renderer.stdin.prependListener("data", logRawInput)
    renderer.keyInput.on("keypress", logParsedKey)
    renderer.on(CliRenderEvents.FRAME, logInputFrame)
    onCleanup(() => {
      renderer.stdin.off("data", logRawInput)
      renderer.keyInput.off("keypress", logParsedKey)
      renderer.off(CliRenderEvents.FRAME, logInputFrame)
      logInputDebug("tui_destroy", { ...inputDebugState(), rendererControlState: renderer.currentControlState })
    })
  }

  useKeyboard(handleKeyPress)

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={theme.bg}>
      <Header page={readerPage()} spaceName={space().name} syncState={space().syncState} draftStatus={draftStatus()} stagedCount={stagedChanges().length} runtimeLabel={runtimeLabel} reloading={pageReloading()} onOpenOverview={() => openChanges()} />
      <Show when={credentialWarning()} fallback={<box height={0} />}>{(status) => <CredentialNotice status={status()} />}</Show>
      <box flexGrow={1} minHeight={0} flexDirection={isNarrow() ? "column" : "row"} paddingX={1}>
        <Navigator rows={treeRows()} selectedPageId={selectedPageId()} focused={focusPane() === "navigator"} viewMode={pageViewMode()} onSetViewMode={switchPageView} />
        <Reader page={readerPage()} focused={focusPane() === "document"} focusedSideRailPanel={focusPane() === "outline" ? "outline" : focusPane() === "related" ? "related" : null} sideRailSelectedIndex={sideRailSelectedIndex()} outlineItems={outlineNavigationItems()} relatedItems={relatedNavigationItems()} narrow={isNarrow()} treeSitterClient={treeSitterClient()} imageRenderMode={inlineImageRenderMode()} setDocumentScrollbox={(scrollbox) => { documentScrollbox = scrollbox }} setImageRenderable={setReaderImageRenderable} />
      </box>
      <StatusBar focusPane={focusPane()} editorOpen={editorOpen()} editorDirty={editorDirty()} editMessage={editStatusMessage()} reloading={pageReloading()} hasStagedChanges={stagedChanges().length > 0} width={dimensions().width} />
      <Show when={editorOpen()} fallback={<box height={0} />}>
        <EditorOverlay
          pageTitle={editorPageTitle()}
          pageId={editorPageId() ?? ""}
          initialMarkdown={editorInitialMarkdown()}
          dirty={editorDirty()}
          draftStatus={editorDraftStatus()}
          inputFocused={editorInputFocused()}
          message={editStatusMessage()}
          left={dimensions().width < 72 ? 1 : 4}
          top={2}
          width={Math.max(32, dimensions().width - (dimensions().width < 72 ? 2 : 8))}
          height={Math.max(10, dimensions().height - 4)}
          onMarkdownChange={setEditorMarkdownFromTextarea}
        />
      </Show>
      <StagedChangesOverlay
        visible={changesOpen()}
        activeSpaceName={space().name}
        changes={stagedChanges()}
        selectedIndex={changesSelectedIndex()}
        selectedChangeKeys={selectedChangeKeys()}
        message={changesMessage()}
        applying={changesApplying()}
        left={dimensions().width < 72 ? 1 : 4}
        top={2}
        width={Math.max(32, dimensions().width - (dimensions().width < 72 ? 2 : 8))}
        height={Math.max(10, dimensions().height - 4)}
        onToggle={toggleSelectedChange}
        onApply={applySelectedChanges}
        onDiscard={discardSelectedChanges}
        onClose={closeChanges}
      />
      <NewPageOverlay
        visible={newPageOpen()}
        title={newPageTitle()}
        parentPage={newPageParentPage()}
        left={dimensions().width < 72 ? 2 : 8}
        width={Math.max(32, dimensions().width - (dimensions().width < 72 ? 4 : 16))}
      />
      <PageSearchOverlay
        visible={pageSearchOpen()}
        query={pageSearchQuery()}
        results={pageSearchResults()}
        selectedIndex={pageSearchSelectedIndex()}
        scope="active"
        activeSpaceName={space().name}
        viewMode={pageViewMode()}
        left={dimensions().width < 72 ? 1 : 4}
        top={2}
        width={Math.max(32, dimensions().width - (dimensions().width < 72 ? 2 : 8))}
        height={Math.max(10, dimensions().height - 4)}
        onQueryChange={setPageSearchQuery}
        onKeyDown={handlePageSearchInputKey}
      />
      <PageSearchOverlay
        visible={allSpaceSearchOpen()}
        query={allSpaceSearchQuery()}
        results={allSpaceSearchResults()}
        selectedIndex={allSpaceSearchSelectedIndex()}
        scope="all"
        activeSpaceName={space().name}
        viewMode={pageViewMode()}
        left={dimensions().width < 72 ? 1 : 4}
        top={2}
        width={Math.max(32, dimensions().width - (dimensions().width < 72 ? 2 : 8))}
        height={Math.max(10, dimensions().height - 4)}
        onQueryChange={setAllSpaceSearchQuery}
        onKeyDown={handleAllSpaceSearchInputKey}
      />
      <DocumentFindOverlay
        visible={documentFindOpen()}
        query={documentFindQuery()}
        matches={documentFindMatches()}
        selectedIndex={documentFindSelectedIndex()}
        pageTitle={readerPage().title}
        left={dimensions().width < 72 ? 2 : 8}
        width={Math.max(32, dimensions().width - (dimensions().width < 72 ? 4 : 16))}
        height={Math.min(18, Math.max(10, dimensions().height - 8))}
        onQueryChange={updateDocumentFindQuery}
        onKeyDown={handleDocumentFindInputKey}
      />
      <SpaceSwitcherOverlay
        visible={spaceSwitcherOpen()}
        query={spaceSwitcherQuery()}
        results={spaceSwitcherResults()}
        selectedIndex={spaceSwitcherSelectedIndex()}
        activeSpaceKey={activeSpaceKey()}
        left={dimensions().width < 72 ? 1 : 4}
        top={2}
        width={Math.max(32, dimensions().width - (dimensions().width < 72 ? 2 : 8))}
        height={Math.max(10, dimensions().height - 4)}
        onQueryChange={setSpaceSwitcherQuery}
        onKeyDown={handleSpaceSwitcherInputKey}
      />
      <CommandPaletteOverlay
        visible={commandPaletteOpen()}
        query={commandPaletteQuery()}
        commands={commandPaletteResults()}
        selectedIndex={commandPaletteSelectedIndex()}
        left={commandPaletteLeft()}
        top={2}
        width={commandPaletteWidth()}
        height={Math.max(10, dimensions().height - 4)}
        onQueryChange={(query) => {
          setCommandPaletteQuery(query)
          setCommandPaletteSelectedIndex(0)
        }}
        onKeyDown={handleCommandPaletteInputKey}
      />
      <HelpOverlay
        visible={helpOpen()}
        commands={helpCommands}
        left={dimensions().width < 72 ? 1 : 4}
        top={2}
        width={Math.max(32, dimensions().width - (dimensions().width < 72 ? 2 : 8))}
        height={Math.max(10, dimensions().height - 4)}
        setScrollbox={(scrollbox) => { helpScrollbox = scrollbox }}
      />
      <Show when={imageViewerOpen()} fallback={<box height={0} />}>
        <ImageViewerOverlay
          visible
          pageTitle={readerPage().title}
          images={readerImageParts()}
          selectedIndex={imageViewerSelectedIndex()}
          renderMode={viewerImageRenderMode()}
          left={dimensions().width < 72 ? 1 : 4}
          top={2}
          width={Math.max(32, dimensions().width - (dimensions().width < 72 ? 2 : 8))}
          height={Math.max(10, dimensions().height - 4)}
          cellPixels={terminalCellPixels()}
          onClose={closeImageViewer}
        />
      </Show>
    </box>
  )
}

function CredentialNotice(props: { status: CredentialWarning }) {
  return (
    <box height={4} backgroundColor="#1f1607" paddingX={1} flexDirection="column">
      <text height={1} fg={theme.warn}><b>{props.status.title}</b></text>
      <text height={1} fg={theme.text}>{props.status.detail}</text>
      <For each={props.status.help.slice(0, 2)}>{(item) => <text height={1} fg={theme.subtle}>{item}</text>}</For>
    </box>
  )
}

export function Header(props: { page: ReaderPage; spaceName: string; syncState: string; draftStatus: PageDraftStatus | null; stagedCount: number; runtimeLabel: string; reloading: boolean; onOpenOverview: () => void }) {
  const syncColor = () => (props.syncState === "fresh" ? theme.good : props.syncState === "stale" ? theme.warn : theme.danger)
  const statusColor = () => (props.draftStatus === "staged" ? theme.good : props.draftStatus === "draft" ? theme.warn : syncColor())
  const statusText = () => `${props.runtimeLabel} · ${props.draftStatus ? `${props.draftStatus} · ` : ""}${props.syncState}`

  return (
    <box height={6} border borderStyle="single" borderColor={theme.border} paddingX={1} flexDirection="column">
      <box height={1} flexDirection="row" justifyContent="space-between" width="100%">
        <text height={1} fg={theme.text}><b>{props.page.title}</b></text>
        <box height={1} flexDirection="row" gap={2}>
          <box height={1} width={Math.max(12, `Overview ${props.stagedCount}`.length + 2)} onMouseDown={props.onOpenOverview}>
            <text height={1} fg={theme.accent}>Overview {props.stagedCount}</text>
          </box>
          <Show when={props.reloading} fallback={<box height={0} />}>
            <text height={1} fg={theme.warn}><b>RELOADING</b></text>
          </Show>
          <text height={1} fg={statusColor()}>{statusText()}</text>
        </box>
      </box>
      <text height={1} fg={theme.muted}>{props.spaceName} / {props.page.path.join(" / ")}</text>
      <text height={1} fg={theme.subtle}>ID: {props.page.pageId}  Space: {props.page.spaceKey}  Parent: {props.page.parentId ?? "root"}</text>
      <text height={1} fg={theme.subtle}>Owner: {props.page.owner}  Updated: {formatDate(props.page.updatedAt)}</text>
    </box>
  )
}

function Navigator(props: { rows: TreeRow[]; selectedPageId: string; focused: boolean; viewMode: PageViewMode; onSetViewMode: (view: PageViewMode) => void }) {
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
      <text height={1} fg={props.focused ? theme.accent : theme.muted}><b>NAVIGATOR</b></text>
      <box height={1} flexDirection="row" gap={1}>
        <NavigatorTab label="Current" active={props.viewMode === "current"} onPress={() => props.onSetViewMode("current")} />
        <NavigatorTab label="Archived" active={props.viewMode === "archived"} onPress={() => props.onSetViewMode("archived")} />
      </box>
      <text height={1} fg={theme.subtle}>j/k move  h/l fold  a toggle  Tab panes</text>
      <box height={1} />
      <scrollbox flexGrow={1} minHeight={0} scrollbarOptions={{ showArrows: false }}>
        <box flexDirection="column" width="100%">
          <For each={props.rows}>{(row) => <NavigatorRow row={row} selected={row.page.pageId === props.selectedPageId} />}</For>
        </box>
      </scrollbox>
    </box>
  )
}

function NavigatorTab(props: { label: string; active: boolean; onPress: () => void }) {
  return (
    <box height={1} width={props.label.length + 4} onMouseDown={props.onPress}>
      <text height={1} fg={props.active ? theme.accent : theme.subtle}>{props.active ? `[${props.label}]` : ` ${props.label} `}</text>
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
  const titleColor = () => props.selected ? theme.text : isArchivedPage(props.row.page) ? theme.subtle : props.row.detached ? theme.warn : theme.muted
  const title = () => isArchivedPage(props.row.page) ? `${props.row.page.title} [archived]` : props.row.page.title

  return (
    <box height={1} width="100%" backgroundColor={props.selected ? theme.accentSoft : undefined} paddingLeft={0} paddingRight={1} flexDirection="row">
      <text height={1} width={props.row.depth * 2 + 2} fg={theme.subtle}>{prefix()}</text>
      <text height={1} width={2} fg={props.selected ? theme.text : symbolColor()}>{symbol()}</text>
      <text height={1} flexGrow={1} minWidth={0} fg={titleColor()}>{title()}</text>
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

function Reader(props: { page: ReaderPage; focused: boolean; focusedSideRailPanel: SideRailPanel | null; sideRailSelectedIndex: number; outlineItems: OutlineNavigationItem[]; relatedItems: RelatedNavigationItem[]; narrow: boolean; treeSitterClient?: TreeSitterClient; imageRenderMode: ImageRenderMode; setDocumentScrollbox: (scrollbox: ScrollBoxRenderable) => void; setImageRenderable: (nodeId: string, renderable: BoxRenderable) => void }) {
  const renderer = useRenderer()
  const renderCodeBlock = createReadableCodeBlockRenderer(renderer)
  const contentParts = createMemo(() => splitReaderImagePlaceholders(props.page.contentMarkdown, props.page.mediaAssets ?? []))

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
          <text height={1} fg={props.focused ? theme.accent : theme.muted}><b>DOCUMENT</b></text>
          <text height={1} fg={theme.subtle}>{props.page.snippet}</text>
          <Show when={isArchivedPage(props.page)} fallback={<box height={0} />}>
            <text height={1} fg={theme.warn}>Archived in Confluence · read-only</text>
          </Show>
          <box height={1} />
          <scrollbox id="document-scrollbox" ref={props.setDocumentScrollbox} flexGrow={1} minHeight={0} scrollX scrollbarOptions={{ showArrows: false }} horizontalScrollbarOptions={{ showArrows: false }}>
            <box flexDirection="column" width="100%">
              <For each={contentParts()}>{(part) => part.kind === "markdown" ? (
                <markdown
                  content={part.content}
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
              ) : <ImagePreviewCard part={part} narrow={props.narrow} renderMode={props.imageRenderMode} setRenderable={props.setImageRenderable} />}</For>
            </box>
          </scrollbox>
        </box>
        <SideRail narrow={props.narrow} focusedPanel={props.focusedSideRailPanel} selectedIndex={props.sideRailSelectedIndex} outlineItems={props.outlineItems} relatedItems={props.relatedItems} />
      </box>
    </box>
  )
}

function ImagePreviewCard(props: { part: Extract<ReaderContentPart, { kind: "image" }>; narrow: boolean; renderMode: ImageRenderMode; setRenderable?: (nodeId: string, renderable: BoxRenderable) => void }) {
  const loaded = createMemo(() => loadImagePreview(props.part.asset))
  const image = createMemo(() => imageFromLoadResult(loaded()))
  const fallbackMessage = createMemo(() => messageFromLoadResult(loaded()))
  const size = createMemo(() => image() ? imagePreviewSize(image()!, props.narrow) : { width: props.narrow ? 34 : 52, height: 4 })

  const renderPreview = (buffer: OptimizedBuffer, decoded: DecodedImage) => {
    drawImagePreview(buffer, decoded, props.renderMode)
  }

  return (
    <box ref={(renderable: BoxRenderable) => props.setRenderable?.(props.part.nodeId, renderable)} width="100%" height={image() ? size().height + 5 : 6} border borderStyle="rounded" borderColor={image() ? theme.good : theme.border} backgroundColor={theme.panel} paddingX={1} marginBottom={1} flexDirection="column">
      <text height={1} fg={image() ? theme.good : theme.warn}>{image() ? <b>IMAGE PREVIEW</b> : <b>IMAGE PLACEHOLDER</b>}</text>
      <text height={1} fg={theme.text}>{props.part.label}</text>
      <Show when={image()} fallback={<ImagePreviewFallback part={props.part} message={fallbackMessage()} />}>
        {(decoded) => (
          <box flexDirection="column" width="100%">
            <text height={1} fg={theme.subtle}>cached {decoded().format.toUpperCase()} {decoded().width}x{decoded().height} · {imageRenderModeLabel(props.renderMode)}</text>
            <box width="100%" height={size().height} backgroundColor={theme.bg} buffered renderAfter={(buffer: OptimizedBuffer) => renderPreview(buffer, decoded())} />
          </box>
        )}
      </Show>
    </box>
  )
}

export function ImageViewerOverlay(props: { visible: boolean; pageTitle: string; images: ReaderImagePart[]; selectedIndex: number; renderMode: ImageRenderMode; left: number; top: number; width: number; height: number; cellPixels?: CellPixelSize | null; onClose: () => void }) {
  const renderer = useRenderer()
  const selectedImage = createMemo(() => props.images[props.selectedIndex] ?? null)
  const loaded = createMemo(() => props.visible && selectedImage() ? loadImagePreview(selectedImage()!.asset) : { status: "error", message: "No image selected." } satisfies ImageLoadResult)
  const image = createMemo(() => imageFromLoadResult(loaded()))
  const fallbackMessage = createMemo(() => messageFromLoadResult(loaded()))
  const previewHeight = createMemo(() => image() ? imageViewerPreviewHeight(image()!, props.width, props.height, isNativeImageRenderMode(props.renderMode)) : Math.max(3, props.height - 8))
  let nativePreviewRenderable: BoxRenderable | undefined
  let queuedNativeImage: NativeViewerImage | null = null
  let queuedNativeKey = ""
  let displayedKittyId: number | null = null
  let displayedNativeArea: NativeImageArea | null = null
  let displayedNativeKey = ""
  let nativeFlushTimer: ReturnType<typeof setTimeout> | undefined
  let lastRenderAfterDebugKey = ""
  let lastOverlayDebugKey = ""

  const renderPreview = (buffer: OptimizedBuffer, decoded: DecodedImage) => {
    if (!isNativeImageRenderMode(props.renderMode)) drawImagePreview(buffer, decoded, props.renderMode)
    logViewerRenderAfter(buffer, decoded)
    queueNativeImage(decoded, buffer.width, buffer.height)
  }

  onMount(() => {
    logImageDebug("viewer_overlay_mount", {
      visible: props.visible,
      imageCount: props.images.length,
      selectedIndex: props.selectedIndex,
      renderMode: props.renderMode,
      left: props.left,
      top: props.top,
      width: props.width,
      height: props.height,
    })
  })

  createEffect(() => {
    const part = selectedImage()
    const loadResult = loaded()
    const decoded = image()
    const state = {
      visible: props.visible,
      imageCount: props.images.length,
      selectedIndex: props.selectedIndex,
      renderMode: props.renderMode,
      hasSelectedImage: Boolean(part),
      nodeId: part?.nodeId,
      label: part?.label,
      loadStatus: loadResult.status,
      imageReady: Boolean(decoded),
      imageWidth: decoded?.width,
      imageHeight: decoded?.height,
      previewRenderablePresent: Boolean(nativePreviewRenderable),
      left: props.left,
      top: props.top,
      width: props.width,
      height: props.height,
      previewHeight: previewHeight(),
    }
    const key = JSON.stringify(state)
    if (key === lastOverlayDebugKey) return

    lastOverlayDebugKey = key
    logImageDebug("viewer_overlay_state", state)
  })

  createEffect(() => {
    const part = selectedImage()
    if (!props.visible || !isNativeImageRenderMode(props.renderMode) || !part || !image()) {
      clearNativeImage()
      if (!props.visible) nativePreviewRenderable = undefined
      return
    }

    const nextId = kittyImageId(`viewer:${part.nodeId}:${part.asset?.cachePath ?? part.label}`)
    if (displayedKittyId !== null && (props.renderMode !== "kitty" || displayedKittyId !== nextId)) clearNativeImage()
  })

  onCleanup(() => {
    cancelNativeFlush()
    logImageDebug("viewer_overlay_cleanup", {
      visible: props.visible,
      imageCount: props.images.length,
      selectedIndex: props.selectedIndex,
      renderMode: props.renderMode,
    })
    clearNativeImage()
    nativePreviewRenderable = undefined
    lastRenderAfterDebugKey = ""
  })

  function queueNativeImage(decoded: DecodedImage, columns: number, rows: number) {
    const part = selectedImage()
    if (!props.visible || !isNativeImageRenderMode(props.renderMode) || !part || !nativePreviewRenderable) {
      if (isNativeImageRenderMode(props.renderMode)) {
        logImageDebug("native_queue_skipped", {
          reason: !props.visible ? "viewer-hidden" : !part ? "no-selected-image" : !nativePreviewRenderable ? "preview-renderable-missing" : "not-native-mode",
          renderMode: props.renderMode,
          columns,
          rows,
        })
      }
      return
    }

    const id = kittyImageId(`viewer:${part.nodeId}:${part.asset?.cachePath ?? part.label}`)
    const queueKey = `${props.renderMode}:${id}:${part.asset?.cachePath ?? part.label}:${columns}x${rows}:${decoded.width}x${decoded.height}`
    const onScreenDisplayKey = nativeDisplayKey(props.renderMode, id, columns, rows, decoded, part.asset, nativePreviewRenderable, renderer)
    if (onScreenDisplayKey && onScreenDisplayKey === displayedNativeKey) {
      logImageDebug("native_queue_skipped", { reason: "displayed-duplicate", mode: props.renderMode, id, columns, rows })
      return
    }
    if (queueKey === queuedNativeKey) {
      logImageDebug("native_queue_skipped", { reason: "pending-duplicate", mode: props.renderMode, id, columns, rows })
      return
    }

    queuedNativeImage = {
      mode: props.renderMode,
      key: queueKey,
      asset: part.asset,
      id: kittyImageId(`viewer:${part.nodeId}:${part.asset?.cachePath ?? part.label}`),
      image: decoded,
      renderable: nativePreviewRenderable,
      cellPixels: props.cellPixels ?? null,
      columns,
      rows,
    }
    queuedNativeKey = queueKey
    logImageDebug("native_queue", { mode: queuedNativeImage.mode, id: queuedNativeImage.id, nodeId: part.nodeId, label: part.label, columns, rows, imageWidth: decoded.width, imageHeight: decoded.height })
    if (props.renderMode === "kitty") logImageDebug("kitty_queue", { id: queuedNativeImage.id, nodeId: part.nodeId, label: part.label, columns, rows, imageWidth: decoded.width, imageHeight: decoded.height })
    scheduleNativeFlush()
  }

  function scheduleNativeFlush() {
    if (nativeFlushTimer) return

    nativeFlushTimer = setTimeout(() => {
      nativeFlushTimer = undefined
      flushNativeImage()
    }, 0)
  }

  function cancelNativeFlush() {
    if (!nativeFlushTimer) return

    clearTimeout(nativeFlushTimer)
    nativeFlushTimer = undefined
    logImageDebug("native_flush_cancelled", { renderMode: props.renderMode, queued: Boolean(queuedNativeImage) })
  }

  function flushNativeImage() {
    const input = queuedNativeImage
    queuedNativeImage = null
    queuedNativeKey = ""
    if (!input) return

    if (!props.visible || props.renderMode !== input.mode || !isRenderableOnScreen(renderer, input.renderable)) {
      logImageDebug("native_flush_skipped", {
        id: input.id,
        mode: input.mode,
        reason: !props.visible ? "viewer-hidden" : props.renderMode !== input.mode ? "mode-changed" : "preview-offscreen",
        renderMode: props.renderMode,
        screenX: input.renderable.screenX,
        screenY: input.renderable.screenY,
        width: input.renderable.width,
        height: input.renderable.height,
        terminalWidth: renderer.terminalWidth,
        terminalHeight: renderer.terminalHeight,
      })
      clearNativeImage()
      return
    }

    const row = Math.max(1, Math.floor(input.renderable.screenY) + 1)
    const column = Math.max(1, Math.floor(input.renderable.screenX) + 1)
    const key = `${input.mode}:${input.id}:${row}:${column}:${input.columns}:${input.rows}:${input.image.width}x${input.image.height}:${input.asset?.cachePath ?? "no-cache"}`
    if (key === displayedNativeKey) {
      logImageDebug("native_write_skipped", { reason: "displayed-duplicate", mode: input.mode, id: input.id, row, column, columns: input.columns, rows: input.rows })
      return
    }

    clearDisplayedNativeImage()

    const command = nativeImageCommandForImage(input)
    const output = `\x1b7\x1b[${row};${column}H${wrapNativeProtocolCommand(command.command)}\x1b8`
    const accepted = writeRawTerminal(renderer, output)
    logImageDebug("native_write", {
      mode: input.mode,
      id: input.id,
      accepted,
      row,
      column,
      columns: input.columns,
      rows: input.rows,
      sourceWidth: input.image.width,
      sourceHeight: input.image.height,
      scaledWidth: command.width,
      scaledHeight: command.height,
      commandBytes: output.length,
      chunks: command.chunks,
      transfer: command.transfer,
      cached: command.cached,
    })
    if (input.mode === "kitty") {
      logImageDebug("kitty_write", {
        id: input.id,
        accepted,
        row,
        column,
        columns: input.columns,
        rows: input.rows,
        sourceWidth: input.image.width,
        sourceHeight: input.image.height,
        scaledWidth: command.width,
        scaledHeight: command.height,
        commandBytes: output.length,
        chunks: command.chunks,
        transfer: command.transfer,
        cached: command.cached,
      })
      displayedKittyId = input.id
    } else if (input.mode === "iterm2") {
      logImageDebug("iterm2_write", { id: input.id, accepted, row, column, columns: input.columns, rows: input.rows, commandBytes: output.length, transfer: command.transfer })
    } else if (input.mode === "sixel") {
      logImageDebug("sixel_write", { id: input.id, accepted, row, column, columns: input.columns, rows: input.rows, commandBytes: output.length, transfer: command.transfer })
    }
    displayedNativeArea = nativeEraseArea(input.mode, row, column, input.columns, input.rows, command.width, command.height, input.cellPixels)
    displayedNativeKey = key
  }

  function clearNativeImage() {
    cancelNativeFlush()
    queuedNativeImage = null
    queuedNativeKey = ""
    displayedNativeKey = ""
    clearDisplayedNativeImage()
  }

  function clearDisplayedNativeImage() {
    if (displayedKittyId !== null) deleteDisplayedKittyImage()
    if (displayedNativeArea) eraseDisplayedNativeArea(displayedNativeArea)
    displayedNativeArea = null
  }

  function deleteDisplayedKittyImage() {
    if (displayedKittyId === null) return

    const id = displayedKittyId
    const accepted = writeRawTerminal(renderer, wrapNativeProtocolCommand(kittyDeleteImageCommand(id)))
    logImageDebug("kitty_delete", { id, accepted })
    displayedKittyId = null
  }

  function eraseDisplayedNativeArea(area: NativeImageArea) {
    const blank = " ".repeat(Math.max(1, Math.min(renderer.terminalWidth - area.column + 1, area.columns)))
    let output = "\x1b7"
    const rows = Math.max(1, Math.min(renderer.terminalHeight - area.row + 1, area.rows))
    for (let row = 0; row < rows; row += 1) output += `\x1b[${area.row + row};${area.column}H${blank}`
    output += "\x1b8"
    const accepted = writeRawTerminal(renderer, output)
    logImageDebug("native_erase", { ...area, accepted })
  }

  function logViewerRenderAfter(buffer: OptimizedBuffer, decoded: DecodedImage) {
    const part = selectedImage()
    const key = `${props.visible}:${props.renderMode}:${part?.nodeId ?? "none"}:${buffer.width}x${buffer.height}:${decoded.width}x${decoded.height}`
    if (key === lastRenderAfterDebugKey) return

    lastRenderAfterDebugKey = key
    logImageDebug("viewer_render_after", {
      visible: props.visible,
      renderMode: props.renderMode,
      nodeId: part?.nodeId,
      label: part?.label,
      bufferColumns: buffer.width,
      bufferRows: buffer.height,
      decodedWidth: decoded.width,
      decodedHeight: decoded.height,
      previewRenderablePresent: Boolean(nativePreviewRenderable),
    })
  }

  return (
    <box
      visible={props.visible}
      position="absolute"
      left={props.left}
      top={props.top}
      width={props.width}
      height={props.height}
      border
      borderStyle="rounded"
      borderColor={image() ? theme.good : theme.warn}
      backgroundColor={theme.bg}
      paddingX={2}
      paddingY={1}
      flexDirection="column"
      zIndex={80}
    >
      <box height={1} flexDirection="row" justifyContent="space-between" width="100%">
        <text height={1} fg={image() ? theme.good : theme.warn}><b>IMAGE VIEWER</b></text>
        <box height={1} width={8} onMouseDown={props.onClose}><text height={1} fg={theme.muted}>Close</text></box>
      </box>
      <text height={1} fg={theme.text}>{props.pageTitle}</text>
      <Show when={selectedImage()} fallback={<text height={1} fg={theme.subtle}>No image placeholders are available on this page.</text>}>
        {(part) => (
          <>
            <text height={1} fg={theme.text}>{part().label}</text>
            <text height={1} fg={theme.subtle}>{props.images.length ? `${props.selectedIndex + 1} of ${props.images.length}` : "0 of 0"} · {imageRenderModeLabel(props.renderMode)} · j/k or h/l switch · esc close</text>
            <box height={1} />
            <Show when={image()} fallback={<ImagePreviewFallback part={part()} message={fallbackMessage()} />}>
              {(decoded) => (
                <box flexDirection="column" width="100%">
                  <text height={1} fg={theme.subtle}>cached {decoded().format.toUpperCase()} {decoded().width}x{decoded().height}</text>
                  <box ref={(renderable: BoxRenderable) => { nativePreviewRenderable = renderable }} width="100%" height={previewHeight()} backgroundColor={theme.bg} buffered renderAfter={(buffer: OptimizedBuffer) => renderPreview(buffer, decoded())} />
                </box>
              )}
            </Show>
          </>
        )}
      </Show>
    </box>
  )
}

function ImagePreviewFallback(props: { part: Extract<ReaderContentPart, { kind: "image" }>; message: string }) {
  return (
    <box flexDirection="column" width="100%">
      <text height={1} fg={theme.subtle}>{props.part.details}</text>
      <text height={1} fg={theme.subtle}>{props.message}</text>
    </box>
  )
}

type ImageLoadResult = { status: "ready"; image: DecodedImage } | { status: "error"; message: string }
type NativeImageRenderMode = Extract<ImageRenderMode, "kitty" | "iterm2" | "sixel">
type NativeViewerImage = { mode: NativeImageRenderMode; key: string; id: number; image: DecodedImage; asset: MediaAsset | null; renderable: BoxRenderable; cellPixels: CellPixelSize | null; columns: number; rows: number }
type NativeImageArea = { mode: NativeImageRenderMode; row: number; column: number; columns: number; rows: number }
type KittyGraphicsCommandCacheEntry = { command: string; width: number; height: number; chunks: number }
type NativeImageCommandResult = KittyGraphicsCommandCacheEntry & { cached: boolean; transfer: string }

const imagePreviewCache = new Map<string, ImageLoadResult>()
const imagePreviewCacheLimit = 24
const kittyGraphicsCommandCache = new WeakMap<DecodedImage, Map<string, KittyGraphicsCommandCacheEntry>>()

function isNativeImageRenderMode(mode: ImageRenderMode): mode is NativeImageRenderMode {
  return mode === "kitty" || mode === "iterm2" || mode === "sixel"
}

function loadImagePreview(asset: MediaAsset | null): ImageLoadResult {
  if (!asset?.cachePath) {
    logImageDebug("image_asset_load", {
      status: "missing-cache-path",
      pageId: asset?.pageId,
      nodeId: asset?.nodeId,
      title: asset?.title,
      contentType: asset?.contentType,
    })
    return { status: "error", message: "No cached image file is available yet." }
  }

  if (asset.contentType === "image/svg+xml") {
    return { status: "error", message: "SVG preview could not be rasterized. Set LAZYCONFLUENCE_CHROMIUM_PATH for browser-compatible rendering, then sync or reload this page." }
  }

  const cached = imagePreviewCache.get(asset.cachePath)
  if (cached) {
    imagePreviewCache.delete(asset.cachePath)
    imagePreviewCache.set(asset.cachePath, cached)
    logImageDebug("image_asset_load", {
      status: "cache-hit",
      result: cached.status,
      pageId: asset.pageId,
      nodeId: asset.nodeId,
      title: asset.title,
      cachePath: asset.cachePath,
      contentType: asset.contentType,
    })
    return cached
  }

  try {
    const stat = fileStat(asset.cachePath)
    const result: ImageLoadResult = { status: "ready", image: decodeImageFile(asset.cachePath) }
    rememberImagePreview(asset.cachePath, result)
    logImageDebug("image_asset_load", {
      status: "decoded",
      pageId: asset.pageId,
      nodeId: asset.nodeId,
      title: asset.title,
      cachePath: asset.cachePath,
      contentType: asset.contentType,
      fileExists: stat.exists,
      fileSize: stat.size,
      decodedWidth: result.image.width,
      decodedHeight: result.image.height,
      format: result.image.format,
    })
    return result
  } catch (error) {
    const result: ImageLoadResult = { status: "error", message: errorMessage(error) }
    rememberImagePreview(asset.cachePath, result)
    const stat = fileStat(asset.cachePath)
    logImageDebug("image_asset_load", {
      status: "decode-error",
      pageId: asset.pageId,
      nodeId: asset.nodeId,
      title: asset.title,
      cachePath: asset.cachePath,
      contentType: asset.contentType,
      fileExists: stat.exists,
      fileSize: stat.size,
      error: result.message,
    })
    return result
  }
}

function rememberImagePreview(path: string, result: ImageLoadResult) {
  imagePreviewCache.delete(path)
  imagePreviewCache.set(path, result)
  while (imagePreviewCache.size > imagePreviewCacheLimit) {
    const oldest = imagePreviewCache.keys().next().value
    if (!oldest) break
    imagePreviewCache.delete(oldest)
    logImageDebug("image_cache_evict", { cachePath: oldest, cacheSize: imagePreviewCache.size })
  }
}

function fileStat(path: string) {
  try {
    const stat = statSync(path)

    return { exists: true, size: stat.size }
  } catch {
    return { exists: false, size: null }
  }
}

function imageFromLoadResult(result: ImageLoadResult) {
  return result.status === "ready" ? result.image : null
}

function messageFromLoadResult(result: ImageLoadResult) {
  return result.status === "error" ? result.message : "No cached image file is available yet."
}

function imagePreviewSize(image: DecodedImage, narrow: boolean) {
  const maxWidth = narrow ? 40 : 96
  const maxHeight = narrow ? 12 : 26
  let width = maxWidth
  let height = Math.max(3, Math.round((width * image.height / image.width) * 0.5))

  if (height > maxHeight) {
    height = maxHeight
    width = Math.max(8, Math.round((height * image.width / image.height) * 2))
  }

  return { width, height }
}

function imageViewerPreviewHeight(image: DecodedImage, overlayWidth: number, overlayHeight: number, native: boolean) {
  const maxWidth = Math.max(8, overlayWidth - 6)
  const maxHeight = Math.max(3, overlayHeight - 10)
  if (native) return maxHeight

  const aspectHeight = Math.max(3, Math.round((maxWidth * image.height / image.width) * 0.5))

  return Math.min(maxHeight, aspectHeight)
}

function drawImagePreview(buffer: OptimizedBuffer, image: DecodedImage, mode: ImageRenderMode) {
  if (mode === "cell-color" || mode === "kitty" || mode === "iterm2" || mode === "sixel") {
    drawColorCellImage(buffer, image)
    return
  }

  drawMonoCellImage(buffer, image)
}

type ScaledImage = { width: number; height: number; rgba: Uint8Array }

const scaledImageCache = new WeakMap<DecodedImage, Map<string, ScaledImage>>()
const monoRamp = " .:-=+*#%@"
const imagePreviewBackgroundInts = RGBA.fromHex(theme.bg).toInts()

function drawColorCellImage(buffer: OptimizedBuffer, image: DecodedImage) {
  const scaled = scaledImageForCells(image, buffer.width, buffer.height)

  for (let y = 0; y < buffer.height; y += 1) {
    for (let x = 0; x < buffer.width; x += 1) {
      buffer.setCell(x, y, "▀", pixelColor(scaled, x, y * 2), pixelColor(scaled, x, y * 2 + 1))
    }
  }
}

function drawMonoCellImage(buffer: OptimizedBuffer, image: DecodedImage) {
  const scaled = scaledImageForCells(image, buffer.width, buffer.height)
  const fg = RGBA.fromHex(theme.text)
  const bg = RGBA.fromHex(theme.bg)

  for (let y = 0; y < buffer.height; y += 1) {
    for (let x = 0; x < buffer.width; x += 1) {
      const top = pixelLuminance(scaled, x, y * 2)
      const bottom = pixelLuminance(scaled, x, y * 2 + 1)
      const char = monoRamp[Math.min(monoRamp.length - 1, Math.max(0, Math.round(((top + bottom) / 2) * (monoRamp.length - 1))))]
      buffer.setCell(x, y, char, fg, bg)
    }
  }
}

function scaledImageForCells(image: DecodedImage, cellWidth: number, cellHeight: number): ScaledImage {
  return scaledImageForSize(image, Math.max(1, cellWidth), Math.max(1, cellHeight * 2))
}

function scaledImageForKitty(image: DecodedImage, columns: number, rows: number): ScaledImage {
  return scaledImageForSize(image, Math.min(image.width, Math.max(1, columns * 4)), Math.min(image.height, Math.max(1, rows * 8)))
}

function scaledImageForSixel(image: DecodedImage, columns: number, rows: number, cellPixels: CellPixelSize | null): ScaledImage {
  const cellWidth = sixelCellPixelWidth(cellPixels)
  const cellHeight = sixelCellPixelHeight(cellPixels)
  const maxWidth = Math.max(1, columns * cellWidth)
  const maxHeight = Math.max(1, rows * cellHeight)
  if (sixelFitMode() === "stretch") return scaledImageForSize(image, maxWidth, maxHeight)

  const scale = Math.min(maxWidth / image.width, maxHeight / image.height)
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))

  return scaledImageForSize(image, width, height)
}

function sixelFitMode() {
  return process.env.LAZYCONFLUENCE_SIXEL_FIT === "stretch" ? "stretch" : "contain"
}

function sixelCellPixelWidth(cellPixels: CellPixelSize | null = null) {
  return positiveIntegerEnv("LAZYCONFLUENCE_SIXEL_CELL_WIDTH", cellPixels?.width ?? 12)
}

function sixelCellPixelHeight(cellPixels: CellPixelSize | null = null) {
  return positiveIntegerEnv("LAZYCONFLUENCE_SIXEL_CELL_HEIGHT", cellPixels?.height ?? 24)
}

function positiveIntegerEnv(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] ?? "", 10)

  return Number.isFinite(value) && value > 0 ? value : fallback
}

function nativeDisplayKey(mode: NativeImageRenderMode, id: number, columns: number, rows: number, image: DecodedImage, asset: MediaAsset | null, renderable: BoxRenderable, renderer: CliRenderer) {
  if (!isRenderableOnScreen(renderer, renderable)) return null

  const row = Math.max(1, Math.floor(renderable.screenY) + 1)
  const column = Math.max(1, Math.floor(renderable.screenX) + 1)
  return `${mode}:${id}:${row}:${column}:${columns}:${rows}:${image.width}x${image.height}:${asset?.cachePath ?? "no-cache"}`
}

function nativeImageCommandForImage(input: NativeViewerImage): NativeImageCommandResult {
  if (input.mode === "kitty") return kittyNativeCommandForImage(input)
  if (input.mode === "iterm2") return iterm2NativeCommandForImage(input)

  return sixelNativeCommandForImage(input)
}

function nativeEraseArea(mode: NativeImageRenderMode, row: number, column: number, columns: number, rows: number, pixelWidth: number, pixelHeight: number, cellPixels: CellPixelSize | null): NativeImageArea {
  if (mode !== "sixel") return { mode, row, column, columns, rows }

  return {
    mode,
    row,
    column,
    columns: Math.max(columns, Math.ceil(pixelWidth / sixelCellPixelWidth(cellPixels)) + 2),
    rows: Math.max(rows, Math.ceil(pixelHeight / sixelCellPixelHeight(cellPixels)) + 2),
  }
}

function kittyNativeCommandForImage(input: NativeViewerImage): NativeImageCommandResult {
  if (input.asset?.cachePath && input.image.format === "png") {
    const bytes = readFileSync(input.asset.cachePath)
    const command = kittyGraphicsPngCommand({ id: input.id, bytes, columns: input.columns, rows: input.rows })

    return { command, width: input.image.width, height: input.image.height, chunks: kittyCommandChunkCount(command), cached: false, transfer: "direct-png" }
  }

  return { ...kittyGraphicsCommandForImage(input.image, input.id, input.columns, input.rows), transfer: "rgba-fallback" }
}

function iterm2NativeCommandForImage(input: NativeViewerImage): NativeImageCommandResult {
  const bytes = input.asset?.cachePath ? readFileSync(input.asset.cachePath) : null
  if (!bytes) return sixelNativeCommandForImage(input)

  const name = input.asset?.title || input.asset?.cachePath || "image"
  const command = iterm2ImageCommand({ bytes, name, columns: input.columns, rows: input.rows })

  return { command, width: input.image.width, height: input.image.height, chunks: 1, cached: false, transfer: "direct-file" }
}

function sixelNativeCommandForImage(input: NativeViewerImage): NativeImageCommandResult {
  const scaled = scaledImageForSixel(input.image, input.columns, input.rows, input.cellPixels)
  const command = sixelImageCommand(scaled)

  return { command, width: scaled.width, height: scaled.height, chunks: 1, cached: false, transfer: "sixel-indexed" }
}

function kittyGraphicsCommandForImage(image: DecodedImage, id: number, columns: number, rows: number): NativeImageCommandResult {
  const scaled = scaledImageForKitty(image, columns, rows)
  const key = `${id}:${columns}x${rows}:${scaled.width}x${scaled.height}`
  let imageCache = kittyGraphicsCommandCache.get(image)

  if (!imageCache) {
    imageCache = new Map()
    kittyGraphicsCommandCache.set(image, imageCache)
  }

  const cached = imageCache.get(key)
  if (cached) return { ...cached, cached: true, transfer: "rgba-fallback" }

  const command = kittyGraphicsCommand({ id, width: scaled.width, height: scaled.height, columns, rows, rgba: scaled.rgba })
  const entry = { command, width: scaled.width, height: scaled.height, chunks: kittyCommandChunkCount(command) }
  imageCache.set(key, entry)

  return { ...entry, cached: false, transfer: "rgba-fallback" }
}

function scaledImageForSize(image: DecodedImage, width: number, height: number): ScaledImage {
  const key = `${width}x${height}`
  let imageCache = scaledImageCache.get(image)
  if (!imageCache) {
    imageCache = new Map()
    scaledImageCache.set(image, imageCache)
  }
  const cached = imageCache.get(key)
  if (cached) return cached

  const scaled: ScaledImage = { width, height, rgba: resizeRgbaAverage(image.rgba, image.width, image.height, width, height) }
  imageCache.set(key, scaled)

  return scaled
}

function isRenderableOnScreen(renderer: CliRenderer, renderable: BoxRenderable) {
  return renderable.screenX < renderer.terminalWidth && renderable.screenY < renderer.terminalHeight && renderable.screenX + renderable.width > 0 && renderable.screenY + renderable.height > 0
}

function writeRawTerminal(renderer: CliRenderer, value: string) {
  const stdout = (renderer as unknown as { stdout?: NodeJS.WriteStream }).stdout ?? process.stdout

  return stdout.write(value)
}

async function detectTerminalCellPixels(renderer: CliRenderer): Promise<CellPixelSize | null> {
  const stdin = (renderer as unknown as { stdin?: NodeJS.ReadStream }).stdin ?? process.stdin
  if (!stdin?.on) return null

  return new Promise((resolve) => {
    let buffer = ""
    const timeout = setTimeout(() => {
      cleanup()
      logImageDebug("terminal_cell_size", { status: "timeout" })
      resolve(null)
    }, 250)

    const cleanup = () => {
      clearTimeout(timeout)
      stdin.off("data", onData)
    }
    const onData = (chunk: Buffer | string) => {
      buffer += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk
      const size = parseTerminalCellPixels(buffer)
      if (!size) return

      cleanup()
      logImageDebug("terminal_cell_size", { status: "detected", ...size })
      resolve(size)
    }

    stdin.on("data", onData)
    logImageDebug("terminal_cell_size", { status: "query" })
    writeRawTerminal(renderer, wrapNativeProtocolCommand("\x1b[16t"))
  })
}

export function parseTerminalCellPixels(response: string): CellPixelSize | null {
  const match = /\x1b\[6;(\d+);(\d+)t/.exec(response)
  if (!match) return null

  const height = Number.parseInt(match[1], 10)
  const width = Number.parseInt(match[2], 10)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null

  return { width, height }
}

function wrapNativeProtocolCommand(value: string) {
  if (!process.env.TMUX) return value

  return `\x1bPtmux;${value.replace(/\x1b/g, "\x1b\x1b")}\x1b\\`
}

function kittyCommandChunkCount(command: string) {
  const matches = command.match(/\x1b_G/g)

  return matches?.length ?? 0
}

function resizeRgbaAverage(source: Uint8Array, sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number) {
  const target = new Uint8Array(targetWidth * targetHeight * 4)
  let write = 0

  for (let y = 0; y < targetHeight; y += 1) {
    const sourceYStart = Math.floor(y * sourceHeight / targetHeight)
    const sourceYEnd = Math.max(sourceYStart + 1, Math.ceil((y + 1) * sourceHeight / targetHeight))
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceXStart = Math.floor(x * sourceWidth / targetWidth)
      const sourceXEnd = Math.max(sourceXStart + 1, Math.ceil((x + 1) * sourceWidth / targetWidth))
      let red = 0
      let green = 0
      let blue = 0
      let alpha = 0
      let count = 0

      for (let sourceY = sourceYStart; sourceY < sourceYEnd; sourceY += 1) {
        for (let sourceX = sourceXStart; sourceX < sourceXEnd; sourceX += 1) {
          const offset = (sourceY * sourceWidth + sourceX) * 4
          const pixelAlpha = source[offset + 3] / 255
          red += source[offset] * pixelAlpha
          green += source[offset + 1] * pixelAlpha
          blue += source[offset + 2] * pixelAlpha
          alpha += pixelAlpha
          count += 1
        }
      }

      const normalizedAlpha = count ? alpha / count : 0
      target[write++] = alpha ? Math.round(red / alpha) : 0
      target[write++] = alpha ? Math.round(green / alpha) : 0
      target[write++] = alpha ? Math.round(blue / alpha) : 0
      target[write++] = Math.round(normalizedAlpha * 255)
    }
  }

  return target
}

function pixelColor(image: ScaledImage, x: number, y: number) {
  const offset = (Math.min(image.height - 1, y) * image.width + x) * 4
  const alpha = image.rgba[offset + 3] / 255

  return RGBA.fromInts(
    Math.round(image.rgba[offset] * alpha + imagePreviewBackgroundInts[0] * (1 - alpha)),
    Math.round(image.rgba[offset + 1] * alpha + imagePreviewBackgroundInts[1] * (1 - alpha)),
    Math.round(image.rgba[offset + 2] * alpha + imagePreviewBackgroundInts[2] * (1 - alpha)),
    255,
  )
}

function pixelLuminance(image: ScaledImage, x: number, y: number) {
  const offset = (Math.min(image.height - 1, y) * image.width + x) * 4
  const alpha = image.rgba[offset + 3] / 255

  return ((0.2126 * image.rgba[offset] + 0.7152 * image.rgba[offset + 1] + 0.0722 * image.rgba[offset + 2]) / 255) * alpha
}

export type ImageRenderModeDecision = { mode: ImageRenderMode; reason: string }

export function imageRenderModeForCapabilities(capabilities: ImageTerminalCapabilities | null | undefined, options: { nativeProtocols?: boolean } = {}): ImageRenderMode {
  return imageRenderModeDecisionForCapabilities(capabilities, options).mode
}

export function imageRenderModeDecisionForCapabilities(capabilities: ImageTerminalCapabilities | null | undefined, options: { nativeProtocols?: boolean } = {}): ImageRenderModeDecision {
  if (options.nativeProtocols) {
    const blockReason = nativeImageProtocolBlockReason(capabilities)
    if (blockReason) return fallbackImageRenderMode(capabilities, `native-blocked:${blockReason}`)
    const forcedMode = forcedImageRenderMode()
    if (forcedMode) return { mode: forcedMode, reason: "forced-env" }
    if (capabilities?.kitty_graphics && !process.env.WT_SESSION) return { mode: "kitty", reason: "kitty-supported" }
    if (supportsIterm2ImageProtocol(capabilities)) return { mode: "iterm2", reason: "iterm2-supported" }
    if (capabilities?.sixel) return { mode: "sixel", reason: "sixel-supported" }

    return fallbackImageRenderMode(capabilities, "native-protocol-unavailable")
  }

  return fallbackImageRenderMode(capabilities, "native-protocols-disabled")
}

function forcedImageRenderMode(): ImageRenderMode | null {
  const mode = process.env.LAZYCONFLUENCE_IMAGE_MODE
  if (mode === "kitty" || mode === "iterm2" || mode === "sixel" || mode === "cell-color" || mode === "cell-mono" || mode === "placeholder") return mode

  return null
}

function fallbackImageRenderMode(capabilities: ImageTerminalCapabilities | null | undefined, reason: string): ImageRenderModeDecision {
  if (!capabilities) return { mode: "cell-color", reason: `${reason}:missing-capabilities` }
  if (capabilities.rgb) return { mode: "cell-color", reason }

  return { mode: "cell-mono", reason: `${reason}:rgb-unavailable` }
}

function nativeImageProtocolBlockReason(capabilities: ImageTerminalCapabilities | null | undefined) {
  if (!capabilities) return null
  if (capabilities.multiplexer && capabilities.multiplexer !== "none" && capabilities.multiplexer !== "tmux") return `reported-multiplexer-${capabilities.multiplexer}`
  if (process.env.ZELLIJ) return "env-zellij"

  return null
}

function supportsIterm2ImageProtocol(capabilities: ImageTerminalCapabilities | null | undefined) {
  const name = capabilities?.terminal?.name?.toLowerCase() ?? ""
  return name.includes("wezterm") || name.includes("iterm")
}

function summarizeImageCapabilities(capabilities: ImageTerminalCapabilities | null | undefined) {
  return {
    kittyGraphics: capabilities?.kitty_graphics,
    sixel: capabilities?.sixel,
    rgb: capabilities?.rgb,
    multiplexer: capabilities?.multiplexer ?? null,
    terminalName: capabilities?.terminal?.name ?? null,
    kittyWindowId: Boolean(process.env.KITTY_WINDOW_ID),
    tmux: Boolean(process.env.TMUX),
    zellij: Boolean(process.env.ZELLIJ),
    windowsTerminal: Boolean(process.env.WT_SESSION),
  }
}

function imageRenderModeLabel(mode: ImageRenderMode) {
  if (mode === "kitty") return "Kitty native"
  if (mode === "iterm2") return "iTerm2 native"
  if (mode === "sixel") return "Sixel native"
  if (mode === "cell-color") return "color cells"
  if (mode === "cell-mono") return "mono cells"
  return "placeholder"
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

function SideRail(props: { narrow: boolean; focusedPanel: SideRailPanel | null; selectedIndex: number; outlineItems: OutlineNavigationItem[]; relatedItems: RelatedNavigationItem[] }) {
  return (
    <box width={props.narrow ? "100%" : 30} minWidth={props.narrow ? 0 : 24} marginLeft={props.narrow ? 0 : 1} height={props.narrow ? 10 : "100%"} flexDirection="column">
      <SideRailPanelView panel="outline" title="OUTLINE" empty="No headings" active={props.focusedPanel === "outline"} selectedIndex={props.selectedIndex} items={props.outlineItems} />
      <SideRailPanelView panel="related" title="RELATED" empty="No links yet" active={props.focusedPanel === "related"} selectedIndex={props.selectedIndex} items={props.relatedItems} />
    </box>
  )
}

function SideRailPanelView(props: { panel: SideRailPanel; title: string; empty: string; active: boolean; selectedIndex: number; items: Array<OutlineNavigationItem | RelatedNavigationItem> }) {
  const [scrollbox, setScrollbox] = createSignal<ScrollBoxRenderable>()

  createEffect(() => {
    const current = scrollbox()
    if (!props.active || !current || props.selectedIndex < 0 || props.selectedIndex >= props.items.length) return
    current.scrollChildIntoView(sideRailRowId(props.panel, props.selectedIndex))
  })

  return (
    <box border borderStyle="single" borderColor={props.active ? theme.borderActive : theme.border} paddingX={1} paddingY={1} flexGrow={1} minHeight={0} flexDirection="column">
      <text height={1} fg={props.active ? theme.accent : theme.muted}><b>{props.title}</b></text>
      <Show when={props.items.length > 0} fallback={<text height={1} fg={theme.subtle}>{props.empty}</text>}>
        <scrollbox ref={setScrollbox} flexGrow={1} minHeight={0} scrollbarOptions={{ showArrows: false }}>
          <box flexDirection="column" width="100%">
            <For each={props.items}>{(item, index) => <SideRailRow id={sideRailRowId(props.panel, index())} item={item} selected={props.active && index() === props.selectedIndex} />}</For>
          </box>
        </scrollbox>
      </Show>
    </box>
  )
}

function SideRailRow(props: { id: string; item: OutlineNavigationItem | RelatedNavigationItem; selected: boolean }) {
  const label = () => "level" in props.item ? `${"  ".repeat(Math.max(0, props.item.level - 2))}${props.item.title}` : relatedNavigationLabel(props.item)

  return (
    <box id={props.id} height={1} width="100%" backgroundColor={props.selected ? theme.accentSoft : undefined} paddingX={1}>
      <text height={1} fg={props.selected ? theme.text : theme.muted}>{props.selected ? "▶ " : "  "}{label()}</text>
    </box>
  )
}

function sideRailRowId(panel: SideRailPanel, index: number) {
  return `side-rail-${panel}-${index}`
}

export function StatusBar(props: { focusPane: string; editorOpen: boolean; editorDirty: boolean; editMessage: string; reloading: boolean; hasStagedChanges: boolean; width: number }) {
  const status = () => {
    if (props.editorOpen) return props.editMessage || `editing transient buffer: ${props.editorDirty ? "modified" : "unchanged"}`
    if (props.reloading) return props.editMessage || "Reloading current page from Confluence..."
    return props.editMessage ? props.editMessage : `focus: ${props.focusPane}`
  }
  const hints = () => statusBarHints(props.focusPane, props.editorOpen, props.width, status().length, props.hasStagedChanges && !props.editMessage && !props.reloading)

  return (
    <box height={1} backgroundColor={theme.accentSoft} paddingX={1} flexDirection="row" justifyContent="space-between">
      <text height={1} fg={theme.text}>{status()}</text>
      <box height={1} flexDirection="row">
        <For each={hints()}>{(hint) => <StatusHint hint={hint} />}</For>
      </box>
    </box>
  )
}

type StatusHintItem = { key: string; label: string }

export function statusBarHints(focusPane: string, editorOpen: boolean, width: number, statusWidth = 0, hasStagedChanges = false): StatusHintItem[] {
  if (editorOpen) return [{ key: "Ctrl+T", label: "stage" }, { key: "Esc", label: "close" }]
  if (width < 80) return [
    { key: "S", label: "all spaces" },
    { key: "Esc", label: "back" },
    ...(hasStagedChanges ? [{ key: "c", label: "overview" }] : []),
    { key: "Tab", label: "panes" },
    ...(hasStagedChanges ? [] : [{ key: "?", label: "help" }]),
  ]

  const globalHints: StatusHintItem[] = [
    { key: "/", label: "search" },
    { key: "S", label: "all spaces" },
    { key: "Esc", label: "back" },
    ...(hasStagedChanges ? [{ key: "c", label: "overview" }] : []),
    { key: "Tab", label: "panes" },
  ]
  if (width < 110) return globalHints

  const paneHints: StatusHintItem[] = focusPane === "document"
    ? [{ key: "j/k", label: "scroll" }, { key: "e", label: "edit" }, { key: "D", label: "delete" }, { key: "d/u", label: "page" }, { key: "i", label: "image" }]
    : focusPane === "outline"
      ? [{ key: "j/k", label: "select" }, { key: "h/l", label: "related" }, { key: "e", label: "edit" }, { key: "D", label: "delete" }, { key: "Enter", label: "jump" }]
      : focusPane === "related"
        ? [{ key: "j/k", label: "select" }, { key: "h/l", label: "outline" }, { key: "e", label: "edit" }, { key: "D", label: "delete" }, { key: "Enter", label: "open" }]
        : [{ key: "j/k", label: "move" }, { key: "h/l", label: "fold" }, { key: "e", label: "edit" }, { key: "D", label: "delete" }, { key: "n", label: "child" }, { key: "N", label: "root" }]

  return hintsWithinWidth([...globalHints.slice(0, 2), { key: "r", label: "reload" }, ...globalHints.slice(2), ...paneHints], width - statusWidth - 3)
}

function hintsWithinWidth(hints: StatusHintItem[], width: number) {
  const visible: StatusHintItem[] = []
  let used = 0

  for (const hint of hints) {
    const hintWidth = hint.key.length + hint.label.length + 4
    if (used + hintWidth > width) break
    visible.push(hint)
    used += hintWidth
  }

  return visible
}

function StatusHint(props: { hint: StatusHintItem }) {
  return (
    <box height={1} flexDirection="row">
      <text height={1} fg={theme.accent}>{props.hint.key}</text>
      <text height={1} fg={theme.muted}> {props.hint.label}</text>
      <text height={1} fg={theme.muted}> · </text>
    </box>
  )
}

function EditorOverlay(props: {
  pageTitle: string
  pageId: string
  initialMarkdown: string
  dirty: boolean
  draftStatus: PageDraftStatus | null
  inputFocused: boolean
  message: string
  left: number
  top: number
  width: number
  height: number
  onMarkdownChange: (markdown: string) => void
}) {
  let textarea: TextareaRenderable | undefined

  const statusText = () => {
    const persisted = props.draftStatus ?? "synced"
    return `${props.dirty ? "modified" : "unchanged"} · ${persisted}`
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
        <text height={1} fg={theme.accent}><b>EDITOR</b></text>
        <text height={1} fg={props.dirty ? theme.warn : theme.good}>{statusText()}</text>
      </box>
      <text height={1} fg={theme.text}>{props.pageTitle}</text>
      <text height={1} fg={theme.subtle}>ID: {props.pageId}  {props.message || "Stage to keep this buffer. Esc closes without changing staged docs."}</text>
      <box height={1} />
      <textarea
        ref={(node) => { textarea = node }}
        initialValue={props.initialMarkdown}
        focused={props.inputFocused}
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
      <text height={1} fg={theme.muted}>Ctrl+T stage this buffer  Esc close without changing staged docs</text>
    </box>
  )
}

export function StagedChangesOverlay(props: {
  visible: boolean
  activeSpaceName: string
  changes: TuiStagedChange[]
  selectedIndex: number
  selectedChangeKeys: Set<string>
  message: string
  applying: boolean
  left: number
  top: number
  width: number
  height: number
  onToggle: () => void
  onApply: () => void
  onDiscard: () => void
  onClose: () => void
}) {
  const listWidth = createMemo(() => Math.min(40, Math.max(28, Math.floor(props.width * 0.36))))
  const selectedChange = createMemo(() => props.changes[props.selectedIndex])
  const selectedCount = createMemo(() => props.changes.filter((change) => props.selectedChangeKeys.has(change.changeKey)).length)
  const lines = createMemo(() => selectedChange()?.diffMarkdown.split("\n") ?? [])

  return (
    <box
      visible={props.visible}
      position="absolute"
      left={props.left}
      top={props.top}
      width={props.width}
      height={props.height}
      border
      borderStyle="rounded"
      borderColor={theme.warn}
      backgroundColor="#07111f"
      paddingX={1}
      paddingY={1}
      flexDirection="column"
      zIndex={60}
    >
      <box height={1} flexDirection="row" justifyContent="space-between" width="100%">
        <text height={1} fg={theme.warn}><b>OVERVIEW</b></text>
        <text height={1} fg={theme.muted}>{props.activeSpaceName}</text>
      </box>
      <text height={1} fg={theme.subtle}>{props.applying ? "Applying selected staged changes..." : "space select  a apply selected  d discard selected  esc close"}</text>
      <text height={1} fg={reviewMessageColor(props.message)}>{props.message || `${selectedCount()} of ${props.changes.length} staged change${props.changes.length === 1 ? "" : "s"} selected.`}</text>
      <box flexGrow={1} minHeight={0} flexDirection="row" gap={1}>
        <box width={listWidth()} minWidth={24} height="100%" border borderStyle="single" borderColor={theme.border} paddingX={1} flexDirection="column">
          <text height={1} fg={theme.muted}><b>PAGES</b></text>
          <Show when={props.changes.length > 0} fallback={<text height={1} fg={theme.subtle}>No staged changes in this space.</text>}>
            <scrollbox flexGrow={1} minHeight={0} scrollbarOptions={{ showArrows: false }}>
              <box flexDirection="column" width="100%">
                <For each={props.changes}>
                  {(change, index) => <StagedChangeRow change={change} active={index() === props.selectedIndex} checked={props.selectedChangeKeys.has(change.changeKey)} />}
                </For>
              </box>
            </scrollbox>
          </Show>
        </box>
        <box flexGrow={1} minWidth={0} height="100%" border borderStyle="single" borderColor={theme.border} paddingX={1} flexDirection="column">
          <Show when={selectedChange()} fallback={<box flexGrow={1} alignItems="center" justifyContent="center"><text fg={theme.subtle}>Select a staged page to preview its diff.</text></box>}>
            {(change) => (
              <>
                <text height={1} fg={theme.text}>{change().title}</text>
                <text height={1} fg={theme.subtle}>{changeDetailLine(change())}</text>
                <text height={1} fg={theme.muted}>{changePathLine(change())}</text>
                <scrollbox flexGrow={1} minHeight={0} scrollbarOptions={{ showArrows: false }}>
                  <box flexDirection="column" width="100%">
                    <For each={lines()}>{(line) => <text height={1} width="100%" content={line || " "} fg={diffLineColor(line)} />}</For>
                  </box>
                </scrollbox>
              </>
            )}
          </Show>
        </box>
      </box>
      <box height={3} flexDirection="row" gap={1} paddingTop={1}>
        <ReviewButton label="Toggle" color={theme.accent} disabled={props.applying || props.changes.length === 0} onPress={props.onToggle} />
        <ReviewButton label={props.applying ? "Applying" : "Apply"} color={theme.good} disabled={props.applying || selectedCount() === 0} onPress={props.onApply} />
        <ReviewButton label="Discard" color={theme.danger} disabled={props.applying || selectedCount() === 0} onPress={props.onDiscard} />
        <ReviewButton label="Close" color={theme.muted} disabled={props.applying} onPress={props.onClose} />
        <text height={3} fg={theme.subtle}>{selectedCount()} selected / {props.changes.length} staged</text>
      </box>
    </box>
  )
}

function StagedChangeRow(props: { change: TuiStagedChange; active: boolean; checked: boolean }) {
  const marker = () => (props.active ? "▶" : " ")
  const checkbox = () => (props.checked ? "[x]" : "[ ]")
  const kind = () => props.change.kind
  const identifier = () => props.change.kind === "create" ? `parent ${props.change.parentPage?.pageId ?? "space root"}` : props.change.page.pageId

  return (
    <box height={3} width="100%" backgroundColor={props.active ? theme.accentSoft : undefined} paddingX={1} flexDirection="column">
      <text height={1} fg={props.active ? theme.text : theme.muted}>{marker()} {checkbox()} [{kind()}] {props.change.title}</text>
      <text height={1} fg={theme.subtle}>    {identifier()}</text>
      <text height={1} fg={theme.muted}>    {formatDate(props.change.updatedAt)}</text>
    </box>
  )
}

function changeDetailLine(change: TuiStagedChange) {
  if (change.kind === "create") return `New page under ${change.parentPage ? `parent ${change.parentPage.pageId}` : "space root"}  Updated: ${formatDate(change.updatedAt)}`
  if (change.kind === "delete") return `Delete page ${change.page.pageId}  Updated: ${formatDate(change.updatedAt)}`
  return `ID: ${change.page.pageId}  Updated: ${formatDate(change.updatedAt)}`
}

function changePathLine(change: TuiStagedChange) {
  if (change.kind === "create") return [...(change.parentPage?.path ?? []), change.title].join(" / ")
  return change.page.path.join(" / ")
}

function ReviewButton(props: { label: string; color: string; disabled?: boolean; onPress: () => void }) {
  return (
    <box height={3} width={14} border borderStyle="rounded" borderColor={props.disabled ? theme.border : props.color} alignItems="center" justifyContent="center" onMouseDown={() => { if (!props.disabled) props.onPress() }}>
      <text height={1} fg={props.disabled ? theme.subtle : props.color}>{props.label}</text>
    </box>
  )
}

export function NewPageOverlay(props: { visible: boolean; title: string; parentPage: IndexedPage | null; left: number; width: number }) {
  return (
    <box
      visible={props.visible}
      position="absolute"
      left={props.left}
      top={5}
      width={props.width}
      height={9}
      border
      borderStyle="rounded"
      borderColor={theme.borderActive}
      backgroundColor="#08111f"
      paddingX={2}
      paddingY={1}
      flexDirection="column"
      zIndex={70}
    >
      <box height={1} flexDirection="row" justifyContent="space-between" width="100%">
        <text height={1} fg={theme.accent}><b>NEW PAGE</b></text>
        <text height={1} fg={theme.muted}>type: page</text>
      </box>
      <text height={1} fg={theme.subtle}>Parent: {props.parentPage ? props.parentPage.title : "Space root"}</text>
      <box height={1} />
      <box height={1} flexDirection="row">
        <text height={1} fg={theme.text}>Title: </text>
        <Show when={props.title} fallback={<text height={1} fg={theme.subtle}>type a title</text>}>
          {(title) => <text height={1} fg={theme.text}>{title()}_</text>}
        </Show>
      </box>
      <text height={1} fg={theme.subtle}>enter stage create  esc cancel</text>
    </box>
  )
}

export function PageSearchOverlay(props: { visible: boolean; query: string; results: SearchResult[]; selectedIndex: number; scope: "active" | "all"; activeSpaceName: string; viewMode: PageViewMode; left: number; top: number; width: number; height: number; onQueryChange: (query: string) => void; onKeyDown: (key: SearchKeyLike) => boolean }) {
  const resultWindow = createMemo(() => searchResultWindow(props.results, props.selectedIndex, props.height))

  return (
    <box
      visible={props.visible}
      position="absolute"
      left={props.left}
      top={props.top}
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
        <text height={1} fg={theme.accent}><b>{props.scope === "all" ? "ALL-SPACE SEARCH" : "PAGE SEARCH"}</b></text>
        <text height={1} fg={theme.muted}>{props.scope === "all" ? `local index · ${props.viewMode}` : `${props.activeSpaceName} · ${props.viewMode}`}</text>
      </box>
      <SearchInput visible={props.visible} prefix={props.scope === "all" ? "S" : "/"} value={props.query} placeholder="type title, path, or content" onInput={props.onQueryChange} onKeyDown={props.onKeyDown} />
      <text height={1} fg={theme.subtle}>{props.results.length} result{props.results.length === 1 ? "" : "s"}  type to search  up/down move  enter open  esc close</text>
      <box height={1} />
      <Show when={props.results.length > 0} fallback={<EmptySearchState query={props.query} />}>
        <scrollbox flexGrow={1} minHeight={0} scrollbarOptions={{ showArrows: false }}>
          <box flexDirection="column" width="100%">
            <For each={resultWindow()}>
              {(result, index) => {
                const resultIndex = () => searchResultWindowStart(props.results.length, props.selectedIndex, props.height) + index()
                return <SearchResultRow id={pageSearchRowId(props.scope, resultIndex())} result={result} selected={resultIndex() === props.selectedIndex} showSpace={props.scope === "all"} />
              }}
            </For>
          </box>
        </scrollbox>
      </Show>
    </box>
  )
}

function SearchInput(props: { visible: boolean; prefix: string; value: string; placeholder: string; onInput: (value: string) => void; onKeyDown: (key: SearchKeyLike) => boolean }) {
  const [input, setInput] = createSignal<InputRenderable>()

  createEffect(() => {
    const node = input()
    if (!props.visible || !node || node.isDestroyed) return

    // Let the shortcut that opened the overlay finish before the input captures text.
    const timer = setTimeout(() => node.focus(), 1)
    onCleanup(() => clearTimeout(timer))
  })

  createEffect(() => {
    const node = input()
    if (!node || node.isDestroyed || props.visible) return
    node.blur()
  })

  return (
    <box height={1} flexDirection="row" width="100%">
      <text height={1} fg={theme.text}>{props.prefix} </text>
      <input
        ref={setInput}
        value={props.value}
        flexGrow={1}
        backgroundColor="#08111f"
        focusedBackgroundColor="#08111f"
        textColor={theme.text}
        focusedTextColor={theme.text}
        placeholder={props.placeholder}
        placeholderColor={theme.subtle}
        cursorColor={theme.accent}
        onInput={props.onInput}
        onKeyDown={(key) => {
          if (props.onKeyDown(key)) key.preventDefault()
        }}
      />
    </box>
  )
}

export function DocumentFindOverlay(props: { visible: boolean; query: string; matches: DocumentFindMatch[]; selectedIndex: number; pageTitle: string; left: number; width: number; height: number; onQueryChange: (query: string) => void; onKeyDown: (key: SearchKeyLike) => boolean }) {
  const selectedMatch = () => props.matches[props.selectedIndex]

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
      zIndex={25}
    >
      <box height={1} flexDirection="row" justifyContent="space-between" width="100%">
        <text height={1} fg={theme.accent}><b>FIND IN DOCUMENT</b></text>
        <text height={1} fg={theme.muted}>{props.pageTitle}</text>
      </box>
      <SearchInput visible={props.visible} prefix="f" value={props.query} placeholder="type text to find" onInput={props.onQueryChange} onKeyDown={props.onKeyDown} />
      <text height={1} fg={theme.subtle}>{props.query ? props.matches.length ? `${props.selectedIndex + 1}/${props.matches.length} matches  enter next  shift+enter previous  esc close` : "no matches  type to search  esc close" : "type to search  esc close"}</text>
      <box height={1} />
      <Show when={selectedMatch()} fallback={<EmptyDocumentFindState query={props.query} />}>
        {(match) => (
          <box flexGrow={1} justifyContent="center" flexDirection="column">
            <text height={1} fg={theme.good}>line {match().line + 1}, column {match().column + 1}</text>
            <text height={1} fg={theme.text}>{match().preview}</text>
          </box>
        )}
      </Show>
    </box>
  )
}

function EmptyDocumentFindState(props: { query: string }) {
  const message = () => props.query ? `No matches for "${props.query}" in this document.` : "Enter text to search the current document."

  return (
    <box flexGrow={1} alignItems="center" justifyContent="center">
      <text fg={theme.muted}>{message()}</text>
    </box>
  )
}

function SpaceSwitcherOverlay(props: { visible: boolean; query: string; results: SpaceSearchResult[]; selectedIndex: number; activeSpaceKey: string; left: number; top: number; width: number; height: number; onQueryChange: (query: string) => void; onKeyDown: (key: SearchKeyLike) => boolean }) {
  const resultWindow = createMemo(() => searchResultWindow(props.results, props.selectedIndex, props.height))

  return (
    <box
      visible={props.visible}
      position="absolute"
      left={props.left}
      top={props.top}
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
        <text height={1} fg={theme.accent}><b>SWITCH SPACE</b></text>
        <text height={1} fg={theme.muted}>active: {props.activeSpaceKey}</text>
      </box>
      <SearchInput visible={props.visible} prefix="s" value={props.query} placeholder="type space key or name" onInput={props.onQueryChange} onKeyDown={props.onKeyDown} />
      <text height={1} fg={theme.subtle}>{props.results.length} space{props.results.length === 1 ? "" : "s"}  type to filter  up/down move  enter switch  esc close</text>
      <box height={1} />
      <Show when={props.results.length > 0} fallback={<EmptySpaceState query={props.query} />}>
        <scrollbox flexGrow={1} minHeight={0} scrollbarOptions={{ showArrows: false }}>
          <box flexDirection="column" width="100%">
            <For each={resultWindow()}>
              {(result, index) => {
                const resultIndex = () => searchResultWindowStart(props.results.length, props.selectedIndex, props.height) + index()
                return <SpaceResultRow id={spaceSwitcherRowId(resultIndex())} result={result} selected={resultIndex() === props.selectedIndex} active={result.space.key === props.activeSpaceKey} />
              }}
            </For>
          </box>
        </scrollbox>
      </Show>
    </box>
  )
}

export function CommandPaletteOverlay(props: { visible: boolean; query: string; commands: TuiCommand[]; selectedIndex: number; left: number; top: number; width: number; height: number; onQueryChange: (query: string) => void; onKeyDown: (key: SearchKeyLike) => boolean }) {
  const [scrollbox, setScrollbox] = createSignal<ScrollBoxRenderable>()

  createEffect(() => {
    const current = scrollbox()
    if (!props.visible || !current || props.selectedIndex < 0 || props.selectedIndex >= props.commands.length) return
    current.scrollChildIntoView(commandPaletteRowId(props.selectedIndex))
  })

  return (
    <box
      visible={props.visible}
      position="absolute"
      left={props.left}
      top={props.top}
      width={props.width}
      height={props.height}
      border
      borderStyle="rounded"
      borderColor={theme.borderActive}
      backgroundColor="#08111f"
      paddingX={2}
      paddingY={1}
      flexDirection="column"
      zIndex={35}
    >
      <box height={1} flexDirection="row" justifyContent="space-between" width="100%">
        <text height={1} fg={theme.accent}><b>COMMAND PALETTE</b></text>
        <text height={1} fg={theme.muted}>p · ; · : actions</text>
      </box>
      <SearchInput visible={props.visible} prefix="p" value={props.query} placeholder="type an action, key, or description" onInput={props.onQueryChange} onKeyDown={props.onKeyDown} />
      <text height={1} fg={theme.subtle}>{props.commands.length} command{props.commands.length === 1 ? "" : "s"}  type to filter  up/down move  enter run  esc close</text>
      <box height={1} />
      <Show when={props.commands.length > 0} fallback={<EmptyCommandPaletteState query={props.query} />}>
        <scrollbox ref={setScrollbox} flexGrow={1} minHeight={0} scrollbarOptions={{ showArrows: false }}>
          <box flexDirection="column" width="100%">
            <For each={props.commands}>{(command, index) => <CommandPaletteRow id={commandPaletteRowId(index())} command={command} selected={index() === props.selectedIndex} />}</For>
          </box>
        </scrollbox>
      </Show>
    </box>
  )
}

function CommandPaletteRow(props: { id: string; command: TuiCommand; selected: boolean }) {
  const color = () => props.command.available ? theme.text : theme.muted
  const detail = () => props.command.available ? props.command.description : props.command.unavailableReason ?? props.command.description

  return (
    <box id={props.id} height={3} width="100%" backgroundColor={props.selected ? theme.accentSoft : undefined} paddingX={1} flexDirection="column">
      <box height={1} flexDirection="row">
        <text height={1} width={24} fg={props.command.available ? theme.good : theme.subtle}>{props.command.keys}</text>
        <text height={1} fg={color()}>{props.command.available ? <b>{props.command.label}</b> : props.command.label}</text>
      </box>
      <text height={1} fg={props.command.available ? theme.subtle : theme.muted}>{"  " + detail()}</text>
      <text height={1} fg={theme.muted}>{"  " + props.command.group}</text>
    </box>
  )
}

function commandPaletteRowId(index: number) {
  return `command-palette-row-${index}`
}

function EmptyCommandPaletteState(props: { query: string }) {
  return (
    <box flexGrow={1} alignItems="center" justifyContent="center">
      <text fg={theme.muted}>No commands match "{props.query}".</text>
    </box>
  )
}

export function HelpOverlay(props: { visible: boolean; commands: readonly TuiCommand[]; left: number; top: number; width: number; height: number; setScrollbox?: (scrollbox: ScrollBoxRenderable) => void }) {
  const groups = ["Global", "Navigation", "Reader", "Editing", "Images"] as const

  return (
    <box
      visible={props.visible}
      position="absolute"
      left={props.left}
      top={props.top}
      width={props.width}
      height={props.height}
      border
      borderStyle="rounded"
      borderColor={theme.borderActive}
      backgroundColor="#08111f"
      paddingX={2}
      paddingY={1}
      flexDirection="column"
      zIndex={80}
    >
      <box height={1} flexDirection="row" justifyContent="space-between" width="100%">
        <text height={1} fg={theme.accent}><b>KEYBOARD HELP</b></text>
        <text height={1} fg={theme.muted}>j/k scroll · u/d page · ?/Esc/q close</text>
      </box>
      <text height={1} fg={theme.subtle}>Available commands reflect the current reader and overlays. Muted commands are planned but unavailable.</text>
      <box height={1} />
      <scrollbox ref={props.setScrollbox} flexGrow={1} minHeight={0} scrollbarOptions={{ showArrows: false }}>
        <box flexDirection="column" width="100%">
          <For each={groups}>{(group) => {
            const commands = props.commands.filter((command) => command.group === group)
            if (!commands.length) return <box height={0} />

            return (
              <box flexDirection="column" marginBottom={1}>
                <text height={1} fg={theme.accent}><b>{group.toUpperCase()}</b></text>
                <For each={commands}>{(command) => <HelpCommandRow command={command} />}</For>
              </box>
            )
          }}</For>
        </box>
      </scrollbox>
    </box>
  )
}

function HelpCommandRow(props: { command: TuiCommand }) {
  const color = () => props.command.available ? theme.text : theme.muted
  const detail = () => props.command.available ? props.command.description : props.command.unavailableReason ?? props.command.description

  return (
    <box height={2} width="100%" flexDirection="column" paddingLeft={1}>
      <box height={1} flexDirection="row">
        <text height={1} width={24} fg={props.command.available ? theme.good : theme.subtle}>{props.command.keys}</text>
        <text height={1} fg={color()}>{props.command.available ? <b>{props.command.label}</b> : props.command.label}</text>
      </box>
      <text height={1} paddingLeft={24} fg={props.command.available ? theme.subtle : theme.muted}>{detail()}</text>
    </box>
  )
}

function SearchResultRow(props: { id: string; result: SearchResult; selected: boolean; showSpace?: boolean }) {
  const marker = () => (props.selected ? "▶" : " ")

  return (
    <box id={props.id} height={3} width="100%" backgroundColor={props.selected ? theme.accentSoft : undefined} paddingX={1} flexDirection="column">
      <text height={1} fg={props.selected ? theme.text : theme.muted}>{marker() + " " + props.result.page.title + "  ·  " + props.result.matchedIn}</text>
      <text height={1} fg={theme.subtle}>{"  " + (props.showSpace ? `[${props.result.page.spaceKey}] ` : "") + props.result.page.path.join(" / ")}</text>
      <text height={1} fg={theme.muted}>{"  " + props.result.page.snippet}</text>
    </box>
  )
}

function pageSearchRowId(scope: "active" | "all", index: number) {
  return `page-search-${scope}-${index}`
}

function searchResultWindow<T>(results: readonly T[], selectedIndex: number, height: number) {
  const start = searchResultWindowStart(results.length, selectedIndex, height)
  return results.slice(start, start + searchResultWindowSize(height))
}

function searchResultWindowStart(resultCount: number, selectedIndex: number, height: number) {
  const windowSize = searchResultWindowSize(height)
  return Math.min(Math.max(0, selectedIndex - windowSize + 1), Math.max(0, resultCount - windowSize))
}

function searchResultWindowSize(height: number) {
  return Math.max(1, Math.floor((height - 8) / 3))
}

function EmptySearchState(props: { query: string }) {
  return (
    <box flexGrow={1} alignItems="center" justifyContent="center">
      <text fg={theme.muted}>No pages match "{props.query}" in this space.</text>
    </box>
  )
}

function SpaceResultRow(props: { id: string; result: SpaceSearchResult; selected: boolean; active: boolean }) {
  const marker = () => (props.selected ? "▶" : props.active ? "●" : " ")
  const syncColor = () => (props.result.space.syncState === "fresh" ? theme.good : props.result.space.syncState === "stale" ? theme.warn : theme.danger)

  return (
    <box id={props.id} height={3} width="100%" backgroundColor={props.selected ? theme.accentSoft : undefined} paddingX={1} flexDirection="column">
      <text height={1} fg={props.selected ? theme.text : theme.muted}>{marker() + " " + props.result.space.key + "  ·  " + props.result.space.name}</text>
      <text height={1} fg={syncColor()}>{"  " + props.result.space.syncState + "  ·  " + props.result.space.pageCount + " pages  ·  matched " + props.result.matchedIn}</text>
      <text height={1} fg={theme.subtle}>{"  last synced " + formatOptionalDate(props.result.space.lastSyncedAt)}</text>
    </box>
  )
}

function spaceSwitcherRowId(index: number) {
  return `space-switcher-${index}`
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
  return textInputKeyAction(key)
}

export function nextFocusPaneForKey(current: FocusPane, key: SearchKeyLike): FocusPane {
  if (isShiftTabKey(key)) return current === "navigator" ? "related" : current === "related" ? "outline" : current === "outline" ? "document" : "navigator"
  if (isTabKey(key)) return current === "navigator" ? "document" : current === "document" ? "outline" : current === "outline" ? "related" : "navigator"
  if (current === "navigator" && key.name === "return") return "document"
  return current
}

export function nextPageViewModeForKey(current: PageViewMode, key: SearchKeyLike): PageViewMode | null {
  if (!isPlainKey(key, "a")) return null

  return current === "current" ? "archived" : "current"
}

export function nextNavigatorSelectionForCollapse(row: NavigatorCollapseRow | undefined, knownPages: { has: (pageId: string) => boolean }): string | null {
  if (!row || (row.hasChildren && row.expanded)) return null

  const parentId = row.page.parentId
  return parentId && knownPages.has(parentId) ? parentId : null
}

export function documentHorizontalScrollDeltaForKey(key: SearchKeyLike): number {
  if (key.name === "l" || key.name === "right") return documentHorizontalScrollColumns
  if (key.name === "h" || key.name === "left") return -documentHorizontalScrollColumns
  return 0
}

function keyDebugData(key: SearchKeyLike) {
  return {
    keyName: key.name,
    keySequence: readableKeySequence(key.sequence),
    keySequenceHex: keySequenceHex(key.sequence),
    keyCtrl: key.ctrl,
    keyMeta: key.meta,
    keyShift: Boolean(key.shift),
  }
}

function readableKeySequence(sequence: string) {
  if (!sequence) return ""
  if (sequence.length > 16) return `${sequence.slice(0, 16)}...`

  return sequence
}

function keySequenceHex(sequence: string) {
  return [...sequence].map((character) => character.codePointAt(0)?.toString(16).padStart(2, "0") ?? "").join(" ")
}

function applyBatchMessage(results: ApplyPageDraftResult[]) {
  const applied = results.filter((result) => result.status === "applied")
  const conflicts = results.filter((result) => result.status === "conflict")
  const blocked = results.filter((result) => result.status === "blocked")
  const firstFailure = [...conflicts, ...blocked][0]
  const summary = `${applied.length} applied, ${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"}, ${blocked.length} blocked.`

  if (!firstFailure) return `${applied.length} staged change${applied.length === 1 ? "" : "s"} applied to Confluence.`
  return `${summary} ${firstFailure.title}: ${firstFailure.details.join(" ")}`
}

function reviewMessageColor(message: string) {
  if (/\b(conflict|blocked|failed|missing|cannot)\b/i.test(message)) return theme.danger
  if (/\b(appl|stage|review)\b/i.test(message)) return theme.good
  return theme.subtle
}

function diffLineColor(line: string) {
  if (line.startsWith("+++") || line.startsWith("---")) return theme.accent
  if (line.startsWith("+")) return theme.good
  if (line.startsWith("-")) return theme.danger
  return theme.text
}

export function documentOutlineItems(markdown: string): OutlineNavigationItem[] {
  return markdown.split("\n").flatMap((line, index) => {
    const match = /^(#{2,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (!match) return []

    return [{ title: match[2], level: match[1].length, line: index }]
  })
}

export function relatedNavigationItemsForPage(page: ReaderPage, getPageById: (pageId: string) => IndexedPage | null): RelatedNavigationItem[] {
  return [
    ...page.children.map((child) => ({ kind: "child" as const, label: child.title, pageId: child.pageId })),
    ...page.outgoingLinks.map((link) => relatedItemForOutgoingLink(link)),
    ...page.backlinks.map((link) => ({ kind: "backlink" as const, label: getPageById(link.fromPageId)?.title ?? link.fromPageId, pageId: link.fromPageId })),
  ]
}

function relatedItemForOutgoingLink(link: PageLink): RelatedNavigationItem {
  if (link.kind === "internal" && link.targetPageId) return { kind: "internal", label: link.title, pageId: link.targetPageId }
  return { kind: "external", label: link.title, url: link.targetUrl }
}

function relatedNavigationLabel(item: RelatedNavigationItem) {
  if (item.kind === "child") return `child: ${item.label}`
  if (item.kind === "internal") return `-> ${item.label}`
  if (item.kind === "backlink") return `<- ${item.label}`
  return `external: ${item.label}`
}

export function findDocumentMatches(markdown: string, query: string): DocumentFindMatch[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return []

  return markdown.split("\n").flatMap((line, lineIndex) => {
    const normalizedLine = line.toLocaleLowerCase()
    const matches: DocumentFindMatch[] = []
    let start = 0

    while (start < normalizedLine.length) {
      const column = normalizedLine.indexOf(normalizedQuery, start)
      if (column < 0) break

      matches.push({ line: lineIndex, column, preview: line.trim() || "(blank line)" })
      start = column + normalizedQuery.length
    }

    return matches
  })
}

export function nextDocumentFindIndex(current: number, direction: number, matchCount: number) {
  if (matchCount <= 0) return 0
  return (current + direction + matchCount) % matchCount
}

export function searchPaletteCommands(commands: readonly TuiCommand[], query: string): TuiCommand[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return [...commands]

  return commands.filter((command) => `${command.label} ${command.keys} ${command.description} ${command.group}`.toLocaleLowerCase().includes(normalizedQuery))
}

function readerImagePartsForPage(page: ReaderPage): ReaderImagePart[] {
  return splitReaderImagePlaceholders(page.contentMarkdown, page.mediaAssets ?? []).filter(isReaderImagePart)
}

export type ReaderImagePosition = { nodeId: string; top: number; height: number }

export function nearestImageIndexForViewport(images: { nodeId: string }[], positions: ReaderImagePosition[], viewportTop: number, viewportHeight: number) {
  if (!images.length) return 0

  const positionByNodeId = new Map(positions.map((position) => [position.nodeId, position]))
  const viewportCenter = viewportTop + viewportHeight / 2
  let nearestIndex = 0
  let nearestDistance = Number.POSITIVE_INFINITY

  for (let index = 0; index < images.length; index += 1) {
    const position = positionByNodeId.get(images[index].nodeId)
    if (!position) continue

    const distance = distanceToViewportCenter(position, viewportCenter)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestIndex = index
    }
  }

  return Number.isFinite(nearestDistance) ? nearestIndex : 0
}

function readerImagePositions(images: ReaderImagePart[], renderables: Map<string, BoxRenderable>): ReaderImagePosition[] {
  return images.flatMap((image) => {
    const renderable = renderables.get(image.nodeId)
    return renderable ? [{ nodeId: image.nodeId, top: renderable.screenY, height: renderable.height }] : []
  })
}

function distanceToViewportCenter(position: ReaderImagePosition, viewportCenter: number) {
  const bottom = position.top + position.height
  if (viewportCenter < position.top) return position.top - viewportCenter
  if (viewportCenter > bottom) return viewportCenter - bottom

  return 0
}

function isReaderImagePart(part: ReaderContentPart): part is ReaderImagePart {
  return part.kind === "image"
}

function isArchivedPage(page: IndexedPage) {
  return (page.remoteStatus ?? "current") === "archived"
}

function isEditableRemotePage(page: IndexedPage) {
  return (page.remoteStatus ?? "current") === "current" && (page.contentType ?? "page") === "page"
}

function remoteStatusLabel(page: IndexedPage) {
  return page.remoteStatus ?? "current"
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
