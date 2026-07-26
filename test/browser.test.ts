import { describe, expect, test } from "bun:test"
import { browserCommandForUrl, openBrowserUrl } from "../src/browser"

const pageUrl = "https://example.atlassian.net/wiki/spaces/ENG/pages/100/Engineering+Home?source=lazyconfluence"

describe("browser launcher", () => {
  test("builds platform-specific browser commands", () => {
    expect(browserCommandForUrl(pageUrl, "darwin")).toEqual({ command: "open", args: [pageUrl] })
    expect(browserCommandForUrl(pageUrl, "linux")).toEqual({ command: "xdg-open", args: [pageUrl] })
    expect(browserCommandForUrl(pageUrl, "win32")).toEqual({ command: "cmd.exe", args: ["/d", "/s", "/c", `start "" "${pageUrl}"`] })
  })

  test("rejects local and malformed URLs", () => {
    expect(() => browserCommandForUrl("local://page-create/123", "darwin")).toThrow("Only http and https")
    expect(() => browserCommandForUrl("not a URL", "darwin")).toThrow("valid browser URL")
  })

  test("reports launcher failures without throwing", () => {
    const result = openBrowserUrl(pageUrl, { platform: "darwin", launch: () => { throw new Error("open is unavailable") } })
    expect(result).toEqual({ status: "blocked", reason: "open is unavailable" })
  })

  test("passes the normalized URL to the injected launcher", () => {
    const calls: BrowserCall[] = []
    const result = openBrowserUrl("https://example.atlassian.net/wiki", { platform: "linux", launch: (command, args) => calls.push({ command, args }) })

    expect(result).toEqual({ status: "opened", url: "https://example.atlassian.net/wiki" })
    expect(calls).toEqual([{ command: "xdg-open", args: ["https://example.atlassian.net/wiki"] }])
  })
})

type BrowserCall = { command: string; args: string[] }
