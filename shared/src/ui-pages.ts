import type { AlbumResponse } from './api';
import type { PlannedFile } from './discover';
import { failureDetail, type ViewerFailure } from './errors';
import { formatBytes, formatCount } from './format';
import { MAX_MANIFEST_FRAGMENT_LENGTH } from './limits';
import { clearPreviewUrl } from './preview-url';
import { button, element, fileUi, icon, root, type FileUi } from './ui-dom';

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
    section.append(element('h1', '', 'Open a share link'));

    const lede = element(
        'p',
        'lede',
        'The file list is in the part of the link after the #. Paste the whole link to open it.'
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
        note ?? 'Your browser reads the link. It sends only the public album address to the server.'
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
        hint.textContent = 'Opening the share';

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
    section.append(element('h1', '', 'Reading the album'));
    section.append(
        element(
            'p',
            'lede',
            'The album list comes from Google Photos. Nothing is saved until every file passes its hash check.'
        )
    );

    const line = element('p', 'status-line');
    const spinner = element('span', 'spinner');
    spinner.setAttribute('aria-hidden', 'true');
    line.append(spinner, element('span', '', 'Checking the public album'));
    section.append(line);
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
    section.dataset.code = failure.code;
    section.append(icon('alert', 24, 'panel-icon'));
    section.append(element('h1', '', title));
    section.append(element('p', 'error-detail', failureDetail(failure)));

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
    for (const plan of plans) {
        const ui = fileUi(plan);
        ui.save.addEventListener('click', () => handlers.save(plan, ui));
        ui.preview?.addEventListener('click', () => handlers.preview(plan, ui));
        list.append(ui.row);
    }
    section.append(list);

    section.append(
        element(
            'p',
            'verify-note',
            'This browser rebuilds every file from its chunks and checks its SHA-256 before offering it. Anyone with this link can download the files. The owner can stop new downloads but cannot recall copies already saved.'
        )
    );
    root.append(section);
}
