import { SvelteSet } from 'svelte/reactivity';

export function applySelectionGesture(
    selection: DriveSelection,
    key: string,
    event: MouseEvent | KeyboardEvent,
    mode: 'toggle' | 'point',
    visibleKeys: readonly string[]
): void {
    if (event.shiftKey) {
        selection.extendTo(key, visibleKeys);

        return;
    }

    if (mode === 'toggle' || event.ctrlKey || event.metaKey || event.type === 'keydown')
        selection.toggle(key);
    else selection.selectOnly(key);
}

export class DriveSelection {
    private readonly keys = new SvelteSet<string>();
    private anchor: string | null = null;

    get selectedKeys(): ReadonlySet<string> {
        return this.keys;
    }

    get size(): number {
        return this.keys.size;
    }

    has(key: string): boolean {
        return this.keys.has(key);
    }

    toggle(key: string): void {
        if (this.keys.has(key)) this.keys.delete(key);
        else this.keys.add(key);
        this.anchor = key;
    }

    selectOnly(key: string): void {
        this.keys.clear();
        this.keys.add(key);
        this.anchor = key;
    }

    extendTo(key: string, visibleKeys: readonly string[]): void {
        const anchor = this.anchor;
        if (!anchor) {
            this.selectOnly(key);

            return;
        }

        const from = visibleKeys.indexOf(anchor);
        const to = visibleKeys.indexOf(key);
        if (from < 0 || to < 0) {
            this.selectOnly(key);

            return;
        }

        const start = Math.min(from, to);
        const end = Math.max(from, to);
        for (let index = start; index <= end; index++) this.keys.add(visibleKeys[index]!);
    }

    selectAll(visibleKeys: readonly string[]): void {
        for (const key of visibleKeys) this.keys.add(key);
        this.anchor = visibleKeys[0] ?? null;
    }

    remove(key: string): void {
        this.keys.delete(key);
        if (this.anchor === key) this.anchor = null;
    }

    set(keys: ReadonlySet<string>): void {
        this.keys.clear();
        for (const key of keys) this.keys.add(key);
        this.anchor = null;
    }

    clear(): void {
        this.keys.clear();
        this.anchor = null;
    }
}
