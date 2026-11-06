import { createHash } from 'node:crypto';
import {
    parseAlbumUrl,
    slotPaths,
    type PublicItem
} from '@madkarmaa/phodrive-core/server/photos/shares/google-listing';
import {
    readPublicListing,
    type PublicListing
} from '@madkarmaa/phodrive-core/server/photos/shares/google-public-listing';
import {
    isExactRange,
    preflightRange,
    readRange,
    type RangeRead
} from '@madkarmaa/phodrive-core/server/photos/shares/google-range';
import type { AsyncResult } from 'results-ts';
import { failureStatus, inOrder, persist, type SpikeError, type SpikeSession } from './steps.ts';

// Reserved TLD, so the probe observes CORS headers without naming a real deployment.
const PROBE_ORIGIN = 'https://viewer.phodrive.invalid';
const INTERIOR_START = 1;
const INTERIOR_END = 16;
const EXPOSED_RANGE_HEADERS = ['content-range', 'content-length', 'accept-ranges'];

type Findings = { problems: number; matched: Set<string> };

function sha1(bytes: Uint8Array): string {
    return createHash('sha1').update(bytes).digest('hex');
}

function hostOf(url: string): string {
    return new URL(url).hostname;
}

function allowOriginStatus(value: string | null): string {
    if (value === null) return 'none';

    return value === '*' || value === PROBE_ORIGIN ? value : 'other';
}

export function readAlbumListing(session: SpikeSession): AsyncResult<PublicListing, SpikeError> {
    return parseAlbumUrl(session.ledger.link.canonicalUrl ?? '').andThenAsync((album) =>
        readPublicListing(album, session.fetcher)
    );
}

function reportListing(session: SpikeSession, listing: PublicListing): void {
    session.report({ stage: 'listing', status: 'complete', count: listing.items.length });
    session.report({
        stage: 'pagination',
        status: listing.pages > 1 ? 'observed' : 'unobserved',
        count: listing.pages
    });
}

function reportMapping(
    session: SpikeSession,
    findings: Findings,
    item: PublicItem,
    actualSha1: string
): void {
    const fixture = session.ledger.fixtures.find(({ sha1: expected }) => expected === actualSha1);
    if (!fixture) {
        findings.problems += 1;
        session.report({ stage: 'sha1-map', status: 'unmapped', hash: actualSha1 });

        return;
    }

    if (findings.matched.has(actualSha1)) {
        findings.problems += 1;
        session.report({ stage: 'sha1-map', status: 'duplicate', hash: actualSha1 });

        return;
    }
    findings.matched.add(actualSha1);

    session.report({ stage: 'sha1-map', status: 'matched', hash: actualSha1 });

    const dedupKey = Buffer.from(fixture.sha1, 'hex').toString('base64url');
    const slots = slotPaths(item.entry, dedupKey);
    if (item.dedupKey !== dedupKey) findings.problems += 1;

    session.report({
        stage: 'dedup-slot',
        status: slots.length ? `found:${slots.join(',')}` : 'absent',
        hash: actualSha1
    });
}

function probeInterior(
    session: SpikeSession,
    findings: Findings,
    item: PublicItem,
    full: RangeRead,
    size: number
): AsyncResult<void, SpikeError> {
    return readRange(
        item.downloadUrl,
        INTERIOR_START,
        INTERIOR_END,
        PROBE_ORIGIN,
        session.fetcher
    ).map((read) => {
        const expected = full.body.subarray(INTERIOR_START, INTERIOR_END + 1);
        const exact =
            isExactRange(read, INTERIOR_START, INTERIOR_END, size) && read.body.equals(expected);
        if (!exact) findings.problems += 1;

        session.report({
            stage: 'range-interior',
            status: exact ? 'exact' : `mismatch:${read.status}`,
            count: read.body.length,
            hash: sha1(read.body)
        });
    });
}

function probeCors(
    session: SpikeSession,
    findings: Findings,
    item: PublicItem,
    full: RangeRead
): AsyncResult<void, SpikeError> {
    const exposed = (full.exposeHeaders ?? '').toLowerCase();
    const missing = EXPOSED_RANGE_HEADERS.filter((header) => !exposed.includes(header));
    const allowOrigin = allowOriginStatus(full.allowOrigin);
    if (allowOrigin === 'none' || allowOrigin === 'other') findings.problems += 1;

    session.report({ stage: 'cors-origin', status: allowOrigin, host: hostOf(item.downloadUrl) });
    session.report({
        stage: 'cors-expose',
        status: missing.length ? `missing:${missing.join(',')}` : 'all',
        count: EXPOSED_RANGE_HEADERS.length - missing.length
    });

    return preflightRange(item.downloadUrl, PROBE_ORIGIN, session.fetcher).map((preflight) =>
        session.report({
            stage: 'cors-preflight',
            status: `${preflight.status}:${allowOriginStatus(preflight.allowOrigin)}`
        })
    );
}

function probeItem(
    session: SpikeSession,
    findings: Findings,
    item: PublicItem,
    size: number
): AsyncResult<void, SpikeError> {
    return readRange(item.downloadUrl, 0, size - 1, PROBE_ORIGIN, session.fetcher).andThenAsync(
        async (full) => {
            const exact = isExactRange(full, 0, size - 1, size);
            const actualSha1 = sha1(full.body);
            if (!exact) findings.problems += 1;

            session.report({
                stage: 'range-full',
                status: exact ? 'exact' : `mismatch:${full.status}`,
                count: full.body.length,
                hash: actualSha1,
                host: full.locationHost ?? hostOf(item.downloadUrl)
            });
            reportMapping(session, findings, item, actualSha1);

            return probeInterior(session, findings, item, full, size).andThenAsync(() =>
                probeCors(session, findings, item, full)
            );
        }
    );
}

export function runProbe(session: SpikeSession): AsyncResult<number, SpikeError> {
    const findings: Findings = { problems: 0, matched: new Set() };
    const { fixtures } = session.ledger;
    const size = fixtures[0].size;

    return readAlbumListing(session)
        .inspectErr((error) => session.report({ stage: 'listing', status: failureStatus(error) }))
        .andThenAsync(async (listing) => {
            reportListing(session, listing);
            if (listing.items.length !== fixtures.length) findings.problems += 1;

            session.ledger.directUrls = listing.items.map((item) => item.downloadUrl);
            const saved = await persist(session);
            if (saved.isErr()) return saved;

            return inOrder(listing.items, (item) => probeItem(session, findings, item, size));
        })
        .map(() => {
            findings.problems += fixtures.length - findings.matched.size;
            session.report({ stage: 'probe', status: 'done', count: findings.problems });

            return findings.problems;
        });
}
