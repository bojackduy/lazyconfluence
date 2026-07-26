import { describe, expect, test } from "bun:test"
import { popNavigationLocation, pushNavigationLocation, type NavigationLocation } from "../src/tui/history"

const home: NavigationLocation = {
  spaceKey: "ENG",
  pageViewMode: "current",
  pageId: "100",
  expandedPageIds: ["100"],
  scrollLeft: 0,
  scrollTop: 12,
}

describe("TUI navigation history", () => {
  test("pushes locations in bounded order", () => {
    const architecture = { ...home, pageId: "101", scrollTop: 4 }
    const history = pushNavigationLocation(pushNavigationLocation([], home, 2), architecture, 2)

    expect(pushNavigationLocation(history, { ...home, pageId: "102" }, 2)).toEqual([architecture, { ...home, pageId: "102" }])
  })

  test("pops the latest location without mutating empty history", () => {
    expect(popNavigationLocation([])).toEqual({ history: [], location: null })
    expect(popNavigationLocation([home, { ...home, pageId: "101" }])).toEqual({ history: [home], location: { ...home, pageId: "101" } })
  })
})
