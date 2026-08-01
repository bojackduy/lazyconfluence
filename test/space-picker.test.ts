import { describe, expect, test } from "bun:test"
import { filterRemoteSpaces, mergeRemoteSpaces, remoteSpaceWindow } from "../src/tui/app"

describe("unified space picker helpers", () => {
  test("preserves loaded remote pages and filters them by key or name", () => {
    const spaces = mergeRemoteSpaces(
      [{ id: "1", key: "ENG", name: "Engineering" }],
      [{ id: "1", key: "ENG", name: "Engineering" }, { id: "2", key: "OPS", name: "Operations" }],
    )

    expect(spaces.map((space) => space.key)).toEqual(["ENG", "OPS"])
    expect(filterRemoteSpaces(spaces, "ops").map((space) => space.key)).toEqual(["OPS"])
    expect(remoteSpaceWindow(Array.from({ length: 150 }, (_, index) => index), 8, 50)).toHaveLength(42)
  })
})
