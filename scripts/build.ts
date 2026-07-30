import solidPlugin from "@opentui/solid/bun-plugin"
import { rm } from "node:fs/promises"

await rm("dist", { recursive: true, force: true })
const result = await Bun.build({
  entrypoints: ["src/main.tsx"],
  target: "bun",
  conditions: ["browser"],
  outdir: "dist",
  splitting: true,
  external: ["@opentui/core", "@opentui/core-*", "@resvg/resvg-js", "playwright-core", "playwright-core/*"],
  plugins: [solidPlugin],
})

if (!result.success) process.exitCode = 1
