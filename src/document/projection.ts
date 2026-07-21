import type { CanonicalDocument, DocumentBlock, InlineNode, LinkInline } from "./model"

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
  }

  return links
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
    case "rule":
      return "---"
    case "unsupported":
      return `<!-- confluence-opaque node="${block.nodeId}" type="${block.sourceType}" -->`
  }
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

function blockText(block: DocumentBlock) {
  switch (block.type) {
    case "heading":
    case "paragraph":
    case "quote":
      return inlineText(block.inlines)
    case "list":
      return block.items.map(inlineText).join("\n")
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
