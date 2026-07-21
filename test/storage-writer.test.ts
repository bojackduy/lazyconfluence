import { describe, expect, test } from "bun:test"
import { markdownToConfluenceStorage } from "../src/confluence/storage-writer"

describe("Markdown to Confluence storage writer", () => {
  test("converts supported Markdown blocks to storage HTML", () => {
    const result = markdownToConfluenceStorage([
      "# Project Architecture",
      "",
      "Use **local-first** browsing with [Release Checklist](https://example.atlassian.net/wiki/spaces/ENG/pages/102).",
      "",
      "- Sync explicitly",
      "- Render locally",
      "",
      "```ts",
      "const answer = 42",
      "```",
      "",
      "| Field | Value |",
      "| --- | --- |",
      "| Status | Ready |",
    ].join("\n"))

    expect(result.blockedReasons).toEqual([])
    expect(result.storageHtml).toContain("<h1>Project Architecture</h1>")
    expect(result.storageHtml).toContain("<strong>local-first</strong>")
    expect(result.storageHtml).toContain('<a href="https://example.atlassian.net/wiki/spaces/ENG/pages/102">Release Checklist</a>')
    expect(result.storageHtml).toContain("<ul><li>Sync explicitly</li><li>Render locally</li></ul>")
    expect(result.storageHtml).toContain('<pre><code data-language="ts">const answer = 42</code></pre>')
    expect(result.storageHtml).toContain("<table><tbody><tr><th><p>Field</p></th><th><p>Value</p></th></tr><tr><td><p>Status</p></td><td><p>Ready</p></td></tr></tbody></table>")
  })

  test("blocks opaque Confluence placeholders", () => {
    const result = markdownToConfluenceStorage('Intro.\n\n<!-- confluence-opaque node="x" type="macro" -->')

    expect(result.blockedReasons[0]).toContain("opaque Confluence placeholder")
  })
})
