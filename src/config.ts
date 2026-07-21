import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolveConfigPaths, type ConfigPaths } from "./paths"

export const ATLASSIAN_API_TOKEN_URL = "https://id.atlassian.com/manage-profile/security/api-tokens"
export const DEFAULT_API_TOKEN_ENV = "ATLASSIAN_API_TOKEN"

export interface LocalConfig {
  version: 1
  atlassian: {
    siteUrl: string
    email: string
    spaceKeys: string[]
    defaultSpaceKey: string
    apiTokenEnv: string
  }
}

export interface LoadedAtlassianAuth {
  config: LocalConfig
  apiToken: string | null
  paths: ConfigPaths
}

export type CredentialStatus =
  | {
      kind: "ready"
      auth: LoadedAtlassianAuth
    }
  | {
      kind: "missing-config"
      title: string
      detail: string
      help: string[]
      paths: ConfigPaths
    }
  | {
      kind: "missing-token"
      title: string
      detail: string
      help: string[]
      auth: LoadedAtlassianAuth
    }
  | {
      kind: "invalid-config"
      title: string
      detail: string
      help: string[]
      paths: ConfigPaths
    }

export function createLocalConfig(input: { siteUrl: string; email: string; spaceKeys: string[]; apiTokenEnv?: string }): LocalConfig {
  const spaceKeys = uniqueSpaceKeys(input.spaceKeys)

  if (!spaceKeys.length) throw new Error("At least one Confluence space key is required.")

  const email = input.email.trim()
  if (!email) throw new Error("Email is required.")

  return {
    version: 1,
    atlassian: {
      siteUrl: normalizeAtlassianSiteUrl(input.siteUrl),
      email,
      spaceKeys,
      defaultSpaceKey: spaceKeys[0],
      apiTokenEnv: input.apiTokenEnv?.trim() || DEFAULT_API_TOKEN_ENV,
    },
  }
}

export function parseSpaceKeys(value: string): string[] {
  return uniqueSpaceKeys(value.split(/[\s,]+/).map((part) => part.trim()).filter(Boolean))
}

export function normalizeAtlassianSiteUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error("Atlassian site URL is required.")

  let url: URL

  try {
    url = new URL(trimmed)
  } catch (error) {
    throw new Error("Atlassian site URL must be a valid URL, for example https://example.atlassian.net.", { cause: error })
  }

  if (url.protocol !== "https:") throw new Error("Atlassian site URL must use https.")
  url.hash = ""
  url.search = ""

  if (url.pathname === "/wiki" || url.pathname === "/wiki/") url.pathname = "/"
  url.pathname = url.pathname.replace(/\/+$/, "")

  return url.toString().replace(/\/$/, "")
}

export async function saveLocalAuth(config: LocalConfig, apiToken: string, env: NodeJS.ProcessEnv = process.env): Promise<ConfigPaths> {
  const token = apiToken.trim()
  if (!token) throw new Error("API token is required.")

  const paths = resolveConfigPaths(env)
  await mkdir(paths.configDir, { recursive: true, mode: 0o700 })
  await writeFile(paths.configFile, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  await writeFile(paths.credentialFile, credentialEnvContent(config.atlassian.apiTokenEnv, token), { mode: 0o600 })

  return paths
}

export async function loadAtlassianAuth(env: NodeJS.ProcessEnv = process.env): Promise<LoadedAtlassianAuth | null> {
  const paths = resolveConfigPaths(env)
  let configText: string

  try {
    configText = await readFile(paths.configFile, "utf8")
  } catch (error) {
    if (isMissingFileError(error)) return null
    throw error
  }

  const config = parseLocalConfig(configText)
  const apiToken = env[config.atlassian.apiTokenEnv] || (await readApiTokenFromCredentialFile(paths.credentialFile, config.atlassian.apiTokenEnv))

  return {
    config,
    apiToken: apiToken || null,
    paths,
  }
}

export async function loadCredentialStatus(env: NodeJS.ProcessEnv = process.env): Promise<CredentialStatus> {
  const paths = resolveConfigPaths(env)

  try {
    const auth = await loadAtlassianAuth(env)

    if (!auth) {
      return {
        kind: "missing-config",
        title: "Mock mode: no Atlassian credentials configured",
        detail: "You can keep using mock data. Run setup when you are ready to connect Confluence.",
        help: [`Run: lazyconfluence init`, `Generate API token: ${ATLASSIAN_API_TOKEN_URL}`, `Config will be saved at: ${paths.configFile}`],
        paths,
      }
    }

    if (!auth.apiToken) {
      return {
        kind: "missing-token",
        title: "Mock mode: Atlassian API token missing",
        detail: "Config exists, but remote Confluence calls will fail until the token is available.",
        help: [`Run: lazyconfluence init`, `Or set env var: ${auth.config.atlassian.apiTokenEnv}`, `Credential file: ${auth.paths.credentialFile}`],
        auth,
      }
    }

    return { kind: "ready", auth }
  } catch (error) {
    return {
      kind: "invalid-config",
      title: "Mock mode: credential config could not be read",
      detail: error instanceof Error ? error.message : "Unknown config error.",
      help: [`Run: lazyconfluence init`, `Generate API token: ${ATLASSIAN_API_TOKEN_URL}`, `Config path: ${paths.configFile}`],
      paths,
    }
  }
}

function parseLocalConfig(configText: string): LocalConfig {
  const value = JSON.parse(configText) as Partial<LocalConfig>
  const atlassian = value.atlassian

  if (value.version !== 1 || !atlassian) throw new Error("Unsupported lazyconfluence config format.")
  if (!Array.isArray(atlassian.spaceKeys)) throw new Error("Config must include atlassian.spaceKeys.")

  return createLocalConfig({
    siteUrl: String(atlassian.siteUrl || ""),
    email: String(atlassian.email || ""),
    spaceKeys: atlassian.spaceKeys.map(String),
    apiTokenEnv: String(atlassian.apiTokenEnv || DEFAULT_API_TOKEN_ENV),
  })
}

async function readApiTokenFromCredentialFile(path: string, apiTokenEnv: string): Promise<string | null> {
  let text: string

  try {
    text = await readFile(path, "utf8")
  } catch (error) {
    if (isMissingFileError(error)) return null
    throw error
  }

  return parseEnvFile(text)[apiTokenEnv] || null
}

function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {}

  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed)
    if (!match) continue

    values[match[1]] = parseEnvValue(match[2].trim())
  }

  return values
}

function parseEnvValue(value: string) {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\(["\\$`])/g, "$1").replace(/\\n/g, "\n")
  }

  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1)

  return value
}

function credentialEnvContent(apiTokenEnv: string, apiToken: string) {
  return [`# lazyconfluence Atlassian API token`, `# Generate tokens at: ${ATLASSIAN_API_TOKEN_URL}`, `export ${apiTokenEnv}=${quoteEnvValue(apiToken)}`, ""].join("\n")
}

function quoteEnvValue(value: string) {
  return `"${value.replace(/(["\\$`])/g, "\\$1").replace(/\n/g, "\\n")}"`
}

function uniqueSpaceKeys(spaceKeys: string[]) {
  const seen = new Set<string>()
  const result: string[] = []

  for (const key of spaceKeys) {
    const trimmed = key.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }

  return result
}

function isMissingFileError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}
