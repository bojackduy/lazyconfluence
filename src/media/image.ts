import { readFileSync } from "node:fs"
import { inflateSync } from "node:zlib"
import { Resvg } from "@resvg/resvg-js"
import { decode as decodeJpegBytes } from "jpeg-js"

export interface DecodedImage {
  width: number
  height: number
  rgba: Uint8Array
  grayscale: Float32Array
  format: "png" | "jpeg" | "svg"
  rasterPng?: Uint8Array
}

const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const maxSvgInputBytes = 2 * 1024 * 1024
const maxSvgSourceDimension = 4096
const maxSvgSourcePixels = 16 * 1024 * 1024
const maxSvgRasterDimension = 1024
const maxSvgRasterPixels = 1024 * 1024

export function decodeImageFile(filePath: string): DecodedImage {
  const bytes = readFileSync(filePath)

  if (isPng(bytes)) return decodePng(bytes)
  if (isJpeg(bytes)) return decodeJpeg(bytes)
  if (isSvg(bytes)) return decodeSvg(bytes)

  throw new Error("Unsupported cached image format. PNG, JPEG, and SVG are supported in this preview renderer.")
}

function isPng(bytes: Uint8Array) {
  return pngSignature.every((byte, index) => bytes[index] === byte)
}

function isJpeg(bytes: Uint8Array) {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
}

function isSvg(bytes: Uint8Array) {
  return /<svg\b/i.test(new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 4096))))
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

function decodeJpeg(bytes: Uint8Array): DecodedImage {
  try {
    const image = decodeJpegBytes(bytes, { useTArray: true, formatAsRGBA: true })
    const rgba = new Uint8Array(image.data)

    if (!image.width || !image.height || rgba.length !== image.width * image.height * 4) {
      throw new Error("decoded pixel data is invalid")
    }

    return { width: image.width, height: image.height, rgba, grayscale: grayscaleFromRgba(rgba), format: "jpeg" }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    throw new Error(`Invalid JPEG: ${message}`)
  }
}

function decodeSvg(bytes: Uint8Array): DecodedImage {
  if (bytes.length > maxSvgInputBytes) throw new Error(`SVG preview rejected: source exceeds the ${maxSvgInputBytes / 1024 / 1024} MiB limit.`)

  let source: string
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    throw new Error("Invalid SVG: source is not valid UTF-8.")
  }

  const rasterSource = convertSvgForeignObjectsToText(source)
  validateSvgSource(rasterSource)

  try {
    const probe = new Resvg(rasterSource, svgRenderOptions())
    validateSvgDimensions(probe.width, probe.height)

    const targetWidth = svgRasterWidth(probe.width, probe.height)
    const rendered = new Resvg(rasterSource, svgRenderOptions(targetWidth)).render()
    const rgba = new Uint8Array(rendered.pixels)

    if (!rendered.width || !rendered.height || rgba.length !== rendered.width * rendered.height * 4) {
      throw new Error("rasterized pixel data is invalid")
    }

    return {
      width: rendered.width,
      height: rendered.height,
      rgba,
      grayscale: grayscaleFromRgba(rgba),
      format: "svg",
      rasterPng: new Uint8Array(rendered.asPng()),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.startsWith("SVG preview rejected:")) throw error

    throw new Error(`Invalid SVG: ${message}`)
  }
}

function svgRenderOptions(width?: number) {
  return {
    ...(width ? { fitTo: { mode: "width" as const, value: width } } : {}),
    font: { loadSystemFonts: true, defaultFontFamily: "sans-serif" },
    background: "rgba(0, 0, 0, 0)",
  }
}

function validateSvgSource(source: string) {
  if (!/<svg\b/i.test(source)) throw new Error("SVG preview rejected: missing SVG root element.")
  if (/<!doctype\b|<!entity\b/i.test(source)) throw new Error("SVG preview rejected: DOCTYPE and ENTITY declarations are not allowed.")
  if (/<\s*(?:script|iframe|object|embed)\b/i.test(source)) throw new Error("SVG preview rejected: executable or embedded document elements are not allowed.")
  if (/(?:xlink:)?href\s*=\s*(?:(["'])\s*(?!#)[\s\S]*?\1|(?!["'#\s])[^>\s]+)/i.test(source)) throw new Error("SVG preview rejected: external or embedded resource references are not allowed.")
  if (/@import\b/i.test(source) || hasExternalSvgCssResource(source)) throw new Error("SVG preview rejected: CSS resource references are not allowed.")
}

function convertSvgForeignObjectsToText(source: string) {
  return source
    .replace(/<foreignobject\b([^>]*)\/\s*>/gi, "")
    .replace(/<foreignobject\b([^>]*)>([\s\S]*?)<\/foreignobject\s*>/gi, (_match, attributes: string, html: string) => foreignObjectTextElement(attributes, html))
}

function foreignObjectTextElement(attributes: string, html: string) {
  const x = numericAttribute(attributes, "x")
  const y = numericAttribute(attributes, "y")
  const width = numericAttribute(attributes, "width")
  const height = numericAttribute(attributes, "height")
  const lines = foreignObjectLines(html)

  if (x === null || y === null || width === null || height === null || !lines.length) return ""

  const styles = [attributeValue(attributes, "style") ?? "", ...[...html.matchAll(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/gi)].map((match) => match[2])].join(";")
  const fontSize = numericStyle(styles, "font-size") ?? 12
  const lineHeight = numericStyle(styles, "line-height") ?? fontSize * 1.2
  const fill = styleValue(styles, "color") ?? "#111827"
  const family = styleValue(styles, "font-family") ?? "sans-serif"
  const weight = styleValue(styles, "font-weight")
  const alignment = styleValue(styles, "text-align")
  const anchor = alignment === "left" ? "start" : alignment === "right" ? "end" : "middle"
  const textX = anchor === "start" ? x : anchor === "end" ? x + width : x + width / 2
  const textY = y + height / 2 - ((lines.length - 1) * lineHeight) / 2
  const fontWeight = weight && /^(?:bold|[5-9]\d\d)$/i.test(weight) ? ` font-weight="${escapeXml(weight)}"` : ""
  const lineElements = lines.map((line, index) => `<tspan x="${textX}" dy="${index ? lineHeight : 0}">${escapeXml(line)}</tspan>`).join("")

  return `<text x="${textX}" y="${textY}" text-anchor="${anchor}" dominant-baseline="middle" fill="${escapeXml(fill)}" font-family="${escapeXml(family)}" font-size="${fontSize}"${fontWeight}>${lineElements}</text>`
}

function foreignObjectLines(html: string) {
  const text = html
    .replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)\s*>/gi, "")
    .replace(/<\s*br\b[^>]*\/?>/gi, "\n")
    .replace(/<\s*\/(?:div|p|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")

  return decodeHtmlEntities(text)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
}

function numericAttribute(attributes: string, name: string) {
  const value = attributeValue(attributes, name)
  if (!value || value.includes("%")) return null

  const number = Number.parseFloat(value)

  return Number.isFinite(number) ? number : null
}

function attributeValue(attributes: string, name: string) {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`, "i").exec(attributes)

  return match?.[2] ?? null
}

function styleValue(styles: string, name: string) {
  const matches = [...styles.matchAll(new RegExp(`${name}\\s*:\\s*([^;]+)`, "gi"))]

  return matches.at(-1)?.[1].trim() ?? null
}

function numericStyle(styles: string, name: string) {
  const value = styleValue(styles, name)
  if (!value) return null

  const number = Number.parseFloat(value)

  return Number.isFinite(number) ? number : null
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&#x([\da-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_match, name: string) => ({ amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " })[name.toLowerCase()] ?? _match)
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&apos;" })[character] ?? character)
}

function hasExternalSvgCssResource(source: string) {
  for (const match of source.matchAll(/url\s*\(\s*([^)]*?)\s*\)/gi)) {
    const reference = match[1].trim().replace(/^['"]|['"]$/g, "")
    if (!reference.startsWith("#")) return true
  }

  return false
}

function validateSvgDimensions(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("SVG preview rejected: dimensions are invalid.")
  }
  if (width > maxSvgSourceDimension || height > maxSvgSourceDimension || width * height > maxSvgSourcePixels) {
    throw new Error("SVG preview rejected: source dimensions exceed the preview limit.")
  }
}

function svgRasterWidth(width: number, height: number) {
  const scale = Math.min(1, maxSvgRasterDimension / Math.max(width, height), Math.sqrt(maxSvgRasterPixels / (width * height)))

  return Math.max(1, Math.floor(width * scale))
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
