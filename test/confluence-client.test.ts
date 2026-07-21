import { describe, expect, test } from "bun:test"
import { buildConfluenceAuthHeaders, ConfluenceClient, confluenceApiUrl, normalizeConfluenceBaseUrl, type FetchLike } from "../src/confluence/client"

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
