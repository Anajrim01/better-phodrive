const INTERACTIVE = [
    'button',
    'a',
    'input',
    'select',
    'textarea',
    'label',
    'tr',
    'li',
    '[data-file-key]',
    '[role="button"]',
    '[role="menuitem"]',
    '[role="option"]',
    '[role="menu"]',
    '[role="tooltip"]',
    '.marquee-surface',
    '.selection-bar',
    'dialog'
].join(',');

export function isSelectionBackground(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest(INTERACTIVE) === null;
}
