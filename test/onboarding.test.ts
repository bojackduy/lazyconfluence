import { describe, expect, test } from "bun:test"
import { createLocalConfig } from "../src/config"
import { checkAtlassianCredentials } from "../src/onboarding"

const config = createLocalConfig({
  siteUrl: "https://example.atlassian.net",
  email: "reader@example.com",
  spaceKeys: ["ENG"],
})

describe("Atlassian credential checks", () => {
  test("validates authentication and configured spaces", async () => {
    const result = await checkAtlassianCredentials({
      config,
      apiToken: "token",
      fetch: jsonFetch({
        "/wiki/api/v2/spaces?limit=1": { results: [{ id: "10", key: "ENG", name: "Engineering" }] },
        "/wiki/api/v2/spaces?keys=ENG&limit=250": { results: [{ id: "10", key: "ENG", name: "Engineering" }] },
      }),
    })

    expect(result).toEqual({ kind: "ready", resolvedSpaceKeys: ["ENG"] })
  })

  test("explains rejected credentials without exposing the token", async () => {
    const result = await checkAtlassianCredentials({
      config,
      apiToken: "secret-token",
      fetch: jsonFetch({
        "/wiki/api/v2/spaces?limit=1": response({}, false, 401, "Unauthorized"),
      }),
    })

    expect(result.kind).toBe("invalid-credentials")
    expect(result.kind === "invalid-credentials" ? result.message : "").toContain("rejected")
    expect(JSON.stringify(result)).not.toContain("secret-token")
  })

  test("distinguishes site access failures from missing spaces", async () => {
    const denied = await checkAtlassianCredentials({
      config,
      apiToken: "token",
      fetch: jsonFetch({
        "/wiki/api/v2/spaces?limit=1": response({}, false, 403, "Forbidden"),
      }),
    })
    const missingSpace = await checkAtlassianCredentials({
      config,
      apiToken: "token",
      fetch: jsonFetch({
        "/wiki/api/v2/spaces?limit=1": { results: [] },
        "/wiki/api/v2/spaces?keys=ENG&limit=250": { results: [] },
      }),
    })

    expect(denied.kind).toBe("access-denied")
    expect(missingSpace.kind).toBe("spaces-unavailable")
  })

  test("explains an unreachable site without calling it an authentication failure", async () => {
    const result = await checkAtlassianCredentials({
      config,
      apiToken: "token",
      fetch: async () => { throw new TypeError("fetch failed") },
    })

    expect(result.kind).toBe("unreachable")
    expect(result.kind === "unreachable" ? result.help.join(" ") : "").toContain("network")
  })
})

function jsonFetch(responses: Record<string, unknown>) {
  return async (url: string) => {
    const parsed = new URL(url)
    const body = responses[`${parsed.pathname}${parsed.search}`]
    if (!body) return response({}, false, 404, "Not Found")
    return isResponse(body) ? body : response(body)
  }
}

function response(body: unknown, ok = true, status = 200, statusText = "OK") {
  return { ok, status, statusText, json: async () => body }
}

function isResponse(value: unknown): value is ReturnType<typeof response> {
  return typeof value === "object" && value !== null && "ok" in value && "json" in value
}
