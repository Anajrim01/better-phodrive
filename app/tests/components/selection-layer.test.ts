// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ComponentProps } from 'svelte';
import { FileActionKind } from '@madkarmaa/phodrive-core/models';
import { selectionBarVisible } from '#browser/drive/selection-view.svelte';
import SelectionLayer from '#components/SelectionLayer.svelte';

type LayerProps = ComponentProps<typeof SelectionLayer>;

type LayerState = {
    count: number;
    trash: boolean;
    running: boolean;
    runningAction: FileActionKind | null;
    progressDone: number;
    progressTotal: number;
};

beforeEach(() => cleanup());
afterEach(() => cleanup());

function mount(overrides: Partial<LayerState> = {}) {
    const state: LayerState = {
        count: 0,
        trash: false,
        running: false,
        runningAction: null,
        progressDone: 0,
        progressTotal: 0,
        ...overrides
    };
    const confirm = vi.fn();
    const clear = vi.fn();
    const bulk = {
        running: state.running,
        runningAction: state.runningAction,
        progressDone: state.progressDone,
        progressTotal: state.progressTotal,
        download: vi.fn(),
        restore: vi.fn(),
        openMove: vi.fn(),
        openDetails: vi.fn()
    };
    const selection = {
        scope: 'files',
        count: state.count,
        trash: state.trash,
        overlayOpen: false,
        barVisible: selectionBarVisible(state.count, state.running, false),
        canSelectAll: true,
        selected: [],
        clear,
        confirm
    };
    const props = {
        drive: { bulk },
        selection,
        actionsDisabled: state.running,
        browseDisabled: false
    };

    render(SelectionLayer, { props: props as unknown as LayerProps });
}

test.each([
    [FileActionKind.Delete, false, 'Deleting 1 of 3', 1],
    [FileActionKind.Restore, true, 'Restoring 2 of 3', 2],
    [FileActionKind.DeleteForever, true, 'Deleting 3 of 3', 3],
    [FileActionKind.Download, false, 'Downloading 1 of 3', 1]
])(
    'keeps the bar and progress visible at zero selected during %s',
    (runningAction, trash, label, progressDone) => {
        mount({ trash, running: true, runningAction, progressDone, progressTotal: 3 });

        expect(screen.getByRole('toolbar', { name: 'Selection actions' })).toBeTruthy();
        expect(screen.getByText(label)).toBeTruthy();

        const actionButtons = screen
            .getAllByRole('button')
            .filter((button) => button.getAttribute('aria-label') !== 'Clear selection');
        expect(actionButtons.length).toBeGreaterThan(0);
        for (const button of actionButtons) expect(button.hasAttribute('disabled')).toBe(true);
        expect(
            screen.getByRole('button', { name: 'Clear selection' }).hasAttribute('disabled')
        ).toBe(true);
    }
);

test('keeps the clear action enabled while files are selected and idle', () => {
    mount({ count: 2 });

    expect(screen.getByRole('button', { name: 'Clear selection' }).hasAttribute('disabled')).toBe(
        false
    );
});

test('leaves the bar absent when nothing is selected and no bulk action runs', () => {
    mount();

    expect(screen.queryByRole('toolbar', { name: 'Selection actions' })).toBeNull();
});
