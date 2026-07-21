export type SourceRepresentation = "storage" | "atlas_doc_format"
export type RoundTripMode = "native" | "directive" | "opaque" | "lossy"

export interface SourceRef {
  path: string
  type: string
}

export interface BaseDocumentNode {
  nodeId: string
  source?: SourceRef
}

export interface CanonicalDocument {
  schemaVersion: 1
  pageId: string
  title: string
  blocks: DocumentBlock[]
}

export type DocumentBlock = HeadingBlock | ParagraphBlock | ListBlock | CodeBlock | QuoteBlock | TableBlock | RuleBlock | UnsupportedBlock

export interface HeadingBlock extends BaseDocumentNode {
  type: "heading"
  level: number
  inlines: InlineNode[]
}

export interface ParagraphBlock extends BaseDocumentNode {
  type: "paragraph"
  inlines: InlineNode[]
}

export interface ListBlock extends BaseDocumentNode {
  type: "list"
  ordered: boolean
  items: InlineNode[][]
}

export interface CodeBlock extends BaseDocumentNode {
  type: "code"
  language: string | null
  text: string
}

export interface QuoteBlock extends BaseDocumentNode {
  type: "quote"
  inlines: InlineNode[]
}

export interface TableBlock extends BaseDocumentNode {
  type: "table"
  rows: TableRow[]
}

export interface TableRow {
  cells: TableCell[]
}

export interface TableCell {
  header: boolean
  inlines: InlineNode[]
}

export interface RuleBlock extends BaseDocumentNode {
  type: "rule"
}

export interface UnsupportedBlock extends BaseDocumentNode {
  type: "unsupported"
  sourceType: string
  fallbackText: string
}

export type InlineNode = TextInline | LinkInline | StrongInline | EmphasisInline | CodeInline | HardBreakInline | UnsupportedInline

export interface TextInline {
  type: "text"
  text: string
}

export interface LinkInline {
  type: "link"
  text: string
  href: string
}

export interface StrongInline {
  type: "strong"
  text: string
}

export interface EmphasisInline {
  type: "emphasis"
  text: string
}

export interface CodeInline {
  type: "code"
  text: string
}

export interface HardBreakInline {
  type: "hardBreak"
}

export interface UnsupportedInline {
  type: "unsupported"
  text: string
  sourceType: string
}

export interface MappingSidecar {
  schemaVersion: 1
  remoteVersion: number
  sourceRepresentation: SourceRepresentation
  sourceHash: string
  nodes: Record<string, NodeMapping>
}

export interface NodeMapping {
  sourcePath: string
  sourceHash: string
  sourceType: string
  raw?: unknown
  roundTrip: RoundTripMode
}
