import { defineConfig } from 'tsdown';

export default defineConfig({
    entry: ['src/index.ts'],
    platform: 'node',
    fixedExtension: false,
    sourcemap: true
});
