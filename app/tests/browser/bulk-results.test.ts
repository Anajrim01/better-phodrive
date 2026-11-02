import { expect, test } from 'vitest';
import { bulkFailureMessage, type BulkFailure } from '#browser/drive/bulk-results';

function failure(name: string, email = 'first@example.com', message = 'No access'): BulkFailure {
    return { name, email, message };
}

function identicalFailures(
    count: number,
    message: string,
    email = 'first@example.com'
): BulkFailure[] {
    return Array.from({ length: count }, (_, index) =>
        failure(`photo-${index}.jpg`, email, message)
    );
}

test('1,095 stale failures become one actionable sentence', () => {
    const message = bulkFailureMessage(
        identicalFailures(1095, 'Invalid file metadata.'),
        1095,
        'delete'
    );

    expect(message).toBe('This selection no longer matches your library. Refresh and try again.');
    expect(message).not.toContain('photo-0.jpg');
});

test('stale metadata without a final period is still actionable', () => {
    const message = bulkFailureMessage(
        [
            failure('first.jpg', 'first@example.com', 'Invalid file metadata'),
            failure('second.jpg', 'first@example.com', 'Invalid file metadata')
        ],
        2,
        'delete'
    );

    expect(message).toBe('This selection no longer matches your library. Refresh and try again.');
});

test('1,095 identical failures are counted with only three examples', () => {
    const message = bulkFailureMessage(
        identicalFailures(1095, 'Move to trash failed'),
        1095,
        'delete'
    );

    expect(message).toContain('Could not delete any files.');
    expect(message).toContain('1,095 failures with "Move to trash failed" from first@example.com:');
    expect(message).toContain('photo-0.jpg, photo-1.jpg, photo-2.jpg and 1,092 more.');
    expect(message).not.toContain('photo-3.jpg');
    expect(message.length).toBeLessThan(250);
});

test('mixed failure messages keep the success count, failure count, and a few examples', () => {
    const message = bulkFailureMessage(
        [
            failure('first.jpg', 'first@example.com', 'No access'),
            failure('second.jpg', 'second@example.com', 'Paused'),
            failure('third.jpg', 'second@example.com', 'Paused'),
            failure('fourth.jpg', 'second@example.com', 'Paused'),
            failure('fifth.jpg', 'first@example.com', 'No access'),
            failure('sixth.jpg', 'third@example.com', 'Timeout')
        ],
        7,
        'delete'
    );

    expect(message).toContain('Deleted 1 of 7 files. 6 failed.');
    expect(message).toContain(
        '3 failures with "Paused" from second@example.com: second.jpg, third.jpg, fourth.jpg.'
    );
    expect(message).toContain(
        '2 failures with "No access" from first@example.com: first.jpg, fifth.jpg.'
    );
    expect(message).toContain('1 failure with "Timeout" from third@example.com: sixth.jpg.');
});

test('multiple owners with the same failure stay separate and counted', () => {
    const message = bulkFailureMessage(
        [
            failure('first.jpg', 'first@example.com', 'Paused'),
            failure('second.jpg', 'first@example.com', 'Paused'),
            failure('third.jpg', 'second@example.com', 'Paused')
        ],
        3,
        'delete'
    );

    expect(message).toContain(
        '2 failures with "Paused" from first@example.com: first.jpg, second.jpg.'
    );
    expect(message).toContain('1 failure with "Paused" from second@example.com: third.jpg.');
});

test('a long mixed failure list caps the groups shown', () => {
    const message = bulkFailureMessage(
        [
            failure('a.jpg', 'a@example.com', 'One'),
            failure('b.jpg', 'b@example.com', 'Two'),
            failure('c.jpg', 'c@example.com', 'Three'),
            failure('d.jpg', 'd@example.com', 'Four')
        ],
        4,
        'delete'
    );

    expect(message).toContain('Could not delete any files.');
    expect(message).toContain('And 1 more failure.');
    expect(message).not.toContain('"Two"');
});

test('a mixed stale and access failure keeps both outcomes visible', () => {
    const message = bulkFailureMessage(
        [
            failure('stale.jpg', 'first@example.com', 'Invalid file metadata.'),
            failure('denied.jpg', 'first@example.com', 'No access')
        ],
        2,
        'delete'
    );

    expect(message).toContain('1 failure with "Invalid file metadata."');
    expect(message).toContain('1 failure with "No access"');
    expect(message).not.toBe(
        'This selection no longer matches your library. Refresh and try again.'
    );
});
