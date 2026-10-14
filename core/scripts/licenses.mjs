import { copyFile, cp } from 'node:fs/promises';

await copyFile(new URL('../../LICENSE', import.meta.url), new URL('../LICENSE', import.meta.url));
await cp(new URL('../../LICENSES', import.meta.url), new URL('../LICENSES', import.meta.url), {
    recursive: true
});
