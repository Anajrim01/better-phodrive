import { defineConfig } from 'tsdown';

export default defineConfig({
    entry: ['src/**/*.ts'],
    unbundle: true,
    platform: 'node',
    fixedExtension: false,
    sourcemap: true,
    dts: true,
    exports: { devExports: 'development' }
});
