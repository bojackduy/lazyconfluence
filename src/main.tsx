#!/usr/bin/env bun
import "@opentui/solid/preload"
import { runCli } from "./cli"

await runCli(Bun.argv.slice(2))
