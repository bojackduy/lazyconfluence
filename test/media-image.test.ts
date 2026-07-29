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

  test("rasterizes safe SVG previews locally", async () => {
    await withBytes("diagram.svg", Buffer.from(safeSvg), (path) => {
      const image = decodeImageFile(path)

      expect(image).toMatchObject({ format: "svg", width: 20, height: 10 })
      expect(image.rgba).toHaveLength(20 * 10 * 4)
      expect(image.grayscale).toHaveLength(20 * 10)
      expect([...image.rasterPng?.subarray(0, 8) ?? []]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    })
  })

  test("rejects unsafe SVG features before rasterization", async () => {
    const cases = [
      ["script", '<svg><script>alert(1)</script></svg>', "executable or embedded document elements"],
      ["external image", '<svg><image href="https://example.com/image.png" /></svg>', "external or embedded resource references"],
      ["unquoted external image", "<svg><image href=https://example.com/image.png /></svg>", "external or embedded resource references"],
      ["embedded image", '<svg><image href="data:image/png;base64,AAAA" /></svg>', "external or embedded resource references"],
      ["css URL", '<svg><style>.diagram { fill: url(https://example.com/pattern.svg) }</style></svg>', "CSS resource references"],
      ["doctype", '<!DOCTYPE svg><svg />', "DOCTYPE and ENTITY declarations"],
    ] as const

    for (const [name, source, message] of cases) {
      await withBytes(`${name}.svg`, Buffer.from(source), (path) => {
        expect(() => decodeImageFile(path)).toThrow(message)
      })
    }
  })

  test("converts foreignObject labels into rasterized SVG text", async () => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="30"><rect width="80" height="30" fill="#ffffff" /><foreignObject x="0" y="0" width="80" height="30" style="font-size: 16px; color: #000000; text-align: center"><div>HTML label</div></foreignObject></svg>'

    await withBytes("foreign-object.svg", Buffer.from(source), (path) => {
      const image = decodeImageFile(path)

      expect(image).toMatchObject({ format: "svg", width: 80, height: 30 })
      expect(image.rasterPng).toBeDefined()
      expect(hasDarkPixel(image.rgba)).toBe(true)
    })
  })

  test("rejects oversized SVG dimensions", async () => {
    await withBytes("oversized.svg", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="5000" height="1"></svg>'), (path) => {
      expect(() => decodeImageFile(path)).toThrow("source dimensions exceed the preview limit")
    })
  })

  test("rejects oversized SVG source files", async () => {
    const source = `<svg xmlns="http://www.w3.org/2000/svg">${" ".repeat(2 * 1024 * 1024)}</svg>`

    await withBytes("oversized-source.svg", Buffer.from(source), (path) => {
      expect(() => decodeImageFile(path)).toThrow("source exceeds the 2 MiB limit")
    })
  })

  test("allows local SVG fragment references", async () => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><defs><rect id="square" width="10" height="10" fill="#38bdf8" /></defs><use href="#square" /></svg>'

    await withBytes("fragment.svg", Buffer.from(source), (path) => {
      expect(decodeImageFile(path).format).toBe("svg")
    })
  })

  test("reports malformed JPEG data clearly", async () => {
    await withBytes("broken.jpg", Buffer.from([0xff, 0xd8, 0xff, 0x00]), (path) => {
      expect(() => decodeImageFile(path)).toThrow("Invalid JPEG:")
    })
  })

  test("reports unsupported cached image formats", async () => {
    await withBytes("preview.gif", Buffer.from("not an image"), (path) => {
      expect(() => decodeImageFile(path)).toThrow("PNG, JPEG, and SVG are supported")
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

function hasDarkPixel(rgba: Uint8Array) {
  for (let index = 0; index < rgba.length; index += 4) {
    if (rgba[index] < 60 && rgba[index + 1] < 60 && rgba[index + 2] < 60 && rgba[index + 3] > 0) return true
  }

  return false
}

const tinyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"
const safeSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10" viewBox="0 0 20 10"><defs><linearGradient id="blue"><stop stop-color="#38bdf8" /></linearGradient></defs><rect width="20" height="10" fill="url(#blue)" /></svg>'
