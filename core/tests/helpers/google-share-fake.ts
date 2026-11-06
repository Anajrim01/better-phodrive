import { createHash } from 'node:crypto';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import { integer, nested, parse } from '@madkarmaa/phodrive-core/server/protobuf';
import { authResponse, bytes as encode, num } from './protobuf';

import { SECRETS, SHORT_URL } from './google-share-fake-secrets';
import {
    listingAnswer,
    mediaAnswer,
    pageAnswer,
    preflightAnswer,
    shortAnswer
} from './google-share-fake-public';

const RPC = 'photosdata-pa.googleapis.com';
const LINK_DISABLED = 1;

export type FakeCall = { method: string; url: URL; headers: Headers };
export type FakeOptions = {
    /** Answer for a route, or undefined to use the normal handling. */
    override?: (route: string, call: FakeCall) => Response | undefined;
    /** Evaluated on every RPC before it is answered, as a crash at that moment would see it. */
    onCall?: (route: string) => void;
    preexisting?: (sha1: string) => string | undefined;
    /** Direct media URLs keep serving after the share is revoked. */
    directOutlivesRevoke?: boolean;
    responseNextToken?: unknown;
};

type Media = { key: string; body: Uint8Array };

function binary(body: Buffer): Response {
    return new Response(Uint8Array.from(body));
}

/** Serves this spike's mocked shapes. It says nothing about what Google really returns. */
export class FakeGoogle {
    calls: FakeCall[] = [];
    routes: string[] = [];
    media = new Map<string, Media>();
    linkOn = false;
    albumExists = false;
    mutationTargets: string[] = [];

    private pending: Uint8Array = new Uint8Array();
    private nextMedia = 0;

    constructor(private readonly options: FakeOptions = {}) {}

    fetcher: Fetcher = async (input, init) => {
        const url = new URL(String(input));
        const call: FakeCall = {
            method: init?.method ?? 'GET',
            url,
            headers: new Headers(init?.headers)
        };
        const route = this.route(call);

        this.calls.push(call);
        this.routes.push(route);
        this.options.onCall?.(route);

        const body = init?.body ? Buffer.from(await new Response(init.body).arrayBuffer()) : null;
        this.record(route, body);

        return this.options.override?.(route, call) ?? this.answer(route, call, body);
    };

    private route({ method, url }: FakeCall): string {
        if (url.hostname === 'android.googleapis.com') return 'auth';
        if (url.hostname === 'photos.app.goo.gl') return 'short';
        if (url.hostname === 'photos.googleapis.com') return method === 'PUT' ? 'put' : 'start';
        if (url.hostname === 'photos.google.com')
            return url.pathname.endsWith('batchexecute') ? 'batch' : 'page';
        if (url.hostname.endsWith('googleusercontent.com'))
            return method === 'OPTIONS' ? 'preflight' : 'media';
        if (url.hostname !== RPC) throw new Error(`Unexpected host ${url.hostname}`);

        const id = url.pathname.split('/').at(-1) ?? '';
        const named: Record<string, string> = {
            '5084965799730810217': 'hash',
            '16538846908252377752': 'commit',
            '8386163679468898444': 'album-create',
            '11165707358190966680': 'album-remove',
            '11663664809460121647': 'envelope-create',
            '8089014401670041416': 'envelope-delete',
            '17490284929287180316': 'mutation',
            PhotosUpdateLinkSharingState: 'link'
        };

        return named[id] ?? `unknown:${id}`;
    }

    /** Applied before any override, so a failing response can still model a committed change. */
    private record(route: string, body: Buffer | null): void {
        if (route === 'put' && body) this.pending = body;
        if (route === 'commit') {
            const sha1 = createHash('sha1').update(this.pending).digest('hex');
            this.media.set(sha1, {
                key: `${SECRETS.mediaPrefix}${this.nextMedia++}`,
                body: this.pending
            });
        }
        if (route === 'album-create') this.albumExists = true;
        if (route === 'album-remove') this.albumExists = false;
        if (route === 'envelope-delete') this.linkOn = false;
        if (route === 'link' && body)
            this.linkOn =
                parse(body)
                    .andThen((fields) => integer(fields, 2))
                    .unwrap() !== LINK_DISABLED;
        if (route === 'mutation' && body) this.applyMutation(body);
    }

    private applyMutation(body: Buffer): void {
        const fields = parse(body).unwrap();
        const operation = integer(fields, 2).unwrap();
        const keys = fields
            .filter((field) => field.number === 3)
            .map((field) => Buffer.from(String(field.value), 'base64url').toString('hex'));

        this.mutationTargets.push(...keys);
        if (operation === 2) for (const sha1 of keys) this.media.delete(sha1);
    }

    private answer(route: string, call: FakeCall, body: Buffer | null): Response {
        if (route === 'auth') return authResponse();
        if (route === 'hash') return this.hashAnswer(body);
        if (route === 'start')
            return new Response(null, { headers: { 'x-guploader-uploadid': 'upload-id' } });
        if (route === 'put') return binary(Buffer.concat([num(1, 2), encode(2, 'transfer-token')]));
        if (route === 'commit') return this.commitAnswer();
        if (route === 'album-create') return binary(encode(1, encode(1, SECRETS.album)));
        if (route === 'envelope-create') return binary(encode(1, SECRETS.envelope));
        if (route === 'link')
            return binary(
                Buffer.concat([encode(1, encode(1, SHORT_URL)), encode(2, SECRETS.authKey)])
            );
        if (route === 'album-remove' || route === 'envelope-delete') return new Response();
        if (route === 'mutation') return this.mutationAnswer(body);

        return this.publicAnswer(route, call);
    }

    private hashAnswer(body: Buffer | null): Response {
        const sha1 = nested(body ?? Buffer.alloc(0), 1, 1, 1).unwrap();
        const hex = sha1.toString('hex');
        const existing = this.options.preexisting?.(hex) ?? this.media.get(hex)?.key;

        return binary(
            encode(
                1,
                encode(
                    2,
                    Buffer.concat([
                        encode(1, encode(1, sha1)),
                        ...(existing ? [encode(2, encode(1, existing))] : [])
                    ])
                )
            )
        );
    }

    private commitAnswer(): Response {
        const sha1 = createHash('sha1').update(this.pending).digest('hex');
        const scotty = Buffer.concat([num(1, 2), encode(2, 'transfer-token')]);
        const key = this.media.get(sha1)?.key ?? '';

        return binary(
            encode(1, Buffer.concat([encode(1, scotty), num(2, 0), encode(3, encode(1, key))]))
        );
    }

    private mutationAnswer(body: Buffer | null): Response {
        const fields = parse(body ?? Buffer.alloc(0)).unwrap();
        const items = fields.filter((field) => field.number === 3);
        const keys = items.map((field) => {
            const sha1 = Buffer.from(String(field.value), 'base64url').toString('hex');

            return this.keyFor(sha1);
        });

        return binary(
            Buffer.concat([
                ...keys.map((key) => encode(1, key)),
                encode(2, encode(1, 'item-identity'))
            ])
        );
    }

    private deleted = new Map<string, string>();

    private keyFor(sha1: string): string {
        const current = this.media.get(sha1)?.key;
        if (current) this.deleted.set(sha1, current);

        return current ?? this.deleted.get(sha1) ?? '';
    }

    private publicAnswer(route: string, call: FakeCall): Response {
        if (route === 'short') return shortAnswer(this.linkOn);
        if (route === 'page') return pageAnswer(this.linkOn);
        if (route === 'batch') {
            const media = [...this.media.entries()].map(([sha1, value]) => ({ sha1, ...value }));

            return listingAnswer(media, this.options.responseNextToken);
        }
        if (route === 'preflight') return preflightAnswer();

        const media =
            this.linkOn || this.options.directOutlivesRevoke
                ? [...this.media.values()].find(({ key }) => call.url.pathname.includes(key))
                : undefined;

        return mediaAnswer(media, call.headers.get('range'));
    }
}
