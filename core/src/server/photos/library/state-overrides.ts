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

export function clearAccountOverrides(): void {
    overrides.clear();
}
