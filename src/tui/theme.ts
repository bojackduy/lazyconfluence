import { RGBA, SyntaxStyle } from "@opentui/core"
import { createSignal } from "solid-js"

export const defaultThemeId = "midnight"

export const themeColorNames = ["bg", "panel", "panelAlt", "overlay", "overlayInput", "warningBg", "codeBg", "codeBorder", "border", "borderActive", "text", "codeText", "muted", "subtle", "accent", "accentSoft", "folder", "page", "live", "canvas", "imageReady", "imageMissing", "good", "warn", "danger"] as const
export const syntaxColorNames = ["heading", "heading2", "heading3", "heading4", "italic", "linkLabel", "raw", "rawBg", "list", "quote", "comment", "keyword", "string", "number", "function", "type", "property", "operator", "tag", "attribute"] as const

export type ThemeColorName = typeof themeColorNames[number]
export type SyntaxColorName = typeof syntaxColorNames[number]
export type ThemePalette = Record<ThemeColorName, string>
export type SyntaxPalette = Record<SyntaxColorName, string>

export type ResolvedTheme = {
  id: string
  name: string
  colors: ThemePalette
  syntax: SyntaxPalette
}

export type ThemeFile = {
  version: 1
  id: string
  name: string
  extends?: string
  colors?: Partial<ThemePalette>
  syntax?: Partial<SyntaxPalette>
}

const midnight: ResolvedTheme = {
  id: "midnight",
  name: "Midnight",
  colors: {
    bg: "#0b1020", panel: "#111827", panelAlt: "#0f172a", overlay: "#08111f", overlayInput: "#08111f", warningBg: "#1f1607", codeBg: "#0b1220", codeBorder: "#475569", border: "#334155", borderActive: "#7dd3fc", text: "#e5e7eb", codeText: "#dbeafe", muted: "#94a3b8", subtle: "#64748b", accent: "#38bdf8", accentSoft: "#1e3a5f", folder: "#38bdf8", page: "#94a3b8", live: "#86efac", canvas: "#c4b5fd", imageReady: "#86efac", imageMissing: "#facc15", good: "#86efac", warn: "#facc15", danger: "#fda4af",
  },
  syntax: {
    heading: "#bfdbfe", heading2: "#93c5fd", heading3: "#bfdbfe", heading4: "#dbeafe", italic: "#c4b5fd", linkLabel: "#67e8f9", raw: "#fde68a", rawBg: "#1f2937", list: "#c4b5fd", quote: "#cbd5e1", comment: "#64748b", keyword: "#c4b5fd", string: "#86efac", number: "#fbbf24", function: "#93c5fd", type: "#67e8f9", property: "#bae6fd", operator: "#f0abfc", tag: "#fda4af", attribute: "#fcd34d",
  },
}

const paper: ResolvedTheme = {
  id: "paper",
  name: "Paper",
  colors: { bg: "#f8fafc", panel: "#ffffff", panelAlt: "#f1f5f9", overlay: "#ffffff", overlayInput: "#f8fafc", warningBg: "#fef3c7", codeBg: "#e2e8f0", codeBorder: "#94a3b8", border: "#cbd5e1", borderActive: "#0284c7", text: "#0f172a", codeText: "#1e293b", muted: "#475569", subtle: "#64748b", accent: "#0369a1", accentSoft: "#dbeafe", folder: "#0369a1", page: "#475569", live: "#15803d", canvas: "#6d28d9", imageReady: "#15803d", imageMissing: "#a16207", good: "#15803d", warn: "#a16207", danger: "#be123c" },
  syntax: { heading: "#1e3a8a", heading2: "#1d4ed8", heading3: "#1e40af", heading4: "#334155", italic: "#6d28d9", linkLabel: "#0e7490", raw: "#92400e", rawBg: "#fef3c7", list: "#6d28d9", quote: "#475569", comment: "#64748b", keyword: "#7c3aed", string: "#15803d", number: "#a16207", function: "#1d4ed8", type: "#0e7490", property: "#0369a1", operator: "#be185d", tag: "#be123c", attribute: "#a16207" },
}

export const builtInThemes: readonly ResolvedTheme[] = [midnight, paper]

const [activeTheme, setActiveThemeSignal] = createSignal<ResolvedTheme>(midnight)

// Existing components read this proxy reactively while themes remain globally consistent for the one active TUI.
export const theme: ThemePalette = new Proxy({} as ThemePalette, {
  get(_target, key: ThemeColorName) {
    return activeTheme().colors[key]
  },
})

export function currentTheme() {
  return activeTheme()
}

export function setActiveTheme(next: ResolvedTheme) {
  setActiveThemeSignal(next)
}

export function markdownStyle() {
  const theme = activeTheme()
  const colors = theme.colors
  const syntax = theme.syntax
  return SyntaxStyle.fromStyles({
    "markup.heading": { fg: RGBA.fromHex(syntax.heading), bold: true },
    "markup.heading.1": { fg: RGBA.fromHex(colors.accent), bold: true },
    "markup.heading.2": { fg: RGBA.fromHex(syntax.heading2), bold: true },
    "markup.heading.3": { fg: RGBA.fromHex(syntax.heading3), bold: true },
    "markup.heading.4": { fg: RGBA.fromHex(syntax.heading4), bold: true },
    "markup.heading.5": { fg: RGBA.fromHex(syntax.heading4), bold: true },
    "markup.heading.6": { fg: RGBA.fromHex(syntax.heading4), bold: true },
    "markup.strong": { fg: RGBA.fromHex(colors.text), bold: true },
    "markup.italic": { fg: RGBA.fromHex(syntax.italic), italic: true },
    "markup.strikethrough": { fg: RGBA.fromHex(colors.subtle), dim: true },
    "markup.link": { fg: RGBA.fromHex(colors.accent), underline: true },
    "markup.link.label": { fg: RGBA.fromHex(syntax.linkLabel), underline: true },
    "markup.link.url": { fg: RGBA.fromHex(colors.subtle), underline: true, dim: true },
    "markup.raw": { fg: RGBA.fromHex(syntax.raw), bg: RGBA.fromHex(syntax.rawBg) },
    "markup.list": { fg: RGBA.fromHex(syntax.list) },
    "markup.quote": { fg: RGBA.fromHex(syntax.quote), italic: true },
    conceal: { fg: RGBA.fromHex(colors.subtle), dim: true },
    comment: { fg: RGBA.fromHex(syntax.comment), italic: true }, keyword: { fg: RGBA.fromHex(syntax.keyword), bold: true }, string: { fg: RGBA.fromHex(syntax.string) }, number: { fg: RGBA.fromHex(syntax.number) }, boolean: { fg: RGBA.fromHex(syntax.number) }, constant: { fg: RGBA.fromHex(syntax.number) }, function: { fg: RGBA.fromHex(syntax.function) }, method: { fg: RGBA.fromHex(syntax.function) }, type: { fg: RGBA.fromHex(syntax.type) }, variable: { fg: RGBA.fromHex(colors.codeText) }, property: { fg: RGBA.fromHex(syntax.property) }, operator: { fg: RGBA.fromHex(syntax.operator) }, punctuation: { fg: RGBA.fromHex(colors.muted) }, tag: { fg: RGBA.fromHex(syntax.tag) }, attribute: { fg: RGBA.fromHex(syntax.attribute) }, default: { fg: RGBA.fromHex(colors.text) },
  })
}

export function parseThemeFile(text: string): ThemeFile {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error("Theme file must contain valid JSON.")
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Theme file must be a JSON object.")
  const input = value as Record<string, unknown>
  assertOnlyKeys(input, ["version", "id", "name", "extends", "colors", "syntax"], "Theme")
  if (input.version !== 1) throw new Error("Theme version must be 1.")
  const id = stringValue(input.id, "Theme id")
  if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(id)) throw new Error("Theme id must use lowercase letters, numbers, and hyphens.")
  const name = stringValue(input.name, "Theme name")
  const extendsId = input.extends === undefined ? undefined : stringValue(input.extends, "Theme extends")
  if (extendsId && !builtInThemes.some((theme) => theme.id === extendsId)) throw new Error(`Theme extends must name a built-in theme: ${builtInThemes.map((theme) => theme.id).join(", ")}.`)
  return { version: 1, id, name, ...(extendsId ? { extends: extendsId } : {}), colors: parseColorOverrides(input.colors, themeColorNames, "colors"), syntax: parseColorOverrides(input.syntax, syntaxColorNames, "syntax") }
}

export function resolveTheme(file: ThemeFile): ResolvedTheme {
  const base = builtInThemes.find((theme) => theme.id === (file.extends ?? defaultThemeId)) ?? midnight
  return { id: file.id, name: file.name, colors: { ...base.colors, ...file.colors }, syntax: { ...base.syntax, ...file.syntax } }
}

export function themeStarter(id: string, name = id) {
  const file: ThemeFile = { version: 1, id, name, extends: defaultThemeId, colors: { bg: midnight.colors.bg, panel: midnight.colors.panel, panelAlt: midnight.colors.panelAlt, overlay: midnight.colors.overlay, overlayInput: midnight.colors.overlayInput, warningBg: midnight.colors.warningBg, accent: midnight.colors.accent, accentSoft: midnight.colors.accentSoft, borderActive: midnight.colors.borderActive, folder: midnight.colors.folder, imageReady: midnight.colors.imageReady }, syntax: { heading: midnight.syntax.heading, heading2: midnight.syntax.heading2, keyword: midnight.syntax.keyword, string: midnight.syntax.string, function: midnight.syntax.function } }
  return `${JSON.stringify(file, null, 2)}\n`
}

function parseColorOverrides(value: unknown, allowed: readonly string[], label: string) {
  if (value === undefined) return undefined
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Theme ${label} must be an object.`)
  const result: Record<string, string> = {}
  for (const [key, color] of Object.entries(value)) {
    if (!allowed.includes(key)) throw new Error(`Theme ${label} has unsupported token: ${key}.`)
    const hex = stringValue(color, `Theme ${label}.${key}`)
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`Theme ${label}.${key} must be a six-digit hex color.`)
    result[key] = hex.toLowerCase()
  }
  return result
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: string[], label: string) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${label} has unsupported field: ${key}.`)
}

function stringValue(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`)
  return value.trim()
}
