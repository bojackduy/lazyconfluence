import { readFileSync } from "node:fs"
import { inflateSync } from "node:zlib"

export interface DecodedImage {
  width: number
  height: number
  rgba: Uint8Array
  grayscale: Float32Array
  format: "png"
}

const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export function decodeImageFile(filePath: string): DecodedImage {
  const bytes = readFileSync(filePath)

  if (isPng(bytes)) return decodePng(bytes)

  throw new Error("Unsupported cached image format. PNG is supported in this preview renderer.")
}

function isPng(bytes: Uint8Array) {
  return pngSignature.every((byte, index) => bytes[index] === byte)
}

function decodePng(bytes: Uint8Array): DecodedImage {
  let offset = pngSignature.length
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idatChunks: Uint8Array[] = []

  while (offset + 12 <= bytes.length) {
    const length = readUInt32(bytes, offset)
    const type = Buffer.from(bytes.subarray(offset + 4, offset + 8)).toString("ascii")
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    const data = bytes.subarray(dataStart, dataEnd)

    if (type === "IHDR") {
      width = readUInt32(data, 0)
      height = readUInt32(data, 4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === "IDAT") {
      idatChunks.push(data)
    } else if (type === "IEND") {
      break
    }

    offset = dataEnd + 4
  }

  if (!width || !height) throw new Error("Invalid PNG: missing dimensions.")
  if (bitDepth !== 8) throw new Error(`Unsupported PNG bit depth: ${bitDepth}.`)
  if (interlace !== 0) throw new Error("Unsupported PNG interlace mode.")

  const bytesPerPixel = pngBytesPerPixel(colorType)
  const inflated = inflateSync(Buffer.concat(idatChunks.map((chunk) => Buffer.from(chunk))))
  const scanlineBytes = width * bytesPerPixel
  const unfiltered = new Uint8Array(height * scanlineBytes)
  let readOffset = 0

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[readOffset]
    readOffset += 1
    const rowStart = y * scanlineBytes
    const previousRowStart = rowStart - scanlineBytes

    for (let x = 0; x < scanlineBytes; x += 1) {
      const raw = inflated[readOffset + x]
      const left = x >= bytesPerPixel ? unfiltered[rowStart + x - bytesPerPixel] : 0
      const up = y > 0 ? unfiltered[previousRowStart + x] : 0
      const upLeft = y > 0 && x >= bytesPerPixel ? unfiltered[previousRowStart + x - bytesPerPixel] : 0
      unfiltered[rowStart + x] = applyPngFilter(filter, raw, left, up, upLeft)
    }

    readOffset += scanlineBytes
  }

  const rgba = rgbaFromPngPixels(unfiltered, width, height, colorType, bytesPerPixel)

  return { width, height, rgba, grayscale: grayscaleFromRgba(rgba), format: "png" }
}

function pngBytesPerPixel(colorType: number) {
  if (colorType === 0) return 1
  if (colorType === 2) return 3
  if (colorType === 4) return 2
  if (colorType === 6) return 4

  throw new Error(`Unsupported PNG color type: ${colorType}.`)
}

function applyPngFilter(filter: number, raw: number, left: number, up: number, upLeft: number) {
  switch (filter) {
    case 0:
      return raw
    case 1:
      return (raw + left) & 0xff
    case 2:
      return (raw + up) & 0xff
    case 3:
      return (raw + Math.floor((left + up) / 2)) & 0xff
    case 4:
      return (raw + paeth(left, up, upLeft)) & 0xff
    default:
      throw new Error(`Unsupported PNG filter: ${filter}.`)
  }
}

function rgbaFromPngPixels(pixels: Uint8Array, width: number, height: number, colorType: number, bytesPerPixel: number) {
  const rgba = new Uint8Array(width * height * 4)
  let target = 0

  for (let source = 0; source < pixels.length; source += bytesPerPixel) {
    if (colorType === 0) {
      const value = pixels[source]
      rgba[target++] = value
      rgba[target++] = value
      rgba[target++] = value
      rgba[target++] = 255
    } else if (colorType === 2) {
      rgba[target++] = pixels[source]
      rgba[target++] = pixels[source + 1]
      rgba[target++] = pixels[source + 2]
      rgba[target++] = 255
    } else if (colorType === 4) {
      const value = pixels[source]
      rgba[target++] = value
      rgba[target++] = value
      rgba[target++] = value
      rgba[target++] = pixels[source + 1]
    } else {
      rgba[target++] = pixels[source]
      rgba[target++] = pixels[source + 1]
      rgba[target++] = pixels[source + 2]
      rgba[target++] = pixels[source + 3]
    }
  }

  return rgba
}

function paeth(left: number, up: number, upLeft: number) {
  const estimate = left + up - upLeft
  const distanceLeft = Math.abs(estimate - left)
  const distanceUp = Math.abs(estimate - up)
  const distanceUpLeft = Math.abs(estimate - upLeft)

  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) return left
  if (distanceUp <= distanceUpLeft) return up
  return upLeft
}

function grayscaleFromRgba(rgba: Uint8Array) {
  const grayscale = new Float32Array(rgba.length / 4)
  let target = 0

  for (let source = 0; source < rgba.length; source += 4) {
    const alpha = rgba[source + 3] / 255
    const luminance = (0.2126 * rgba[source] + 0.7152 * rgba[source + 1] + 0.0722 * rgba[source + 2]) / 255
    grayscale[target++] = luminance * alpha
  }

  return grayscale
}

function readUInt32(bytes: Uint8Array, offset: number) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
}
