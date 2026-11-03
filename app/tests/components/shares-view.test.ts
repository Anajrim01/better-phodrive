// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ComponentProps } from 'svelte';
import type { ShareRecord } from '@madkarmaa/phodrive-core/share-models';
import SharesView from '#components/SharesView.svelte';

vi.hoisted(() => {
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: (query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => false
        })
    });
    Object.defineProperty(Element.prototype, 'animate', {
        configurable: true,
        value: () => ({
            cancel: () => {},
            finish: () => {},
            finished: Promise.resolve(),
            addEventListener: () => {},
            removeEventListener: () => {}
        })
    });
    Object.defineProperty(globalThis, 'ResizeObserver', {
        configurable: true,
        value: class {
            observe() {}
            unobserve() {}
            disconnect() {}
        }
    });
});

type SharesProps = ComponentProps<typeof SharesView>;

function share(overrides: Partial<ShareRecord> = {}): ShareRecord {
    return {
        name: 'Holiday photos',
        envelopeKey: 'AF1QipEnvelope',
        albumKey: 'AF1QipAlbum',
        shortUrl: 'https://photos.app.goo.gl/abc123',
        albumUrl: 'https://photos.google.com/share/AbCdEf?key=M2ZXZ1',
        authKey: 'M2ZXZ1ZVa3U1anM5QUZITzhySDFSYk1Xb19FelhR',
        shareUrl: 'https://shared.phodrive.dev/#share=AbCdEf',
        createdAt: 1_700_000_000_000,
        ...overrides
    };
}

function props(overrides: Partial<SharesProps> = {}): SharesProps {
    return {
        records: [],
        fileCounts: new Map<string, number>(),
        copyState: 'idle',
        copiedKey: '',
        oncopy: vi.fn(),
        onrevoke: vi.fn(),
        ...overrides
    };
}

beforeEach(() => cleanup());
afterEach(() => cleanup());

test('the empty state explains where share links come from', () => {
    render(SharesView, { props: props() });

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent?.replace(/\s+/g, ' ').trim()).toBe('Shares (0)');
    expect(screen.getByText('No share links yet')).toBeTruthy();
    expect(
        screen.getByText('Share files from My files. Links you create appear here.')
    ).toBeTruthy();
});

test('rows show the name, created date, and file count when it is known', () => {
    const first = share();
    const second = share({
        envelopeKey: 'AF1QipSecond',
        name: 'Trip video',
        createdAt: 1_700_000_100_000
    });
    const third = share({
        envelopeKey: 'AF1QipThird',
        name: 'One photo',
        createdAt: 1_700_000_200_000
    });

    render(SharesView, {
        props: props({
            records: [first, second, third],
            fileCounts: new Map([
                [first.envelopeKey, 3],
                [third.envelopeKey, 1]
            ])
        })
    });

    expect(screen.getByText('Holiday photos')).toBeTruthy();
    expect(screen.getByText('3 files')).toBeTruthy();
    expect(screen.getByText('One photo')).toBeTruthy();
    expect(screen.getByText('1 file')).toBeTruthy();

    const firstRow = screen.getByText('Holiday photos').closest('li');
    expect(firstRow?.querySelector('time')).not.toBeNull();

    const secondRow = screen.getByText('Trip video').closest('li');
    expect(secondRow?.querySelector('time')?.getAttribute('datetime')).toBe(
        new Date(second.createdAt).toISOString()
    );
    expect(secondRow?.textContent).not.toMatch(/\d+ files?/);
});

test('copy and revoke pass their row record to the callbacks', async () => {
    const first = share();
    const second = share({ envelopeKey: 'AF1QipSecond', name: 'Trip video' });
    const oncopy = vi.fn();
    const onrevoke = vi.fn();

    render(SharesView, { props: props({ records: [first, second], oncopy, onrevoke }) });

    await fireEvent.click(screen.getByRole('button', { name: 'Copy link to Holiday photos' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Revoke link to Trip video' }));

    expect(oncopy).toHaveBeenCalledTimes(1);
    expect(oncopy).toHaveBeenCalledWith(first);
    expect(onrevoke).toHaveBeenCalledTimes(1);
    expect(onrevoke).toHaveBeenCalledWith(second);
});

test('Open is an external anchor that names the share', () => {
    const first = share();

    render(SharesView, { props: props({ records: [first] }) });

    const open = screen.getByRole('link', { name: 'Open Holiday photos' });
    expect(open.getAttribute('href')).toBe(first.shareUrl);
    expect(open.getAttribute('target')).toBe('_blank');
    expect(open.getAttribute('rel')).toBe('noopener noreferrer');
});

test('a successful copy shows quiet confirmation in the row', () => {
    const first = share();

    render(SharesView, {
        props: props({ records: [first], copyState: 'copied', copiedKey: first.envelopeKey })
    });

    expect(screen.getByText('Link copied')).toBeTruthy();
});

test('a manual copy exposes the share URL in a readonly field', () => {
    const first = share();
    const second = share({ envelopeKey: 'AF1QipSecond', name: 'Trip video' });

    render(SharesView, {
        props: props({
            records: [first, second],
            copyState: 'manual',
            copiedKey: first.envelopeKey
        })
    });

    expect(
        screen.getByText(
            'This browser could not copy the link automatically. Select the link below and copy it.'
        )
    ).toBeTruthy();

    const inputs = screen.getAllByRole('textbox');
    expect(inputs).toHaveLength(1);

    const input = screen.getByLabelText('Share link for Holiday photos') as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    expect(input.value).toBe(first.shareUrl);
});

test('a failed copy shows the error and the share URL', () => {
    const first = share();

    render(SharesView, {
        props: props({
            records: [first],
            copyState: 'failed',
            copiedKey: first.envelopeKey,
            copyError: 'Clipboard permission was denied.'
        })
    });

    expect(screen.getByText('Clipboard permission was denied.')).toBeTruthy();

    const input = screen.getByLabelText('Share link for Holiday photos') as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    expect(input.value).toBe(first.shareUrl);
});

test('a revoke notice appears above the list', () => {
    const first = share();

    render(SharesView, {
        props: props({
            records: [first],
            revokeNotice: 'Share revoked. The link no longer opens.'
        })
    });

    expect(screen.getByRole('status').textContent).toBe('Share revoked. The link no longer opens.');
});

test('an unavailable viewer pauses creation but keeps existing links manageable', async () => {
    const first = share();
    const oncopy = vi.fn();
    const onrevoke = vi.fn();

    render(SharesView, {
        props: props({
            records: [first],
            shareAvailable: false,
            oncopy,
            onrevoke
        })
    });

    expect(
        screen.getByText(
            "Sharing isn't available yet. You can still open, copy, or revoke any links listed here."
        )
    ).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'Copy link to Holiday photos' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Revoke link to Holiday photos' }));
    expect(oncopy).toHaveBeenCalledWith(first);
    expect(onrevoke).toHaveBeenCalledWith(first);
    expect(screen.getByRole('link', { name: 'Open Holiday photos' })).toBeTruthy();
});

test('the empty state says creation is paused while the viewer is unavailable', () => {
    render(SharesView, { props: props({ shareAvailable: false }) });

    expect(
        screen.getByText('Creating new links is paused until the viewer is available.')
    ).toBeTruthy();
});
