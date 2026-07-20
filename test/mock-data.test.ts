import { describe, expect, test } from "bun:test"
import { extractOutline, getDefaultPageId, getPagesForSpace, getReaderPage, mockPages, mockSpaces, searchPagesInSpace, searchSpaces } from "../src/mock-data"

describe("mock data", () => {
  test("has a default page for the active space", () => {
    expect(getDefaultPageId("ENG")).toBe("eng-home")
  })

  test("returns pages for one space only", () => {
    expect(getPagesForSpace("ENG").every((page) => page.spaceKey === "ENG")).toBe(true)
  })

  test("contains several spaces for switcher design", () => {
    expect(mockSpaces.map((space) => space.key)).toEqual(["ENG", "OPS", "ARCH", "PLAT", "TEAM"])
  })

  test("space page counts match mock records", () => {
    for (const space of mockSpaces) {
      expect(space.pageCount).toBe(getPagesForSpace(space.key).length)
      expect(getDefaultPageId(space.key)).toBe(getPagesForSpace(space.key)[0]?.pageId)
    }
  })

  test("searches spaces by key and name", () => {
    expect(searchSpaces("plat")[0]?.space.key).toBe("PLAT")
    expect(searchSpaces("architecture")[0]?.space.key).toBe("ARCH")
  })

  test("empty space search returns all spaces in switcher order", () => {
    expect(searchSpaces("").map((result) => result.space.key)).toEqual(["ENG", "OPS", "ARCH", "PLAT", "TEAM"])
  })

  test("searches pages inside one active space", () => {
    const results = searchPagesInSpace("ENG", "release")

    expect(results[0]?.page.pageId).toBe("release-checklist")
    expect(results.every((result) => result.page.spaceKey === "ENG")).toBe(true)
  })

  test("active-space search does not leak matching pages from other spaces", () => {
    expect(searchPagesInSpace("ENG", "observability")).toEqual([])
    expect(searchPagesInSpace("PLAT", "observability")[0]?.page.pageId).toBe("observability")
  })

  test("empty search returns active-space pages", () => {
    const results = searchPagesInSpace("OPS", "")

    expect(results.map((result) => result.page.pageId)).toEqual(["ops-home", "incident-response", "database-saturation", "rollback-production"])
  })

  test("builds reader details from page relationships", () => {
    const page = getReaderPage("eng-home")

    expect(page.children.map((child) => child.pageId)).toContain("architecture")
    expect(page.outgoingLinks.some((link) => link.targetPageId === "architecture")).toBe(true)
  })

  test("default reader page is long enough to exercise scrolling", () => {
    const page = getReaderPage("eng-home")

    expect(page.contentMarkdown.split("\n").length).toBeGreaterThan(180)
    expect(page.outline.length).toBeGreaterThan(20)
  })

  test("extracts second-level and lower headings for the outline", () => {
    expect(extractOutline("# Title\n\n## One\n\n### Two")).toEqual(["One", "Two"])
  })

  test("all mock page ids are unique", () => {
    const ids = new Set(mockPages.map((page) => page.pageId))

    expect(ids.size).toBe(mockPages.length)
  })
})
