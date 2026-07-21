import { createInterface } from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import { ATLASSIAN_API_TOKEN_URL, createLocalConfig, loadAtlassianAuth, parseSpaceKeys, saveLocalAuth } from "./config"
import { openIndexRepository } from "./index/repository"
import { formatSyncReport, syncConfluence, SyncServiceError, type SyncProgressEvent, type SyncReport } from "./sync"
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
      await runSyncCommand(args.slice(1))
      return
    case "search":
      await runSearchCommand(args.slice(1))
      return
    default:
      console.error(`Unknown command: ${command}`)
      console.error("Usage: lazyconfluence [tui|init|doctor|sync|search]")
      process.exitCode = 1
  }
}

async function runSyncCommand(args: string[]) {
  try {
    const options = parseSyncArgs(args)
    const report = await syncConfluence({ spaceKeys: options.spaceKeys, onProgress: options.quiet ? undefined : printSyncProgress })
    console.log(formatSyncReport(report))
    if (hasFatalSyncFailure(report)) process.exitCode = 1
  } catch (error) {
    console.error(error instanceof SyncServiceError ? error.message : error instanceof Error ? error.message : "Unknown sync error.")
    process.exitCode = 1
  }
}

async function runSearchCommand(args: string[]) {
  let options: ReturnType<typeof parseSearchArgs>

  try {
    options = parseSearchArgs(args)
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid search options.")
    process.exitCode = 1
    return
  }

  const auth = await loadAtlassianAuth()

  if (!options.all && !options.spaceKey && !auth) {
    console.error("No lazyconfluence config found. Run `bun run start init`, or use `search --all <query>` to search the local database without config.")
    process.exitCode = 1
    return
  }

  const spaceKey = options.all ? null : options.spaceKey || auth?.config.atlassian.defaultSpaceKey || null
  const repository = openIndexRepository()

  try {
    const results = spaceKey ? repository.searchPagesInSpace(spaceKey, options.query, options.limit) : repository.searchPagesAcrossSpaces(options.query, options.limit)

    if (!results.length) {
      console.log("No local results.")
      return
    }

    console.log(`Local search results${spaceKey ? ` in ${spaceKey}` : " across all spaces"}:`)
    for (const [index, result] of results.entries()) {
      console.log(`${index + 1}. [${result.page.spaceKey}] ${result.page.title}`)
      console.log(`   Path: ${result.page.path.join(" / ")}`)
      console.log(`   Updated: ${result.page.updatedAt}`)
      if (result.page.snippet) console.log(`   Snippet: ${result.page.snippet}`)
      console.log(`   URL: ${result.page.url}`)
    }
  } finally {
    repository.close()
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
    console.log("Run `bun run start sync` to fetch configured spaces into the local index.")
  } finally {
    closeRl()
  }
}

async function printLocalConfigSummary() {
  const auth = await loadAtlassianAuth()
  const repository = openIndexRepository()

  try {
    const stats = repository.getStats()

    if (!auth) {
      console.log("No lazyconfluence config found. Run `bun run start init` first.")
    } else {
      console.log("lazyconfluence local config")
      console.log(`Site URL: ${auth.config.atlassian.siteUrl}`)
      console.log(`Email: ${auth.config.atlassian.email}`)
      console.log(`Spaces: ${auth.config.atlassian.spaceKeys.join(", ")}`)
      console.log(`Default space: ${auth.config.atlassian.defaultSpaceKey}`)
      console.log(`API token: ${auth.apiToken ? "found" : "missing"}`)
    }

    console.log("lazyconfluence local database")
    console.log(`Database: ${repository.path ?? "unknown"}`)
    console.log(`Schema version: ${stats.schemaVersion}`)
    console.log(`Spaces indexed: ${stats.spaceCount}`)
    console.log(`Pages indexed: ${stats.pageCount}`)
    console.log(`Links indexed: ${stats.linkCount}`)
    console.log(`Body artifacts: ${stats.bodyArtifactCount}`)

    if (auth) {
      for (const spaceKey of auth.config.atlassian.spaceKeys) {
        const space = repository.getSpace(spaceKey)
        console.log(`Configured space ${spaceKey}: ${space ? `${space.pageCount} local pages` : "not synced"}`)
      }
    }

    console.log("No remote doctor check was run.")
  } finally {
    repository.close()
  }
}

function parseSyncArgs(args: string[]) {
  let spaceKeys: string[] | undefined
  let quiet = false

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    if (arg === "--space") {
      const value = args[index + 1]
      if (!value) throw new Error("--space requires a space key.")
      spaceKeys = [value]
      index += 1
      continue
    }

    if (arg === "--spaces") {
      const value = args[index + 1]
      if (!value) throw new Error("--spaces requires comma-separated space keys.")
      spaceKeys = parseSpaceKeys(value)
      index += 1
      continue
    }

    if (arg === "--all-configured") continue

    if (arg === "--quiet") {
      quiet = true
      continue
    }

    throw new Error(`Unknown sync option: ${arg}`)
  }

  return { spaceKeys, quiet }
}

function printSyncProgress(event: SyncProgressEvent) {
  if (event.type === "completed") return
  console.log(event.message)
}

function hasFatalSyncFailure(report: SyncReport) {
  return report.spacesSynced === 0 || report.failures.some((failure) => failure.scope !== "page")
}

function parseSearchArgs(args: string[]) {
  let all = false
  let spaceKey: string | null = null
  let limit = 20
  const queryParts: string[] = []

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    if (arg === "--all") {
      all = true
      continue
    }

    if (arg === "--space") {
      const value = args[index + 1]
      if (!value) throw new Error("--space requires a space key.")
      spaceKey = value
      index += 1
      continue
    }

    if (arg === "--limit") {
      const value = Number(args[index + 1])
      if (!Number.isInteger(value) || value < 1) throw new Error("--limit requires a positive integer.")
      limit = value
      index += 1
      continue
    }

    queryParts.push(arg)
  }

  return {
    all,
    spaceKey,
    limit,
    query: queryParts.join(" ").trim(),
  }
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
