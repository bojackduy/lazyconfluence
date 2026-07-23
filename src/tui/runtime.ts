import type { RuntimeEnv } from "../runtime/env"
import type { CredentialStatus } from "../config"
import { createDevRuntimeSource, devCredentialStatus } from "./dev/source"
import { createProdRuntimeSource } from "./prod/source"
import type { TuiSource } from "./source"

export interface TuiRuntime {
  env: RuntimeEnv
  label: string
  source: TuiSource
  credentialStatus?: CredentialStatus
}

export function createTuiRuntime(input: { env: RuntimeEnv }): TuiRuntime {
  return input.env === "dev" ? createDevTuiRuntime() : createProdTuiRuntime()
}

export function createDevTuiRuntime(): TuiRuntime {
  return {
    env: "dev",
    label: "DEV mock",
    source: createDevRuntimeSource(),
    credentialStatus: devCredentialStatus,
  }
}

export function createProdTuiRuntime(): TuiRuntime {
  return {
    env: "prod",
    label: "PROD local",
    source: createProdRuntimeSource(),
  }
}
