# Atlassian Mapping Artifact

This artifact defines the mapping system needed between Atlassian Confluence content, the local index, the terminal renderer, and a future editable Markdown-like workflow.

The important realization is that this cannot be a simple `html -> markdown` conversion. Confluence pages can contain macros, mentions, statuses, tables, layouts, attachments, task lists, embeds, inline cards, and unknown app-provided nodes. If lazyconfluence later allows editing, the app needs a stable internal document model and a preservation strategy, not just a rendered Markdown string.

## Core Position

`contentMarkdown` in `IndexedPage` is a projection.

It is useful for:

- Search.
- Snippets.
- Terminal reading.
- Mock data.
- First read-only sync.

It is not enough for:

- Safe editing.
- Round-tripping unknown Confluence constructs.
- Preserving macros and embedded app content.
- Writing back to Confluence without losing formatting.

The long-term source of truth should be a canonical lazyconfluence document representation plus source metadata that remembers where each node came from.

## Target Data Flow

```text
Atlassian API
  -> RawConfluencePage
  -> CanonicalDocument + MappingSidecar
  -> IndexedPage projection
  -> Reader/render projection

Editable workflow later:

CanonicalDocument + MappingSidecar
  -> EditableMarkdown
  -> EditedMarkdown
  -> CanonicalDocument patch
  -> Confluence write body
  -> Atlassian API update
```

The repository/index should store projections for browsing, but the mapper should own content semantics.

## Layer Boundaries

### 1. Remote Atlassian Layer

Purpose: hold API payloads as received from Atlassian.

Expected future module ownership:

- `src/confluence/client.ts`: fetches pages, spaces, children, versions, bodies.
- `src/confluence/types.ts`: remote DTO types, kept close to Atlassian naming.
- `src/confluence/mapper.ts`: turns remote payloads into app-owned records.

Do not let UI or repository code depend on remote DTO shapes.

Candidate type shape:

```ts
interface RawConfluencePage {
  id: string
  spaceKey: string
  title: string
  url: string
  parentId: string | null
  version: number
  owner: string
  updatedAt: string
  body: {
    representation: "storage" | "atlas_doc_format"
    value: string
  }
  raw: unknown
}
```

### 2. Canonical Document Layer

Purpose: represent what lazyconfluence understands independent of Confluence, OpenTUI, and Markdown syntax.

Expected future module ownership:

- `src/document/model.ts`: canonical block and inline nodes.
- `src/document/normalize.ts`: stable IDs, text extraction, outline extraction.
- `src/document/links.ts`: internal and external link extraction.

The canonical model should be explicit enough for rendering and editing, but not speculative. Start with common page content, add node kinds only when real fixtures require them.

Candidate type shape:

```ts
interface CanonicalDocument {
  schemaVersion: 1
  pageId: string
  title: string
  blocks: DocumentBlock[]
}

type DocumentBlock =
  | ParagraphBlock
  | HeadingBlock
  | ListBlock
  | TaskListBlock
  | CodeBlock
  | QuoteBlock
  | TableBlock
  | PanelBlock
  | ExpandBlock
  | RuleBlock
  | AttachmentBlock
  | UnsupportedBlock

type InlineNode =
  | TextInline
  | LinkInline
  | StrongInline
  | EmphasisInline
  | CodeInline
  | MentionInline
  | StatusInline
  | HardBreakInline
  | UnsupportedInline
```

Every canonical node should have a stable node ID.

```ts
interface BaseNode {
  nodeId: string
  source?: SourceRef
}
```

Stable IDs matter because an edit diff needs to know whether a node was changed, moved, removed, or left untouched.

### 3. Mapping Sidecar Layer

Purpose: preserve source data that the canonical document cannot fully express.

This is the safety valve for Confluence-specific or app-specific constructs.

Candidate type shape:

```ts
interface MappingSidecar {
  schemaVersion: 1
  remoteVersion: number
  sourceRepresentation: "storage" | "atlas_doc_format"
  sourceHash: string
  nodes: Record<string, NodeMapping>
}

interface NodeMapping {
  sourcePath: string
  sourceHash: string
  sourceType: string
  raw?: unknown
  roundTrip: "native" | "directive" | "opaque" | "lossy"
}
```

Round-trip modes:

- `native`: lazyconfluence understands the node and can write it back safely.
- `directive`: represented in editable Markdown using a custom directive syntax.
- `opaque`: preserved if untouched, but not safely editable.
- `lossy`: readable only; user must confirm before an edit can discard or simplify it.

### 4. Index Projection Layer

Purpose: produce records already implemented in `src/model.ts` and `src/index/*`.

Output records:

- `SpaceSummary`.
- `IndexedPage`.
- `PageLink`.
- `SearchResult`.

The index projection should be derived from canonical documents, not directly from raw Confluence HTML where possible.

Mapping responsibilities:

- Convert title, page ID, space, parent, owner, updated time, URL into `IndexedPage` fields.
- Convert canonical plain text into `snippet`.
- Convert canonical document into `contentMarkdown` for current read-only rendering.
- Extract links into `PageLink` records.
- Extract path and hierarchy from page ancestry.

### 5. Render Projection Layer

Purpose: turn the canonical document or `contentMarkdown` into terminal-friendly output.

Current state:

- TUI reads mock `contentMarkdown` from `IndexedPage`.

Near-term acceptable state:

- TUI reads repository `IndexedPage.contentMarkdown` after integration.

Long-term preferred state:

- TUI renders from a render projection derived from `CanonicalDocument`, with Markdown as a fallback text form.

Do not make OpenTUI components parse Confluence storage or Atlassian Document Format.

### 6. Editable Markdown Layer

Purpose: expose a text format users can edit without needing to understand Confluence internals.

This should not be generic Markdown. It should be "lazyconfluence editable Markdown": CommonMark-like syntax plus explicit directives for Confluence-only constructs.

Important constraint:

- Editable Markdown should prioritize predictable round-trip behavior over looking exactly like GitHub Markdown.

## Recommended Internal Storage

The current local index schema stores pages and FTS projections. For editing, a future migration should add a body artifact table instead of overloading `pages.content_markdown`.

Candidate future table:

```sql
CREATE TABLE page_bodies (
  page_id TEXT PRIMARY KEY REFERENCES pages(page_id) ON DELETE CASCADE,
  remote_version INTEGER NOT NULL,
  source_representation TEXT NOT NULL,
  source_body TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  canonical_json TEXT NOT NULL,
  sidecar_json TEXT NOT NULL,
  editable_markdown TEXT NOT NULL,
  rendered_markdown TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Why separate storage matters:

- Search stays fast and simple.
- Reader projections can be regenerated.
- Editing can compare against the source body and remote version.
- Unknown nodes can be preserved outside the user-visible Markdown.

## Mapping Table

| Confluence construct | Canonical node | Editable Markdown | Write-back policy | Notes |
| --- | --- | --- | --- | --- |
| Page title | Page metadata | Editor title field, not body H1 by default | Native | Avoid accidentally duplicating title as document heading. |
| Paragraph | `ParagraphBlock` | Plain paragraphs | Native | Preserve inline marks. |
| Heading | `HeadingBlock` | `#` through `######` | Native | Confluence heading levels should map directly. |
| Bold | `StrongInline` | `**text**` | Native | Preserve nested inline marks where possible. |
| Italic | `EmphasisInline` | `*text*` | Native | Avoid ambiguous underscores. |
| Inline code | `CodeInline` | `` `code` `` | Native | Escape backticks deterministically. |
| Code block | `CodeBlock` | Fenced code block | Native | Preserve language when Confluence exposes it. |
| Bullet list | `ListBlock` | `- item` | Native | Preserve nesting in canonical tree. |
| Numbered list | `ListBlock` | `1. item` | Native | Markdown numbers can be normalized. |
| Task list | `TaskListBlock` | `- [ ]` and `- [x]` | Native or directive | Depends on Confluence task representation. |
| Block quote | `QuoteBlock` | `>` | Native | Nested content may need canonical children. |
| Horizontal rule | `RuleBlock` | `---` | Native | Straightforward. |
| Table | `TableBlock` | Markdown table for simple tables | Native or directive | Complex cells need directive fallback. |
| Link to page | `LinkInline` | `[title](confluence://page/{id})` or normal URL | Native | Keep page ID when available. |
| External link | `LinkInline` | `[title](https://...)` | Native | Used for `PageLink.kind = external`. |
| Attachment link | `AttachmentBlock` or `LinkInline` | `[name](attachment:name.ext)` | Directive | Needs attachment metadata and upload path later. |
| Image attachment | `AttachmentBlock` | `![alt](attachment:image.png)` | Directive | Width/height/caption may need sidecar. |
| User mention | `MentionInline` | `@{accountId:Display Name}` | Directive | Display name alone is not stable enough. |
| Date mention | `DateInline` later | `{date:2026-07-21}` | Directive | Add only when fixtures require it. |
| Status lozenge | `StatusInline` | `{status color="green" text="DONE"}` | Directive | Preserve color and text. |
| Info/warning panel | `PanelBlock` | `:::confluence-panel type="info" title="..."` | Directive | Render as callout in TUI. |
| Expand | `ExpandBlock` | `:::confluence-expand title="..."` | Directive | TUI can render collapsed later. |
| Layout columns | `UnsupportedBlock` or future `LayoutBlock` | Opaque marker or directive | Opaque first | Terminal renderer probably linearizes layout. |
| Table of contents macro | `UnsupportedBlock` or generated outline | Opaque or generated | Opaque first | Avoid writing generated outline back incorrectly. |
| Jira issue macro | `UnsupportedInline` or `UnsupportedBlock` | Opaque marker | Opaque | Preserve raw macro if untouched. |
| Unknown structured macro | `UnsupportedBlock` | Opaque marker | Opaque | Must not be silently discarded. |
| Unknown inline extension | `UnsupportedInline` | Opaque marker | Opaque | Must survive unchanged if possible. |

## Editable Markdown Directive Syntax

The syntax should be stable, boring, and easy to parse.

Recommended block directive pattern:

```md
:::confluence-panel type="info" title="Deployment note" node="lc_node_123"
Panel body in editable Markdown.
:::
```

Recommended inline directive pattern:

```md
{status color="green" text="DONE" node="lc_node_456"}
```

Recommended mention pattern:

```md
@{accountId:712020:Example Person}
```

Recommended opaque block marker:

```md
<!-- confluence-opaque node="lc_node_789" type="ac:structured-macro" -->
```

Rules:

- If an opaque marker remains untouched, write back the original raw source for that node.
- If an opaque marker is deleted, delete that Confluence construct only after explicit user confirmation in the eventual edit flow.
- If an opaque marker is modified, reject the write with a clear error until the app knows how to edit that construct.
- Directives must carry stable node IDs when generated from existing Confluence content.
- New directives created by users can omit node IDs; the writer will allocate them.

## URL And Link Mapping

Confluence page links need special handling because URLs may include `/wiki`, encoded titles, query strings, comment anchors, or renamed page titles.

Canonical link identity should prefer:

- Page ID when Atlassian provides one.
- Normalized Confluence page URL key when the link points at an indexed page.
- Raw URL when the target cannot be resolved.

The current local repository already normalizes URLs to match indexed internal pages. The mapper should use the same concept for `PageLink` extraction.

Recommended relationship key:

```text
{scheme}://{host}/spaces/{spaceKey}/pages/{pageId}
```

Do not rely on the human-readable title segment in Confluence page URLs.

## Snippet And Search Text Mapping

Search text should come from canonical plain text extraction, not raw markup.

Rules:

- Skip navigation-only macro text when possible.
- Include headings because they are high-signal.
- Include table cell text in reading order.
- Include link labels, not raw URLs, unless URL text is the only visible text.
- Exclude opaque macro raw XML or JSON.
- Generate snippets from the first useful paragraph or high-signal section.

## Write-Back Workflow

Future editing should use a conservative write path.

```text
1. Load page body artifact from local DB.
2. Open editable Markdown generated from canonical document and sidecar.
3. Parse edited Markdown into a new canonical document.
4. Diff old canonical document against new canonical document.
5. Check opaque nodes for deletion or mutation.
6. Fetch current Confluence page version metadata.
7. Refuse write if remote version changed unless a rebase flow is implemented.
8. Generate Confluence body from new canonical document plus preserved sidecar raw nodes.
9. Send page update with incremented version.
10. Re-sync that page into the local index.
```

Conflict rules:

- If remote version changed, do not blindly overwrite.
- If only title changed remotely and body is unchanged, title-only reconciliation may be possible later.
- If body changed remotely, require user review or a future three-way merge.
- Store source hashes so unchanged raw nodes can be reused safely.

## Loss Rules

The mapper must never silently lose Confluence content.

Required behavior:

- Known native nodes can be converted and written back.
- Known directive nodes can be converted and written back.
- Unknown nodes are represented as opaque placeholders.
- Untouched opaque nodes are preserved exactly when writing back.
- Deleted opaque nodes require explicit confirmation.
- Modified opaque markers reject the write.
- Lossy conversion requires an explicit test fixture and a documented reason.

## Mapping Tests

All mapping tests must be local and network-free.

Recommended fixture categories:

- `simple-page.storage.html`: headings, paragraphs, lists, links.
- `table-page.storage.html`: simple and complex tables.
- `macro-page.storage.html`: panels, expands, status, unknown structured macro.
- `attachments-page.storage.html`: images and file links.
- `mentions-page.storage.html`: user mentions and dates.
- `link-page.storage.html`: internal page links with `/wiki`, encoded titles, query strings, and anchors.
- `roundtrip-page.storage.html`: mixed known and opaque content.

Recommended test assertions:

- Raw Confluence body maps to canonical document.
- Canonical document maps to `IndexedPage` and `PageLink` projections.
- `contentMarkdown` renders readable terminal text.
- Editable Markdown parses back into canonical document.
- Known simple pages round-trip with equivalent structure.
- Opaque nodes remain byte-identical when untouched.
- Link extraction distinguishes internal indexed pages from external links.
- Snippet generation avoids macro noise.

## Implementation Slices

### Slice 1: Read-Only Mapper

Add only read support first.

Expected files:

- `src/confluence/mapper.ts`.
- `src/confluence/storage.ts` if parsing storage XHTML is separated.
- `src/document/model.ts` if the canonical model is introduced now.
- `test/confluence-mapper.test.ts`.

Output:

- `IndexedPage`.
- `PageLink[]`.
- Render/search `contentMarkdown`.
- No write-back yet.

### Slice 2: Canonical Body Persistence

Add storage for raw body, canonical JSON, sidecar JSON, and rendered Markdown.

Expected files:

- `src/index/schema.ts` migration v2.
- Repository methods for page body artifacts.
- Tests for persistence and migration.

Output:

- Repository can preserve enough data for future editing.
- Current TUI still uses rendered/search projection.

### Slice 3: Editable Markdown Serializer

Add canonical to editable Markdown output.

Expected files:

- `src/document/editable-markdown.ts`.
- Fixtures for directives and opaque nodes.

Output:

- Users can inspect a deterministic editable text form.
- No Confluence writes yet.

### Slice 4: Editable Markdown Parser

Add editable Markdown back to canonical document.

Expected files:

- `src/document/parse-editable-markdown.ts`.
- Tests for native Markdown, directives, and opaque marker handling.

Output:

- Parsed edits can be diffed against old canonical document.

### Slice 5: Confluence Writer

Add canonical document to Confluence body conversion and guarded update flow.

Expected files:

- `src/confluence/writer.ts`.
- `src/sync.ts` update flow or a separate explicit `push` command.

Output:

- Explicit user action writes changes.
- Remote version conflicts are detected.
- Unknown content is preserved or blocked according to loss rules.

## Immediate Recommendation

The next Confluence API mapping task should not directly map remote body content into only `IndexedPage.contentMarkdown` if editing is a real product goal.

Recommended near-term adjustment:

- Keep the local index code as-is for search and browsing projections.
- Introduce a canonical document model before or during the Confluence mapper task.
- Make `contentMarkdown` a derived field from canonical content.
- Store or return enough mapping metadata to support future sidecar persistence.
- Treat write-back as a later explicit slice with stricter tests.

This keeps the current local-first reader milestone moving while avoiding a dead-end conversion pipeline.
