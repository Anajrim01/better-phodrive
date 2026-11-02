import { expect, test, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { groupChunks } from '@madkarmaa/phodrive-core/files';
import { partitionFileGroups } from '@madkarmaa/phodrive-core/trash';
import { FileActionKind, type RemoteBmp } from '@madkarmaa/phodrive-core/models';
import { deleteFiles } from '#browser/files';

const PAYLOAD = Uint8Array.of(0, 255, 13, 10, 42);
const FILE_HASH = createHash('sha256').update(PAYLOAD).digest('hex');

function chunk(name = 'proof.bin', fileId = FILE_HASH): RemoteBmp {
    return {
        fileHash: fileId,
        fileId,
        chunkIndex: 0,
        isLast: true,
        originalName: name,
        size: PAYLOAD.length,
        at: 1,
        mediaKey: name,
        sha1: '0'.repeat(40)
    };
}

test('duplicate confirmations cannot complete a multi-chunk file', async () => {
    const first = { ...chunk(), isLast: false };
    const second = {
        ...chunk(),
        chunkIndex: 1,
        mediaKey: 'proof-1',
        sha1: '1'.repeat(40)
    };
    const item = groupChunks([
        { ...first, email: 'test@example.com' },
        { ...second, email: 'test@example.com' }
    ])[0];
    const outcomes: { deleted: number; error?: string }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(
        async () =>
            new Response(
                `${JSON.stringify({
                    type: 'file',
                    index: 0,
                    name: item.name,
                    deleted: [
                        {
                            mediaKey: first.mediaKey,
                            sha1: first.sha1,
                            trashedAt: 5
                        },
                        {
                            mediaKey: first.mediaKey,
                            sha1: first.sha1,
                            trashedAt: 5
                        }
                    ]
                })}
${JSON.stringify({ type: 'done' })}
`
            )
    );

    const result = await deleteFiles(
        'test@example.com',
        'aas_et/test',
        [item],
        2,
        (_file, outcome) => {
            outcomes.push({
                deleted: outcome.deleted.length,
                ...(outcome.error ? { error: outcome.error } : {})
            });
        }
    );

    expect(result.isOk()).toBe(true);
    expect(outcomes).toEqual([{ deleted: 1, error: 'Invalid delete response.' }]);
});

test('a misindexed event name fails all pending files closed', async () => {
    const first = groupChunks([{ ...chunk(), email: 'test@example.com' }])[0];
    const second = groupChunks([
        { ...chunk('second.bin', 'b'.repeat(64)), email: 'test@example.com' }
    ])[0];
    const outcomes: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(
        async () =>
            new Response(
                `${JSON.stringify({
                    type: 'file',
                    index: 0,
                    name: second.name,
                    action: 'delete',
                    deleted: [
                        {
                            mediaKey: first.chunks[0].mediaKey,
                            sha1: first.chunks[0].sha1,
                            trashedAt: 5
                        }
                    ]
                })}
${JSON.stringify({ type: 'done' })}
`
            )
    );

    await deleteFiles('test@example.com', 'aas_et/test', [first, second], 2, (item, outcome) => {
        outcomes.push(`${item.name}:${outcome.error}`);
    });

    expect(outcomes).toEqual([
        'proof.bin:Invalid delete response.',
        'second.bin:Invalid delete response.'
    ]);
});

test('bulk delete rejects malformed events without losing already confirmed files', async () => {
    const first = groupChunks([{ ...chunk(), email: 'test@example.com' }])[0];
    const results: { name: string; deleted: number; error?: string }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(
        async () =>
            new Response(
                `${JSON.stringify({
                    type: 'file',
                    index: 0,
                    name: first.name,
                    deleted: [
                        {
                            mediaKey: first.chunks[0].mediaKey,
                            sha1: first.chunks[0].sha1,
                            trashedAt: 5
                        }
                    ]
                })}\nnot-json\n`
            )
    );

    const result = await deleteFiles(
        'test@example.com',
        'aas_et/test',
        [first],
        2,
        (item, outcome) =>
            results.push({
                name: item.name,
                deleted: outcome.deleted.length,
                ...(outcome.error ? { error: outcome.error } : {})
            })
    );

    expect(result.isOk()).toBe(true);
    expect(results).toEqual([{ name: 'proof.bin', deleted: 1 }]);
});

test('a file event for another action is rejected', async () => {
    const item = partitionFileGroups([{ ...chunk(), trashedAt: 1, email: 'test@example.com' }])
        .trashed[0];
    const outcomes: { deleted: number; error?: string }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(
        async () =>
            new Response(
                `${JSON.stringify({
                    type: 'file',
                    index: 0,
                    name: item.name,
                    action: FileActionKind.Delete,
                    deleted: [
                        {
                            mediaKey: item.trashedChunks[0].mediaKey,
                            sha1: item.trashedChunks[0].sha1
                        }
                    ]
                })}
${JSON.stringify({ type: 'done' })}
`
            )
    );

    await deleteFiles(
        'test@example.com',
        'aas_et/test',
        [item],
        2,
        (_file, outcome) => {
            outcomes.push({
                deleted: outcome.deleted.length,
                ...(outcome.error ? { error: outcome.error } : {})
            });
        },
        FileActionKind.Restore
    );

    expect(outcomes).toEqual([{ deleted: 0, error: 'Invalid delete response.' }]);
});
