export interface SixelImageInput {
  width: number
  height: number
  rgba: Uint8Array
}

const sixelPalette = createSixelPalette()

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
    const colors = colorsInBand(indexed, width, height, y)
    for (let colorIndex = 0; colorIndex < colors.length; colorIndex += 1) {
      const color = colors[colorIndex]
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
      if (colorIndex < colors.length - 1) parts.push("$")
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

    indexed[target] = rgbCubePaletteIndex(rgba[source], rgba[source + 1], rgba[source + 2])
  }

  return indexed
}

function colorsInBand(indexed: Uint8Array, width: number, height: number, y: number) {
  const used = new Set<number>()
  for (let bit = 0; bit < 6; bit += 1) {
    const py = y + bit
    if (py >= height) continue
    for (let x = 0; x < width; x += 1) used.add(indexed[py * width + x])
  }

  return [...used].sort((left, right) => left - right)
}

function rgbCubePaletteIndex(red: number, green: number, blue: number) {
  const r = Math.max(0, Math.min(5, Math.round(red / 51)))
  const g = Math.max(0, Math.min(5, Math.round(green / 51)))
  const b = Math.max(0, Math.min(5, Math.round(blue / 51)))

  return 1 + r * 36 + g * 6 + b
}

function encodeRun(char: string, length: number) {
  if (!char || length <= 0) return ""
  if (length > 3) return `!${length}${char}`

  return char.repeat(length)
}

function toSixelPercent(value: number) {
  return Math.round(value / 255 * 100)
}

function createSixelPalette() {
  const palette: Array<readonly [number, number, number]> = [[0, 0, 0]]
  const steps = [0, 51, 102, 153, 204, 255]

  for (const red of steps) {
    for (const green of steps) {
      for (const blue of steps) palette.push([red, green, blue])
    }
  }

  for (let index = 0; index < 39; index += 1) {
    const value = Math.round(index * 255 / 38)
    palette.push([value, value, value])
  }

  return palette
}
