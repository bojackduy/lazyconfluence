import { render, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import type { ScrollBoxRenderable } from "@opentui/core"
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import type { IndexedPage, ReaderPage, SearchResult, SpaceSearchResult } from "../model"
import { loadCredentialStatus, type CredentialStatus } from "../config"
import { getDefaultPageId, getPagesForSpace, getReaderPage, mockSpaces, searchPagesInSpace, searchSpaces } from "../mock-data"
import { markdownStyle, theme } from "./theme"

type TreeRow = {
  page: IndexedPage
  depth: number
  hasChildren: boolean
  expanded: boolean
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

export function App(props: { credentialStatus?: CredentialStatus } = {}) {
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const [credentialStatus, setCredentialStatus] = createSignal<CredentialStatus | null>(props.credentialStatus ?? null)
  const [activeSpaceKey, setActiveSpaceKey] = createSignal("ENG")
  const [selectedPageId, setSelectedPageId] = createSignal(getDefaultPageId())
  const [expandedPageIds, setExpandedPageIds] = createSignal(new Set([getDefaultPageId()]))
  const [focusPane, setFocusPane] = createSignal<"navigator" | "document">("navigator")
  const [pageSearchOpen, setPageSearchOpen] = createSignal(false)
  const [pageSearchQuery, setPageSearchQuery] = createSignal("")
  const [pageSearchSelectedIndex, setPageSearchSelectedIndex] = createSignal(0)
  const [spaceSwitcherOpen, setSpaceSwitcherOpen] = createSignal(false)
  const [spaceSwitcherQuery, setSpaceSwitcherQuery] = createSignal("")
  const [spaceSwitcherSelectedIndex, setSpaceSwitcherSelectedIndex] = createSignal(0)
  let documentScrollbox: ScrollBoxRenderable | undefined

  const space = createMemo(() => mockSpaces.find((candidate) => candidate.key === activeSpaceKey()) ?? mockSpaces[0])
  const pages = createMemo(() => getPagesForSpace(activeSpaceKey()))
  const pageById = createMemo(() => new Map(pages().map((page) => [page.pageId, page])))
  const treeRows = createMemo(() => buildTreeRows(pages(), expandedPageIds()))
  const selectedIndex = createMemo(() => treeRows().findIndex((row) => row.page.pageId === selectedPageId()))
  const selectedRow = createMemo(() => treeRows().find((row) => row.page.pageId === selectedPageId()))
  const readerPage = createMemo(() => getReaderPage(selectedPageId()))
  const pageSearchResults = createMemo(() => searchPagesInSpace(activeSpaceKey(), pageSearchQuery()))
  const spaceSwitcherResults = createMemo(() => searchSpaces(spaceSwitcherQuery()))
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
    setSpaceSwitcherSelectedIndex(Math.max(0, searchSpaces("").findIndex((result) => result.space.key === activeSpaceKey())))
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

    const defaultPageId = getDefaultPageId(result.space.key)
    setActiveSpaceKey(result.space.key)
    setSelectedPageId(defaultPageId)
    setExpandedPageIds(new Set([defaultPageId]))
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
      <Header page={readerPage()} spaceName={space().name} syncState={space().syncState} />
      <Show when={credentialWarning()}>{(status) => <CredentialNotice status={status()} />}</Show>
      <box flexGrow={1} minHeight={0} flexDirection={isNarrow() ? "column" : "row"} paddingX={1}>
        <Navigator rows={treeRows()} selectedPageId={selectedPageId()} focused={focusPane() === "navigator"} />
        <Reader page={readerPage()} focused={focusPane() === "document"} narrow={isNarrow()} setDocumentScrollbox={(scrollbox) => { documentScrollbox = scrollbox }} />
      </box>
      <StatusBar focusPane={focusPane()} />
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

function Header(props: { page: ReaderPage; spaceName: string; syncState: string }) {
  const syncColor = () => (props.syncState === "fresh" ? theme.good : props.syncState === "stale" ? theme.warn : theme.danger)

  return (
    <box height={5} border borderStyle="single" borderColor={theme.border} paddingX={1} flexDirection="column">
      <box height={1} flexDirection="row" justifyContent="space-between" width="100%">
        <text height={1} fg={theme.text} attributes={1}>{props.page.title}</text>
        <text height={1} fg={syncColor()}>{props.syncState}</text>
      </box>
      <text height={1} fg={theme.muted}>{props.spaceName} / {props.page.path.join(" / ")}</text>
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

  return (
    <box height={1} width="100%" backgroundColor={props.selected ? theme.accentSoft : undefined} paddingLeft={0} paddingRight={1}>
      <text height={1} fg={props.selected ? theme.text : theme.muted}>{prefix()}{props.row.page.title}</text>
    </box>
  )
}

function Reader(props: { page: ReaderPage; focused: boolean; narrow: boolean; setDocumentScrollbox: (scrollbox: ScrollBoxRenderable) => void }) {
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
              width="100%"
              tableOptions={{ style: "grid", widthMode: "full", wrapMode: "word", borderStyle: "rounded", borderColor: theme.border }}
            />
          </scrollbox>
        </box>
        <SideRail page={props.page} narrow={props.narrow} />
      </box>
    </box>
  )
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

function StatusBar(props: { focusPane: string }) {
  const hint = () => {
    if (props.focusPane === "document") return "/ page search | s spaces | j/k scroll line | d/u scroll doc | h navigator | q quit"
    return "/ page search | s spaces | j/k move | h/l fold tree | d/u scroll doc | q quit"
  }

  return (
    <box height={1} backgroundColor={theme.accentSoft} paddingX={1} flexDirection="row" justifyContent="space-between">
      <text height={1} fg={theme.text}>focus: {props.focusPane}</text>
      <text height={1} fg={theme.muted}>{hint()}</text>
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

  for (const page of pages) {
    const siblings = byParent.get(page.parentId) ?? []
    siblings.push(page)
    byParent.set(page.parentId, siblings)
  }

  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => a.title.localeCompare(b.title))
  }

  const rows: TreeRow[] = []
  const visit = (parentId: string | null, depth: number) => {
    for (const page of byParent.get(parentId) ?? []) {
      const hasChildren = (byParent.get(page.pageId)?.length ?? 0) > 0
      const expanded = hasChildren && expandedPageIds.has(page.pageId)

      rows.push({ page, depth, hasChildren, expanded })
      if (expanded) visit(page.pageId, depth + 1)
    }
  }

  visit(null, 0)
  return rows
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

function relatedItems(page: ReaderPage) {
  return [
    ...page.children.map((child) => `child: ${child.title}`),
    ...page.outgoingLinks.map((link) => `${link.kind === "internal" ? "->" : "external"} ${link.title}`),
    ...page.backlinks.map((link) => `<- ${link.title}`),
  ]
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "2-digit", year: "numeric" }).format(new Date(value))
}

function formatOptionalDate(value: string | null) {
  return value ? formatDate(value) : "never"
}
