import { render } from 'svelte/server';
import { expect, test, vi } from 'vitest';
import { FileLayout, FileSort } from '@madkarmaa/phodrive-core/models';
import FileGrid from '#components/FileGrid.svelte';

function folderTile(onsharefolder?: (path: string) => void) {
    return render(FileGrid, {
        props: {
            files: [],
            folders: [{ path: 'Trips', name: 'Trips', files: 1, subfolders: 0 }],
            layout: FileLayout.List,
            sort: FileSort.ModifiedDescending,
            loading: false,
            loadFailed: false,
            filtered: false,
            hasFiles: true,
            hasMore: false,
            disabled: false,
            action: null,
            ondownload: () => {},
            ondelete: () => {},
            onmore: () => {},
            ...(onsharefolder ? { onsharefolder } : {})
        }
    }).body;
}

test('a folder tile offers Share only when sharing is available', () => {
    expect(folderTile(vi.fn())).toContain('Share folder Trips');
    expect(folderTile()).not.toContain('Share folder');
});
