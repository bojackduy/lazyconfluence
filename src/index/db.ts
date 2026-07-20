import { mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { Database } from "bun:sqlite"
import { applyIndexSchema } from "./schema"

export interface OpenIndexDatabaseOptions {
  path?: string
  env?: NodeJS.ProcessEnv
}

export interface IndexDatabase {
  path: string
  database: Database
  close: () => void
}

export function openIndexDatabase(input: string | OpenIndexDatabaseOptions = {}): IndexDatabase {
  const options = typeof input === "string" ? { path: input } : input
  const path = expandHomePath(options.path || resolveIndexDatabasePath(options.env))

  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  }

  const database = new Database(path, { create: true })
  applyIndexSchema(database)

  return {
    path,
    database,
    close: () => database.close(),
  }
}

export function resolveIndexDatabasePath(env: NodeJS.ProcessEnv = process.env) {
  const configuredPath = env.LAZYCONFLUENCE_DB_PATH?.trim()
  if (configuredPath) return configuredPath

  return join(resolveDataDir(env), "index.sqlite3")
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
