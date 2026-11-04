import { expect, test, vi } from 'vitest';
import { FolderHistory, folderFromUrl, folderUrl } from '#browser/drive/folder-history';
import { FolderNavigation } from '#browser/drive/folder-navigation';

function fakeHistory(initial = 'http://localhost/files?sort=name') {
    let url = initial;
    let listener: ((url: string) => void) | null = null;
    const pushes: string[] = [];
    const replaces: string[] = [];
    const env = {
        read: () => url,
        push: (next: string) => {
            pushes.push(next);
            url = new URL(next, url).href;
        },
        replace: (next: string) => {
            replaces.push(next);
            url = new URL(next, url).href;
        },
        listen: (handler: (url: string) => void) => {
            listener = handler;

            return () => {
                listener = null;
            };
        }
    };

    return {
        env,
        pushes,
        replaces,
        url: () => url,
        go: (next: string) => {
            url = new URL(next, url).href;
            listener?.(url);
        }
    };
}

test('folder URLs preserve unrelated query parameters and hash', () => {
    expect(folderUrl('http://localhost/files?sort=name#top', 'Projects/2026')).toBe(
        '/files?sort=name&folder=Projects%2F2026#top'
    );
    expect(folderFromUrl('http://localhost/files?folder=Projects%2F2026')).toBe('Projects/2026');
    expect(folderFromUrl('http://localhost/files?folder=..%2Fbad')).toBe('');
});

test('opening and navigating folders updates history and validates loaded paths', () => {
    const history = fakeHistory();
    const files = [{ folder: 'Projects' }, { folder: 'Projects/2026' }];
    let folder = '';
    const navigation = new FolderNavigation(
        () => folder,
        (next) => {
            folder = next;
        },
        () => files,
        new FolderHistory(history.env)
    );

    navigation.open('Projects');
    expect(folder).toBe('Projects');
    navigation.open('Projects/2026');
    expect(folder).toBe('Projects/2026');
    navigation.open('Projects', 'ancestor');
    expect(folder).toBe('Projects');
    navigation.open('missing');
    expect(folder).toBe('Projects');

    history.go('http://localhost/files');
    expect(folder).toBe('');
});

test('a deep link waits for pages and falls back to root when the folder is absent', () => {
    const history = fakeHistory('http://localhost/files?folder=Projects%2F2026');
    const files: { folder: string }[] = [];
    let folder = '';
    const navigation = new FolderNavigation(
        () => folder,
        (next) => {
            folder = next;
        },
        () => files,
        new FolderHistory(history.env)
    );

    expect(folder).toBe('');
    navigation.settle(true);
    expect(folder).toBe('Projects/2026');

    files.push({ folder: 'Projects/2026' });
    navigation.settle(false);
    expect(folder).toBe('Projects/2026');
    expect(history.url()).toContain('folder=Projects%2F2026');
});

test('a missing deep link falls back to root and resets on context change', () => {
    const history = fakeHistory('http://localhost/files?folder=Old');
    let folder = '';
    const navigation = new FolderNavigation(
        () => folder,
        (next) => {
            folder = next;
        },
        () => [],
        new FolderHistory(history.env)
    );

    navigation.settle(false);
    expect(folder).toBe('');
    expect(history.url()).not.toContain('folder=');

    folder = 'Projects';
    navigation.reset();
    expect(folder).toBe('');
    expect(history.url()).not.toContain('folder=');
});

test('popstate waits for a not-yet-loaded folder while pages remain', () => {
    const history = fakeHistory();
    const files: { folder: string }[] = [];
    let folder = '';
    const navigation = new FolderNavigation(
        () => folder,
        (next) => {
            folder = next;
        },
        () => files,
        new FolderHistory(history.env)
    );
    navigation.settle(true);

    history.go('http://localhost/files?folder=Projects');
    expect(folder).toBe('Projects');

    files.push({ folder: 'Projects' });
    navigation.settle(false);
    expect(folder).toBe('Projects');
});

test('folder history ignores repeated opens', () => {
    const history = fakeHistory();
    let folder = 'Projects';
    const navigation = new FolderNavigation(
        () => folder,
        (next) => {
            folder = next;
        },
        () => [{ folder: 'Projects' }],
        new FolderHistory(history.env)
    );

    navigation.open('Projects');
    expect(history.pushes).toHaveLength(0);
    vi.restoreAllMocks();
});
