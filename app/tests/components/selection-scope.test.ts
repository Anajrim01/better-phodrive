// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import SelectionScope from '#components/SelectionScope.svelte';

beforeEach(() => cleanup());
afterEach(() => cleanup());

test('a new folder or filter scope clears the selection and an unchanged scope does not', async () => {
    const onreset = vi.fn();
    const view = render(SelectionScope, { props: { scope: 'first', onreset } });

    await view.rerender({ scope: 'first', onreset });
    expect(onreset).not.toHaveBeenCalled();

    await view.rerender({ scope: 'second', onreset });
    expect(onreset).toHaveBeenCalledTimes(1);

    await view.rerender({ scope: 'second', onreset });
    expect(onreset).toHaveBeenCalledTimes(1);
});
