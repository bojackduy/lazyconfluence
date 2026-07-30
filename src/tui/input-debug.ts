import { appendFileSync, mkdirSync } from "node:fs"
import { dirname, isAbsolute, resolve } from "node:path"

type InputDebugData = Record<string, boolean | number | string | null | undefined>

export function inputDebugEnabled(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(env.LAZYCONFLUENCE_INPUT_DEBUG_LOG?.trim())
}

export function inputDebugLogPath(env: NodeJS.ProcessEnv = process.env) {
  const configured = env.LAZYCONFLUENCE_INPUT_DEBUG_LOG?.trim()
  if (!configured) return null
  return isAbsolute(configured) ? configured : resolve(configured)
}

export function logInputDebug(event: string, data: InputDebugData = {}, env: NodeJS.ProcessEnv = process.env) {
  const path = inputDebugLogPath(env)
  if (!path) return

  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    appendFileSync(path, `${JSON.stringify({ ts: new Date().toISOString(), event, ...compact(data) })}\n`, { mode: 0o600 })
  } catch {
    // Diagnostics must never interfere with terminal input or rendering.
  }
}

function compact(data: InputDebugData) {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined))
}
