import { describe, expect, test } from "bun:test"
import { documentPlainText } from "../src/document/projection"
import { mapConfluenceFolder, mapConfluencePage, mapConfluenceSpace } from "../src/confluence/mapper"
import type { ConfluencePage, ConfluenceSpace } from "../src/confluence/client"

const space: ConfluenceSpace = {
  id: "10",
  key: "ENG",
  name: "Engineering",
  homepageId: "100",
}

describe("Confluence mapper", () => {
  test("maps spaces into local summaries", () => {
    expect(mapConfluenceSpace(space, { lastSyncedAt: "2026-07-21T10:00:00Z", pageCount: 3 })).toEqual({
      key: "ENG",
      name: "Engineering",
      lastSyncedAt: "2026-07-21T10:00:00Z",
      pageCount: 3,
      syncState: "fresh",
    })
  })

  test("maps storage HTML into canonical document, index projection, and links", () => {
    const page: ConfluencePage = {
      id: "101",
      title: "Project Architecture",
      parentId: "100",
      ownerId: "architecture-guild",
      version: { number: 7, createdAt: "2026-07-19T11:05:00Z" },
      _links: { webui: "/wiki/spaces/ENG/pages/101/Project+Architecture" },
      body: {
        storage: {
          value: [
            "<h1>Project Architecture</h1>",
            '<p>Use <strong>local-first</strong> browsing with <a href="/wiki/spaces/ENG/pages/102/Release+Checklist?focusedCommentId=abc#note">Release Checklist</a>.</p>',
            "<ul><li>Sync explicitly</li><li>Render locally</li></ul>",
            '<p>External reference: <a href="https://developer.atlassian.com/cloud/confluence/rest/v2/">REST API</a></p>',
          ].join(""),
        },
      },
    }

    const mapped = mapConfluencePage({
      page,
      space,
      baseUrl: "https://example.atlassian.net/wiki",
      ancestors: [{ id: "100", title: "Engineering Home" }],
    })

    expect(mapped.document.blocks.map((block) => block.type)).toEqual(["heading", "paragraph", "list", "paragraph"])
    expect(documentPlainText(mapped.document)).toContain("Use local-first browsing with Release Checklist.")
    expect(mapped.indexedPage).toMatchObject({
      pageId: "101",
      spaceKey: "ENG",
      title: "Project Architecture",
      url: "https://example.atlassian.net/wiki/spaces/ENG/pages/101/Project+Architecture",
      parentId: "100",
      path: ["Engineering Home", "Project Architecture"],
      owner: "architecture-guild",
      updatedAt: "2026-07-19T11:05:00Z",
    })
    expect(mapped.indexedPage.contentMarkdown).toContain("**local-first**")
    expect(mapped.indexedPage.contentMarkdown).toContain("[Release Checklist](https://example.atlassian.net/wiki/spaces/ENG/pages/102/Release+Checklist?focusedCommentId=abc#note)")
    expect(mapped.indexedPage.snippet).toBe("Use local-first browsing with Release Checklist.")
    expect(mapped.links).toEqual([
      {
        fromPageId: "101",
        targetUrl: "https://example.atlassian.net/wiki/spaces/ENG/pages/102/Release+Checklist?focusedCommentId=abc#note",
        targetPageId: null,
        title: "Release Checklist",
        kind: "internal",
      },
      {
        fromPageId: "101",
        targetUrl: "https://developer.atlassian.com/cloud/confluence/rest/v2/",
        targetPageId: null,
        title: "REST API",
        kind: "external",
      },
    ])
  })

  test("preserves unknown Confluence macros as opaque sidecar nodes", () => {
    const page: ConfluencePage = {
      id: "200",
      title: "Macro Page",
      parentId: null,
      version: { number: 2, createdAt: "2026-07-20T12:00:00Z" },
      _links: { webui: "/spaces/ENG/pages/200/Macro+Page" },
      body: {
        storage: {
          value: '<p>Readable introduction for the page.</p><ac:structured-macro ac:name="toc"><ac:parameter ac:name="printable">true</ac:parameter></ac:structured-macro>',
        },
      },
    }

    const mapped = mapConfluencePage({ page, space, baseUrl: "https://example.atlassian.net" })
    const opaqueNode = Object.values(mapped.sidecar.nodes).find((node) => node.roundTrip === "opaque")

    expect(mapped.document.blocks.map((block) => block.type)).toEqual(["paragraph", "unsupported"])
    expect(mapped.indexedPage.contentMarkdown).toContain("<!-- confluence-opaque")
    expect(opaqueNode?.sourceType).toBe("ac:structured-macro:toc")
    expect(String(opaqueNode?.raw)).toContain("ac:name=\"toc\"")
  })

  test("maps storage tables into markdown tables", () => {
    const mapped = mapConfluencePage({
      page: {
        id: "225",
        title: "Table Page",
        version: { number: 3, createdAt: "2026-07-21T09:00:00Z" },
        body: {
          storage: {
            value: [
              '<table data-layout="default"><tbody>',
              "<tr><th><p>Field</p></th><th><p>Value</p></th></tr>",
              "<tr><td><p>Status</p></td><td><p><strong>Ready</strong></p></td></tr>",
              "</tbody></table>",
            ].join(""),
          },
        },
      },
      space,
      baseUrl: "https://example.atlassian.net/wiki",
    })

    expect(mapped.document.blocks.map((block) => block.type)).toEqual(["table"])
    expect(mapped.renderedMarkdown).toContain("| Field | Value |")
    expect(mapped.renderedMarkdown).toContain("| --- | --- |")
    expect(mapped.renderedMarkdown).toContain("| Status | **Ready** |")
    expect(documentPlainText(mapped.document)).toContain("Status Ready")
  })

  test("uses the sync timestamp when Confluence omits page timestamps", () => {
    const mapped = mapConfluencePage({
      page: {
        id: "250",
        title: "Undated Page",
        body: { storage: { value: "<p>Undated content.</p>" } },
      },
      space,
      baseUrl: "https://example.atlassian.net/wiki",
      syncedAt: "2026-07-21T10:00:00Z",
    })

    const folder = mapConfluenceFolder({
      page: { id: "251", title: "Undated Folder", type: "folder" },
      space,
      baseUrl: "https://example.atlassian.net/wiki",
      syncedAt: "2026-07-21T10:00:00Z",
    })

    expect(mapped.indexedPage.updatedAt).toBe("2026-07-21T10:00:00Z")
    expect(folder.updatedAt).toBe("2026-07-21T10:00:00Z")
  })

  test("maps folders into tree-capable indexed projections", () => {
    const folder = mapConfluenceFolder({
      page: {
        id: "300",
        title: "Design Notes",
        type: "folder",
        parentId: "101",
        createdAt: "2026-07-20T13:00:00Z",
        _links: { webui: "/spaces/ENG/folders/300/Design+Notes" },
      },
      space,
      baseUrl: "https://example.atlassian.net/wiki",
      ancestors: [{ id: "101", title: "Project Architecture" }],
    })

    expect(folder).toEqual({
      pageId: "300",
      spaceKey: "ENG",
      title: "Design Notes",
      url: "https://example.atlassian.net/wiki/spaces/ENG/folders/300/Design+Notes",
      parentId: "101",
      path: ["Project Architecture", "Design Notes"],
      owner: "",
      updatedAt: "2026-07-20T13:00:00Z",
      contentMarkdown: "",
      snippet: "",
    })
  })
})
