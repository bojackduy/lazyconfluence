import { describe, expect, test } from "bun:test"
import { filterRemoteSpaces, mergeRemoteSpaces, remotePageStatus } from "../src/tui/remote-space-picker"

describe("remote space picker", () => {
  test("filters loaded remote spaces and preserves earlier pages when appending", () => {
    const loaded = mergeRemoteSpaces(
      [{ id: "1", key: "ENG", name: "Engineering" }],
      [{ id: "1", key: "ENG", name: "Engineering" }, { id: "2", key: "OPS", name: "Operations" }],
    )

    expect(loaded.map((space) => space.key)).toEqual(["ENG", "OPS"])
    expect(filterRemoteSpaces(loaded, "ops").map((space) => space.key)).toEqual(["OPS"])
    expect(remotePageStatus(50, "/wiki/api/v2/spaces?cursor=next")).toBe("50 loaded · more available")
    expect(remotePageStatus(50, null)).toBe("50 loaded · complete")
  })
})
