import { type LocalConfig } from "./config"
import { ConfluenceClient, ConfluenceClientError, type FetchLike } from "./confluence/client"

export type RemoteCredentialCheck =
  | { kind: "ready"; resolvedSpaceKeys: string[] }
  | { kind: "invalid-credentials"; message: string; help: string[] }
  | { kind: "access-denied"; message: string; help: string[] }
  | { kind: "invalid-site"; message: string; help: string[] }
  | { kind: "spaces-unavailable"; message: string; help: string[] }
  | { kind: "unreachable"; message: string; help: string[] }

export async function checkAtlassianCredentials(input: { config: LocalConfig; apiToken: string; fetch?: FetchLike }): Promise<RemoteCredentialCheck> {
  const client = new ConfluenceClient({
    siteUrl: input.config.atlassian.siteUrl,
    email: input.config.atlassian.email,
    apiToken: input.apiToken,
    fetch: input.fetch,
  })

  try {
    await client.validateConnection()
  } catch (error) {
    return connectionFailure(error)
  }

  try {
    const spaces = await client.resolveSpaces(input.config.atlassian.spaceKeys)
    return { kind: "ready", resolvedSpaceKeys: spaces.map((space) => space.key) }
  } catch (error) {
    return {
      kind: "spaces-unavailable",
      message: errorMessage(error),
      help: ["Check each space key against its Confluence URL.", "Confirm this Atlassian account can browse every configured space."],
    }
  }
}

function connectionFailure(error: unknown): RemoteCredentialCheck {
  if (error instanceof ConfluenceClientError) {
    if (error.status === 401) {
      return {
        kind: "invalid-credentials",
        message: "Atlassian rejected the account email or API token.",
        help: ["Use the email for the Atlassian account that created the token.", "Create a new API token if the existing token was revoked or copied incorrectly."],
      }
    }

    if (error.status === 403) {
      return {
        kind: "access-denied",
        message: "The account authenticated but cannot access this Confluence site.",
        help: ["Confirm the account has Confluence product access.", "Ask a site administrator to grant access if needed."],
      }
    }

    if (error.status === 404) {
      return {
        kind: "invalid-site",
        message: "Confluence was not found at the configured site URL.",
        help: ["Use the site root, for example https://example.atlassian.net.", "Do not use a page, space, or REST API URL."],
      }
    }
  }

  return {
    kind: "unreachable",
    message: errorMessage(error),
    help: ["Check the site URL and network connection.", "If the site is reachable in a browser, try `lazyconfluence doctor --remote` again."],
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to reach Confluence."
}
