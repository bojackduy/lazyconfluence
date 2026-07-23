import type { MediaAsset } from "../model"

export type ReaderContentPart =
  | { kind: "markdown"; content: string }
  | { kind: "image"; nodeId: string; label: string; details: string; asset: MediaAsset | null }

const imagePlaceholderPattern = /^> \[image: ([^\]\n]+)\]\n> ([^\n]*)\n<!-- confluence-opaque node="([^"]+)" type="ac:image" -->/gm

export function splitReaderImagePlaceholders(markdown: string, mediaAssets: MediaAsset[] = []): ReaderContentPart[] {
  const parts: ReaderContentPart[] = []
  const assetsByNodeId = new Map(mediaAssets.map((asset) => [asset.nodeId, asset]))
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = imagePlaceholderPattern.exec(markdown)) !== null) {
    appendMarkdownPart(parts, markdown.slice(lastIndex, match.index))
    parts.push({ kind: "image", label: match[1], details: match[2], nodeId: match[3], asset: assetsByNodeId.get(match[3]) ?? null })
    lastIndex = imagePlaceholderPattern.lastIndex
  }

  appendMarkdownPart(parts, markdown.slice(lastIndex))

  return parts.length ? parts : [{ kind: "markdown", content: markdown }]
}

function appendMarkdownPart(parts: ReaderContentPart[], content: string) {
  if (!content.trim()) return

  parts.push({ kind: "markdown", content: content.trim() })
}
