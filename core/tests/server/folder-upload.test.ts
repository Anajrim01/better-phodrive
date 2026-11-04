import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { UploadEventType, type UploadEvent } from '@madkarmaa/phodrive-core/models';
import { fileIdentity } from '@madkarmaa/phodrive-core/server/chunks';
import { decodeSplitBmp } from '../helpers/split-bmp';
import { receiveFileUpload, fileUploadStream } from '@madkarmaa/phodrive-core/server/upload/file';
import { uploadFiles } from '@madkarmaa/phodrive-core/server/upload';
import { receiveUpload } from '@madkarmaa/phodrive-core/server/upload/input';
import type {
    ChunkMetadataRecord,
    ChunkMetadataStore
} from '@madkarmaa/phodrive-core/server/photos';
import { Ok } from 'results-ts';
import { TEST_ACCOUNT, uploadForm } from '../helpers/upload';
import { photosUploadHarness } from '../helpers/photos-harness';

const PAYLOAD = Buffer.from('folder upload payload');

function fileRequest(folder?: string) {
    const form = new FormData();
    form.set(
        'metadata',
        JSON.stringify({
            name: 'report.pdf',
            size: PAYLOAD.length,
            workers: 1,
            ...(folder ? { folder } : {})
        })
    );
    form.set('file', new Blob([PAYLOAD]), 'report.pdf');

    return new Request('http://localhost/api/upload', { method: 'POST', body: form });
}

function events(text: string): UploadEvent[] {
    return text
        .split('\n\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => JSON.parse(line.slice('data: '.length)));
}

function savedRecord(): {
    records: ChunkMetadataRecord[];
    store: ChunkMetadataStore;
} {
    const records: ChunkMetadataRecord[] = [];

    return {
        records,
        store: {
            load: () => Ok(new Map()).andThenAsync(async (value) => Ok(value)),
            save: async (next) => {
                records.push(...next);
            },
            remove: async () => {}
        }
    };
}

test('browser mode carries a folder through identity, chunk zero, and metadata', async () => {
    const folder = 'Projects/2026';
    const fixture = uploadForm(PAYLOAD, 'report.pdf', { folder });
    const received = await receiveUpload(fixture.request(), TEST_ACCOUNT);
    const harness = photosUploadHarness();
    const metadata = savedRecord();
    const emitted: UploadEvent[] = [];

    const uploaded = await uploadFiles(
        received.unwrap(),
        (event) => emitted.push(event),
        harness.fetcher,
        metadata.store
    );
    expect(uploaded.isOk()).toBe(true);

    const chunk = emitted.find((event) => event.type === UploadEventType.Chunk);
    expect(chunk).toMatchObject({ chunk: { folder } });
    expect(metadata.records[0]).toMatchObject({ folder });
    const [bmp] = [...harness.stored.values()];
    const decoded = decodeSplitBmp(Buffer.from(bmp!)).unwrap();
    expect(new TextDecoder().decode(Buffer.from(bmp!).subarray(54, 62))).toBe('BMSPLIT\x02');
    expect(decoded.header.folder).toBe(folder);
    expect(decoded.header.fileId).toBe(
        fileIdentity('report.pdf', fixture.metadata.file.fileHash, undefined, folder)
    );
    await received.unwrap().cancel();
});

test('server mode carries a folder through the whole-file request and metadata', async () => {
    const folder = 'Work/Source';
    const harness = photosUploadHarness();
    const metadata = savedRecord();
    const received = await receiveFileUpload(fileRequest(folder));
    const response = fileUploadStream(
        received.unwrap(),
        TEST_ACCOUNT,
        harness.fetcher,
        metadata.store
    );
    const reported = events(await response.text());

    expect(reported.find((event) => event.type === UploadEventType.Chunk)).toMatchObject({
        chunk: { folder }
    });
    expect(metadata.records[0]).toMatchObject({ folder });

    const [bmp] = [...harness.stored.values()];
    const decoded = decodeSplitBmp(Buffer.from(bmp!)).unwrap();
    expect(new TextDecoder().decode(Buffer.from(bmp!).subarray(54, 62))).toBe('BMSPLIT\x02');
    expect(decoded.header.folder).toBe(folder);
    expect(decoded.header.fileId).toBe(
        fileIdentity(
            'report.pdf',
            createHash('sha256').update(PAYLOAD).digest('hex'),
            undefined,
            folder
        )
    );
});

test('root uploads still emit v1 and omit folder metadata', async () => {
    const fixture = uploadForm(PAYLOAD, 'report.pdf');
    const received = await receiveUpload(fixture.request(), TEST_ACCOUNT);
    const harness = photosUploadHarness();
    const metadata = savedRecord();

    const uploaded = await uploadFiles(
        received.unwrap(),
        () => {},
        harness.fetcher,
        metadata.store
    );
    expect(uploaded.isOk()).toBe(true);
    expect(metadata.records[0]?.folder).toBeUndefined();
    const [bmp] = [...harness.stored.values()];
    expect(new TextDecoder().decode(Buffer.from(bmp!).subarray(54, 62))).toBe('BMSPLIT\x01');
    await received.unwrap().cancel();
});
