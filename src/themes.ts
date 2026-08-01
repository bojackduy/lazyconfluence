import { mkdir, readdir, readFile, writeFile, copyFile } from "node:fs/promises"
import { join } from "node:path"
import { loadAtlassianAuth, loadConfiguredThemeId, saveLocalConfig, withSelectedTheme } from "./config"
import { resolveConfigPaths } from "./paths"
import { builtInThemes, defaultThemeId, parseThemeFile, resolveTheme, themeStarter, type ResolvedTheme } from "./tui/theme"

export type AvailableTheme = ResolvedTheme & { source: "built-in" | "user"; path?: string }
export type ThemeCatalog = { themes: AvailableTheme[]; errors: string[] }

export async function loadThemeCatalog(env: NodeJS.ProcessEnv = process.env): Promise<ThemeCatalog> {
  const paths = resolveConfigPaths(env)
  let files: string[] = []
  try {
    files = await readdir(paths.themesDir)
  } catch (error) {
    if (!isMissingFileError(error)) throw error
  }
  const themes: AvailableTheme[] = builtInThemes.map((theme) => ({ ...theme, source: "built-in" }))
  const errors: string[] = []
  for (const file of files.filter((file) => file.endsWith(".json")).sort()) {
    const path = join(paths.themesDir, file)
    try {
      const parsed = parseThemeFile(await readFile(path, "utf8"))
      if (themes.some((theme) => theme.id === parsed.id)) throw new Error(`Theme id ${parsed.id} conflicts with an existing theme.`)
      themes.push({ ...resolveTheme(parsed), source: "user", path })
    } catch (error) {
      errors.push(`${file}: ${error instanceof Error ? error.message : "Unknown error."}`)
    }
  }
  return { themes, errors }
}

export async function loadSelectedTheme(env: NodeJS.ProcessEnv = process.env) {
  const catalog = await loadThemeCatalog(env)
  const preferredId = loadConfiguredThemeId(env) ?? defaultThemeId
  const selected = catalog.themes.find((theme) => theme.id === preferredId) ?? catalog.themes.find((theme) => theme.id === defaultThemeId)!
  return { ...catalog, selected, fellBack: selected.id !== preferredId }
}

export async function installTheme(sourcePath: string, env: NodeJS.ProcessEnv = process.env) {
  const parsed = parseThemeFile(await readFile(sourcePath, "utf8"))
  if (builtInThemes.some((theme) => theme.id === parsed.id)) throw new Error(`Theme id ${parsed.id} is reserved by a built-in theme.`)
  const paths = resolveConfigPaths(env)
  await mkdir(paths.themesDir, { recursive: true, mode: 0o700 })
  const destination = join(paths.themesDir, `${parsed.id}.json`)
  await assertThemeDoesNotExist(destination)
  await copyFile(sourcePath, destination)
  return { theme: resolveTheme(parsed), destination }
}

export async function initializeTheme(id: string, env: NodeJS.ProcessEnv = process.env) {
  const filename = `${id}.json`
  parseThemeFile(themeStarter(id))
  const paths = resolveConfigPaths(env)
  await mkdir(paths.themesDir, { recursive: true, mode: 0o700 })
  const destination = join(paths.themesDir, filename)
  await assertThemeDoesNotExist(destination)
  await writeFile(destination, themeStarter(id, titleFromId(id)), { mode: 0o600 })
  return destination
}

async function assertThemeDoesNotExist(path: string) {
  try {
    await readFile(path)
    throw new Error(`Theme already exists: ${path}`)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Theme already exists:")) throw error
    if (!isMissingFileError(error)) throw error
  }
}

export async function selectTheme(themeId: string, env: NodeJS.ProcessEnv = process.env) {
  const catalog = await loadThemeCatalog(env)
  if (!catalog.themes.some((theme) => theme.id === themeId)) throw new Error(`Unknown theme: ${themeId}`)
  const auth = await loadAtlassianAuth(env)
  if (!auth) throw new Error("No lazyconfluence config found. Run `lazyconfluence init` first.")
  await saveLocalConfig(withSelectedTheme(auth.config, themeId), env)
}

export function themeDirectory(env: NodeJS.ProcessEnv = process.env) {
  return resolveConfigPaths(env).themesDir
}

function titleFromId(id: string) {
  return id.split("-").map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(" ")
}

function isMissingFileError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}
