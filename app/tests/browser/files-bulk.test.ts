import { expect, test, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { groupChunks } from '@madkarmaa/phodrive-core/files';
import type { RemoteBmp } from '@madkarmaa/phodrive-core/models';
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

test('bulk delete streams per-file results and maps confirmed chunks to local files', async () => {
    const first = groupChunks([{ ...chunk(), email: 'test@example.com' }])[0];
    const second = groupChunks([
        { ...chunk('second.bin', 'b'.repeat(64)), email: 'test@example.com' }
    ])[0];
    const results: { name: string; deleted: number; error?: string }[] = [];
    const lines = [
        JSON.stringify({
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
        }),
        JSON.stringify({
            type: 'file',
            index: 1,
            name: second.name,
            deleted: [],
            error: 'One chunk failed'
        }),
        JSON.stringify({ type: 'done' })
    ].join('\n');
    const bytes = new TextEncoder().encode(`${lines}\n`);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(bytes.slice(0, 9));
                controller.enqueue(bytes.slice(9, 40));
                controller.enqueue(bytes.slice(40));
                controller.close();
            }
        });

        return new Response(body, { headers: { 'content-type': 'application/x-ndjson' } });
    });

    const result = await deleteFiles(
        'test@example.com',
        'aas_et/test',
        [first, second],
        2,
        (item, outcome) => {
            results.push({
                name: item.name,
                deleted: outcome.deleted.length,
                ...(outcome.error ? { error: outcome.error } : {})
            });
        }
    );

    expect(result.isOk()).toBe(true);
    expect(results).toEqual([
        { name: 'proof.bin', deleted: 1 },
        { name: 'second.bin', deleted: 0, error: 'One chunk failed' }
    ]);
});

test('bulk delete reports every file when the request fails before streaming', async () => {
    const first = groupChunks([{ ...chunk(), email: 'test@example.com' }])[0];
    const second = groupChunks([
        { ...chunk('second.bin', 'b'.repeat(64)), email: 'test@example.com' }
    ])[0];
    const results: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
        Response.json({ error: 'Server refused the batch' }, { status: 400 })
    );

    const result = await deleteFiles(
        'test@example.com',
        'aas_et/test',
        [first, second],
        2,
        (item, outcome) => results.push(`${item.name}:${outcome.error}`)
    );

    expect(result.isOk()).toBe(true);
    expect(results).toEqual([
        'proof.bin:Server refused the batch',
        'second.bin:Server refused the batch'
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

test('a 1711-file selection fits the default request body limit', async () => {
    const files = Array.from({ length: 1711 }, (_, index) =>
        groupChunks([
            {
                ...chunk(
                    `file-${index}.bin`,
                    createHash('sha256').update(`file-${index}`).digest('hex')
                ),
                email: 'test@example.com'
            }
        ])
    ).map(([item]) => item);
    let body = '';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
        body = String(init?.body);

        return Response.json({ error: 'Expected stop' }, { status: 400 });
    });

    await deleteFiles('test@example.com', 'aas_et/test', files, 2, () => {});

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(Buffer.byteLength(body)).toBeLessThan(512 * 1024);
});
