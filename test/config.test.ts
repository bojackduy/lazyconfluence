import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { ATLASSIAN_API_TOKEN_URL, createLocalConfig, loadAtlassianAuth, loadCredentialStatus, normalizeAtlassianSiteUrl, parseSpaceKeys, saveLocalAuth } from "../src/config"

describe("local auth config", () => {
  test("normalizes Atlassian site URLs", () => {
    expect(normalizeAtlassianSiteUrl("https://example.atlassian.net/wiki/")).toBe("https://example.atlassian.net")
    expect(normalizeAtlassianSiteUrl("https://example.atlassian.net/")).toBe("https://example.atlassian.net")
  })

  test("parses comma and space separated space keys", () => {
    expect(parseSpaceKeys("ENG, OPS ARCH ENG")).toEqual(["ENG", "OPS", "ARCH"])
  })

  test("saves config separately from the API token and reloads both", async () => {
    const configHome = await mkdtemp(join(tmpdir(), "lazyconfluence-config-"))
    const env = { LAZYCONFLUENCE_CONFIG_HOME: configHome } as NodeJS.ProcessEnv

    try {
      const config = createLocalConfig({
        siteUrl: "https://example.atlassian.net/wiki",
        email: "you@example.com",
        spaceKeys: ["ENG", "OPS"],
      })
      const paths = await saveLocalAuth(config, "secret-token", env)
      const loaded = await loadAtlassianAuth(env)
      const configText = await readFile(paths.configFile, "utf8")
      const credentialText = await readFile(paths.credentialFile, "utf8")

      expect(loaded?.config.atlassian.siteUrl).toBe("https://example.atlassian.net")
      expect(loaded?.config.atlassian.defaultSpaceKey).toBe("ENG")
      expect(loaded?.apiToken).toBe("secret-token")
      expect(configText).not.toContain("secret-token")
      expect(credentialText).toContain(ATLASSIAN_API_TOKEN_URL)
      expect(credentialText).toContain("export ATLASSIAN_API_TOKEN=")
    } finally {
      await rm(configHome, { recursive: true, force: true })
    }
  })

  test("environment token overrides the local credential file", async () => {
    const configHome = await mkdtemp(join(tmpdir(), "lazyconfluence-config-"))
    const env = { LAZYCONFLUENCE_CONFIG_HOME: configHome } as NodeJS.ProcessEnv

    try {
      const config = createLocalConfig({
        siteUrl: "https://example.atlassian.net",
        email: "you@example.com",
        spaceKeys: ["ENG"],
      })

      await saveLocalAuth(config, "file-token", env)
      const loaded = await loadAtlassianAuth({ ...env, ATLASSIAN_API_TOKEN: "env-token" })

      expect(loaded?.apiToken).toBe("env-token")
    } finally {
      await rm(configHome, { recursive: true, force: true })
    }
  })

  test("credential status explains missing config without throwing", async () => {
    const configHome = await mkdtemp(join(tmpdir(), "lazyconfluence-config-"))
    const env = { LAZYCONFLUENCE_CONFIG_HOME: configHome } as NodeJS.ProcessEnv

    try {
      const status = await loadCredentialStatus(env)

      expect(status.kind).toBe("missing-config")
      expect(status.kind !== "ready" ? status.help.join("\n") : "").toContain("lazyconfluence init")
    } finally {
      await rm(configHome, { recursive: true, force: true })
    }
  })

  test("credential status reports a configured account with no token", async () => {
    const configHome = await mkdtemp(join(tmpdir(), "lazyconfluence-config-"))
    const env = { LAZYCONFLUENCE_CONFIG_HOME: configHome } as NodeJS.ProcessEnv

    try {
      const config = createLocalConfig({
        siteUrl: "https://example.atlassian.net",
        email: "you@example.com",
        spaceKeys: ["ENG"],
      })
      const paths = await saveLocalAuth(config, "file-token", env)
      await writeFile(paths.credentialFile, "export ATLASSIAN_API_TOKEN=\n")

      const status = await loadCredentialStatus(env)

      expect(status.kind).toBe("missing-token")
      expect(status.kind === "missing-token" ? status.help.join("\n") : "").toContain("ATLASSIAN_API_TOKEN")
    } finally {
      await rm(configHome, { recursive: true, force: true })
    }
  })

  test("credential status is ready when config and token load", async () => {
    const configHome = await mkdtemp(join(tmpdir(), "lazyconfluence-config-"))
    const env = { LAZYCONFLUENCE_CONFIG_HOME: configHome } as NodeJS.ProcessEnv

    try {
      const config = createLocalConfig({
        siteUrl: "https://example.atlassian.net",
        email: "you@example.com",
        spaceKeys: ["ENG"],
      })

      await saveLocalAuth(config, "file-token", env)
      const status = await loadCredentialStatus(env)

      expect(status.kind).toBe("ready")
      expect(status.kind === "ready" ? status.auth.apiToken : null).toBe("file-token")
    } finally {
      await rm(configHome, { recursive: true, force: true })
    }
  })

  test("credential status reports unreadable config as a non-blocking warning", async () => {
    const configHome = await mkdtemp(join(tmpdir(), "lazyconfluence-config-"))
    const env = { LAZYCONFLUENCE_CONFIG_HOME: configHome } as NodeJS.ProcessEnv

    try {
      await writeFile(join(configHome, "config.json"), "{not json")

      const status = await loadCredentialStatus(env)

      expect(status.kind).toBe("invalid-config")
      expect(status.kind !== "ready" ? status.detail : "").not.toBe("")
    } finally {
      await rm(configHome, { recursive: true, force: true })
    }
  })
})
