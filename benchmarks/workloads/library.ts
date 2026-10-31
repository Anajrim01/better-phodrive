import assert from 'node:assert/strict';
import { FileSort } from '@madkarmaa/phodrive-core/models';
import { groupChunks, sortFiles, type UploadedChunk } from '@madkarmaa/phodrive-core/files';
import { parseLibraryPage } from '@madkarmaa/phodrive-core/server/photos/library/metadata';
import { bytesField, message, numberField } from '@madkarmaa/phodrive-core/server/protobuf';
import type { Workload } from '../fixtures';

export function libraryWorkload(name: string): Workload | undefined {
    if (name === 'protocol-page') {
        const entries = Array.from({ length: 1000 }, (_, i) =>
            bytesField(
                2,
                message(
                    bytesField(1, `media-${i}`),
                    bytesField(
                        2,
                        message(
                            numberField(9, i + 1),
                            numberField(10, 10000),
                            bytesField(13, bytesField(1, new Uint8Array(20).fill(i % 255)))
                        )
                    )
                )
            )
        );
        const page = bytesField(1, message(...entries));

        return {
            bytes: page.length * 10,
            run: () => {
                for (let i = 0; i < 10; i++)
                    assert.equal(parseLibraryPage(page).unwrap().items.length, 1000);
            }
        };
    }

    if (name !== 'group-chunks' && name !== 'group-many-files' && name !== 'sort-files')
        return undefined;

    const manyFiles = name !== 'group-chunks';
    const entries: UploadedChunk[] = Array.from({ length: manyFiles ? 10_000 : 4096 }, (_, i) => ({
        email: 'bench@example.com',
        fileHash: 'ab'.repeat(32),
        fileId: manyFiles ? String(i) : String(i % 8),
        chunkIndex: manyFiles ? 0 : Math.floor(i / 8),
        isLast: manyFiles || i >= 4088,
        originalName: `file-${i}`,
        size: 1,
        at: (i * 997) % 10007,
        mediaKey: String(i),
        sha1: 'ab'.repeat(20)
    }));
    const groups = groupChunks(entries);

    return {
        bytes: 0,
        run: () => {
            for (let i = 0; i < 10; i++) {
                if (name.startsWith('group-'))
                    assert.equal(
                        groupChunks([...entries, ...entries.filter((_, index) => index % 4 === 0)])
                            .length,
                        manyFiles ? 10_000 : 8
                    );
                else
                    assert.equal(
                        sortFiles(groups, FileSort.ModifiedDescending).length,
                        entries.length
                    );
            }
        }
    };
}
