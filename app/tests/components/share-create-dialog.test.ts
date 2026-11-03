// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ShareRecord } from '@madkarmaa/phodrive-core/share-models';
import ShareCreateDialog from '#components/ShareCreateDialog.svelte';

const SHARE_URL = 'https://shared.phodrive.dev/#share=AbCdEf';
const SHARE_RECORD: ShareRecord = {
    name: 'Holiday photos',
    envelopeKey: 'AF1QipEnvelope',
    albumKey: 'AF1QipAlbum',
    shortUrl: 'https://photos.app.goo.gl/abc123',
    albumUrl: 'https://photos.google.com/share/AbCdEf?key=M2ZXZ1',
    authKey: '',
    shareUrl: SHARE_URL,
    createdAt: 1_700_000_000_000
};

function selected(name: string, complete = true) {
    return { name, complete };
}

function renderCreate(
    overrides: {
        files?: { name: string; complete: boolean }[];
        invalidReason?: string;
        busy?: boolean;
        error?: string;
        errorCode?: string;
        recovery?: { envelopeKey?: string; albumKey: string } | null;
        oncreate?: (name: string) => void;
        onclose?: () => void;
    } = {}
) {
    return render(ShareCreateDialog, {
        props: {
            open: true,
            files: overrides.files ?? [selected('Holiday.jpg')],
            invalidReason: overrides.invalidReason,
            busy: overrides.busy ?? false,
            error: overrides.error,
            errorCode: overrides.errorCode,
            recovery: overrides.recovery,
            oncreate: overrides.oncreate ?? vi.fn(),
            oncopy: vi.fn(),
            onclose: overrides.onclose ?? vi.fn()
        }
    });
}

beforeEach(() => cleanup());
afterEach(() => cleanup());

test('the create state lists files, defaults the name, and submits by form or button', async () => {
    const oncreate = vi.fn();
    renderCreate({ oncreate });

    expect(screen.getByText('1 file')).toBeTruthy();
    expect(screen.getByText('Holiday.jpg')).toBeTruthy();

    const input = screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
    expect(input.value).toBe('Holiday');

    await fireEvent.input(input, { target: { value: 'Summer' } });

    const form = input.closest('form');
    if (!(form instanceof HTMLFormElement)) throw new Error('The name field is not in a form.');

    await fireEvent.submit(form);
    expect(oncreate).toHaveBeenCalledWith('Summer');

    await fireEvent.click(screen.getByRole('button', { name: 'Create link' }));
    expect(oncreate).toHaveBeenCalledTimes(2);
    expect(oncreate).toHaveBeenLastCalledWith('Summer');
});

test('multiple files use a count name and the list stops after five names', () => {
    renderCreate({
        files: [
            selected('One.jpg'),
            selected('Two.jpg'),
            selected('Three.jpg'),
            selected('Four.jpg'),
            selected('Five.jpg'),
            selected('Six.jpg')
        ]
    });

    expect(screen.getByText('6 files')).toBeTruthy();
    expect(screen.getByText('Five.jpg')).toBeTruthy();
    expect(screen.queryByText('Six.jpg')).toBeNull();
    expect(screen.getByText('and 1 more')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe(
        '6 files'
    );
});

test('the name must be 1 to 200 trimmed characters', async () => {
    const oncreate = vi.fn();
    renderCreate({ oncreate });

    const input = screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
    const create = screen.getByRole('button', { name: 'Create link' }) as HTMLButtonElement;

    await fireEvent.input(input, { target: { value: '' } });
    expect(create.disabled).toBe(true);

    const form = input.closest('form');
    if (!(form instanceof HTMLFormElement)) throw new Error('The name field is not in a form.');
    await fireEvent.submit(form);
    expect(screen.getByText('Enter a name for the share link.')).toBeTruthy();
    expect(oncreate).not.toHaveBeenCalled();

    await fireEvent.input(input, { target: { value: '   ' } });
    expect(create.disabled).toBe(true);

    await fireEvent.input(input, { target: { value: 'a'.repeat(201) } });
    expect(create.disabled).toBe(true);
    await fireEvent.blur(input);
    expect(screen.getByText('Use 200 characters or fewer.')).toBeTruthy();

    const longest = 'b'.repeat(200);
    await fireEvent.input(input, { target: { value: longest } });
    expect(create.disabled).toBe(false);
    await fireEvent.submit(form);
    expect(oncreate).toHaveBeenCalledWith(longest);

    await fireEvent.input(input, { target: { value: 'x' } });
    await fireEvent.click(create);
    expect(oncreate).toHaveBeenLastCalledWith('x');
});

test('an invalid selection reason is visible and blocks creation', () => {
    const reason = 'Share needs complete files. Remove incomplete files to continue.';
    renderCreate({ files: [selected('Proof.bin', false)], invalidReason: reason });

    expect(screen.getByText(reason)).toBeTruthy();
    expect(
        (screen.getByRole('button', { name: 'Create link' }) as HTMLButtonElement).disabled
    ).toBe(true);
});

test('a create error stays visible and shows recovery keys without claiming success', () => {
    renderCreate({
        error: 'Could not create the share link.',
        recovery: {
            envelopeKey: 'AF1QipEnvelope',
            albumKey: 'AF1QipAlbum'
        }
    });

    expect(screen.getByRole('alert').textContent).toContain('Could not create the share link.');
    expect(screen.getByText(/The link may already be live/)).toBeTruthy();
    expect(screen.getByText('Envelope key')).toBeTruthy();
    expect(screen.getByText('AF1QipEnvelope')).toBeTruthy();
    expect(screen.getByText('Album key')).toBeTruthy();
    expect(screen.getByText('AF1QipAlbum')).toBeTruthy();
    expect(screen.queryByText('Share link ready')).toBeNull();
});

test('SHARE_LINK_NOT_LIVE offers a retry action and keeps the selection', async () => {
    const oncreate = vi.fn();
    renderCreate({
        oncreate,
        errorCode: 'SHARE_LINK_NOT_LIVE',
        error: 'The share link is not serving yet. Check again before retrying.'
    });

    expect(screen.getByRole('alert').textContent).toContain(
        'The share link is not serving yet. Check again before retrying.'
    );
    expect(screen.queryByRole('button', { name: 'Create link' })).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(oncreate).toHaveBeenCalledWith('Holiday');
});

test('SHARE_LINK_UNCERTAIN explains the live risk and never offers a second create', async () => {
    const onclose = vi.fn();
    const oncreate = vi.fn();
    renderCreate({
        onclose,
        oncreate,
        errorCode: 'SHARE_LINK_UNCERTAIN',
        error: 'The share link may still be public.',
        recovery: { envelopeKey: 'AF1QipEnvelope', albumKey: 'AF1QipAlbum' }
    });

    expect(screen.getByText(/The link may already be live/)).toBeTruthy();
    expect(screen.getByText('AF1QipEnvelope')).toBeTruthy();
    const photos = screen.getByRole('link', { name: 'Open Google Photos' });
    expect(photos.getAttribute('href')).toBe('https://photos.google.com/');
    expect(photos.getAttribute('target')).toBe('_blank');
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create link' })).toBeNull();

    const name = screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
    expect(name.disabled).toBe(true);
    const form = name.closest('form');
    if (!(form instanceof HTMLFormElement)) throw new Error('The name field is not in a form.');
    await fireEvent.submit(form);
    expect(oncreate).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onclose).toHaveBeenCalledTimes(1);
});

test('SHARE_URL_TOO_LONG offers a smaller selection instead of a retry', async () => {
    const onclose = vi.fn();
    renderCreate({
        onclose,
        errorCode: 'SHARE_URL_TOO_LONG',
        error: 'This selection is too large for one share link'
    });

    expect(screen.getByText('Remove some files from the selection and try again.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Choose fewer files' }));
    expect(onclose).toHaveBeenCalledTimes(1);
});

test('the success state shows the URL, copies the record, and opens a new tab', async () => {
    const oncopy = vi.fn();
    render(ShareCreateDialog, {
        props: {
            open: true,
            files: [selected('Holiday.jpg')],
            busy: false,
            record: SHARE_RECORD,
            oncreate: vi.fn(),
            oncopy,
            onclose: vi.fn()
        }
    });

    expect(screen.getByText('Share link ready')).toBeTruthy();
    const link = screen.getByRole('textbox', { name: 'Share link' }) as HTMLInputElement;
    expect(link.value).toBe(SHARE_URL);
    expect(link.readOnly).toBe(true);

    await fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(oncopy).toHaveBeenCalledWith(SHARE_RECORD);

    const open = screen.getByRole('link', { name: 'Open link' });
    expect(open.getAttribute('href')).toBe(SHARE_URL);
    expect(open.getAttribute('target')).toBe('_blank');
    expect(open.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
});

test('a storage notice is visible in the success state', () => {
    const notice = 'This share was created, but it was not saved in this browser.';
    render(ShareCreateDialog, {
        props: {
            open: true,
            files: [selected('Holiday.jpg')],
            busy: false,
            record: SHARE_RECORD,
            storageNotice: notice,
            oncreate: vi.fn(),
            oncopy: vi.fn(),
            onclose: vi.fn()
        }
    });

    expect(screen.getByText(notice).getAttribute('role')).toBe('status');
});

test('manual and failed copy states keep the URL selectable and explain what to do', () => {
    render(ShareCreateDialog, {
        props: {
            open: true,
            files: [selected('Holiday.jpg')],
            busy: false,
            record: SHARE_RECORD,
            copyState: 'manual',
            oncreate: vi.fn(),
            oncopy: vi.fn(),
            onclose: vi.fn()
        }
    });

    const manualLink = screen.getByRole('textbox', { name: 'Share link' }) as HTMLInputElement;
    expect(manualLink.readOnly).toBe(true);
    expect(manualLink.value).toBe(SHARE_URL);
    expect(
        screen.getByText('Clipboard access is blocked. Select the link and copy it.')
    ).toBeTruthy();

    manualLink.focus();
    manualLink.select();
    expect(manualLink.selectionStart).toBe(0);
    expect(manualLink.selectionEnd).toBe(SHARE_URL.length);

    cleanup();

    render(ShareCreateDialog, {
        props: {
            open: true,
            files: [selected('Holiday.jpg')],
            busy: false,
            record: SHARE_RECORD,
            copyState: 'failed',
            copyError: 'Clipboard permission was denied.',
            oncreate: vi.fn(),
            oncopy: vi.fn(),
            onclose: vi.fn()
        }
    });

    const failedLink = screen.getByRole('textbox', { name: 'Share link' }) as HTMLInputElement;
    expect(failedLink.readOnly).toBe(true);
    expect(failedLink.value).toBe(SHARE_URL);
    expect(screen.getByText('Clipboard permission was denied.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();

    cleanup();

    render(ShareCreateDialog, {
        props: {
            open: true,
            files: [selected('Holiday.jpg')],
            busy: false,
            record: SHARE_RECORD,
            copyState: 'failed',
            oncreate: vi.fn(),
            oncopy: vi.fn(),
            onclose: vi.fn()
        }
    });

    expect(
        screen.getByText('The link could not be copied. Select the link and copy it.')
    ).toBeTruthy();
});
