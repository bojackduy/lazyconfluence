import { createInterface } from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import { ATLASSIAN_API_TOKEN_URL, createLocalConfig, loadAtlassianAuth, parseSpaceKeys, saveLocalAuth } from "./config"
import { formatSyncReport, syncConfluence, SyncServiceError } from "./sync"
import { renderTui } from "./tui/app"

export async function runCli(args: string[]) {
  const command = args[0]

  switch (command) {
    case undefined:
    case "tui":
      await renderTui()
      return
    case "init":
      await runInit()
      return
    case "doctor":
      await printLocalConfigSummary()
      return
    case "sync":
      await runSyncCommand()
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

async function runSyncCommand() {
  try {
    const report = await syncConfluence()
    console.log(formatSyncReport(report))
    if (!report.complete) process.exitCode = 1
  } catch (error) {
    console.error(error instanceof SyncServiceError ? error.message : error instanceof Error ? error.message : "Unknown sync error.")
    process.exitCode = 1
  }
}

async function runInit() {
  console.log("lazyconfluence auth setup")
  console.log(`Generate an Atlassian API token at: ${ATLASSIAN_API_TOKEN_URL}`)
  console.log("The token is stored in a local env file, not in the repository.\n")

  const existing = await loadAtlassianAuth()
  const rl = createInterface({ input, output })
  let rlClosed = false
  const closeRl = () => {
    if (rlClosed) return
    rl.close()
    rlClosed = true
  }

  try {
    const siteUrl = await askRequired(rl, "Atlassian site URL", existing?.config.atlassian.siteUrl)
    const email = await askRequired(rl, "Atlassian account email", existing?.config.atlassian.email)
    const defaultSpaceKeys = existing?.config.atlassian.spaceKeys.join(",")
    const spaceKeysInput = await askRequired(rl, "Space keys to configure (comma-separated, first is default)", defaultSpaceKeys)
    const spaceKeys = parseSpaceKeys(spaceKeysInput)

    closeRl()

    const token = await askHidden("Atlassian API token")
    const config = createLocalConfig({ siteUrl, email, spaceKeys })
    const paths = await saveLocalAuth(config, token)

    console.log("\nSaved lazyconfluence auth config.")
    console.log(`Config: ${paths.configFile}`)
    console.log(`Credentials: ${paths.credentialFile}`)
    console.log(`Default space: ${config.atlassian.defaultSpaceKey}`)
    console.log("Remote checks, sync, and cache setup are still deferred.")
  } finally {
    closeRl()
  }
}

async function printLocalConfigSummary() {
  const auth = await loadAtlassianAuth()

  if (!auth) {
    console.log("No lazyconfluence config found. Run `bun run start init` first.")
    return
  }

  console.log("lazyconfluence local config")
  console.log(`Site URL: ${auth.config.atlassian.siteUrl}`)
  console.log(`Email: ${auth.config.atlassian.email}`)
  console.log(`Spaces: ${auth.config.atlassian.spaceKeys.join(", ")}`)
  console.log(`Default space: ${auth.config.atlassian.defaultSpaceKey}`)
  console.log(`API token: ${auth.apiToken ? "found" : "missing"}`)
  console.log("No remote doctor check is implemented yet.")
}

async function askRequired(rl: ReturnType<typeof createInterface>, label: string, defaultValue?: string) {
  const suffix = defaultValue ? ` [${defaultValue}]` : ""

  while (true) {
    const answer = (await rl.question(`${label}${suffix}: `)).trim()
    const value = answer || defaultValue || ""

    if (value) return value
    console.log(`${label} is required.`)
  }
}

async function askHidden(label: string) {
  if (!input.isTTY || !output.isTTY) return askHiddenFallback(label)

  output.write(`${label}: `)
  input.setRawMode(true)
  input.resume()

  return new Promise<string>((resolve, reject) => {
    let value = ""

    const cleanup = () => {
      input.off("data", onData)
      input.setRawMode(false)
      output.write("\n")
    }

    const onData = (chunk: Buffer) => {
      const text = chunk.toString("utf8")

      if (text === "\u0003") {
        cleanup()
        reject(new Error("Auth setup cancelled."))
        return
      }

      if (text === "\r" || text === "\n") {
        cleanup()
        resolve(value.trim())
        return
      }

      if (text === "\u007f" || text === "\b") {
        value = value.slice(0, -1)
        return
      }

      value += text
    }

    input.on("data", onData)
  })
}

async function askHiddenFallback(label: string) {
  const rl = createInterface({ input, output })

  try {
    return (await rl.question(`${label}: `)).trim()
  } finally {
    rl.close()
  }
}
