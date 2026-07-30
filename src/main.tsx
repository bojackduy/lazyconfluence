#!/usr/bin/env bun
import "@opentui/solid/preload"
import { logInputDebug } from "./tui/input-debug"

logInputDebug("bootstrap_start", {
  argv: Bun.argv.slice(2).join(" "),
  bunVersion: Bun.version,
  cwd: process.cwd(),
  stdinIsTTY: Boolean(process.stdin.isTTY),
  stdoutIsTTY: Boolean(process.stdout.isTTY),
  term: process.env.TERM ?? null,
  termProgram: process.env.TERM_PROGRAM ?? null,
  tmux: Boolean(process.env.TMUX),
  sty: Boolean(process.env.STY),
})
const { runCli } = await import("./cli")
logInputDebug("preload_ready")
await runCli(Bun.argv.slice(2))
