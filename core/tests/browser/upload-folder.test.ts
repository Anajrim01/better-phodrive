import { createHash } from 'node:crypto';
import { Err, Ok } from 'results-ts';
import { expect, test } from 'vitest';
import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import { transferFiles } from '@madkarmaa/phodrive-core/browser/upload';
import { prepareFile } from '@madkarmaa/phodrive-core/browser/upload/planned';
import type { ChunkTransport } from '@madkarmaa/phodrive-core/browser/upload/request';
import { fileIdentity } from '@madkarmaa/phodrive-core/server/chunks';

const FAILED = { code: 'UPLOAD_FAILED', message: 'stop' } as const satisfies ApplicationError;

test('a resolved folder enters the first chunk header and the file identity', async () => {
    const file = new File(['folder upload'], 'a.ts');
    const plan = (await prepareFile(file, 0, () => Ok(undefined), 'Work/Source')).unwrap();

    expect(plan.headers[0]).toMatchObject({ folder: 'Work/Source', fileName: 'a.ts' });
    expect(plan.headers[0]?.fileId).toBe(
        fileIdentity(
            'a.ts',
            createHash('sha256').update('folder upload').digest('hex'),
            undefined,
            'Work/Source'
        )
    );
});

test('a resolved directory folder reaches every chunk upload request', async () => {
    const file = new File(['folder upload'], 'a.ts');
    Object.defineProperty(file, 'webkitRelativePath', { value: 'Source/a.ts' });
    const folders: string[] = [];
    const transport: ChunkTransport = ({ metadata }) => {
        folders.push(metadata.file.folder ?? '');

        return Err(FAILED).andThenAsync(async () => Ok(undefined));
    };

    await transferFiles(
        [file],
        'test@example.com',
        1,
        () => {},
        () => {},
        transport,
        undefined,
        ['Work/Source']
    );

    expect(folders).toEqual(['Work/Source']);
});

test('a regular file without a relative path uses the current folder', async () => {
    const folders: string[] = [];
    const transport: ChunkTransport = ({ metadata }) => {
        folders.push(metadata.file.folder ?? '');

        return Err(FAILED).andThenAsync(async () => Ok(undefined));
    };

    await transferFiles(
        [new File(['root'], 'a.txt')],
        'test@example.com',
        1,
        () => {},
        () => {},
        transport,
        undefined,
        ['Projects/2026']
    );

    expect(folders).toEqual(['Projects/2026']);
});
