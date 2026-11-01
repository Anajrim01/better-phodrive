import { vi } from 'vitest';

if (typeof window !== 'undefined') {
    if (typeof window.matchMedia !== 'function') {
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
    }

    if (typeof Element.prototype.animate !== 'function') {
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
    }

    if (typeof globalThis.ResizeObserver !== 'function') {
        Object.defineProperty(globalThis, 'ResizeObserver', {
            configurable: true,
            value: class {
                observe() {}
                unobserve() {}
                disconnect() {}
            }
        });
    }

    if (typeof HTMLDialogElement !== 'undefined') {
        Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
            configurable: true,
            value: function (this: HTMLDialogElement) {
                this.setAttribute('open', '');
                const event = new Event('toggle');
                Object.defineProperty(event, 'newState', { value: 'open' });
                this.dispatchEvent(event);
                this.querySelector<HTMLElement>('[autofocus]')?.focus();
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
    }

    if (typeof URL.createObjectURL !== 'function') {
        Object.defineProperty(URL, 'createObjectURL', {
            configurable: true,
            value: vi.fn(() => 'blob:preview')
        });
    }

    if (typeof URL.revokeObjectURL !== 'function') {
        Object.defineProperty(URL, 'revokeObjectURL', {
            configurable: true,
            value: vi.fn()
        });
    }
}
