import type { CredentialStatus } from "../../config"
import { createDevTuiSource } from "../data"
import type { TuiSource } from "../source"

export const devCredentialStatus: CredentialStatus = {
  kind: "ready",
  auth: {
    config: {
      version: 1,
      atlassian: {
        siteUrl: "https://example.atlassian.net",
        email: "dev@example.com",
        spaceKeys: ["ENG", "OPS", "ARCH", "PLAT", "TEAM"],
        defaultSpaceKey: "ENG",
        apiTokenEnv: "ATLASSIAN_API_TOKEN",
      },
    },
    apiToken: null,
    paths: {
      configDir: "dev://lazyconfluence",
      configFile: "dev://lazyconfluence/config.json",
      credentialFile: "dev://lazyconfluence/atlassian.env",
    },
  },
}

export function createDevRuntimeSource(): TuiSource {
  return createDevTuiSource()
}
