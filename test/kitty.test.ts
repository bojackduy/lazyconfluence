import { describe, expect, test } from "bun:test"
import { kittyDeleteImageCommand, kittyGraphicsCommand, kittyGraphicsFileCommand, kittyGraphicsPngCommand, kittyImageId } from "../src/tui/kitty"

describe("Kitty graphics protocol", () => {
  test("builds a direct transmit-and-display command", () => {
    const command = kittyGraphicsCommand({
      id: 42,
      width: 1,
      height: 1,
      columns: 2,
      rows: 1,
      rgba: new Uint8Array([255, 0, 0, 255]),
    })

    expect(command).toBe("\x1b_Ga=T,f=32,s=1,v=1,c=2,r=1,i=42,q=2,m=0;/wAA/w==\x1b\\")
  })

  test("chunks large payloads", () => {
    const command = kittyGraphicsCommand({
      id: 7,
      width: 40,
      height: 40,
      columns: 10,
      rows: 5,
      rgba: new Uint8Array(40 * 40 * 4).fill(255),
    })

    expect(command).toContain("m=1;")
    expect(command).toContain("\x1b_Gm=0;")
  })

  test("builds a compact PNG file transfer command", () => {
    const command = kittyGraphicsFileCommand({ id: 42, path: "/tmp/image.png", columns: 12, rows: 8, size: 1234 })

    expect(command).toBe(`\x1b_Ga=T,f=100,t=f,c=12,r=8,i=42,q=2,S=1234;${Buffer.from("/tmp/image.png").toString("base64")}\x1b\\`)
  })

  test("builds a direct PNG transmit-and-display command", () => {
    const bytes = Buffer.from("tiny png bytes")
    const command = kittyGraphicsPngCommand({ id: 42, bytes, columns: 12, rows: 8 })

    expect(command).toBe(`\x1b_Ga=T,f=100,c=12,r=8,i=42,q=2,m=0;${bytes.toString("base64")}\x1b\\`)
    expect(command).not.toContain("t=f")
  })

  test("chunks direct PNG payloads", () => {
    const command = kittyGraphicsPngCommand({ id: 7, bytes: new Uint8Array(5000).fill(255), columns: 10, rows: 5 })

    expect(command).toContain("a=T,f=100,c=10,r=5,i=7,q=2,m=1;")
    expect(command).toContain("\x1b_Gm=0;")
  })

  test("builds delete commands and stable numeric ids", () => {
    expect(kittyDeleteImageCommand(42)).toBe("\x1b_Ga=d,d=i,i=42,q=2;\x1b\\")
    expect(kittyImageId("page:image:path")).toBe(kittyImageId("page:image:path"))
    expect(kittyImageId("page:image:path")).not.toBe(kittyImageId("other"))
  })
})
