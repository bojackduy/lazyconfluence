import { describe, expect, test } from "bun:test"
import { sixelImageCommand } from "../src/tui/sixel"

describe("Sixel image protocol", () => {
  test("builds a raster-sized payload with a 256-color palette", () => {
    const command = sixelImageCommand({
      width: 16,
      height: 16,
      rgba: new Uint8Array(16 * 16 * 4).fill(255),
    })

    expect(command).toContain("\x1bPq\"1;1;16;16")
    expect(command).toContain("#255;2;")
    expect(command).toContain("!16")
    expect(command.endsWith("\x1b\\")).toBe(true)
  })
})
