export interface StorageConversionResult {
  storageHtml: string
  blockedReasons: string[]
}

type MarkdownBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; lines: string[] }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "code"; language: string; text: string }
  | { type: "quote"; lines: string[] }
  | { type: "table"; rows: string[][] }
  | { type: "rule" }

export function markdownToConfluenceStorage(markdown: string): StorageConversionResult {
  const blockedReasons: string[] = []

  if (/<!--\s*confluence-opaque\b/i.test(markdown)) {
    blockedReasons.push("Draft contains an opaque Confluence placeholder that cannot be safely written back yet.")
  }

  const blocks = parseMarkdownBlocks(markdown)
  const storageHtml = blocks.map(renderBlock).join("")

  return { storageHtml, blockedReasons }
}

function parseMarkdownBlocks(markdown: string) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n")
  const blocks: MarkdownBlock[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) {
      index += 1
      continue
    }

    const fence = /^```([^`]*)\s*$/.exec(line)
    if (fence) {
      const content: string[] = []
      index += 1
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        content.push(lines[index])
        index += 1
      }
      if (index < lines.length) index += 1
      blocks.push({ type: "code", language: fence[1].trim(), text: content.join("\n") })
      continue
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2].trim() })
      index += 1
      continue
    }

    if (/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: "rule" })
      index += 1
      continue
    }

    if (isTableStart(lines, index)) {
      const tableLines: string[] = []
      tableLines.push(lines[index])
      index += 2
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        tableLines.push(lines[index])
        index += 1
      }
      blocks.push({ type: "table", rows: tableLines.map(splitTableRow) })
      continue
    }

    const list = listItem(line)
    if (list) {
      const items: string[] = []
      const ordered = list.ordered
      while (index < lines.length) {
        const item = listItem(lines[index])
        if (!item || item.ordered !== ordered) break
        items.push(item.text)
        index += 1
      }
      blocks.push({ type: "list", ordered, items })
      continue
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = []
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ""))
        index += 1
      }
      blocks.push({ type: "quote", lines: quoteLines })
      continue
    }

    const paragraphLines: string[] = []
    while (index < lines.length && lines[index].trim() && !startsBlock(lines, index)) {
      paragraphLines.push(lines[index])
      index += 1
    }
    blocks.push({ type: "paragraph", lines: paragraphLines })
  }

  return blocks
}

function startsBlock(lines: string[], index: number) {
  const line = lines[index]
  return /^```/.test(line)
    || /^(#{1,6})\s+/.test(line)
    || /^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)
    || Boolean(listItem(line))
    || /^>\s?/.test(line)
    || isTableStart(lines, index)
}

function isTableStart(lines: string[], index: number) {
  const header = lines[index]
  const separator = lines[index + 1]

  return Boolean(header?.includes("|") && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(separator ?? ""))
}

function listItem(line: string) {
  const unordered = /^\s{0,3}[-*+]\s+(.+)$/.exec(line)
  if (unordered) return { ordered: false, text: unordered[1].trim() }

  const ordered = /^\s{0,3}\d+[.)]\s+(.+)$/.exec(line)
  if (ordered) return { ordered: true, text: ordered[1].trim() }

  return null
}

function splitTableRow(line: string) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "")
  const cells: string[] = []
  let current = ""
  let escaped = false

  for (const char of trimmed) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === "\\") {
      escaped = true
      continue
    }
    if (char === "|") {
      cells.push(current.trim())
      current = ""
      continue
    }
    current += char
  }

  cells.push(current.trim())
  return cells
}

function renderBlock(block: MarkdownBlock) {
  switch (block.type) {
    case "heading":
      return `<h${block.level}>${renderInline(block.text)}</h${block.level}>`
    case "paragraph":
      return `<p>${renderInline(block.lines.join("\n"))}</p>`
    case "list":
      return `<${block.ordered ? "ol" : "ul"}>${block.items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${block.ordered ? "ol" : "ul"}>`
    case "code":
      return `<pre><code${block.language ? ` data-language="${escapeAttribute(block.language)}"` : ""}>${escapeHtml(block.text)}</code></pre>`
    case "quote":
      return `<blockquote><p>${renderInline(block.lines.join("\n"))}</p></blockquote>`
    case "table":
      return renderTable(block.rows)
    case "rule":
      return "<hr />"
  }
}

function renderTable(rows: string[][]) {
  if (!rows.length) return ""

  const columnCount = Math.max(...rows.map((row) => row.length))
  const renderRow = (row: string[], tag: "th" | "td") => `<tr>${Array.from({ length: columnCount }, (_value, index) => `<${tag}><p>${renderInline(row[index] ?? "")}</p></${tag}>`).join("")}</tr>`
  const [header, ...body] = rows

  return `<table><tbody>${renderRow(header, "th")}${body.map((row) => renderRow(row, "td")).join("")}</tbody></table>`
}

function renderInline(value: string) {
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g
  const parts: string[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(value)) !== null) {
    parts.push(escapeInlineText(value.slice(lastIndex, match.index)))
    parts.push(renderInlineToken(match[0]))
    lastIndex = pattern.lastIndex
  }

  parts.push(escapeInlineText(value.slice(lastIndex)))
  return parts.join("")
}

function renderInlineToken(token: string) {
  if (token.startsWith("`") && token.endsWith("`")) return `<code>${escapeHtml(token.slice(1, -1))}</code>`
  if (token.startsWith("**") && token.endsWith("**")) return `<strong>${escapeHtml(token.slice(2, -2))}</strong>`
  if (token.startsWith("*") && token.endsWith("*")) return `<em>${escapeHtml(token.slice(1, -1))}</em>`

  const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
  if (link) return `<a href="${escapeAttribute(link[2].trim())}">${escapeHtml(link[1])}</a>`

  return escapeHtml(token)
}

function escapeInlineText(value: string) {
  return escapeHtml(value).replace(/\n/g, "<br />")
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replace(/'/g, "&#39;")
}
