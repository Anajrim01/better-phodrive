// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ComponentProps } from 'svelte';
import type { ShareRecord } from '@madkarmaa/phodrive-core/share-models';
import RevokeShareDialog from '#components/RevokeShareDialog.svelte';

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
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
        configurable: true,
        value: function (this: HTMLDialogElement) {
            this.setAttribute('open', '');
            const event = new Event('toggle');
            Object.defineProperty(event, 'newState', { value: 'open' });
            this.dispatchEvent(event);
        }
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
        configurable: true,
        value: function (this: HTMLDialogElement) {
            this.removeAttribute('open');
            const event = new Event('toggle');
            Object.defineProperty(event, 'newState', { value: 'closed' });
            this.dispatchEvent(event);
        }
    });
});

type DialogProps = ComponentProps<typeof RevokeShareDialog>;

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

function props(overrides: Partial<DialogProps> = {}): DialogProps {
    return {
        open: true,
        record: share(),
        busy: false,
        onrevoke: vi.fn(),
        onclose: vi.fn(),
        ...overrides
    };
}

beforeEach(() => cleanup());
afterEach(() => cleanup());

test('the dialog names the share and explains what revoking does', async () => {
    const record = share();
    const onrevoke = vi.fn();

    render(RevokeShareDialog, { props: props({ record, onrevoke }) });

    expect(screen.getByRole('heading', { name: 'Revoke share link?' })).toBeTruthy();
    expect(
        screen.getByText(
            'The link for Holiday photos stops working. Downloaded copies stay with the people who saved them.'
        )
    ).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'Revoke link' }));
    expect(onrevoke).toHaveBeenCalledTimes(1);
});

test('an error is announced and recovery keys stay selectable', () => {
    const recovery = { envelopeKey: 'AF1QipEnvelope', albumKey: 'AF1QipAlbum' };

    render(RevokeShareDialog, {
        props: props({
            error: 'Google Photos did not confirm the revoke.',
            recovery
        })
    });

    expect(screen.getByRole('alert').textContent).toBe('Google Photos did not confirm the revoke.');
    expect(screen.getByText(/Google may still serve the link/)).toBeTruthy();
    expect(screen.getByText('Envelope key')).toBeTruthy();
    expect(screen.getByText('Album key')).toBeTruthy();
    expect(screen.getByText(recovery.envelopeKey)).toBeTruthy();
    expect(screen.getByText(recovery.albumKey)).toBeTruthy();
});

test('revoking is disabled when there is no record', () => {
    render(RevokeShareDialog, { props: props({ record: null }) });

    const revoke = screen.getByRole('button', { name: 'Revoke link' }) as HTMLButtonElement;
    expect(revoke.disabled).toBe(true);
});

test('SHARE_REVOKE_UNVERIFIED keeps the record and offers check and retry', async () => {
    const record = share();
    const onrevoke = vi.fn();
    render(RevokeShareDialog, {
        props: props({
            record,
            onrevoke,
            errorCode: 'SHARE_REVOKE_UNVERIFIED',
            error: 'Could not confirm the old share link stopped serving. Retry revoke.',
            recovery: { envelopeKey: record.envelopeKey, albumKey: record.albumKey }
        })
    });

    expect(screen.getByRole('alert').textContent).toContain(
        'Could not confirm the old share link stopped serving. Retry revoke.'
    );
    const check = screen.getByRole('link', { name: 'Check link' });
    expect(check.getAttribute('href')).toBe(record.shareUrl);
    expect(check.getAttribute('target')).toBe('_blank');
    expect(screen.queryByRole('button', { name: 'Revoke link' })).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Try revoke again' }));
    expect(onrevoke).toHaveBeenCalledTimes(1);
});

test('SHARE_LINK_STILL_LIVE offers the live link and a retry without recovery keys', () => {
    const record = share();
    render(RevokeShareDialog, {
        props: props({
            record,
            errorCode: 'SHARE_LINK_STILL_LIVE',
            error: 'The old share link is still serving. Retry revoke before sharing again.'
        })
    });

    expect(screen.getByRole('alert').textContent).toContain('is still serving');
    expect(screen.getByRole('link', { name: 'Check link' }).getAttribute('href')).toBe(
        record.shareUrl
    );
    expect(screen.getByRole('button', { name: 'Try revoke again' })).toBeTruthy();
    expect(screen.queryByText(/Google may still serve the link/)).toBeNull();
});
