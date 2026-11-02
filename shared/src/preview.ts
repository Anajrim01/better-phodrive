import { TEXT_PREVIEW_CHARS } from './limits';

export type PreviewKind = 'image' | 'text';

const IMAGE_TYPES: Record<string, string> = {
    avif: 'image/avif',
    bmp: 'image/bmp',
    gif: 'image/gif',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp'
};

const TEXT_TYPES = new Set([
    'css',
    'csv',
    'html',
    'js',
    'json',
    'log',
    'md',
    'mjs',
    'srt',
    'svg',
    'ts',
    'tsx',
    'txt',
    'vtt',
    'xml',
    'yaml',
    'yml'
]);

function extension(name: string): string {
    const index = name.lastIndexOf('.');
    if (index < 0 || index === name.length - 1) return '';

    return name.slice(index + 1).toLowerCase();
}

export function previewKind(name: string): PreviewKind | null {
    const ext = extension(name);
    if (IMAGE_TYPES[ext]) return 'image';
    if (TEXT_TYPES.has(ext)) return 'text';

    return null;
}

export function imageType(name: string): string {
    return IMAGE_TYPES[extension(name)] ?? 'application/octet-stream';
}

export interface PreviewNode {
    node: Node;
    objectUrl?: string;
}

export async function buildPreview(
    blob: Blob,
    kind: PreviewKind,
    name: string
): Promise<PreviewNode> {
    if (kind === 'image') {
        const image = document.createElement('img');
        image.className = 'preview-image';
        image.alt = name;
        const objectUrl = URL.createObjectURL(new Blob([blob], { type: imageType(name) }));
        image.src = objectUrl;

        return { node: image, objectUrl };
    }

    const text = await blob.text();
    const pre = document.createElement('pre');
    pre.className = 'preview-text';
    pre.textContent =
        text.length > TEXT_PREVIEW_CHARS
            ? `${text.slice(0, TEXT_PREVIEW_CHARS)}

Preview cut at ${TEXT_PREVIEW_CHARS.toLocaleString()} characters.`
            : text;

    return { node: pre };
}
