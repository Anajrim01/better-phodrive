import { copyFile, cp } from 'node:fs/promises';
import { join } from 'node:path';

// Package scripts run from their workspace, which receives the repository licenses.
const workspace = process.cwd();

await copyFile(new URL('../LICENSE', import.meta.url), join(workspace, 'LICENSE'));
await cp(new URL('../LICENSES', import.meta.url), join(workspace, 'LICENSES'), {
    recursive: true
});
