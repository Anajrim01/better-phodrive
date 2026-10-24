import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import Icons from 'unplugin-icons/vite';
import {
    defaultClientConditions,
    defaultServerConditions,
    type PreviewServer,
    type ViteDevServer
} from 'vite';
import { defineConfig } from 'vitest/config';

// Resolve core to source for hot reload, as the core package exports it under this condition.
const SOURCE_CONDITION = '@madkarmaa/phodrive-source';

function disableRequestTimeouts({ httpServer }: ViteDevServer | PreviewServer) {
    if (!httpServer) return;

    if ('requestTimeout' in httpServer) httpServer.requestTimeout = 0;
    if ('headersTimeout' in httpServer) httpServer.headersTimeout = 0;
}

export default defineConfig({
    envDir: '..',
    resolve: { conditions: [SOURCE_CONDITION, ...defaultClientConditions] },
    ssr: {
        noExternal: ['@madkarmaa/phodrive-core'],
        resolve: { conditions: [SOURCE_CONDITION, ...defaultServerConditions] }
    },
    test: { include: ['tests/**/*.test.ts'] },
    plugins: [
        {
            name: 'disable-request-timeouts',
            configureServer: disableRequestTimeouts,
            configurePreviewServer: disableRequestTimeouts
        },
        tailwindcss(),
        sveltekit({
            env: { dir: '..' },
            compilerOptions: {
                // Force runes mode for the project, except for libraries. Can be removed in svelte 6.
                runes: ({ filename }) =>
                    filename.split(/[/\\]/).includes('node_modules') ? undefined : true
            },
            adapter: adapter()
        }),
        Icons({ compiler: 'svelte' })
    ]
});
