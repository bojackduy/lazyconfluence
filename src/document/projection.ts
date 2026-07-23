import type { CanonicalDocument, DocumentBlock, ImageBlock, InlineNode, LinkInline } from "./model"

export function renderDocumentMarkdown(document: CanonicalDocument) {
  return document.blocks.map(renderBlockMarkdown).filter(Boolean).join("\n\n")
}

export function documentPlainText(document: CanonicalDocument) {
  return compactText(document.blocks.map(blockText).filter(Boolean).join("\n"))
}

export function documentSnippet(document: CanonicalDocument, limit = 240) {
  const candidates = document.blocks
    .map(blockText)
    .map(compactText)
    .filter((text) => text && !isBoilerplate(text))

  const useful = candidates.find((text) => text.length >= 40) || candidates[0] || ""

  return limitText(useful, limit)
}

export function documentLinks(document: CanonicalDocument) {
  const links: LinkInline[] = []

  for (const block of document.blocks) {
    if ("inlines" in block) collectInlineLinks(block.inlines, links)
    if (block.type === "list") {
      for (const item of block.items) collectInlineLinks(item, links)
    }
    if (block.type === "table") {
      for (const row of block.rows) {
        for (const cell of row.cells) collectInlineLinks(cell.inlines, links)
      }
    }
  }

  return links
}

export function documentImages(document: CanonicalDocument): ImageBlock[] {
  return document.blocks.filter((block): block is ImageBlock => block.type === "image")
}

export function inlineText(inlines: InlineNode[]) {
  return inlines.map((inline) => {
    switch (inline.type) {
      case "text":
      case "strong":
      case "emphasis":
      case "code":
      case "unsupported":
        return inline.text
      case "link":
        return inline.text || inline.href
      case "hardBreak":
        return "\n"
    }
  }).join("")
}

function renderBlockMarkdown(block: DocumentBlock) {
  switch (block.type) {
    case "heading":
      return `${"#".repeat(Math.min(Math.max(block.level, 1), 6))} ${renderInlineMarkdown(block.inlines)}`.trim()
    case "paragraph":
      return renderInlineMarkdown(block.inlines).trim()
    case "list":
      return block.items.map((item, index) => `${block.ordered ? `${index + 1}.` : "-"} ${renderInlineMarkdown(item).trim()}`).join("\n")
    case "code":
      return [`\`\`\`${block.language || ""}`, block.text, "```"].join("\n")
    case "quote":
      return renderInlineMarkdown(block.inlines).split("\n").map((line) => `> ${line}`.trimEnd()).join("\n")
    case "table":
      return renderTableMarkdown(block)
    case "image":
      return renderImageMarkdown(block)
    case "rule":
      return "---"
    case "unsupported":
      return `<!-- confluence-opaque node="${block.nodeId}" type="${block.sourceType}" -->`
  }
}

function renderImageMarkdown(block: Extract<DocumentBlock, { type: "image" }>) {
  const label = block.title || block.url || "image"
  const details = block.url ? block.url : "Attachment on this Confluence page."

  return [`> [image: ${label}]`, `> ${details}`, `<!-- confluence-opaque node="${block.nodeId}" type="${block.sourceType}" -->`].join("\n")
}

function renderInlineMarkdown(inlines: InlineNode[]) {
  return inlines.map((inline) => {
    switch (inline.type) {
      case "text":
        return inline.text
      case "strong":
        return `**${inline.text}**`
      case "emphasis":
        return `*${inline.text}*`
      case "code":
        return `\`${inline.text.replace(/`/g, "\\`")}\``
      case "link":
        return `[${inline.text || inline.href}](${inline.href})`
      case "hardBreak":
        return "\n"
      case "unsupported":
        return inline.text
    }
  }).join("")
}

function renderTableMarkdown(block: Extract<DocumentBlock, { type: "table" }>) {
  const rows = block.rows.filter((row) => row.cells.length > 0)
  const columnCount = Math.max(0, ...rows.map((row) => row.cells.length))

  if (!rows.length || !columnCount) return ""

  const headerIndex = rows.findIndex((row) => row.cells.some((cell) => cell.header))
  const effectiveHeaderIndex = headerIndex === -1 ? 0 : headerIndex
  const header = rows[effectiveHeaderIndex]
  const bodyRows = rows.filter((_row, index) => index !== effectiveHeaderIndex)
  const separator = Array.from({ length: columnCount }, () => "---")

  return [
    renderTableRow(header, columnCount),
    renderMarkdownTableCells(separator),
    ...bodyRows.map((row) => renderTableRow(row, columnCount)),
  ].join("\n")
}

function renderTableRow(row: Extract<DocumentBlock, { type: "table" }>["rows"][number], columnCount: number) {
  return renderMarkdownTableCells(Array.from({ length: columnCount }, (_value, index) => renderTableCell(row.cells[index])))
}

function renderMarkdownTableCells(cells: string[]) {
  return `| ${cells.join(" | ")} |`
}

function renderTableCell(cell: Extract<DocumentBlock, { type: "table" }>["rows"][number]["cells"][number] | undefined) {
  const value = cell ? renderInlineMarkdown(cell.inlines).replace(/\s*\n\s*/g, "<br>").replace(/\|/g, "\\|").trim() : ""

  return value || " "
}

function blockText(block: DocumentBlock) {
  switch (block.type) {
    case "heading":
    case "paragraph":
    case "quote":
      return inlineText(block.inlines)
    case "list":
      return block.items.map(inlineText).join("\n")
    case "table":
      return block.rows.map((row) => row.cells.map((cell) => inlineText(cell.inlines)).join("\t")).join("\n")
    case "image":
      return `Image: ${block.title || block.url || "image"}${block.url ? ` ${block.url}` : ""}`
    case "code":
      return block.text
    case "rule":
      return ""
    case "unsupported":
      return block.fallbackText
  }
}

function collectInlineLinks(inlines: InlineNode[], links: LinkInline[]) {
  for (const inline of inlines) {
    if (inline.type === "link") links.push(inline)
  }
}

function compactText(value: string) {
  return value.replace(/[\t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim()
}

function limitText(value: string, limit: number) {
  if (value.length <= limit) return value

  return `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}…`
}

function isBoilerplate(value: string) {
  return /^(document type|status|candidate|owner|last updated)$/i.test(value.trim())
}
