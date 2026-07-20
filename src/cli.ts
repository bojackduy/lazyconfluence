import { renderTui } from "./tui/app"

export async function runCli(args: string[]) {
  const command = args[0]

  switch (command) {
    case undefined:
    case "tui":
      await renderTui()
      return
    case "init":
      console.log("init is deferred: the first loop is mock-backed UI design.")
      return
    case "doctor":
      console.log("doctor ok: mock UI build is available. Run `bun run start` to open it.")
      return
    case "sync":
      console.log("sync is deferred until the reader and navigator UI are approved.")
      return
    case "search":
      console.log("search is deferred for the next UI loop.")
      return
    default:
      console.error(`Unknown command: ${command}`)
      console.error("Usage: lazyconfluence [tui|init|doctor|sync|search]")
      process.exitCode = 1
  }
}
