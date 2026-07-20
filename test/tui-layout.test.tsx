import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { App } from "../src/tui/app"
import type { CredentialStatus } from "../src/config"

const missingConfigStatus: CredentialStatus = {
  kind: "missing-config",
  title: "Mock mode: no Atlassian credentials configured",
  detail: "You can keep using mock data. Run setup when you are ready to connect Confluence.",
  help: ["Run: bun run start init", "Generate API token: https://id.atlassian.com/manage-profile/security/api-tokens"],
  paths: {
    configDir: "/tmp/lazyconfluence",
    configFile: "/tmp/lazyconfluence/config.json",
    credentialFile: "/tmp/lazyconfluence/atlassian.env",
  },
}

describe("main TUI layout", () => {
  test("renders navigator and document labels in a headless frame", async () => {
    const setup = await testRender(() => <App credentialStatus={missingConfigStatus} />, { width: 120, height: 36 })

    await setup.renderOnce()

    const frame = setup.captureCharFrame()
    setup.renderer.destroy()

    expect(frame).toContain("NAVIGATOR")
    expect(frame).toContain("DOCUMENT")
    expect(frame).toContain("Mock mode: no Atlassian credentials configured")
    expect(frame).toContain("Run: bun run start init")
    expect(frame).toContain("j/k move")
    expect(frame).toContain("h/l fold")
    expect(frame).toContain("s spaces")
    expect(frame).toContain("d/u scroll doc")
    expect(frame).toContain("▾ Engineering Home")
    expect(frame).toContain("▸ Project Architecture")
    expect(frame).toContain("Start here for engineering norms")
  })
})
