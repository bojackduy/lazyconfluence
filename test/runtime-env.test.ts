import { describe, expect, test } from "bun:test"
import { defaultRuntimeEnv, parseRuntimeEnv, runtimeEnvFromLegacyDemo } from "../src/runtime/env"

describe("runtime environment", () => {
  test("defaults to prod unless dev is requested", () => {
    expect(defaultRuntimeEnv({} as NodeJS.ProcessEnv)).toBe("prod")
    expect(defaultRuntimeEnv({ LAZYCONFLUENCE_RUNTIME_ENV: "dev" } as NodeJS.ProcessEnv)).toBe("dev")
    expect(defaultRuntimeEnv({ LAZYCONFLUENCE_DEMO: "1" } as NodeJS.ProcessEnv)).toBe("dev")
  })

  test("parses explicit runtime aliases", () => {
    expect(parseRuntimeEnv("dev")).toBe("dev")
    expect(parseRuntimeEnv("--dev")).toBe("dev")
    expect(parseRuntimeEnv("demo")).toBe("dev")
    expect(parseRuntimeEnv("--demo")).toBe("dev")
    expect(parseRuntimeEnv("prod")).toBe("prod")
    expect(parseRuntimeEnv("--prod")).toBe("prod")
  })

  test("keeps legacy demo options as dev", () => {
    expect(runtimeEnvFromLegacyDemo(true)).toBe("dev")
    expect(runtimeEnvFromLegacyDemo(false)).toBe("prod")
  })
})
