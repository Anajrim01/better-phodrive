import { expect, test } from 'vitest';
import type { GoogleAccountGroup } from '@madkarmaa/phodrive-core/models';
import { childFolders } from '@madkarmaa/phodrive-core/files';
import { planUploads } from '#browser/drive/upload-plan';
import { SECOND_ACCOUNT, TEST_ACCOUNT } from '../helpers/drive';

const GROUP: GoogleAccountGroup = {
    id: 'group',
    name: 'Family archive',
    members: [TEST_ACCOUNT, SECOND_ACCOUNT]
};

function relativeFile(name: string, path: string, size = 100): File {
    const file = new File([new Uint8Array(size)], name);
    Object.defineProperty(file, 'webkitRelativePath', { value: path });

    return file;
}

test('group planning resolves folders without changing owner assignment', () => {
    const plan = planUploads(
        [
            relativeFile('report.pdf', 'Projects/report.pdf', 100),
            relativeFile('other.pdf', 'Projects/sub/other.pdf', 100)
        ],
        { kind: 'group', group: GROUP }
    );

    expect(plan.owners.size).toBe(2);
    expect(new Set(plan.queues.map((queue) => queue.account.id))).toEqual(
        new Set([TEST_ACCOUNT.id, SECOND_ACCOUNT.id])
    );
    expect(
        plan.queues.every((queue) => queue.folders.every((folder) => folder.startsWith('Projects')))
    ).toBe(true);
    expect(
        childFolders(
            [...plan.folders].map(([, folder]) => ({ folder })),
            ''
        )
    ).toEqual([{ path: 'Projects', name: 'Projects', files: 1, subfolders: 1 }]);
});

test('the current folder prefixes directory picks and root files', () => {
    const plan = planUploads(
        [relativeFile('a.ts', 'Source/a.ts'), new File(['readme'], 'README.md')],
        { kind: 'account', account: TEST_ACCOUNT },
        'Work'
    );

    expect([...plan.folders.values()].sort()).toEqual(['Work', 'Work/Source']);
});
