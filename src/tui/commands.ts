export type CommandContext = "main" | "navigator" | "document" | "page-search" | "space-switcher" | "new-page" | "editor" | "changes" | "image-viewer" | "help"

export type CommandGroup = "Global" | "Navigation" | "Reader" | "Editing" | "Images"

export type CommandId =
  | "quit"
  | "show-help"
  | "open-command-palette"
  | "open-page-search"
  | "open-document-find"
  | "open-space-switcher"
  | "open-browser"
  | "refresh"
  | "go-back"
  | "focus-next-pane"
  | "focus-previous-pane"
  | "move-down"
  | "move-up"
  | "move-left"
  | "move-right"
  | "activate"
  | "open-overview"
  | "toggle-page-view"
  | "edit-page"
  | "open-image-viewer"
  | "create-child-page"
  | "create-root-page"
  | "stage-delete"
  | "page-down"
  | "page-up"
  | "close-overlay"
  | "search-next"
  | "search-previous"
  | "search-submit"
  | "input-delete"
  | "stage-editor"
  | "toggle-change"
  | "apply-changes"
  | "discard-changes"
  | "next-image"
  | "previous-image"

export type TuiCommand = {
  id: CommandId
  label: string
  description: string
  keys: string
  group: CommandGroup
  contexts: readonly CommandContext[]
  available: boolean
  unavailableReason?: string
}

export const tuiCommands: readonly TuiCommand[] = [
  command("quit", "Quit", "Exit lazyconfluence.", "q · Esc", "Global", ["main"], true),
  command("show-help", "Help", "Show available keyboard commands.", "?", "Global", ["main", "help"], true),
  command("open-command-palette", "Command palette", "Search and run actions.", "p", "Global", ["main"], false, "Command palette is not implemented yet."),
  command("open-page-search", "Page search", "Search pages in the active space.", "/", "Global", ["main"], true),
  command("open-document-find", "Find in document", "Find text in the current document.", "f", "Global", ["main"], false, "Document find is not implemented yet."),
  command("open-space-switcher", "Switch space", "Choose another locally indexed space.", "s", "Global", ["main"], true),
  command("open-browser", "Open in browser", "Open the selected Confluence page in your browser.", "o", "Global", ["main"], false, "Browser open is not implemented yet."),
  command("refresh", "Refresh", "Sync configured spaces from Confluence.", "r", "Global", ["main"], false, "Sync runs explicitly from the CLI today."),
  command("go-back", "Go back", "Return to the previous page in navigation history.", "b", "Navigation", ["main"], false, "Navigation history is not implemented yet."),
  command("focus-next-pane", "Next pane", "Move focus between navigator and document.", "Tab", "Navigation", ["main", "navigator", "document"], true),
  command("focus-previous-pane", "Previous pane", "Move focus to the previous pane.", "Shift+Tab", "Navigation", ["main", "navigator", "document"], true),
  command("move-down", "Move down", "Move selection or scroll down.", "j · Down", "Navigation", ["navigator", "document", "changes", "image-viewer", "help"], true),
  command("move-up", "Move up", "Move selection or scroll up.", "k · Up", "Navigation", ["navigator", "document", "changes", "image-viewer", "help"], true),
  command("move-left", "Move left", "Collapse a page or scroll document left.", "h · Left", "Navigation", ["navigator", "document"], true),
  command("move-right", "Move right", "Expand a page or scroll document right.", "l · Right", "Navigation", ["navigator", "document"], true),
  command("activate", "Activate", "Open the selected item or switch focus.", "Enter", "Navigation", ["navigator", "page-search", "space-switcher", "new-page"], true),
  command("open-overview", "Overview", "Review staged local changes.", "c", "Editing", ["main"], true),
  command("toggle-page-view", "Current / archived", "Switch navigator content status.", "a", "Reader", ["main"], true),
  command("edit-page", "Edit page", "Edit the selected local page draft.", "e", "Editing", ["main"], true),
  command("open-image-viewer", "Image viewer", "Open cached document images.", "i", "Images", ["main"], true),
  command("create-child-page", "New child page", "Stage a new child page.", "n", "Editing", ["navigator"], true),
  command("create-root-page", "New root page", "Stage a new root page.", "N", "Editing", ["navigator"], true),
  command("stage-delete", "Delete page", "Stage deletion of the selected leaf page.", "D", "Editing", ["main"], true),
  command("page-down", "Half page down", "Scroll by one viewport.", "d", "Reader", ["main", "document", "help"], true),
  command("page-up", "Half page up", "Scroll by one viewport.", "u", "Reader", ["main", "document", "help"], true),
  command("close-overlay", "Close", "Close the active overlay without applying changes.", "Esc · q", "Global", ["page-search", "space-switcher", "new-page", "editor", "changes", "image-viewer", "help"], true),
  command("search-next", "Next result", "Select the next result.", "Down · Ctrl+N", "Navigation", ["page-search", "space-switcher"], true),
  command("search-previous", "Previous result", "Select the previous result.", "Up · Ctrl+P", "Navigation", ["page-search", "space-switcher"], true),
  command("search-submit", "Open result", "Open the selected search result.", "Enter", "Navigation", ["page-search", "space-switcher"], true),
  command("input-delete", "Delete character", "Delete the previous input character.", "Backspace", "Editing", ["page-search", "space-switcher", "new-page"], true),
  command("stage-editor", "Stage editor", "Stage the current editor buffer.", "Ctrl+T", "Editing", ["editor"], true),
  command("toggle-change", "Toggle change", "Select or clear the highlighted staged change.", "Space", "Editing", ["changes"], true),
  command("apply-changes", "Apply changes", "Apply selected staged changes to Confluence.", "a", "Editing", ["changes"], true),
  command("discard-changes", "Discard changes", "Discard selected staged changes.", "d", "Editing", ["changes"], true),
  command("next-image", "Next image", "Show the next document image.", "j · l · Down · Right", "Images", ["image-viewer"], true),
  command("previous-image", "Previous image", "Show the previous document image.", "k · h · Up · Left", "Images", ["image-viewer"], true),
]

export function commandsForContext(contexts: readonly CommandContext[]) {
  return tuiCommands.filter((command) => command.contexts.some((context) => contexts.includes(context)))
}

export function commandForId(id: CommandId) {
  return tuiCommands.find((command) => command.id === id)
}

function command(id: CommandId, label: string, description: string, keys: string, group: CommandGroup, contexts: readonly CommandContext[], available: boolean, unavailableReason?: string): TuiCommand {
  return { id, label, description, keys, group, contexts, available, unavailableReason }
}
