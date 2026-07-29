import type { CommandContext, CommandId } from "./commands"

export type TuiKey = {
  name: string
  sequence: string
  ctrl: boolean
  meta: boolean
  shift?: boolean
}

export type TextInputAction = "append" | "delete" | "submit" | "close" | "next" | "previous" | "ignore"

export function resolveKeyCommand(key: TuiKey, context: CommandContext): CommandId | null {
  if (key.ctrl && key.name === "c") return "quit"

  if (context === "help") {
    if (key.name === "escape" || isPlainKey(key, "q") || isPlainKey(key, "?")) return "close-overlay"
    if (matchesAny(key, ["j", "down"])) return "move-down"
    if (matchesAny(key, ["k", "up"])) return "move-up"
    if (key.name === "d") return "page-down"
    if (key.name === "u") return "page-up"
    return null
  }
  if (context === "image-viewer") {
    if (key.name === "escape" || isPlainKey(key, "q")) return "close-overlay"
    if (matchesAny(key, ["j", "down", "l", "right"])) return "next-image"
    if (matchesAny(key, ["k", "up", "h", "left"])) return "previous-image"
    return null
  }
  if (context === "changes") {
    if (key.name === "escape") return "close-overlay"
    if (matchesAny(key, ["j", "down"])) return "move-down"
    if (matchesAny(key, ["k", "up"])) return "move-up"
    if (key.sequence === " ") return "toggle-change"
    if (isPlainKey(key, "a")) return "apply-changes"
    if (isPlainKey(key, "d")) return "discard-changes"
    return null
  }
  if (context === "editor") {
    if (key.name === "escape") return "close-overlay"
    return key.ctrl && key.name === "t" ? "stage-editor" : null
  }
  if (context === "document-find") {
    if (key.name === "escape") return "close-overlay"
    if (key.name === "return" || key.name === "enter") return key.shift ? "search-previous" : "search-next"
    if (key.name === "backspace") return "input-delete"
    if (key.name === "down" || (key.ctrl && (key.name === "j" || key.name === "n"))) return "search-next"
    if (key.name === "up" || (key.ctrl && (key.name === "k" || key.name === "p"))) return "search-previous"
    return null
  }
  if (context === "command-palette") {
    if (key.name === "escape") return "close-overlay"
    if (key.name === "return" || key.name === "enter") return "search-submit"
    if (key.name === "backspace") return "input-delete"
    if (key.name === "down" || (key.ctrl && (key.name === "j" || key.name === "n"))) return "search-next"
    if (key.name === "up" || (key.ctrl && (key.name === "k" || key.name === "p"))) return "search-previous"
    return null
  }
  if (context === "page-search" || context === "space-switcher" || context === "new-page") return textInputCommand(key)

  if (key.name === "escape") return "go-back"
  if (key.name === "q") return "quit"
  if (isPlainKey(key, "?")) return "show-help"
  if (isPlainKey(key, "p")) return "open-command-palette"
  if (key.name === ";" || key.name === ":") return "open-command-palette"
  if (key.name === "/") return "open-page-search"
  if (isPlainKey(key, "S")) return "open-all-space-search"
  if (isPlainKey(key, "f")) return "open-document-find"
  if (isPlainKey(key, "s")) return "open-space-switcher"
  if (isPlainKey(key, "o")) return "open-browser"
  if (isPlainKey(key, "r")) return "refresh"
  if (isPlainKey(key, "c")) return "open-overview"
  if (isPlainKey(key, "a")) return "toggle-page-view"
  if (isPlainKey(key, "e")) return "edit-page"
  if (isPlainKey(key, "i")) return "open-image-viewer"
  if (isPlainKey(key, "D")) return "stage-delete"
  if (isShiftTabKey(key)) return "focus-previous-pane"
  if (isTabKey(key)) return "focus-next-pane"
  if (key.name === "d") return "page-down"
  if (key.name === "u") return "page-up"

  if (context === "navigator") {
    if (isPlainKey(key, "N")) return "create-root-page"
    if (isPlainKey(key, "n")) return "create-child-page"
    if (matchesAny(key, ["j", "down"])) return "move-down"
    if (matchesAny(key, ["k", "up"])) return "move-up"
    if (matchesAny(key, ["l", "right"])) return "move-right"
    if (matchesAny(key, ["h", "left"])) return "move-left"
    if (key.name === "return") return "activate"
  }

  if (context === "outline" || context === "related") {
    if (matchesAny(key, ["j", "down"])) return "move-down"
    if (matchesAny(key, ["k", "up"])) return "move-up"
    if (matchesAny(key, ["l", "right"])) return "move-right"
    if (matchesAny(key, ["h", "left"])) return "move-left"
    if (key.name === "return") return "activate"
  }

  if (context === "document") {
    if (matchesAny(key, ["j", "down"])) return "move-down"
    if (matchesAny(key, ["k", "up"])) return "move-up"
    if (matchesAny(key, ["l", "right"])) return "move-right"
    if (matchesAny(key, ["h", "left"])) return "move-left"
  }

  return null
}

export function textInputKeyAction(key: TuiKey): TextInputAction {
  const command = textInputCommand(key)
  if (command === "close-overlay") return "close"
  if (command === "search-submit") return "submit"
  if (command === "input-delete") return "delete"
  if (command === "search-next") return "next"
  if (command === "search-previous") return "previous"
  return isTextCharacter(key) ? "append" : "ignore"
}

export function isPlainKey(key: TuiKey, value: string) {
  return !key.ctrl && !key.meta && (key.name === value || key.sequence === value)
}

export function isTabKey(key: TuiKey) {
  return key.name === "tab" || key.sequence === "\t"
}

export function isShiftTabKey(key: TuiKey) {
  return (isTabKey(key) && key.shift) || key.name === "backtab" || key.name === "shift-tab" || key.sequence === "\x1B[Z"
}

function textInputCommand(key: TuiKey): CommandId | null {
  if (key.name === "escape") return "close-overlay"
  if (key.name === "return" || key.name === "enter") return "search-submit"
  if (key.name === "backspace") return "input-delete"
  if (key.name === "down" || (key.ctrl && (key.name === "j" || key.name === "n"))) return "search-next"
  if (key.name === "up" || (key.ctrl && (key.name === "k" || key.name === "p"))) return "search-previous"
  return null
}

function matchesAny(key: TuiKey, names: string[]) {
  return names.some((name) => key.name === name)
}

function isTextCharacter(key: TuiKey) {
  if (key.ctrl || key.meta) return false
  if (["return", "tab", "escape", "backspace"].includes(key.name)) return false
  if (key.sequence === "\t" || key.sequence === "\x1B[Z") return false
  return key.sequence.length === 1 && key.sequence >= " "
}
