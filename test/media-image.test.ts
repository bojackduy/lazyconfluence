import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { encode as encodeJpeg } from "jpeg-js"
import { decodeImageFile } from "../src/media/image"

describe("cached image decoding", () => {
  test("keeps decoding supported PNG previews", async () => {
    await withFixture("preview.png", tinyPngBase64, (path) => {
      const image = decodeImageFile(path)

      expect(image).toMatchObject({ format: "png", width: 1, height: 1 })
      expect(image.rgba).toHaveLength(4)
      expect(image.grayscale).toHaveLength(1)
    })
  })

  test("decodes JPEG and JPG cached previews", async () => {
    await withBytes("preview.jpg", tinyJpegBytes(), (path) => {
      const image = decodeImageFile(path)

      expect(image).toMatchObject({ format: "jpeg", width: 2, height: 1 })
      expect(image.rgba).toHaveLength(8)
      expect(image.grayscale).toHaveLength(2)
      expect(image.rgba[3]).toBe(255)
      expect(image.rgba[7]).toBe(255)
    })

    await withBytes("preview.jpeg", tinyJpegBytes(), (path) => {
      expect(decodeImageFile(path).format).toBe("jpeg")
    })
  })

  test("leaves SVG previews for sync-time Chromium rasterization", async () => {
    await withBytes("diagram.svg", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10" />'), (path) => {
      expect(() => decodeImageFile(path)).toThrow("PNG and JPEG are supported")
    })
  })

  test("reports malformed JPEG data clearly", async () => {
    await withBytes("broken.jpg", Buffer.from([0xff, 0xd8, 0xff, 0x00]), (path) => {
      expect(() => decodeImageFile(path)).toThrow("Invalid JPEG:")
    })
  })

  test("reports unsupported cached image formats", async () => {
    await withBytes("preview.gif", Buffer.from("not an image"), (path) => {
      expect(() => decodeImageFile(path)).toThrow("PNG and JPEG are supported")
    })
  })
})

async function withFixture(filename: string, base64: string, callback: (path: string) => void) {
  return withBytes(filename, Buffer.from(base64, "base64"), callback)
}

async function withBytes(filename: string, bytes: Uint8Array, callback: (path: string) => void) {
  const directory = await mkdtemp(join(tmpdir(), "lazyconfluence-media-image-"))
  const path = join(directory, filename)

  try {
    await writeFile(path, bytes)
    callback(path)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function tinyJpegBytes() {
  return encodeJpeg({ data: Buffer.from([255, 0, 0, 255, 0, 0, 255, 255]), width: 2, height: 1 }, 90).data
}

const tinyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"
