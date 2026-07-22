import { describe, expect, test } from "bun:test"
import { buildConfluenceAuthHeaders, ConfluenceClient, ConfluenceClientError, confluenceApiUrl, normalizeConfluenceBaseUrl, type FetchLike } from "../src/confluence/client"

describe("Confluence client", () => {
  test("normalizes Confluence URLs and builds auth headers", () => {
    expect(normalizeConfluenceBaseUrl("https://example.atlassian.net")).toBe("https://example.atlassian.net/wiki")
    expect(normalizeConfluenceBaseUrl("https://example.atlassian.net/wiki/")).toBe("https://example.atlassian.net/wiki")
    expect(confluenceApiUrl("https://example.atlassian.net/wiki", "/wiki/api/v2/pages", { cursor: "abc" })).toBe(
      "https://example.atlassian.net/wiki/api/v2/pages?cursor=abc",
    )

    expect(buildConfluenceAuthHeaders("reader@example.com", "token")).toEqual({
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from("reader@example.com:token", "utf8").toString("base64")}`,
    })
  })

  test("resolves configured spaces without real network access", async () => {
    const calls: string[] = []
    const client = new ConfluenceClient({
      siteUrl: "https://example.atlassian.net/wiki",
      email: "reader@example.com",
      apiToken: "token",
      fetch: jsonFetch(calls, {
        "/wiki/api/v2/spaces?keys=ENG&keys=OPS&limit=250": {
          results: [
            { id: "10", key: "ENG", name: "Engineering", homepageId: "100" },
            { id: "20", key: "OPS", name: "Operations", homepageId: "200" },
          ],
        },
      }),
    })

    const spaces = await client.resolveSpaces(["ENG", "OPS", "ENG"])

    expect(calls).toEqual(["https://example.atlassian.net/wiki/api/v2/spaces?keys=ENG&keys=OPS&limit=250"])
    expect(spaces.map((space) => space.key)).toEqual(["ENG", "OPS"])
    expect(spaces[0]?.homepageId).toBe("100")
  })

  test("fetches pages by space with pagination", async () => {
    const calls: string[] = []
    const client = new ConfluenceClient({
      siteUrl: "https://example.atlassian.net",
      email: "reader@example.com",
      apiToken: "token",
      fetch: jsonFetch(calls, {
        "/wiki/api/v2/pages?space-id=10&limit=2&body-format=storage": {
          results: [{ id: "100", title: "Home" }],
          _links: { next: "/wiki/api/v2/pages?cursor=next" },
        },
        "/wiki/api/v2/pages?cursor=next": {
          results: [{ id: "101", title: "Architecture" }],
          _links: {},
        },
      }),
    })

    const pages = await client.fetchPagesBySpace("10", { limit: 2, bodyFormat: "storage" })

    expect(calls).toEqual([
      "https://example.atlassian.net/wiki/api/v2/pages?space-id=10&limit=2&body-format=storage",
      "https://example.atlassian.net/wiki/api/v2/pages?cursor=next",
    ])
    expect(pages.map((page) => page.title)).toEqual(["Home", "Architecture"])
  })

  test("fetches a page body and direct children", async () => {
    const calls: string[] = []
    const client = new ConfluenceClient({
      siteUrl: "https://example.atlassian.net/wiki",
      email: "reader@example.com",
      apiToken: "token",
      fetch: jsonFetch(calls, {
        "/wiki/api/v2/pages/100?body-format=storage": {
          id: "100",
          title: "Home",
          body: { storage: { value: "<p>Hello</p>" } },
        },
        "/wiki/api/v2/pages/100/direct-children?limit=250": {
          results: [{ id: "101", title: "Child", parentId: "100" }],
          _links: {},
        },
      }),
    })

    const page = await client.fetchPageBody("100")
    const children = await client.fetchDirectChildren("100")

    expect(page.body?.storage?.value).toBe("<p>Hello</p>")
    expect(children.map((child) => child.parentId)).toEqual(["100"])
    expect(calls).toEqual([
      "https://example.atlassian.net/wiki/api/v2/pages/100?body-format=storage",
      "https://example.atlassian.net/wiki/api/v2/pages/100/direct-children?limit=250",
    ])
  })

  test("updates a page with Confluence storage", async () => {
    const calls: Array<{ url: string; method?: string; body?: string; contentType?: string }> = []
    const client = new ConfluenceClient({
      siteUrl: "https://example.atlassian.net/wiki",
      email: "reader@example.com",
      apiToken: "token",
      fetch: async (url, init) => {
        calls.push({ url, method: init?.method, body: init?.body, contentType: init?.headers?.["Content-Type"] })
        return response({ id: "100", title: "Home", version: { number: 8 } })
      },
    })

    const updated = await client.updatePage({ id: "100", title: "Home", storageValue: "<p>Updated</p>", versionNumber: 8, message: "test apply" })

    expect(updated.version?.number).toBe(8)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      url: "https://example.atlassian.net/wiki/api/v2/pages/100",
      method: "PUT",
      contentType: "application/json",
    })
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      id: "100",
      status: "current",
      title: "Home",
      body: { representation: "storage", value: "<p>Updated</p>" },
      version: { number: 8, message: "test apply" },
    })
  })

  test("creates a page with Confluence storage", async () => {
    const calls: Array<{ url: string; method?: string; body?: string; contentType?: string }> = []
    const client = new ConfluenceClient({
      siteUrl: "https://example.atlassian.net/wiki",
      email: "reader@example.com",
      apiToken: "token",
      fetch: async (url, init) => {
        calls.push({ url, method: init?.method, body: init?.body, contentType: init?.headers?.["Content-Type"] })
        return response({ id: "101", title: "New Page", parentId: "100", version: { number: 1 } })
      },
    })

    const created = await client.createPage({ spaceId: "10", parentId: "100", title: "New Page", storageValue: "<h1>New Page</h1>" })

    expect(created.id).toBe("101")
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      url: "https://example.atlassian.net/wiki/api/v2/pages",
      method: "POST",
      contentType: "application/json",
    })
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      spaceId: "10",
      parentId: "100",
      status: "current",
      title: "New Page",
      body: { representation: "storage", value: "<h1>New Page</h1>" },
    })
  })

  test("times out requests that do not finish", async () => {
    const calls: string[] = []
    const client = new ConfluenceClient({
      siteUrl: "https://example.atlassian.net/wiki",
      email: "reader@example.com",
      apiToken: "token",
      requestTimeoutMs: 1,
      fetch: async (url, init) => {
        calls.push(url)

        return new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Request aborted", "AbortError")), { once: true })
        })
      },
    })

    let error: unknown
    try {
      await client.resolveSpaces(["ENG"])
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(ConfluenceClientError)
    expect(error instanceof Error ? error.message : "").toContain("Confluence request timed out after 1ms")
    expect(calls[0]).toBe("https://example.atlassian.net/wiki/api/v2/spaces?keys=ENG&limit=250")
  })
})

function jsonFetch(calls: string[], responses: Record<string, unknown>): FetchLike {
  return async (url) => {
    calls.push(url)
    const path = new URL(url).pathname + new URL(url).search
    const body = responses[path]

    if (!body) {
      return response({ message: `missing fixture for ${path}` }, false, 404, "Not Found")
    }

    return response(body)
  }
}

function response(body: unknown, ok = true, status = 200, statusText = "OK") {
  return {
    ok,
    status,
    statusText,
    json: async () => body,
  }
}
