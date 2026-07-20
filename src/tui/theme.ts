import { RGBA, SyntaxStyle } from "@opentui/core"

export const theme = {
  bg: "#0b1020",
  panel: "#111827",
  panelAlt: "#0f172a",
  border: "#334155",
  borderActive: "#7dd3fc",
  text: "#e5e7eb",
  muted: "#94a3b8",
  subtle: "#64748b",
  accent: "#38bdf8",
  accentSoft: "#1e3a5f",
  good: "#86efac",
  warn: "#facc15",
  danger: "#fda4af",
}

export const markdownStyle = SyntaxStyle.fromStyles({
  "markup.heading.1": { fg: RGBA.fromHex(theme.accent), bold: true },
  "markup.heading.2": { fg: RGBA.fromHex("#93c5fd"), bold: true },
  "markup.heading.3": { fg: RGBA.fromHex("#bfdbfe"), bold: true },
  "markup.strong": { fg: RGBA.fromHex(theme.text), bold: true },
  "markup.link": { fg: RGBA.fromHex(theme.accent), underline: true },
  "markup.raw": { fg: RGBA.fromHex("#a7f3d0") },
  "markup.list": { fg: RGBA.fromHex("#c4b5fd") },
  default: { fg: RGBA.fromHex(theme.text) },
})
