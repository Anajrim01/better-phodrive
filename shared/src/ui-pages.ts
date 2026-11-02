import type { AlbumResponse } from './api';
import type { PlannedFile } from './discover';
import { failureDetail, failureTitle, type ViewerFailure } from './errors';
import { formatBytes, formatCount } from './format';
import { MAX_MANIFEST_FRAGMENT_LENGTH } from './limits';
import { clearPreviewUrl } from './preview-url';
import { button, element, fileUi, root, type FileUi } from './ui-dom';

export interface ShareHandlers {
    save: (plan: PlannedFile, ui: FileUi) => void;
    preview: (plan: PlannedFile, ui: FileUi) => void;
}

function clearRoot(): void {
    clearPreviewUrl();
    root.replaceChildren();
    root.setAttribute('aria-busy', 'false');
}

export function renderLanding(onOpen: () => void, note?: string): void {
    clearRoot();
    document.title = 'Phodrive shared files';

    const section = element('section', 'intro');
    section.append(element('p', 'eyebrow', 'Shared file'));
    section.append(element('h1', '', 'Open a share link'));

    const lede = element(
        'p',
        'lede',
        'Phodrive share links carry the album in the part after the hash. Paste one here, or open the original link. The hash is not sent; only the public album URL goes to the proxy.'
    );
    section.append(lede);

    const form = element('form', 'open-form');
    const label = element('label', '', 'Share link');
    label.htmlFor = 'share-link';

    const input = element('input');
    input.id = 'share-link';
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = 'https://shared.phodrive.dev/#share=...';
    input.value = location.hash || '';

    const row = element('div', 'field-row');
    const submit = button('Open', true);
    submit.type = 'submit';
    row.append(input, submit);

    const hint = element(
        'p',
        'field-hint',
        note ?? 'The link is read in your browser. Only the public album URL is sent to the proxy.'
    );
    hint.setAttribute('role', 'status');

    form.append(label, row, hint);
    form.addEventListener('submit', (event) => {
        event.preventDefault();

        const fragment = extractShareFragment(input.value);
        if (!fragment || fragment.length > MAX_MANIFEST_FRAGMENT_LENGTH + 7) {
            hint.textContent = 'That does not look like a Phodrive share link.';
            hint.classList.add('field-error');
            return;
        }

        hint.classList.remove('field-error');
        hint.textContent = 'Opening the share.';

        if (location.hash === fragment) onOpen();
        else location.hash = fragment;
    });

    section.append(form);
    root.append(section);
}

function extractShareFragment(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const marker = '#share=';
    const index = trimmed.indexOf(marker);
    if (index >= 0) return trimmed.slice(index);
    if (trimmed.startsWith('share=')) return `#${trimmed}`;

    return null;
}

export function renderReading(): void {
    clearRoot();
    document.title = 'Reading share · Phodrive';
    root.setAttribute('aria-busy', 'true');

    const section = element('section', 'status-panel');
    section.append(element('p', 'eyebrow', 'Share'));
    section.append(element('h1', '', 'Reading the album'));
    section.append(
        element(
            'p',
            'lede',
            'The public item list is coming from Google Photos. Nothing is saved until every file checks out.'
        )
    );
    section.append(element('p', 'status-line', 'Checking the public album first'));
    root.append(section);
}

export function renderError(
    title: string,
    failure: ViewerFailure,
    retry: (() => void) | null
): void {
    clearRoot();
    document.title = `${title} · Phodrive`;

    const section = element('section', 'error-panel');
    section.append(element('p', 'eyebrow', 'Share'));
    section.append(element('h1', '', title));
    section.append(element('p', 'error-detail', failureDetail(failure)));
    section.append(element('p', 'error-code', failure.code));

    const actions = element('div', 'error-actions');
    if (retry) {
        const again = button('Try again', true);
        again.addEventListener('click', retry);
        actions.append(again);
    }

    const other = element('a', 'button button-quiet', 'Open another share');
    other.href = location.pathname;
    actions.append(other);
    section.append(actions);
    root.append(section);
}

export function renderShare(
    album: AlbumResponse,
    plans: PlannedFile[],
    handlers: ShareHandlers
): void {
    clearRoot();
    const title = album.title || 'Shared files';
    document.title = `${title} · Phodrive`;

    const total = plans.reduce((sum, plan) => sum + plan.size, 0);
    const section = element('section', 'share');
    const head = element('header', 'share-head');
    head.append(element('p', 'eyebrow', plans.length === 1 ? 'Shared file' : 'Shared files'));
    head.append(element('h1', '', title));
    head.append(
        element(
            'p',
            'share-meta',
            `${formatCount(plans.length, 'file')} · ${formatBytes(total)} · rebuilt in this browser`
        )
    );
    section.append(head);

    const list = element('ul', 'file-list');
    for (const [index, plan] of plans.entries()) {
        const ui = fileUi(plan, index);
        ui.save.addEventListener('click', () => handlers.save(plan, ui));
        ui.preview?.addEventListener('click', () => handlers.preview(plan, ui));
        list.append(ui.row);
    }
    section.append(list);

    section.append(
        element(
            'p',
            'verify-note',
            'Every file is rebuilt from its chunks and hashed here before it is offered. Anyone with this link can download it. The owner can stop new downloads, but a saved copy stays saved.'
        )
    );
    root.append(section);
}
