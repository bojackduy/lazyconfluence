import { homedir } from "node:os"
import { join } from "node:path"

export interface ConfigPaths {
  configDir: string
  configFile: string
  credentialFile: string
  themesDir: string
}

export function resolveConfigPaths(env: NodeJS.ProcessEnv = process.env): ConfigPaths {
  const configDir = env.LAZYCONFLUENCE_CONFIG_HOME || defaultConfigDir(env)

  return {
    configDir,
    configFile: join(configDir, "config.json"),
    credentialFile: join(configDir, "atlassian.env"),
    themesDir: join(configDir, "themes"),
  }
}

function defaultConfigDir(env: NodeJS.ProcessEnv) {
  if (process.platform === "win32") {
    return join(env.APPDATA || join(homedir(), "AppData", "Roaming"), "lazyconfluence")
  }

  return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "lazyconfluence")
}
