import { describe, expect, test } from "bun:test"
import { commandForId, tuiCommands } from "../src/tui/commands"
import { resolveKeyCommand, textInputKeyAction, type TuiKey } from "../src/tui/keymap"

const key = (name: string, sequence = name, overrides: Partial<TuiKey> = {}): TuiKey => ({ name, sequence, ctrl: false, meta: false, ...overrides })

describe("TUI command registry", () => {
  test("documents the product keyboard intents", () => {
    const commandIds = tuiCommands.map((command) => command.id)

    expect(commandIds).toEqual(expect.arrayContaining([
      "quit",
      "show-help",
      "open-page-search",
      "open-all-space-search",
      "open-document-find",
      "open-space-switcher",
      "open-command-palette",
      "activate",
      "open-browser",
      "refresh",
      "move-left",
      "move-down",
      "move-up",
      "move-right",
      "go-back",
      "focus-next-pane",
      "close-overlay",
    ]))
  })

  test("marks implemented commands available and keeps future commands visible", () => {
    expect(commandForId("open-document-find")).toMatchObject({ available: true })
    expect(commandForId("open-command-palette")).toMatchObject({ available: true })
    expect(commandForId("open-browser")).toMatchObject({ available: true })
    expect(commandForId("go-back")).toMatchObject({ available: true })
    expect(commandForId("refresh")).toMatchObject({ available: true, label: "Reload current page" })
  })
})

describe("context-aware key resolution", () => {
  test("resolves main reader commands", () => {
    expect(resolveKeyCommand(key("?"), "navigator")).toBe("show-help")
    expect(resolveKeyCommand(key("/"), "document")).toBe("open-page-search")
    expect(resolveKeyCommand(key("S"), "document")).toBe("open-all-space-search")
    expect(resolveKeyCommand(key("s"), "navigator")).toBe("open-space-switcher")
    expect(resolveKeyCommand(key("p"), "document")).toBe("open-command-palette")
    expect(resolveKeyCommand(key(";"), "document")).toBe("open-command-palette")
    expect(resolveKeyCommand(key(":"), "document")).toBe("open-command-palette")
    expect(resolveKeyCommand(key("f"), "document")).toBe("open-document-find")
    expect(resolveKeyCommand(key("o"), "navigator")).toBe("open-browser")
    expect(resolveKeyCommand(key("r"), "navigator")).toBe("refresh")
    expect(resolveKeyCommand(key("escape", "\u001b"), "document")).toBe("go-back")
    expect(resolveKeyCommand(key("b"), "document")).toBeNull()
    expect(resolveKeyCommand(key("q"), "document")).toBe("quit")
  })

  test("maps pane-specific lazy navigation and aliases", () => {
    expect(resolveKeyCommand(key("j"), "navigator")).toBe("move-down")
    expect(resolveKeyCommand(key("up", "\u001b[A"), "document")).toBe("move-up")
    expect(resolveKeyCommand(key("l"), "navigator")).toBe("focus-next-pane")
    expect(resolveKeyCommand(key("h"), "navigator")).toBe("focus-previous-pane")
    expect(resolveKeyCommand(key("right", "\u001b[C"), "document")).toBe("move-right")
    expect(resolveKeyCommand(key("return", "\r"), "navigator")).toBe("activate")
    expect(resolveKeyCommand(key("tab", "\t"), "document")).toBe("focus-next-pane")
    expect(resolveKeyCommand(key("tab", "\x1b[Z", { shift: true }), "document")).toBe("focus-previous-pane")
  })

  test("keeps text overlays safe for typing", () => {
    expect(textInputKeyAction(key("j"))).toBe("append")
    expect(textInputKeyAction(key("k"))).toBe("append")
    expect(textInputKeyAction(key("down", "\u001b[B"))).toBe("next")
    expect(textInputKeyAction(key("p", "p", { ctrl: true }))).toBe("previous")
    expect(resolveKeyCommand(key("j"), "page-search")).toBeNull()
    expect(resolveKeyCommand(key("escape", "\u001b"), "space-switcher")).toBe("close-overlay")
  })

  test("routes document find navigation without reserving printable text", () => {
    expect(resolveKeyCommand(key("return", "\r"), "document-find")).toBe("search-next")
    expect(resolveKeyCommand(key("return", "\r", { shift: true }), "document-find")).toBe("search-previous")
    expect(resolveKeyCommand(key("n"), "document-find")).toBeNull()
    expect(resolveKeyCommand(key("n", "n", { ctrl: true }), "document-find")).toBe("search-next")
    expect(resolveKeyCommand(key("p", "p", { ctrl: true }), "document-find")).toBe("search-previous")
  })

  test("routes command palette controls without reserving printable text", () => {
    expect(resolveKeyCommand(key("return", "\r"), "command-palette")).toBe("search-submit")
    expect(resolveKeyCommand(key("down", "\u001b[B"), "command-palette")).toBe("search-next")
    expect(resolveKeyCommand(key("p"), "command-palette")).toBeNull()
    expect(resolveKeyCommand(key("p", "p", { ctrl: true }), "command-palette")).toBe("search-previous")
    expect(resolveKeyCommand(key("escape", "\u001b"), "command-palette")).toBe("close-overlay")
  })

  test("gives each overlay predictable close and movement commands", () => {
    expect(resolveKeyCommand(key("q"), "help")).toBe("close-overlay")
    expect(resolveKeyCommand(key("j"), "help")).toBe("move-down")
    expect(resolveKeyCommand(key("up", "\u001b[A"), "help")).toBe("move-up")
    expect(resolveKeyCommand(key("d"), "help")).toBe("page-down")
    expect(resolveKeyCommand(key("u"), "help")).toBe("page-up")
    expect(resolveKeyCommand(key("right", "\u001b[C"), "image-viewer")).toBe("next-image")
    expect(resolveKeyCommand(key("h"), "image-viewer")).toBe("previous-image")
    expect(resolveKeyCommand(key("escape", "\u001b"), "image-viewer")).toBe("close-overlay")
    expect(resolveKeyCommand(key(" ", " "), "changes")).toBe("toggle-change")
    expect(resolveKeyCommand(key("t", "t", { ctrl: true }), "editor")).toBe("stage-editor")
  })
})
