# Phodrive CLI

`phodrive` uses Google Photos as cloud storage from the terminal: connect accounts, then list, upload, download, and delete files without running the Phodrive server. It requires Node.js 24.21 or newer, or Bun.

```sh
npm install --global @madkarmaa/phodrive-cli
phodrive account add you@gmail.com
phodrive file upload ./photos
phodrive --help
```

The package is published to GitHub Packages. See the [Phodrive README](https://github.com/madkarmaa/phodrive#command-line) for registry setup, getting a token, and every command.
