# Phodrive core

`@phodrive/core` contains the split BMP format, chunk planning, file grouping, Google Photos protocol, and transfer logic. It has no Svelte or SvelteKit dependency. Server modules require Node.js 22.22.2 or a supported newer version, or Bun. Browser modules use standard web APIs.

Build from the repository root with `bun run build`, or build only the library with `bun run --cwd core build`. With npm, use `npm run build --workspace core`.

The main export contains shared schemas, types, chunk planning, file grouping, and BMP format helpers. Google Photos authentication, listing, upload, download, and deletion are available from `@phodrive/core/server`. Browser clients for the Phodrive HTTP API are available from `@phodrive/core/browser`. The browser clients use relative `/api/*` URLs and require that API on the same origin.

```ts
import { connectGoogleAccount, listBmps } from '@phodrive/core/server';

const connected = await connectGoogleAccount(email, token);
const listed = await connected.andThenAsync((aasToken) => listBmps(email, aasToken, ''));

listed.match({
    Ok: (page) => console.log(page.items),
    Err: (error) => console.error(error.message)
});
```

Fallible synchronous operations return results-ts `Result`; asynchronous operations return `AsyncResult`. Handle both variants with `match` or compose them with `andThen` and `andThenAsync`. Credentials are supplied per operation and are not persisted by the library.

To install outside this repository, run `npm pack --workspace core --pack-destination <directory>` and install the generated archive in the consuming project. The package includes JavaScript, type declarations, source maps, and licenses. Node.js and Bun resolve the compiled JavaScript; Vite development builds use the source files for hot reload.
