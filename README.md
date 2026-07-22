# lazyconfluence

`lazyconfluence` is a terminal-first Confluence document browser. It syncs the Confluence spaces you choose into a local index, then lets you browse and read pages from the terminal without making remote calls during normal navigation.

## Install

`lazyconfluence` runs on [Bun](https://bun.sh/), so install Bun first:

```bash
curl -fsSL https://bun.sh/install | bash
```

Install the CLI from npm:

```bash
npm install -g @bojackduy/lazyconfluence
```

Run it:

```bash
lazyconfluence
```

## Atlassian Setup

You need four things from Atlassian before syncing Confluence content:

- Your Atlassian site URL, for example `https://example.atlassian.net`.
- Your Atlassian account email.
- An Atlassian API token for the same account.
- One or more Confluence space keys, for example `ENG` or `OPS`.

Create the API token:

1. Open <https://id.atlassian.com/manage-profile/security/api-tokens>.
2. Log in with the Atlassian account that can read the Confluence spaces you want to browse.
3. Select `Create API token`.
4. Name it something recognizable, for example `lazyconfluence`.
5. Copy the token immediately. Atlassian only shows it once.

Find a space key:

1. Open a page in the Confluence space.
2. Look at the URL. Space URLs commonly include `/wiki/spaces/SPACEKEY/...`.
3. Use the `SPACEKEY` value when `lazyconfluence init` asks for space keys.

The API token uses your own Confluence permissions. If your account cannot read a page in Confluence, `lazyconfluence` cannot sync it either.

## First Sync

Configure local credentials:

```bash
lazyconfluence init
```

The setup prompt asks for:

- `Atlassian site URL`: your site root, for example `https://example.atlassian.net`.
- `Atlassian account email`: the email you use to log in to Atlassian.
- `Space keys`: comma-separated space keys, with the first one used as the default space.
- `Atlassian API token`: the token you created above.

Credentials are stored in your local user config directory, not in this repository or in the synced page index.

Check local config and index state:

```bash
lazyconfluence doctor
```

Sync configured spaces:

```bash
lazyconfluence sync
```

Sync one space explicitly:

```bash
lazyconfluence sync --space ENG
```

After syncing, open the terminal UI:

```bash
lazyconfluence
```

Normal browsing reads from the local index. Remote Confluence requests happen only when you explicitly run `sync`.

## Common Commands

```bash
lazyconfluence                 # open the TUI
lazyconfluence tui             # open the TUI explicitly
lazyconfluence init            # configure Atlassian credentials
lazyconfluence doctor          # inspect local config and index state
lazyconfluence sync            # fetch configured spaces into the local index
lazyconfluence sync --space ENG
lazyconfluence search runbook
lazyconfluence search --all runbook
```

Local draft commands are available, but remote Confluence write-back is not implemented yet:

```bash
lazyconfluence edit <page-id>
lazyconfluence draft <page-id> --file ./page.md
lazyconfluence drafts
lazyconfluence stage <page-id>
lazyconfluence diff <page-id>
lazyconfluence preview <page-id>
lazyconfluence unstage <page-id>
lazyconfluence discard <page-id>
```

## Configuration Files

By default, config is stored under your OS user config directory:

- macOS/Linux: `$XDG_CONFIG_HOME/lazyconfluence` or `~/.config/lazyconfluence`
- Windows: `%APPDATA%/lazyconfluence`

Useful environment variables:

- `LAZYCONFLUENCE_CONFIG_HOME`: override the config directory.
- `LAZYCONFLUENCE_DB_PATH`: override the local SQLite index path.
- `ATLASSIAN_API_TOKEN`: provide the API token from the environment instead of the generated credential file.

## Developer Setup

Install dependencies:

```bash
bun install
```

Run from source:

```bash
bun run start
```

Run checks:

```bash
bun run typecheck
bun test
bun run build
```

The current product and implementation planning lives in `docs/`:

1. `docs/README.md` for product and UX direction.
2. `docs/BUILD_PLAN.md` for implementation direction.
3. `docs/OPENTUI_REFERENCE.md` for terminal UI guidance.
4. `docs/TASK_TRACKER.md` for task status.
5. `docs/subagents/*.md` for parallel work briefs.

`lazylens/` is a read-only submodule used only as reference material. Do not edit it.

## npm Publishing

This repository publishes `@bojackduy/lazyconfluence` to npm from GitHub Actions.

One-time setup:

1. Create an npm automation or granular publish token for the `@bojackduy` scope.
2. Add it to this GitHub repository as an Actions secret named `NPM_TOKEN`.
3. Make sure the package version in `package.json` is new before publishing.

Publish by creating a GitHub Release, or run the `Publish to npm` workflow manually from GitHub Actions.

For a manual publish from your machine, first verify npm auth and scope access:

```bash
npm login
npm whoami
```

The `npm whoami` result must be `bojackduy`, or the logged-in account must own an npm organization named `bojackduy`. If the account cannot publish under the `@bojackduy` scope, npm returns `404 Not Found` for `@bojackduy/lazyconfluence` even when the package name is valid.

Then publish:

```bash
bun run build
npm publish --access public
```
