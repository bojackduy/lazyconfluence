#!/usr/bin/env bun
import "@opentui/solid/preload"

const { runCli } = await import("./cli")
await runCli(Bun.argv.slice(2))
