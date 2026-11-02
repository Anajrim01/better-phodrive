// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createUploadJobs, type UploadJob } from '#browser/files';
import { UploadJobStatus } from '@madkarmaa/phodrive-core/models';
import UploadPanel from '#components/UploadPanel.svelte';
import UploadStatusRow from '#components/UploadStatusRow.svelte';

function job(overrides: Partial<UploadJob> = {}): UploadJob {
    const [created] = createUploadJobs([new File(['status'], 'status.bin')]);
    if (!created) throw new Error('Expected a job.');

    return { ...created, ...overrides };
}

beforeEach(() => cleanup());
afterEach(() => cleanup());

test('an upload error keeps its full message and retry action in a wrapping row', () => {
    const message = `Google Photos rejected this file: ${'https://example.com/error/'.repeat(8)}`;
    const item = job({
        name: 'very-long-upload-name.bin',
        status: UploadJobStatus.Error,
        message
    });
    const view = render(UploadStatusRow, {
        props: {
            job: item,
            retryDisabled: false,
            now: Date.now(),
            onretry: vi.fn()
        }
    });

    const detail = screen.getByRole('alert');
    expect(detail.textContent).toBe(message);
    expect(detail.classList.contains('break-words')).toBe(true);
    expect(screen.getByRole('button', { name: `Retry ${item.name}` })).toBeTruthy();
    expect(view.container.querySelector('.np-item-end')).not.toBeNull();
});

test('the upload panel wraps its status and keeps the queue in its own scroll area', () => {
    const item = job({ status: UploadJobStatus.Error, message: 'Upload failed' });
    const view = render(UploadPanel, {
        props: {
            open: false,
            busy: false,
            jobs: [item],
            retryDisabled: false,
            onretry: vi.fn()
        }
    });

    const heading = view.container.querySelector('h2');
    const queue = view.container.querySelector('.upload-queue');
    const scroll = view.container.querySelector('.upload-queue-scroll');
    expect(heading?.classList.contains('break-words')).toBe(true);
    expect(heading?.textContent).toContain('1 upload failed');
    expect(scroll?.contains(queue)).toBe(true);
    expect(scroll?.classList.contains('min-h-0')).toBe(true);
    expect(scroll?.classList.contains('overflow-y-auto')).toBe(true);
    expect(view.container.querySelectorAll('header button.shrink-0')).toHaveLength(2);
});
