import { type InputRenderable, type KeyEvent, type ScrollBoxRenderable } from "@opentui/core"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { For, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import type { ConfluenceSpace, ConfluenceSpacePage } from "../confluence/client"
import { theme } from "./theme"

export type RemoteSpacePickerOptions = {
  configuredSpaceKeys: readonly string[]
  loadPage: (nextPath?: string | null) => Promise<ConfluenceSpacePage>
  saveSpaceKeys: (spaceKeys: string[]) => Promise<void>
  onClose?: () => void
  onComplete?: () => void
}

export function RemoteSpacePicker(props: RemoteSpacePickerOptions) {
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const [configuredKeys, setConfiguredKeys] = createSignal(new Set(props.configuredSpaceKeys))
  const [spaces, setSpaces] = createSignal<ConfluenceSpace[]>([])
  const [nextPath, setNextPath] = createSignal<string | null | undefined>(undefined)
  const [selectedKeys, setSelectedKeys] = createSignal(new Set<string>())
  const [selectedIndex, setSelectedIndex] = createSignal(0)
  const [query, setQuery] = createSignal("")
  const [searchOpen, setSearchOpen] = createSignal(false)
  const [loading, setLoading] = createSignal(false)
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal("")
  const [message, setMessage] = createSignal("")
  let input: InputRenderable | undefined
  let scrollbox: ScrollBoxRenderable | undefined

  const filteredSpaces = createMemo(() => filterRemoteSpaces(spaces(), query()))
  const selectedSpace = () => filteredSpaces()[selectedIndex()]
  const canLoadMore = () => nextPath() !== null && !loading()

  createEffect(() => {
    const space = selectedSpace()
    if (space) scrollbox?.scrollChildIntoView(remoteSpaceRowId(space.key))
  })

  onMount(() => {
    void loadNextPage()
    const handleKey = (key: KeyEvent) => {
      if (saving()) return

      if (key.name === "escape") {
        key.preventDefault()
        key.stopPropagation()
        if (searchOpen()) {
          setSearchOpen(false)
          input?.blur()
          return
        }
        props.onClose?.() ?? renderer.destroy()
        return
      }
      if (key.name === "q" && !searchOpen()) {
        key.preventDefault()
        key.stopPropagation()
        props.onClose?.() ?? renderer.destroy()
        return
      }
      if (key.name === "/") {
        key.preventDefault()
        key.stopPropagation()
        setSearchOpen(true)
        setTimeout(() => input?.focus(), 1)
        return
      }
      if ((!searchOpen() && key.name === "j") || key.name === "down") {
        key.preventDefault()
        key.stopPropagation()
        moveSelection(1)
        return
      }
      if ((!searchOpen() && key.name === "k") || key.name === "up") {
        key.preventDefault()
        key.stopPropagation()
        moveSelection(-1)
        return
      }
      if (key.name === "l" && key.shift) {
        key.preventDefault()
        key.stopPropagation()
        void loadNextPage()
        return
      }
      if (key.name === "space") {
        key.preventDefault()
        key.stopPropagation()
        toggleSelectedSpace()
        return
      }
      if (key.name === "return") {
        key.preventDefault()
        key.stopPropagation()
        void saveSelectedSpaces()
      }
    }

    renderer.keyInput.prependListener("keypress", handleKey)
    onCleanup(() => renderer.keyInput.off("keypress", handleKey))
  })

  async function loadNextPage() {
    if (!canLoadMore()) return

    setLoading(true)
    setError("")
    try {
      const page = await props.loadPage(nextPath())
      setSpaces((current) => mergeRemoteSpaces(current, page.spaces))
      setNextPath(page.nextPath)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load remote spaces.")
    } finally {
      setLoading(false)
    }
  }

  function moveSelection(delta: number) {
    const count = filteredSpaces().length
    if (!count) return
    setSelectedIndex((current) => (current + delta + count) % count)
  }

  function toggleSelectedSpace() {
    const space = selectedSpace()
    if (!space || configuredKeys().has(space.key)) return

    setSelectedKeys((current) => {
      const next = new Set(current)
      if (next.has(space.key)) next.delete(space.key)
      else next.add(space.key)
      return next
    })
  }

  async function saveSelectedSpaces() {
    const spaceKeys = [...selectedKeys()]
    if (!spaceKeys.length) return

    setSaving(true)
    setError("")
    try {
      await props.saveSpaceKeys(spaceKeys)
      setConfiguredKeys((current) => new Set([...current, ...spaceKeys]))
      setMessage(`Added ${spaceKeys.join(", ")} to local config. Run lazyconfluence sync to import them.`)
      setSelectedKeys(new Set<string>())
      props.onComplete?.()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save selected spaces.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <box position="absolute" left={0} top={0} zIndex={100} width="100%" height="100%" backgroundColor={theme.bg} alignItems="center" justifyContent="center">
      <box width={Math.min(92, Math.max(34, dimensions().width - 2))} height={Math.max(12, dimensions().height - 2)} border borderStyle="rounded" borderColor={theme.borderActive} backgroundColor={theme.panel} paddingX={2} paddingY={1} flexDirection="column">
        <box height={1} flexDirection="row" justifyContent="space-between">
          <text height={1} fg={theme.accent}><b>ADD CONFLUENCE SPACES</b></text>
          <text height={1} fg={theme.subtle}>{remotePageStatus(spaces().length, nextPath())}</text>
        </box>
        <text height={1} fg={theme.muted}>Remote discovery updates local config only. The reader stays local until an explicit sync.</text>
        <box height={1} flexDirection="row">
          <text height={1} fg={theme.accent}>/ </text>
          <input
            ref={(node: InputRenderable) => { input = node }}
            value={query()}
            onInput={(value) => {
              setQuery(value)
              setSelectedIndex(0)
            }}
            placeholder="filter loaded remote spaces"
            placeholderColor={theme.subtle}
            textColor={theme.text}
            focusedTextColor={theme.text}
            cursorColor={theme.accent}
            backgroundColor={theme.panel}
            focusedBackgroundColor={searchOpen() ? theme.accentSoft : theme.panel}
            flexGrow={1}
          />
        </box>
        {error() ? <text height={1} fg={theme.danger}>{error()}</text> : <box height={1} />}
        {message() ? <text height={1} fg={theme.good}>{message()}</text> : <box height={1} />}
        <scrollbox ref={(node: ScrollBoxRenderable) => { scrollbox = node }} flexGrow={1} minHeight={0} scrollbarOptions={{ showArrows: false }} viewportCulling>
          <box flexDirection="column" width="100%">
            <For each={filteredSpaces()} fallback={<text height={1} fg={theme.subtle}>{loading() ? "Loading remote spaces..." : query() ? "No loaded spaces match this filter." : "No remote spaces are available."}</text>}>
              {(space, index) => <RemoteSpaceRow space={space} selected={index() === selectedIndex()} configured={configuredKeys().has(space.key)} checked={selectedKeys().has(space.key)} />}
            </For>
          </box>
        </scrollbox>
        <text height={1} fg={theme.subtle}>{loading() ? "Loading remote spaces..." : canLoadMore() ? "Shift+L load next page" : "All remote pages loaded"}</text>
        <text height={1} fg={theme.muted}>j/k choose · Space mark · Enter add {selectedKeys().size || "selected"} · / filter · Esc close</text>
      </box>
    </box>
  )
}

function RemoteSpaceRow(props: { space: ConfluenceSpace; selected: boolean; configured: boolean; checked: boolean }) {
  const marker = () => props.configured ? "=" : props.checked ? "x" : " "
  const detail = () => props.configured ? "already configured" : props.space.id

  return (
    <box id={remoteSpaceRowId(props.space.key)} height={1} width="100%" backgroundColor={props.selected ? theme.accentSoft : undefined} paddingX={1}>
      <text height={1} fg={props.configured ? theme.subtle : props.selected ? theme.text : theme.muted}>{props.selected ? ">" : " "} [{marker()}] {props.space.key}  {props.space.name} · {detail()}</text>
    </box>
  )
}

export function filterRemoteSpaces(spaces: readonly ConfluenceSpace[], query: string) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return [...spaces]

  return spaces.filter((space) => {
    const text = `${space.key} ${space.name}`.toLowerCase()
    return terms.every((term) => text.includes(term))
  })
}

export function mergeRemoteSpaces(existing: readonly ConfluenceSpace[], incoming: readonly ConfluenceSpace[]) {
  const seen = new Set(existing.map((space) => space.key))
  const merged = [...existing]

  for (const space of incoming) {
    if (seen.has(space.key)) continue
    seen.add(space.key)
    merged.push(space)
  }

  return merged
}

export function remotePageStatus(loadedCount: number, nextPath: string | null | undefined) {
  if (nextPath === undefined) return "loading first page"
  return nextPath ? `${loadedCount} loaded · more available` : `${loadedCount} loaded · complete`
}

function remoteSpaceRowId(spaceKey: string) {
  return `remote-space-${spaceKey}`
}
