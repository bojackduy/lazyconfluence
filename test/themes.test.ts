import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { createLocalConfig, loadAtlassianAuth, saveLocalConfig } from "../src/config"
import { installTheme, initializeTheme, loadSelectedTheme, loadThemeCatalog, selectTheme } from "../src/themes"
import { builtInThemes, parseThemeFile, resolveTheme, themeColorNames } from "../src/tui/theme"

const catppuccinMocha = JSON.stringify({
  version: 1,
  id: "catppuccin-mocha",
  name: "Catppuccin Mocha",
  extends: "midnight",
  colors: {
    bg: "#1e1e2e",
    panel: "#181825",
    panelAlt: "#11111b",
    codeBg: "#181825",
    codeBorder: "#45475a",
    border: "#313244",
    borderActive: "#89b4fa",
    text: "#cdd6f4",
    codeText: "#cdd6f4",
    muted: "#a6adc8",
    subtle: "#6c7086",
    accent: "#89b4fa",
    accentSoft: "#313244",
    good: "#a6e3a1",
    warn: "#f9e2af",
    danger: "#f38ba8"
  },
  syntax: {
    keyword: "#cba6f7",
    string: "#a6e3a1",
    function: "#89b4fa",
    type: "#94e2d5",
    comment: "#6c7086"
  }
}, null, 2)

describe("local theme packs", () => {
  test("resolves a Catppuccin-style local pack with complete fallback tokens", () => {
    const theme = resolveTheme(parseThemeFile(catppuccinMocha))

    expect(theme.colors.bg).toBe("#1e1e2e")
    expect(theme.syntax.keyword).toBe("#cba6f7")
    expect(theme.syntax.attribute).toBe("#fcd34d")
    expect(theme.colors.overlay).toBe("#08111f")
  })

  test("provides every full-app color token in each built-in theme", () => {
    for (const theme of builtInThemes) {
      expect(Object.keys(theme.colors).sort()).toEqual([...themeColorNames].sort())
    }
  })

  test("keeps application surfaces free of colors that bypass installed themes", async () => {
    const source = await readFile(join(import.meta.dir, "../src/tui/app.tsx"), "utf8")
    expect(source.match(/#[0-9a-fA-F]{6}/g) ?? []).toEqual([])
  })

  test("rejects unknown tokens and unsafe color values", () => {
    expect(() => parseThemeFile(JSON.stringify({ version: 1, id: "bad", name: "Bad", colors: { nope: "#ffffff" } }))).toThrow("unsupported token")
    expect(() => parseThemeFile(JSON.stringify({ version: 1, id: "bad", name: "Bad", colors: { bg: "blue" } }))).toThrow("six-digit hex")
  })

  test("installs, selects, and preserves a user-adjustable theme file", async () => {
    const configHome = await mkdtemp(join(tmpdir(), "lazyconfluence-theme-"))
    const source = join(configHome, "catppuccin-mocha.json")
    const env = { LAZYCONFLUENCE_CONFIG_HOME: configHome } as NodeJS.ProcessEnv
    try {
      await writeFile(source, catppuccinMocha)
      await saveLocalConfig(createLocalConfig({ siteUrl: "https://example.atlassian.net", email: "reader@example.com", spaceKeys: ["ENG"] }), env)

      const installed = await installTheme(source, env)
      const catalog = await loadThemeCatalog(env)
      await selectTheme(installed.theme.id, env)
      const selected = await loadSelectedTheme(env)

      expect(catalog.themes.find((theme) => theme.id === "catppuccin-mocha")?.source).toBe("user")
      expect(await readFile(installed.destination, "utf8")).toBe(catppuccinMocha)
      expect(selected.selected.id).toBe("catppuccin-mocha")
      expect((await loadAtlassianAuth(env))?.config.ui?.themeId).toBe("catppuccin-mocha")
      await expect(installTheme(source, env)).rejects.toThrow("Theme already exists")
    } finally {
      await rm(configHome, { recursive: true, force: true })
    }
  })

  test("creates a validated editable starter without replacing existing work", async () => {
    const configHome = await mkdtemp(join(tmpdir(), "lazyconfluence-theme-"))
    const env = { LAZYCONFLUENCE_CONFIG_HOME: configHome } as NodeJS.ProcessEnv
    try {
      const destination = await initializeTheme("my-theme", env)
      expect(parseThemeFile(await readFile(destination, "utf8"))).toMatchObject({ id: "my-theme", extends: "midnight" })
      await expect(initializeTheme("my-theme", env)).rejects.toThrow("Theme already exists")
    } finally {
      await rm(configHome, { recursive: true, force: true })
    }
  })
})
