import { render, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { For, Show, createMemo, createSignal } from "solid-js"
import type { IndexedPage, ReaderPage } from "../model"
import { getDefaultPageId, getPagesForSpace, getReaderPage, mockSpaces } from "../mock-data"
import { markdownStyle, theme } from "./theme"

type TreeRow = {
  page: IndexedPage
  depth: number
}

export async function renderTui() {
  render(() => <App />, {
    targetFps: 30,
    exitOnCtrlC: true,
    backgroundColor: theme.bg,
    consoleMode: "disabled",
  })
}

export function App() {
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const [activeSpaceKey] = createSignal("ENG")
  const [selectedPageId, setSelectedPageId] = createSignal(getDefaultPageId())
  const [focusPane, setFocusPane] = createSignal<"navigator" | "document">("navigator")

  const space = createMemo(() => mockSpaces.find((candidate) => candidate.key === activeSpaceKey()) ?? mockSpaces[0])
  const pages = createMemo(() => getPagesForSpace(activeSpaceKey()))
  const treeRows = createMemo(() => buildTreeRows(pages()))
  const selectedIndex = createMemo(() => treeRows().findIndex((row) => row.page.pageId === selectedPageId()))
  const readerPage = createMemo(() => getReaderPage(selectedPageId()))
  const isNarrow = createMemo(() => dimensions().width < 96)

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      renderer.destroy()
      return
    }

    if (key.name === "q" || key.name === "escape") {
      renderer.destroy()
      return
    }

    if (key.name === "tab") {
      setFocusPane((pane) => (pane === "navigator" ? "document" : "navigator"))
      return
    }

    if (focusPane() === "navigator") {
      if (key.name === "j" || key.name === "down") moveSelection(1, treeRows(), selectedIndex(), setSelectedPageId)
      if (key.name === "k" || key.name === "up") moveSelection(-1, treeRows(), selectedIndex(), setSelectedPageId)
      if (key.name === "l" || key.name === "right" || key.name === "return") setFocusPane("document")
      return
    }

    if (key.name === "h" || key.name === "left") setFocusPane("navigator")
  })

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={theme.bg}>
      <Header page={readerPage()} spaceName={space().name} syncState={space().syncState} />
      <box flexGrow={1} minHeight={0} flexDirection={isNarrow() ? "column" : "row"} paddingX={1}>
        <Navigator rows={treeRows()} selectedPageId={selectedPageId()} focused={focusPane() === "navigator"} />
        <Reader page={readerPage()} focused={focusPane() === "document"} narrow={isNarrow()} />
      </box>
      <StatusBar focusPane={focusPane()} />
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
      <text height={1} fg={theme.subtle}>j/k move  tab focus  enter read</text>
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
  const prefix = () => `${"  ".repeat(props.row.depth)}${props.selected ? ">" : " "} `

  return (
    <box height={1} width="100%" backgroundColor={props.selected ? theme.accentSoft : undefined} paddingLeft={0} paddingRight={1}>
      <text height={1} fg={props.selected ? theme.text : theme.muted}>{prefix()}{props.row.page.title}</text>
    </box>
  )
}

function Reader(props: { page: ReaderPage; focused: boolean; narrow: boolean }) {
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
          <scrollbox flexGrow={1} minHeight={0} scrollbarOptions={{ showArrows: false }}>
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
  return (
    <box height={1} backgroundColor={theme.accentSoft} paddingX={1} flexDirection="row" justifyContent="space-between">
      <text height={1} fg={theme.text}>focus: {props.focusPane}</text>
      <text height={1} fg={theme.muted}>j/k move | tab switch pane | h/l focus | q quit | mock data</text>
    </box>
  )
}

function buildTreeRows(pages: IndexedPage[]) {
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
      rows.push({ page, depth })
      visit(page.pageId, depth + 1)
    }
  }

  visit(null, 0)
  return rows
}

function moveSelection(direction: number, rows: TreeRow[], selectedIndex: number, setSelectedPageId: (pageId: string) => void) {
  const nextIndex = Math.max(0, Math.min(rows.length - 1, selectedIndex + direction))
  const nextRow = rows[nextIndex]

  if (nextRow) setSelectedPageId(nextRow.page.pageId)
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
