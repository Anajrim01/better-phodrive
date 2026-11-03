import type { PlannedFile } from './discover';
import { formatBytes, formatCount } from './format';
import { PREVIEW_BYTES } from './limits';
import { previewKind, type PreviewKind } from './preview';
import type { ReassemblyResult } from './reassemble';

function appRoot(): HTMLElement {
    const element = document.querySelector<HTMLElement>('#app');
    if (!element) throw new Error('App root is missing');

    return element;
}

export const root = appRoot();

export interface FileUi {
    row: HTMLLIElement;
    save: HTMLButtonElement;
    preview?: HTMLButtonElement;
    progress: HTMLElement;
    bar: HTMLElement;
    progressCopy: HTMLElement;
    message: HTMLElement;
    verified: HTMLElement;
    previewBox: HTMLElement;
    kind: PreviewKind | null;
    busy: boolean;
    saved: boolean;
}

type IconName = 'alert' | 'check' | 'download' | 'eye' | 'file' | 'file-text' | 'image';

const ICONS: Record<IconName, string[]> = {
    alert: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'M12 7.75v5', 'M12 16.5v.01'],
    check: ['m5 12.5 4.5 4.5L19 7.5'],
    download: ['M12 4v11', 'm7.5 10.5 4.5 4.5 4.5-4.5', 'M5 20h14'],
    eye: [
        'M2.8 12S6.4 5.8 12 5.8 21.2 12 21.2 12 17.6 18.2 12 18.2 2.8 12 2.8 12Z',
        'M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Z'
    ],
    file: ['M7 3h7l4 4v14H7z', 'M14 3v4h4'],
    'file-text': ['M7 3h7l4 4v14H7z', 'M14 3v4h4', 'M10 12h5', 'M10 16h5'],
    image: [
        'M6 5h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z',
        'M9 9.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z',
        'm4.5 17 4.5-4.5 3 3 3.5-3.5 4 4'
    ]
};

export function icon(name: IconName, size = 18, className?: string): SVGSVGElement {
    const namespace = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(namespace, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.5');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    if (className) svg.setAttribute('class', className);

    for (const data of ICONS[name]) {
        const path = document.createElementNS(namespace, 'path');
        path.setAttribute('d', data);
        svg.append(path);
    }

    return svg;
}

export function element<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;

    return node;
}

export function button(label: string, primary = false, name?: IconName): HTMLButtonElement {
    const node = element('button', primary ? 'button button-primary' : 'button button-quiet');
    node.type = 'button';
    if (name) node.append(icon(name));
    node.append(element('span', 'button-label', label));

    return node;
}

export function setButtonLabel(node: HTMLButtonElement, label: string): void {
    const target = node.querySelector<HTMLElement>('.button-label');
    if (target) target.textContent = label;
}

function fileGlyph(kind: PreviewKind | null): IconName {
    if (kind === 'image') return 'image';
    if (kind === 'text') return 'file-text';

    return 'file';
}

export function fileUi(plan: PlannedFile): FileUi {
    const kind = previewKind(plan.name);
    const row = element('li', 'file-row');

    const tile = element('div', 'file-icon');
    tile.append(icon(fileGlyph(kind), 20));
    row.append(tile);

    const body = element('div', 'file-body');
    body.append(element('h2', 'file-name', plan.name));

    const meta = element('p', 'file-meta');
    if (plan.folder) meta.append(element('span', '', plan.folder));
    meta.append(element('span', '', formatBytes(plan.size)));
    meta.append(element('span', '', formatCount(plan.chunks.length, 'chunk')));
    body.append(meta);
    row.append(body);

    const actions = element('div', 'file-actions');
    const preview =
        kind && plan.size <= PREVIEW_BYTES ? button('Preview', false, 'eye') : undefined;
    const save = button('Save', true, 'download');
    if (preview) actions.append(preview);
    actions.append(save);
    row.append(actions);

    const progress = element('div', 'row-progress');
    progress.hidden = true;
    const barBox = element('div', 'progress');
    barBox.setAttribute('role', 'progressbar');
    barBox.setAttribute('aria-label', `Rebuilding ${plan.name}`);
    barBox.setAttribute('aria-valuemin', '0');
    barBox.setAttribute('aria-valuemax', '100');
    barBox.setAttribute('aria-valuenow', '0');
    const bar = element('span', 'progress-bar');
    barBox.append(bar);
    const progressCopy = element('p', 'progress-copy', '');
    progress.append(barBox, progressCopy);
    row.append(progress);

    const message = element('p', 'row-message');
    message.hidden = true;
    message.setAttribute('role', 'status');
    row.append(message);

    const verified = element('div', 'verified');
    verified.hidden = true;
    verified.setAttribute('role', 'status');
    row.append(verified);

    const previewBox = element('div', 'preview');
    previewBox.hidden = true;
    row.append(previewBox);

    return {
        row,
        save,
        preview,
        progress,
        bar,
        progressCopy,
        message,
        verified,
        previewBox,
        kind,
        busy: false,
        saved: false
    };
}

export function setProgress(ui: FileUi, written: number, total: number): void {
    const ratio = total === 0 ? 1 : Math.min(1, written / total);
    ui.bar.style.transform = `scaleX(${ratio.toFixed(4)})`;
    ui.bar.parentElement?.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    ui.progressCopy.textContent =
        ratio >= 1 ? 'Checking the SHA-256' : `${formatBytes(written)} of ${formatBytes(total)}`;
}

export function showMessage(ui: FileUi, message: string): void {
    ui.message.textContent = message;
    ui.message.hidden = false;
}

export function clearMessage(ui: FileUi): void {
    ui.message.textContent = '';
    ui.message.hidden = true;
}

export function showVerified(ui: FileUi, result: ReassemblyResult): void {
    ui.verified.replaceChildren();
    const mark = element('span', 'verified-mark');
    mark.append(icon('check', 16));

    const digest = result.sha256.replace(/(.{16})/g, '$1 ').trim();

    const copy = element('div');
    copy.append(element('p', 'verified-title', 'Saved and verified'));
    copy.append(element('p', 'verified-hash', `${formatBytes(result.size)} · SHA-256 ${digest}`));

    ui.verified.append(mark, copy);
    ui.verified.hidden = false;
    ui.save.replaceChildren(icon('check'), element('span', 'button-label', 'Saved'));
    ui.save.title = 'This copy is already saved.';
    ui.save.setAttribute('aria-label', 'Saved. This copy is already saved');
    ui.save.disabled = true;
    ui.saved = true;
    ui.progress.hidden = true;
}

export function finishBusy(ui: FileUi): void {
    ui.busy = false;
    if (!ui.saved) ui.save.disabled = false;
    if (ui.preview) ui.preview.disabled = false;
}
