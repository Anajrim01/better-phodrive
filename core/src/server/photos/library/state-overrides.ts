import {
    emptyOverrides,
    isEmptyOverrides,
    parseOverrides,
    type LibraryOverrides
} from './overrides';

const overrides = new Map<string, LibraryOverrides>();

export function readAccountOverrides(email: string): LibraryOverrides {
    return overrides.get(email.toLowerCase()) ?? emptyOverrides();
}

export function setAccountOverrides(email: string, value: LibraryOverrides): void {
    const key = email.toLowerCase();
    if (isEmptyOverrides(value)) overrides.delete(key);
    else overrides.set(key, value);
}

export function loadAccountOverrides(value: unknown): void {
    if (!value || typeof value !== 'object') return;

    for (const [email, stored] of Object.entries(value)) {
        const parsed = parseOverrides(stored);
        if (!isEmptyOverrides(parsed)) overrides.set(email.toLowerCase(), parsed);
    }
}

export function accountOverridesSnapshot(): Record<string, LibraryOverrides> {
    return Object.fromEntries(overrides);
}

export function forgetFileOverrides(email: string, fileIds: Iterable<string>): boolean {
    const current = overrides.get(email.toLowerCase());
    if (!current) return false;

    let changed = false;
    const fileNames = { ...current.fileNames };
    const fileFolders = { ...current.fileFolders };
    for (const fileId of fileIds) {
        if (fileId in fileNames) {
            delete fileNames[fileId];
            changed = true;
        }
        if (fileId in fileFolders) {
            delete fileFolders[fileId];
            changed = true;
        }
    }
    if (changed) overrides.set(email.toLowerCase(), { ...current, fileNames, fileFolders });

    return changed;
}

export function clearAccountOverrides(): void {
    overrides.clear();
}
