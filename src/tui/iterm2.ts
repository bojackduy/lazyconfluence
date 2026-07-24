export interface Iterm2ImageInput {
  bytes: Uint8Array
  name: string
  columns: number
  rows: number
}

export function iterm2ImageCommand(input: Iterm2ImageInput) {
  const name = Buffer.from(input.name).toString("base64")
  const payload = Buffer.from(input.bytes).toString("base64")
  const width = `${Math.max(1, Math.floor(input.columns))}`
  const height = `${Math.max(1, Math.floor(input.rows))}`

  return `\x1b]1337;File=name=${name};size=${input.bytes.length};inline=1;width=${width};height=${height};preserveAspectRatio=1;doNotMoveCursor=1:${payload}\x07`
}
