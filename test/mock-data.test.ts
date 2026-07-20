import { describe, expect, test } from "bun:test"
import { extractOutline, getDefaultPageId, getPagesForSpace, getReaderPage, mockPages } from "../src/mock-data"

describe("mock data", () => {
  test("has a default page for the active space", () => {
    expect(getDefaultPageId("ENG")).toBe("eng-home")
  })

  test("returns pages for one space only", () => {
    expect(getPagesForSpace("ENG").every((page) => page.spaceKey === "ENG")).toBe(true)
  })

  test("builds reader details from page relationships", () => {
    const page = getReaderPage("eng-home")

    expect(page.children.map((child) => child.pageId)).toContain("architecture")
    expect(page.outgoingLinks.some((link) => link.targetPageId === "architecture")).toBe(true)
  })

  test("extracts second-level and lower headings for the outline", () => {
    expect(extractOutline("# Title\n\n## One\n\n### Two")).toEqual(["One", "Two"])
  })

  test("all mock page ids are unique", () => {
    const ids = new Set(mockPages.map((page) => page.pageId))

    expect(ids.size).toBe(mockPages.length)
  })
})
