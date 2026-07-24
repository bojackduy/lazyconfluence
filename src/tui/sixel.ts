export interface SixelImageInput {
  width: number
  height: number
  rgba: Uint8Array
}

const sixelPalette = [
  [0, 0, 0],
  [85, 85, 85],
  [170, 170, 170],
  [255, 255, 255],
  [170, 0, 0],
  [0, 170, 0],
  [170, 85, 0],
  [0, 0, 170],
  [170, 0, 170],
  [0, 170, 170],
  [255, 85, 85],
  [85, 255, 85],
  [255, 255, 85],
  [85, 85, 255],
  [255, 85, 255],
  [85, 255, 255],
] as const

export function sixelImageCommand(input: SixelImageInput) {
  const width = Math.max(1, Math.floor(input.width))
  const height = Math.max(1, Math.floor(input.height))
  const indexed = indexedPixels(input.rgba, width, height)
  const parts: string[] = [`\x1bPq\"1;1;${width};${height}`]

  for (let index = 0; index < sixelPalette.length; index += 1) {
    const [red, green, blue] = sixelPalette[index]
    parts.push(`#${index};2;${toSixelPercent(red)};${toSixelPercent(green)};${toSixelPercent(blue)}`)
  }

  for (let y = 0; y < height; y += 6) {
    for (let color = 0; color < sixelPalette.length; color += 1) {
      let line = `#${color}`
      let runChar = ""
      let runLength = 0

      for (let x = 0; x < width; x += 1) {
        let bits = 0
        for (let bit = 0; bit < 6; bit += 1) {
          const py = y + bit
          if (py >= height) continue
          if (indexed[py * width + x] === color) bits |= 1 << bit
        }

        const char = String.fromCharCode(63 + bits)
        if (char === runChar) {
          runLength += 1
        } else {
          line += encodeRun(runChar, runLength)
          runChar = char
          runLength = 1
        }
      }

      line += encodeRun(runChar, runLength)
      parts.push(line)
      if (color < sixelPalette.length - 1) parts.push("$")
    }
    if (y + 6 < height) parts.push("-")
  }

  parts.push("\x1b\\")
  return parts.join("")
}

function indexedPixels(rgba: Uint8Array, width: number, height: number) {
  const indexed = new Uint8Array(width * height)

  for (let source = 0, target = 0; source < rgba.length && target < indexed.length; source += 4, target += 1) {
    const alpha = rgba[source + 3]
    if (alpha < 16) {
      indexed[target] = 0
      continue
    }

    indexed[target] = nearestPaletteColor(rgba[source], rgba[source + 1], rgba[source + 2])
  }

  return indexed
}

function nearestPaletteColor(red: number, green: number, blue: number) {
  let best = 0
  let bestDistance = Number.POSITIVE_INFINITY

  for (let index = 0; index < sixelPalette.length; index += 1) {
    const [paletteRed, paletteGreen, paletteBlue] = sixelPalette[index]
    const distance = (red - paletteRed) ** 2 + (green - paletteGreen) ** 2 + (blue - paletteBlue) ** 2
    if (distance < bestDistance) {
      best = index
      bestDistance = distance
    }
  }

  return best
}

function encodeRun(char: string, length: number) {
  if (!char || length <= 0) return ""
  if (length > 3) return `!${length}${char}`

  return char.repeat(length)
}

function toSixelPercent(value: number) {
  return Math.round(value / 255 * 100)
}
