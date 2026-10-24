import { defineConfig } from 'tsdown';

/** Vite and Vitest resolve the development condition to source for hot reload and tests. */
function withSource(target: unknown): unknown {
    if (typeof target !== 'string' || !target.startsWith('./dist/')) return target;

    const source = target.replace(/^\.\/dist\//, './src/').replace(/\.js$/, '.ts');

    return { development: source, default: target };
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
