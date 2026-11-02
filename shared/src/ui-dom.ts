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

export function button(label: string, primary = false): HTMLButtonElement {
    const node = element(
        'button',
        primary ? 'button button-primary' : 'button button-quiet',
        label
    );
    node.type = 'button';

    return node;
}

export function seal(): SVGSVGElement {
    const namespace = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(namespace, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2.2');
    svg.setAttribute('aria-hidden', 'true');

    const path = document.createElementNS(namespace, 'path');
    path.setAttribute('d', 'M5 12.5l4.5 4.5L19 7.5');
    svg.append(path);

    return svg;
}

export function fileUi(plan: PlannedFile, index: number): FileUi {
    const kind = previewKind(plan.name);
    const row = element('li', 'file-row');
    row.append(element('span', 'file-index', String(index + 1).padStart(2, '0')));

    const body = element('div', 'file-body');
    body.append(element('h2', 'file-name', plan.name));

    const meta = element('p', 'file-meta');
    if (plan.folder) meta.append(element('span', '', plan.folder));
    meta.append(element('span', '', formatCount(plan.chunks.length, 'chunk')));
    meta.append(element('span', '', formatBytes(plan.size)));
    body.append(meta);
    row.append(body);

    const actions = element('div', 'file-actions');
    const preview = kind && plan.size <= PREVIEW_BYTES ? button('Preview') : undefined;
    const save = button('Save', true);
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
        ratio >= 1 ? 'Final hash check' : `${formatBytes(written)} of ${formatBytes(total)}`;
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
    const mark = element('span', 'seal');
    mark.append(seal());

    const copy = element('div');
    copy.append(element('p', 'verified-title', 'Saved and verified'));
    copy.append(
        element('p', 'verified-hash', `${formatBytes(result.size)} · SHA-256 ${result.sha256}`)
    );

    ui.verified.append(mark, copy);
    ui.verified.hidden = false;
    ui.save.textContent = 'Saved';
    ui.save.disabled = true;
    ui.saved = true;
    ui.progress.hidden = true;
}

export function finishBusy(ui: FileUi): void {
    ui.busy = false;
    if (!ui.saved) ui.save.disabled = false;
    if (ui.preview) ui.preview.disabled = false;
}
