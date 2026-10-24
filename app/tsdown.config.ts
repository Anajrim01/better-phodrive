import { defineConfig } from 'tsdown';

export default defineConfig({
    entry: { server: 'src/server.ts' },
    outDir: 'build',
    // Vite writes the SvelteKit handler to the same directory first.
    clean: false,
    platform: 'node',
    fixedExtension: false,
    deps: { neverBundle: ['#build-handler'] }
});
