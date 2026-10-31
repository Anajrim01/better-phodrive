import { homedir } from 'node:os';
import { join } from 'node:path';
import {
    configureProbeCache,
    flushProbeCache
} from '@madkarmaa/phodrive-core/server/photos/library';
import type { Handle } from '@sveltejs/kit/hooks';
import { readPreferencesDefaults } from '#server/preferences';

const THEME_PLACEHOLDER = '%phodrive.theme%';
const PROBE_CACHE_PATH =
    process.env.PHODRIVE_PROBE_CACHE ?? join(homedir(), '.phodrive', 'probe-cache.json');

configureProbeCache(PROBE_CACHE_PATH);
process.on('exit', flushProbeCache);

export const handle: Handle = ({ event, resolve }) => {
    const defaults = readPreferencesDefaults();

    return resolve(event, {
        transformPageChunk: ({ html }) => html.replaceAll(THEME_PLACEHOLDER, defaults.theme)
    });
};
