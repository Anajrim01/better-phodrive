import { defineConfig } from 'tsdown';

export default defineConfig({
    entry: ['src/**/*.ts'],
    unbundle: true,
    platform: 'node',
    fixedExtension: false,
    sourcemap: true,
    dts: true,
    // Workspace Vite and Vitest configs opt into this condition to use source for hot reload and tests.
    // A package-specific name keeps consumers' development builds on the compiled JavaScript.
    exports: { devExports: '@madkarmaa/phodrive-source' }
});
