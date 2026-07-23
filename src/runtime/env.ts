export type RuntimeEnv = "dev" | "prod"

export function defaultRuntimeEnv(env: NodeJS.ProcessEnv = process.env): RuntimeEnv {
  if (env.LAZYCONFLUENCE_RUNTIME_ENV) return parseRuntimeEnv(env.LAZYCONFLUENCE_RUNTIME_ENV)

  return env.LAZYCONFLUENCE_DEMO === "1" ? "dev" : "prod"
}

export function parseRuntimeEnv(value: string): RuntimeEnv {
  if (value === "dev" || value === "demo" || value === "--dev" || value === "--demo") return "dev"
  if (value === "prod" || value === "--prod") return "prod"

  throw new Error(`Unknown runtime env: ${value}. Expected dev or prod.`)
}

export function runtimeEnvFromLegacyDemo(demo?: boolean): RuntimeEnv {
  return demo ? "dev" : "prod"
}
