import { defineConfig } from 'tsdown';

// Workspace Vite and Vitest configs opt into this condition to use source for hot reload and tests.
// A package-specific name keeps consumers' development builds on the compiled JavaScript.
const SOURCE_CONDITION = '@madkarmaa/phodrive-source';

function withSource(target: unknown): unknown {
    if (typeof target !== 'string' || !target.startsWith('./dist/')) return target;

    const source = target.replace(/^\.\/dist\//, './src/').replace(/\.js$/, '.ts');

    return { [SOURCE_CONDITION]: source, default: target };
}

export default defineConfig({
    entry: ['src/**/*.ts'],
    unbundle: true,
    platform: 'node',
    fixedExtension: false,
    sourcemap: true,
    dts: true,
    exports: {
        customExports: (exports: Record<string, unknown>) =>
            Object.fromEntries(
                Object.entries(exports).map(([path, target]) => [path, withSource(target)])
            )
    }
});
