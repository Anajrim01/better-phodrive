const BIDI_CONTROLS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g;
const ILLEGAL = /[<>:"/\\|?*]/g;

function trimEdges(value: string): string {
    return value.replace(/^[. ]+|[. ]+$/g, '');
}

export function sanitizeFileName(input: string): string {
    let name = input
        .replace(BIDI_CONTROLS, '')
        .replace(CONTROL, '')
        .replace(ILLEGAL, '-')
        .replace(/\s+/g, ' ');
    name = trimEdges(name);

    if (!name) return 'phodrive-file';

    if (name.length > 255) {
        const dot = name.lastIndexOf('.');
        const extension = dot > 0 && name.length - dot <= 20 ? name.slice(dot) : '';
        const base = trimEdges(name.slice(0, 255 - extension.length));

        name = `${base || 'phodrive-file'}${extension}`;
    }

    return name;
}
