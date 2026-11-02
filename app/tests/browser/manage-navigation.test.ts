import { expect, test, vi } from 'vitest';
import { navigate } from '#browser/drive/manage-navigation';

test('folder management navigation replaces the current history entry', () => {
    const openFolder = vi.fn();

    navigate({ currentFolder: () => 'A/B', openFolder }, { from: 'A/B', to: 'A/C' });

    expect(openFolder).toHaveBeenCalledWith('A/C', 'replace');
});
