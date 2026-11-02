import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';

export interface MockItem {
    uid: string;
    url: string;
    width?: number;
    height?: number;
}

export interface MockAlbum {
    uid: string;
    key: string;
    title: string;
    items: MockItem[];
    declaredCount?: number;
    omitRpc?: boolean;
    corruptRpc?: boolean;
    omitInit?: boolean;
    batchMode?: 'ok' | 'http500' | 'malformed' | 'wrongId';
    itemTransform?: (item: MockItem) => unknown;
}

export interface MockGoogle {
    origin: string;
    requests: { method: string; path: string; range: string | null }[];
    rpcBodies: string[];
    close: () => Promise<void>;
}

function listingData(album: MockAlbum): unknown[] {
    const entries = album.items.map((item) =>
        album.itemTransform
            ? album.itemTransform(item)
            : [
                  item.uid,
                  [item.url, item.width ?? 1280, item.height ?? 720, null, null, null, null],
                  0,
                  'media',
                  0,
                  0,
                  [],
                  [],
                  2,
                  { '15': 0 }
              ]
    );
    const metadata: unknown[] = new Array(43).fill(null);
    metadata[1] = album.title;
    metadata[21] = album.declaredCount ?? album.items.length;

    return [null, entries, '', metadata, null, ''];
}

function pageHtml(album: MockAlbum): string {
    const data = JSON.stringify(listingData(album));
    const services = album.omitRpc
        ? ''
        : album.corruptRpc
          ? `<script>var AF_dataServiceRequests = {'ds:1' : {id:'snAcKc',request:"not-an-array"}};</script>`
          : `<script>var AF_dataServiceRequests = {'ds:0' : {id:'UJlKrf',request:[${JSON.stringify(album.uid)},${JSON.stringify(album.key)}]},'ds:1' : {id:'snAcKc',ext: 7.1E7,request:[${JSON.stringify(album.uid)},null,null,${JSON.stringify(album.key)}]}};</script>`;
    const init = album.omitInit
        ? ''
        : `<script>AF_initDataCallback({key: 'ds:1', hash: '1', data:${data}, sideChannel: {}});</script>`;

    return `<!doctype html><html><head><title>${album.title}</title></head><body>${services}${init}</body></html>`;
}

async function readBody(request: IncomingMessage): Promise<string> {
    const parts: Buffer[] = [];

    for await (const part of request) parts.push(Buffer.from(part));

    return Buffer.concat(parts).toString('utf8');
}

function batchBody(album: MockAlbum, rpcId: string): string {
    if (album.batchMode === 'malformed') return ")]}'\n\nnot json";

    const returnedId = album.batchMode === 'wrongId' ? 'otherRpc' : rpcId;
    const payload = JSON.stringify(listingData(album));

    return `)]}'\n\n${JSON.stringify([
        ['wrb.fr', returnedId, payload, null, null, null, 'generic'],
        ['di', 1]
    ])}`;
}

function handle(album: MockAlbum, mock: MockGoogle) {
    return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        mock.requests.push({
            method: request.method ?? 'GET',
            path: url.pathname,
            range: request.headers.range ?? null
        });

        if (request.method === 'GET' && url.pathname === `/share/${album.uid}`) {
            if (url.searchParams.get('key') !== album.key) {
                response.writeHead(404).end();
                return;
            }

            response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            response.end(pageHtml(album));
            return;
        }

        if (request.method === 'POST' && url.pathname === '/_/PhotosUi/data/batchexecute') {
            const body = await readBody(request);
            mock.rpcBodies.push(body);

            if (album.batchMode === 'http500') {
                response.writeHead(500).end();
                return;
            }

            const rpcId = url.searchParams.get('rpcids') ?? 'snAcKc';
            response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
            response.end(batchBody(album, rpcId));
            return;
        }

        response.writeHead(404).end();
    };
}

export async function startMockGoogle(album: MockAlbum): Promise<MockGoogle> {
    const sockets = new Set<Socket>();
    const mock: MockGoogle = {
        origin: '',
        requests: [],
        rpcBodies: [],
        close: async () => undefined
    };
    const server = createServer((request, response) => {
        void handle(album, mock)(request, response);
    });
    server.on('connection', (socket) => sockets.add(socket));

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Mock server has no port');

    mock.origin = `http://127.0.0.1:${address.port}`;
    mock.close = async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        for (const socket of sockets) socket.destroy();
    };

    return mock;
}

export function albumBody(album: MockAlbum): string {
    return JSON.stringify({
        album: `https://photos.google.com/share/${album.uid}?key=${album.key}`
    });
}
