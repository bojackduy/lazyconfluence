import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { App } from "../src/tui/app"

describe("main TUI layout", () => {
  test("renders navigator and document labels in a headless frame", async () => {
    const setup = await testRender(() => <App />, { width: 120, height: 36 })

    await setup.renderOnce()

    const frame = setup.captureCharFrame()
    setup.renderer.destroy()

    expect(frame).toContain("NAVIGATOR")
    expect(frame).toContain("DOCUMENT")
    expect(frame).toContain("j/k move")
    expect(frame).toContain("Start here for engineering norms")
  })
})
