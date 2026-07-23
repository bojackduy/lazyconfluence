export interface KittyGraphicsInput {
  id: number
  width: number
  height: number
  columns: number
  rows: number
  rgba: Uint8Array
}

const kittyPayloadChunkSize = 4096

export function kittyGraphicsCommand(input: KittyGraphicsInput) {
  const payload = Buffer.from(input.rgba).toString("base64")
  const chunks = chunkString(payload, kittyPayloadChunkSize)
  const commands: string[] = []

  for (let index = 0; index < chunks.length; index += 1) {
    const more = index < chunks.length - 1 ? 1 : 0
    const params = index === 0
      ? `a=T,f=32,s=${input.width},v=${input.height},c=${input.columns},r=${input.rows},i=${input.id},q=2,m=${more}`
      : `m=${more}`

    commands.push(`\x1b_G${params};${chunks[index]}\x1b\\`)
  }

  return commands.join("")
}

export function kittyDeleteImageCommand(id: number) {
  return `\x1b_Ga=d,d=i,i=${id},q=2;\x1b\\`
}

export function kittyImageId(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0) % 2147480000 + 1000
}

function chunkString(value: string, size: number) {
  const chunks: string[] = []
  for (let index = 0; index < value.length; index += size) chunks.push(value.slice(index, index + size))

  return chunks.length ? chunks : [""]
}
