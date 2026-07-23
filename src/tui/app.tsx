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
import type { FocusPane, IndexedPage, PageViewMode, ReaderPage, SearchResult, SpaceSearchResult } from "../model"
import { loadCredentialStatus, type CredentialStatus } from "../config"
import type { PageDraftStatus } from "../index/repository"
import type { ApplyPageDraftResult } from "../apply"
import { createMockTuiDataSource, createRepositoryTuiDataSource, emptyPageId, emptyReaderPage, emptySpaceSummary, type TuiDataSource, type TuiStagedChange } from "./data"
import { markdownStyle, theme } from "./theme"

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

const documentHorizontalScrollColumns = 8

export type SearchKeyLike = {
  name: string
  sequence: string
  ctrl: boolean
  meta: boolean
  shift?: boolean
}

type CredentialWarning = Exclude<CredentialStatus, { kind: "ready" }>

export type PageSearchKeyAction = "append" | "delete" | "submit" | "close" | "next" | "previous" | "ignore"

export interface RenderTuiOptions {
  demo?: boolean
}

const demoCredentialStatus: CredentialStatus = {
  kind: "ready",
  auth: {
    config: {
      version: 1,
      atlassian: {
        siteUrl: "https://example.atlassian.net",
        email: "demo@example.com",
        spaceKeys: ["ENG", "OPS", "ARCH", "PLAT", "TEAM"],
        defaultSpaceKey: "ENG",
        apiTokenEnv: "ATLASSIAN_API_TOKEN",
      },
    },
    apiToken: null,
    paths: {
      configDir: "demo://lazyconfluence",
      configFile: "demo://lazyconfluence/config.json",
      credentialFile: "demo://lazyconfluence/atlassian.env",
    },
  },
}

export async function renderTui(options: RenderTuiOptions = {}) {
  const dataSource = options.demo ? createMockTuiDataSource() : undefined

  render(() => <App credentialStatus={options.demo ? demoCredentialStatus : undefined} dataSource={dataSource} />, {
    targetFps: 30,
    exitOnCtrlC: true,
    backgroundColor: theme.bg,
    consoleMode: "disabled",
  })
}

export function App(props: { credentialStatus?: CredentialStatus; dataSource?: TuiDataSource; disableTreeSitter?: boolean; initialPageViewMode?: PageViewMode } = {}) {
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const dataSource = props.dataSource ?? createRepositoryTuiDataSource()
  const initialSpaceKey = dataSource.getDefaultSpaceKey() ?? "LOCAL"
  const initialPageId = dataSource.getDefaultPageId(initialSpaceKey) ?? emptyPageId
  const [credentialStatus, setCredentialStatus] = createSignal<CredentialStatus | null>(props.credentialStatus ?? null)
  const [activeSpaceKey, setActiveSpaceKey] = createSignal(initialSpaceKey)
  const initialPageViewMode = props.initialPageViewMode ?? "current"
  const initialViewPageId = dataSource.getDefaultPageId(initialSpaceKey, initialPageViewMode) ?? emptyPageId
  const [pageViewMode, setPageViewMode] = createSignal<PageViewMode>(initialPageViewMode)
  const initialSelectedPageId = initialPageViewMode === "current" ? initialPageId : initialViewPageId
  const [selectedPageId, setSelectedPageId] = createSignal(initialSelectedPageId)
  const [expandedPageIds, setExpandedPageIds] = createSignal(new Set(initialSelectedPageId === emptyPageId ? [] : [initialSelectedPageId]))
  const [focusPane, setFocusPane] = createSignal<"navigator" | "document">("navigator")
  const [pageSearchOpen, setPageSearchOpen] = createSignal(false)
  const [pageSearchQuery, setPageSearchQuery] = createSignal("")
  const [pageSearchSelectedIndex, setPageSearchSelectedIndex] = createSignal(0)
  const [newPageOpen, setNewPageOpen] = createSignal(false)
  const [newPageTitle, setNewPageTitle] = createSignal("")
  const [newPageParentPageId, setNewPageParentPageId] = createSignal<string | null>(null)
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
  const [editorInputFocused, setEditorInputFocused] = createSignal(false)
  const [changesOpen, setChangesOpen] = createSignal(false)
  const [changesSelectedIndex, setChangesSelectedIndex] = createSignal(0)
  const [selectedChangeKeys, setSelectedChangeKeys] = createSignal(new Set<string>())
  const [changesApplying, setChangesApplying] = createSignal(false)
  const [changesMessage, setChangesMessage] = createSignal("")
  const [editStatusMessage, setEditStatusMessage] = createSignal("")
  const [treeSitterClient, setTreeSitterClient] = createSignal<TreeSitterClient | undefined>()
  let documentScrollbox: ScrollBoxRenderable | undefined
  let editorFocusTimer: ReturnType<typeof setTimeout> | undefined

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
  const spaceSwitcherResults = createMemo(() => dataSource.searchSpaces(spaceSwitcherQuery()))
  const stagedChanges = createMemo(() => {
    draftRevision()
    return dataSource.listStagedChanges(activeSpaceKey())
  })
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
    if (!props.dataSource) dataSource.close?.()
  })

  const clearEditorFocusTimer = () => {
    if (!editorFocusTimer) return

    clearTimeout(editorFocusTimer)
    editorFocusTimer = undefined
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
    const maxIndex = Math.max(0, spaceSwitcherResults().length - 1)

    if (spaceSwitcherSelectedIndex() > maxIndex) setSpaceSwitcherSelectedIndex(maxIndex)
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

  const openPageSearch = () => {
    setSpaceSwitcherOpen(false)
    setChangesOpen(false)
    setNewPageOpen(false)
    setPageSearchOpen(true)
    setPageSearchQuery("")
    setPageSearchSelectedIndex(0)
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

  const closePageSearch = () => {
    setPageSearchOpen(false)
    setPageSearchQuery("")
    setPageSearchSelectedIndex(0)
  }

  const openSpaceSwitcher = () => {
    setPageSearchOpen(false)
    setChangesOpen(false)
    setNewPageOpen(false)
    setSpaceSwitcherOpen(true)
    setSpaceSwitcherQuery("")
    setSpaceSwitcherSelectedIndex(Math.max(0, dataSource.searchSpaces("").findIndex((result) => result.space.key === activeSpaceKey())))
  }

  const closeSpaceSwitcher = () => {
    setSpaceSwitcherOpen(false)
    setSpaceSwitcherQuery("")
    setSpaceSwitcherSelectedIndex(0)
  }

  const openChanges = (focusChangeKey?: string) => {
    setPageSearchOpen(false)
    setNewPageOpen(false)
    setSpaceSwitcherOpen(false)

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
      setEditStatusMessage(`Staged delete for ${change.title}. Open Overview to apply/discard.`)
    } catch (error) {
      setEditStatusMessage(errorMessage(error))
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
    setSpaceSwitcherOpen(false)
    setChangesOpen(false)
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
      setEditStatusMessage(`Created local page ${change.title}. Press e to edit or c Overview to apply/discard.`)
    } catch (error) {
      setEditStatusMessage(errorMessage(error))
    }
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

  const scrollDocumentHorizontallyBy = (columns: number) => {
    documentScrollbox?.scrollBy({ x: columns, y: 0 })
    setFocusPane("document")
  }

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
      closeEditorImmediately(result === "staged" ? `Staged changes for ${editorPageTitle()}. Open Overview to review/apply/discard.` : `No buffer changes staged for ${editorPageTitle()}.`)
    } catch (error) {
      setEditStatusMessage(errorMessage(error))
    }
  }

  const closeEditor = () => {
    closeEditorImmediately(`Closed editor for ${editorPageTitle()}; staged changes were not changed.`)
  }

  const closeEditorImmediately = (message: string) => {
    clearEditorFocusTimer()
    setEditorOpen(false)
    setEditorInputFocused(false)
    setEditorPageId(null)
    setEditorPageTitle("")
    setEditorInitialMarkdown("")
    setEditorOriginalMarkdown("")
    setEditorMarkdown("")
    setEditStatusMessage(message)
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
    if (key.ctrl && key.name === "c") {
      renderer.destroy()
      return
    }

    if (changesOpen()) {
      if (key.name === "escape") closeChanges()
      else if (key.name === "j" || key.name === "down") moveChangesSelection(1)
      else if (key.name === "k" || key.name === "up") moveChangesSelection(-1)
      else if (key.sequence === " ") toggleSelectedChange()
      else if (isPlainKey(key, "a")) applySelectedChanges()
      else if (isPlainKey(key, "d")) discardSelectedChanges()
      return
    }

    if (newPageOpen()) {
      const action = pageSearchKeyAction(key)

      if (action === "close") closeNewPage()
      else if (action === "submit") submitNewPage()
      else if (action === "delete") setNewPageTitle((title) => title.slice(0, -1))
      else if (action === "append") setNewPageTitle((title) => title + key.sequence)
      return
    }

    if (editorOpen()) {
      if (key.name === "escape") closeEditor()
      else if (key.ctrl && key.name === "t") stageEditorBuffer()
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

    if (isPlainKey(key, "c")) {
      openChanges()
      return
    }

    if (nextPageViewModeForKey(pageViewMode(), key)) {
      togglePageView()
      return
    }

    if (isPlainKey(key, "e")) {
      openEditorForSelectedPage()
      return
    }

    if (isPlainKey(key, "D")) {
      stageDeleteSelectedPage()
      return
    }

    if (focusPane() === "navigator" && isPlainKey(key, "N")) {
      openRootNewPage()
      return
    }

    if (focusPane() === "navigator" && isPlainKey(key, "n")) {
      openNewPage()
      return
    }

    if (isTabKey(key) || isShiftTabKey(key)) {
      setFocusPane(nextFocusPaneForKey(focusPane(), key))
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
      if (key.name === "return") setFocusPane(nextFocusPaneForKey(focusPane(), key))
      return
    }

    if (focusPane() === "document") {
      const horizontalDelta = documentHorizontalScrollDeltaForKey(key)

      if (key.name === "j" || key.name === "down") scrollDocumentBy(1)
      if (key.name === "k" || key.name === "up") scrollDocumentBy(-1)
      if (horizontalDelta !== 0) scrollDocumentHorizontallyBy(horizontalDelta)
      return
    }
  }

  useKeyboard(handleKeyPress)

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={theme.bg}>
      <Header page={readerPage()} spaceName={space().name} syncState={space().syncState} draftStatus={draftStatus()} stagedCount={stagedChanges().length} onOpenOverview={() => openChanges()} />
      <Show when={credentialWarning()} fallback={<box height={0} />}>{(status) => <CredentialNotice status={status()} />}</Show>
      <box flexGrow={1} minHeight={0} flexDirection={isNarrow() ? "column" : "row"} paddingX={1}>
        <Navigator rows={treeRows()} selectedPageId={selectedPageId()} focused={focusPane() === "navigator"} viewMode={pageViewMode()} onSetViewMode={switchPageView} />
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
        activeSpaceName={space().name}
        viewMode={pageViewMode()}
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

function Header(props: { page: ReaderPage; spaceName: string; syncState: string; draftStatus: PageDraftStatus | null; stagedCount: number; onOpenOverview: () => void }) {
  const syncColor = () => (props.syncState === "fresh" ? theme.good : props.syncState === "stale" ? theme.warn : theme.danger)
  const statusColor = () => (props.draftStatus === "staged" ? theme.good : props.draftStatus === "draft" ? theme.warn : syncColor())
  const statusText = () => props.draftStatus ? `${props.draftStatus} · ${props.syncState}` : props.syncState

  return (
    <box height={6} border borderStyle="single" borderColor={theme.border} paddingX={1} flexDirection="column">
      <box height={1} flexDirection="row" justifyContent="space-between" width="100%">
        <text height={1} fg={theme.text} attributes={1}>{props.page.title}</text>
        <box height={1} flexDirection="row" gap={2}>
          <box height={1} width={Math.max(12, `Overview ${props.stagedCount}`.length + 2)} onMouseDown={props.onOpenOverview}>
            <text height={1} fg={theme.accent}>Overview {props.stagedCount}</text>
          </box>
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
      <text height={1} fg={props.focused ? theme.accent : theme.muted} attributes={1}>NAVIGATOR</text>
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
          <Show when={isArchivedPage(props.page)} fallback={<box height={0} />}>
            <text height={1} fg={theme.warn}>Archived in Confluence · read-only</text>
          </Show>
          <box height={1} />
          <scrollbox id="document-scrollbox" ref={props.setDocumentScrollbox} flexGrow={1} minHeight={0} scrollX scrollbarOptions={{ showArrows: false }} horizontalScrollbarOptions={{ showArrows: false }}>
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
    if (props.editorOpen) return "Ctrl+T stage | Esc close without changing staged docs"
    if (props.focusPane === "document") return "/ search | s spaces | a archived | c overview | e edit | D delete | Tab panes | j/k scroll | h/l wide | d/u page | q quit"
    return "/ search | s spaces | a archived | c overview | Tab panes | n child | N root | e edit | D delete | j/k move | h/l fold | q quit"
  }
  const status = () => {
    if (props.editorOpen) return props.editMessage || `editing transient buffer: ${props.editorDirty ? "modified" : "unchanged"}`
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
        <text height={1} fg={theme.accent} attributes={1}>EDITOR</text>
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
        <text height={1} fg={theme.warn} attributes={1}>OVERVIEW</text>
        <text height={1} fg={theme.muted}>{props.activeSpaceName}</text>
      </box>
      <text height={1} fg={theme.subtle}>{props.applying ? "Applying selected staged changes..." : "space select  a apply selected  d discard selected  esc close"}</text>
      <text height={1} fg={reviewMessageColor(props.message)}>{props.message || `${selectedCount()} of ${props.changes.length} staged change${props.changes.length === 1 ? "" : "s"} selected.`}</text>
      <box flexGrow={1} minHeight={0} flexDirection="row" gap={1}>
        <box width={listWidth()} minWidth={24} height="100%" border borderStyle="single" borderColor={theme.border} paddingX={1} flexDirection="column">
          <text height={1} fg={theme.muted} attributes={1}>PAGES</text>
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
        <text height={1} fg={theme.accent} attributes={1}>NEW PAGE</text>
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

function PageSearchOverlay(props: { visible: boolean; query: string; results: SearchResult[]; selectedIndex: number; activeSpaceName: string; viewMode: PageViewMode; left: number; width: number; height: number }) {
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
        <text height={1} fg={theme.muted}>{props.activeSpaceName} · {props.viewMode}</text>
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
  if (key.name === "return" || key.name === "enter") return "submit"
  if (key.name === "backspace") return "delete"
  if (isSearchCharacter(key)) return "append"
  if (key.name === "down" || (key.ctrl && (key.name === "j" || key.name === "n"))) return "next"
  if (key.name === "up" || (key.ctrl && (key.name === "k" || key.name === "p"))) return "previous"
  return "ignore"
}

export function nextFocusPaneForKey(current: FocusPane, key: SearchKeyLike): FocusPane {
  if (isShiftTabKey(key) || isTabKey(key)) return current === "navigator" ? "document" : "navigator"
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

function isSearchCharacter(key: SearchKeyLike) {
  if (key.ctrl || key.meta) return false
  if (["return", "tab", "escape", "backspace"].includes(key.name)) return false
  if (key.sequence === "\t" || key.sequence === "\x1B[Z") return false
  return key.sequence.length === 1 && key.sequence >= " "
}

function isPlainKey(key: SearchKeyLike, value: string) {
  return !key.ctrl && !key.meta && (key.name === value || key.sequence === value)
}

function isTabKey(key: SearchKeyLike) {
  return key.name === "tab" || key.sequence === "\t"
}

function isShiftTabKey(key: SearchKeyLike) {
  return (isTabKey(key) && key.shift) || key.name === "backtab" || key.name === "shift-tab" || key.sequence === "\x1B[Z"
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

function relatedItems(page: ReaderPage) {
  return [
    ...page.children.map((child) => `child: ${child.title}`),
    ...page.outgoingLinks.map((link) => `${link.kind === "internal" ? "->" : "external"} ${link.title}`),
    ...page.backlinks.map((link) => `<- ${link.title}`),
  ]
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
