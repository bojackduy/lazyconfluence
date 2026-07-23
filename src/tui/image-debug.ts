import { appendFileSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export type ImageDebugData = Record<string, string | number | boolean | null | undefined>

export function imageDebugEnabled(env: NodeJS.ProcessEnv = process.env) {
  const value = env.LAZYCONFLUENCE_IMAGE_DEBUG?.trim().toLowerCase()

  return value === "1" || value === "true" || value === "yes" || value === "on" || value === "image" || value === "kitty"
}

export function imageDebugLogPath(env: NodeJS.ProcessEnv = process.env) {
  const configured = env.LAZYCONFLUENCE_IMAGE_DEBUG_LOG?.trim()
  if (configured) return expandHomePath(configured)

  return join(resolveDataDir(env), "image-debug.jsonl")
}

export function logImageDebug(event: string, data: ImageDebugData = {}, env: NodeJS.ProcessEnv = process.env) {
  if (!imageDebugEnabled(env)) return

  try {
    const path = imageDebugLogPath(env)
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    appendFileSync(path, `${JSON.stringify({ ts: new Date().toISOString(), event, ...compactData(data) })}\n`, { mode: 0o600 })
  } catch {
    // Debug logging must never break the TUI render path.
  }
}

function compactData(data: ImageDebugData) {
  const compacted: ImageDebugData = {}

  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) compacted[key] = value
  }

  return compacted
}

function resolveDataDir(env: NodeJS.ProcessEnv) {
  const configuredDataHome = env.LAZYCONFLUENCE_DATA_HOME?.trim()
  if (configuredDataHome) return expandHomePath(configuredDataHome)

  if (process.platform === "win32") {
    return join(env.LOCALAPPDATA || env.APPDATA || join(homedir(), "AppData", "Local"), "lazyconfluence")
  }

  if (process.platform === "darwin") {
    return join(env.XDG_DATA_HOME || join(homedir(), "Library", "Application Support"), "lazyconfluence")
  }

  return join(env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "lazyconfluence")
}

function expandHomePath(path: string) {
  if (path === "~") return homedir()
  if (path.startsWith("~/")) return join(homedir(), path.slice(2))

  return path
}
