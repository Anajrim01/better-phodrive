<p align="center">
    <img src="./app/src/lib/assets/favicon.svg" alt="Phodrive logo" width="100" height="auto" />
    <h1 align="center">Phodrive</h1>
    <p align="center"><i>Files worth a thousand pixels.</i></p>
</p>

Use Google Photos as a cloud storage provider by spoofing a Pixel XL device to get unlimited storage.

> [!CAUTION]
> Using this project may violate Google's terms or policies and could result in your Google account being restricted or banned.

<table>
    <tr>
        <td><img src="./docs/screenshots/home-desktop-light.png" alt="Phodrive homepage on desktop in light mode" width="640" /></td>
        <td><img src="./docs/screenshots/home-mobile-light.png" alt="Phodrive homepage on mobile in light mode" width="185" /></td>
    </tr>
    <tr>
        <td><img src="./docs/screenshots/home-desktop-dark.png" alt="Phodrive homepage on desktop in dark mode" width="640" /></td>
        <td><img src="./docs/screenshots/home-mobile-dark.png" alt="Phodrive homepage on mobile in dark mode" width="185" /></td>
    </tr>
</table>

## Development

Use Node.js 24.21 or newer, or Bun.

```sh
bun install
bun --bun run dev
```

Open `http://127.0.0.1:5173`. With Node.js, use `npm install` and `npm run dev` instead.

The repository uses [Bun workspaces](https://bun.sh/docs/pm/workspaces), also supported by npm. `app/` contains the SvelteKit web app. `core/` is the standalone `@madkarmaa/phodrive-core` library for the file format, Google Photos protocol, and transfers. `cli/` is the `phodrive` command line. Root commands build core before running the app. Run the command line from source with `bun run cli <command>`, for example `bun run cli file list`. See [core usage](./core/README.md) for using the library elsewhere.

Keep environment files at the repository root, for example `.env`.

### Verification

Tests use [Vitest](https://vitest.dev/).

```sh
bun run check
bun run test
bun run build
```

## Deployment

> [!WARNING]
> Do not expose this server to other machines.
>
> The API has no user authentication. Anyone who can reach it can send Google Photos requests through your server and use your machine's network and resources.

### From source

Install dependencies with `bun install`.

To build and run with Node.js:

```sh
bun run build
bun run start
```

To build and serve using Bun:

```sh
bun --bun run build
bun run start:bun
```

Open `http://127.0.0.1:3000` for the production build.

### Docker

```sh
docker run --pull always --rm --init --name phodrive -p 127.0.0.1:3000:3000 ghcr.io/madkarmaa/phodrive:latest
```

Open `http://localhost:3000` or `http://127.0.0.1:3000`. The server derives the upload origin from the request host and port, including a different published port. To override it, pass `-e ORIGIN=http://localhost:3000` with the exact origin used in your browser.

### Deployment defaults

Settings use your saved choice first, then the deployment default, then the built-in default. Phodrive saves a browser preference only when you choose a value. Users without a saved choice receive updated deployment defaults.

| Environment variable                        | Built-in default | Allowed values                                           |
| ------------------------------------------- | ---------------- | -------------------------------------------------------- |
| `PHODRIVE_DEFAULT_REFRESH_INTERVAL_SECONDS` | `60`             | Whole seconds from `0` to `86400`; `0` disables refresh  |
| `PHODRIVE_DEFAULT_CONCURRENT_WORKERS`       | `8`              | Whole numbers from `1` to `32`                           |
| `PHODRIVE_DEFAULT_THEME`                    | `auto`           | `auto`, `light`, `dark`                                  |
| `PHODRIVE_DEFAULT_SORT`                     | `modified-desc`  | `modified-desc`, `modified-asc`, `name-asc`, `name-desc` |

Set these variables in the server environment before starting the app. Missing or invalid values use the built-in defaults. The server publishes the validated settings defaults. For example:

```sh
bunx cross-env PHODRIVE_DEFAULT_REFRESH_INTERVAL_SECONDS=120 PHODRIVE_DEFAULT_CONCURRENT_WORKERS=4 bun run start
```

For Docker, pass the same variables with `-e`, for example `-e PHODRIVE_DEFAULT_CONCURRENT_WORKERS=4`.

## Connect a Google account

1. Open the app at the address shown above for your setup.
2. Sign in at [Google Embedded Setup](https://accounts.google.com/EmbeddedSetup).
3. In developer tools, open Application, then Cookies, then `https://accounts.google.com`. Copy the cookie value starting with `oauth2_4/`.
4. Enter your Google account email and paste the token into Phodrive.

![How to get the token](./docs/screenshots/token.png)

> [!NOTE]
> Your browser stores the credentials. The server uses them for each request and does not save them.

## Command line

The `phodrive` command does everything the web app does, directly from your machine, without running the server. It is published to GitHub Packages, which requires a GitHub [personal access token (classic)](https://github.com/settings/tokens) with the `read:packages` scope, even for public packages. Add it to `~/.npmrc`:

```ini
@madkarmaa:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN
```

Then install it with `npm install --global @madkarmaa/phodrive-cli`, or run it once with `npx @madkarmaa/phodrive-cli`.

```sh
phodrive account add you@gmail.com   # prompts for the oauth2_4/ token from the steps above
phodrive file list                   # search, filter, and sort with: file list report --type pdf --days 30 --sort name-asc
phodrive file upload ./photos        # files and whole folders
phodrive file download report.pdf    # by name or by the ID shown in file list
phodrive file delete report.pdf
phodrive setting set workers 4
```

Run `phodrive help` for every command, and `phodrive help <command>`, `phodrive <command> --help`, or `-h` for its options, for example `phodrive help file upload`. Accounts are `account add`, `remove`, `list`, and `use`; files are `file list`, `upload`, `download`, and `delete`; settings are `setting show`, `set`, and `reset`.

Without a terminal, pass values as arguments and flags instead of prompts: pipe the token into `account add`, and pass `--yes` to `delete` and `account remove`. `--json` prints machine-readable lists. Downloads never replace existing files unless you pass `--force`.

Accounts and settings are saved in `config.json` in your user configuration folder, readable only by your user on macOS and Linux. Set `PHODRIVE_CONFIG` to use another file. `PHODRIVE_DEFAULT_SORT` and `PHODRIVE_DEFAULT_CONCURRENT_WORKERS` apply when no setting is saved. The command line allows up to one worker per processor, detected each time it runs, instead of the web limit of 32.

## Attribution

Copyright © 2026 MadKarma (madkarmaa). Phodrive is licensed under the MIT License; see [LICENSE](./LICENSE).

The Google Photos protocol code is based on [xob0t/gotohp](https://github.com/xob0t/gotohp) (MIT).

The Photos library request mask is based on [xob0t/gpmc](https://github.com/xob0t/gpmc) (MIT).

The OAuth2-to-AAS exchange is adapted from [xhyrom/sniff](https://github.com/xhyrom/sniff) (Apache-2.0).

The OAuth2 exchange's DroidGuard compatibility field follows [simon-weber/gpsoauth](https://github.com/simon-weber/gpsoauth) (MIT).
