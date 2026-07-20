import { describe, expect, test } from "bun:test"
import { pageSearchKeyAction } from "../src/tui/app"

const key = (name: string, sequence = name, ctrl = false) => ({ name, sequence, ctrl, meta: false })

describe("page search key routing", () => {
  test("plain j and k type into the search query", () => {
    expect(pageSearchKeyAction(key("j"))).toBe("append")
    expect(pageSearchKeyAction(key("k"))).toBe("append")
  })

  test("arrow keys move search results", () => {
    expect(pageSearchKeyAction(key("down", "\u001b[B"))).toBe("next")
    expect(pageSearchKeyAction(key("up", "\u001b[A"))).toBe("previous")
  })

  test("ctrl movement aliases do not append text", () => {
    expect(pageSearchKeyAction(key("j", "j", true))).toBe("next")
    expect(pageSearchKeyAction(key("n", "n", true))).toBe("next")
    expect(pageSearchKeyAction(key("k", "k", true))).toBe("previous")
    expect(pageSearchKeyAction(key("p", "p", true))).toBe("previous")
  })

  test("search control keys keep their control behavior", () => {
    expect(pageSearchKeyAction(key("backspace", "\b"))).toBe("delete")
    expect(pageSearchKeyAction(key("return", "\r"))).toBe("submit")
    expect(pageSearchKeyAction(key("escape", "\u001b"))).toBe("close")
  })
})
