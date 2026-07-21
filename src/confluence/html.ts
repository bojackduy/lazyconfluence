import { absoluteConfluenceWebUrl } from "./client"
import type { CanonicalDocument, DocumentBlock, InlineNode, MappingSidecar, NodeMapping, RoundTripMode, SourceRepresentation } from "../document/model"

export interface ParseConfluenceStorageInput {
  pageId: string
  title: string
  storageHtml: string
  baseUrl: string
  remoteVersion: number
  sourceRepresentation?: SourceRepresentation
}

export interface ParsedConfluenceStorage {
  document: CanonicalDocument
  sidecar: MappingSidecar
}

export function parseConfluenceStorage(input: ParseConfluenceStorageInput): ParsedConfluenceStorage {
  const blocks: DocumentBlock[] = []
  const nodes: Record<string, NodeMapping> = {}
  const blockPattern = /<((?:h[1-6])|p|ul|ol|pre|blockquote|ac:structured-macro)\b([^>]*)>([\s\S]*?)<\/\1>|<(hr)\b[^>]*\/?>/gi
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = blockPattern.exec(input.storageHtml)) !== null) {
    addLooseTextBlock(input, blocks, nodes, input.storageHtml.slice(lastIndex, match.index))
    addMatchedBlock(input, blocks, nodes, match)
    lastIndex = blockPattern.lastIndex
  }

  addLooseTextBlock(input, blocks, nodes, input.storageHtml.slice(lastIndex))

  return {
    document: {
      schemaVersion: 1,
      pageId: input.pageId,
      title: input.title,
      blocks,
    },
    sidecar: {
      schemaVersion: 1,
      remoteVersion: input.remoteVersion,
      sourceRepresentation: input.sourceRepresentation ?? "storage",
      sourceHash: stableHash(input.storageHtml),
      nodes,
    },
  }
}

export function htmlToText(value: string) {
  return compactText(decodeHtml(stripTags(value)))
}

function addMatchedBlock(input: ParseConfluenceStorageInput, blocks: DocumentBlock[], nodes: Record<string, NodeMapping>, match: RegExpExecArray) {
  const tag = (match[1] || match[4] || "").toLowerCase()
  const attrs = parseAttributes(match[2] || "")
  const inner = match[3] || ""
  const raw = match[0]
  const nodeId = blockNodeId(input.pageId, blocks.length)
  const sourcePath = `storage.blocks[${blocks.length}]`
  let block: DocumentBlock | null = null
  let roundTrip: RoundTripMode = "native"
  let sourceType = tag

  if (/^h[1-6]$/.test(tag)) {
    block = { type: "heading", nodeId, source: { path: sourcePath, type: tag }, level: Number(tag.slice(1)), inlines: parseInlineHtml(inner, input.baseUrl) }
  } else if (tag === "p") {
    const inlines = parseInlineHtml(inner, input.baseUrl)
    if (htmlToText(inner)) block = { type: "paragraph", nodeId, source: { path: sourcePath, type: tag }, inlines }
  } else if (tag === "ul" || tag === "ol") {
    const items = parseListItems(inner, input.baseUrl)
    if (items.length) block = { type: "list", nodeId, source: { path: sourcePath, type: tag }, ordered: tag === "ol", items }
  } else if (tag === "pre") {
    block = { type: "code", nodeId, source: { path: sourcePath, type: tag }, language: null, text: htmlToText(inner) }
  } else if (tag === "blockquote") {
    block = { type: "quote", nodeId, source: { path: sourcePath, type: tag }, inlines: parseInlineHtml(inner, input.baseUrl) }
  } else if (tag === "hr") {
    block = { type: "rule", nodeId, source: { path: sourcePath, type: tag } }
  } else if (tag === "ac:structured-macro") {
    const macroName = attrs["ac:name"] || "unknown"
    sourceType = `ac:structured-macro:${macroName}`
    const codeText = extractPlainTextBody(inner)

    if (macroName === "code" && codeText !== null) {
      roundTrip = "directive"
      block = { type: "code", nodeId, source: { path: sourcePath, type: sourceType }, language: attrs["ac:language"] || null, text: codeText }
    } else {
      roundTrip = "opaque"
      block = { type: "unsupported", nodeId, source: { path: sourcePath, type: sourceType }, sourceType, fallbackText: htmlToText(inner) }
    }
  }

  if (!block) return

  blocks.push(block)
  nodes[nodeId] = nodeMapping(sourcePath, sourceType, raw, roundTrip)
}

function addLooseTextBlock(input: ParseConfluenceStorageInput, blocks: DocumentBlock[], nodes: Record<string, NodeMapping>, raw: string) {
  const text = htmlToText(raw)
  if (!text) return

  const nodeId = blockNodeId(input.pageId, blocks.length)
  const sourcePath = `storage.blocks[${blocks.length}]`

  blocks.push({ type: "paragraph", nodeId, source: { path: sourcePath, type: "text" }, inlines: [{ type: "text", text }] })
  nodes[nodeId] = nodeMapping(sourcePath, "text", raw, "native")
}

function parseInlineHtml(value: string, baseUrl: string): InlineNode[] {
  const inlines: InlineNode[] = []
  const inlinePattern = /<(a|strong|b|em|i|code)\b([^>]*)>([\s\S]*?)<\/\1>|<br\s*\/?>/gi
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = inlinePattern.exec(value)) !== null) {
    appendText(inlines, inlineHtmlText(value.slice(lastIndex, match.index)))

    const tag = (match[1] || "br").toLowerCase()
    const attrs = parseAttributes(match[2] || "")
    const inner = inlineHtmlText(match[3] || "")

    if (tag === "a") {
      const href = attrs.href ? absoluteConfluenceWebUrl(baseUrl, attrs.href) : ""
      if (href) inlines.push({ type: "link", text: compactInlineText(inner) || href, href })
    } else if (tag === "strong" || tag === "b") {
      inlines.push({ type: "strong", text: compactInlineText(inner) })
    } else if (tag === "em" || tag === "i") {
      inlines.push({ type: "emphasis", text: compactInlineText(inner) })
    } else if (tag === "code") {
      inlines.push({ type: "code", text: compactInlineText(inner) })
    } else {
      inlines.push({ type: "hardBreak" })
    }

    lastIndex = inlinePattern.lastIndex
  }

  appendText(inlines, inlineHtmlText(value.slice(lastIndex)))

  return inlines.filter((inline) => inline.type !== "text" || inline.text.length > 0)
}

function parseListItems(value: string, baseUrl: string) {
  const items: InlineNode[][] = []
  const itemPattern = /<li\b[^>]*>([\s\S]*?)<\/li>/gi
  let match: RegExpExecArray | null

  while ((match = itemPattern.exec(value)) !== null) {
    const item = parseInlineHtml(match[1], baseUrl)
    if (item.length) items.push(item)
  }

  return items
}

function appendText(inlines: InlineNode[], text: string) {
  if (!text) return
  const previous = inlines[inlines.length - 1]

  if (previous?.type === "text") {
    previous.text += text
    return
  }

  inlines.push({ type: "text", text })
}

function extractPlainTextBody(value: string) {
  const match = /<ac:plain-text-body\b[^>]*>([\s\S]*?)<\/ac:plain-text-body>/i.exec(value)
  if (!match) return null

  return match[1].replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim()
}

function parseAttributes(value: string) {
  const attrs: Record<string, string> = {}
  const pattern = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(value)) !== null) {
    attrs[match[1]] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? "")
  }

  return attrs
}

function nodeMapping(sourcePath: string, sourceType: string, raw: string, roundTrip: RoundTripMode): NodeMapping {
  return {
    sourcePath,
    sourceHash: stableHash(raw),
    sourceType,
    raw,
    roundTrip,
  }
}

function blockNodeId(pageId: string, index: number) {
  return `lc_${pageId.replace(/[^A-Za-z0-9_-]/g, "_")}_${String(index + 1).padStart(4, "0")}`
}

function stripTags(value: string) {
  return value.replace(/<[^>]+>/g, "")
}

function inlineHtmlText(value: string) {
  return decodeHtml(stripTags(value).replace(/[\t\r\n ]+/g, " "))
}

function compactInlineText(value: string) {
  return value.replace(/[\t\r\n ]+/g, " ").trim()
}

function compactText(value: string) {
  return value.replace(/[\t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim()
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
}

function stableHash(value: string) {
  let hash = 5381

  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index)
  }

  return (hash >>> 0).toString(16).padStart(8, "0")
}
