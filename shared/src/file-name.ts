const BIDI_AND_ZERO_WIDTH = /[\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g;
const ILLEGAL = /[<>:"/\\|?*]/g;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const ENCODER = new TextEncoder();

function trimEdges(value: string): string {
    return value.replace(/^[. ]+|[. ]+$/g, '');
}

function truncateBytes(value: string, limit: number): string {
    let output = '';
    let size = 0;

    for (const character of value) {
        const bytes = ENCODER.encode(character).length;
        if (size + bytes > limit) break;

        output += character;
        size += bytes;
    }

    return output;
}

function avoidReserved(name: string): string {
    const dot = name.indexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;

    if (!RESERVED.test(base)) return name;

    return dot > 0 ? `${name.slice(0, dot)}_${name.slice(dot)}` : `${name}_`;
}

function capBytes(name: string): string {
    if (ENCODER.encode(name).length <= 255) return name;

    const dot = name.lastIndexOf('.');
    const extension = dot > 0 && name.length - dot <= 20 ? name.slice(dot) : '';
    const base = extension ? name.slice(0, dot) : name;
    const room = Math.max(0, 255 - ENCODER.encode(extension).length);
    const capped = trimEdges(truncateBytes(base, room));

    return `${capped || 'phodrive-file'}${extension}`;
}

export function sanitizeFileName(input: string): string {
    let name = input
        .replace(BIDI_AND_ZERO_WIDTH, '')
        .replace(CONTROL, '')
        .replace(ILLEGAL, '-')
        .replace(/\s+/g, ' ');
    name = trimEdges(name);

    if (!name) return 'phodrive-file';

    return capBytes(avoidReserved(name));
}

export function sanitizeFolderPath(input: string): string {
    const cleaned = trimEdges(
        input.replace(BIDI_AND_ZERO_WIDTH, '').replace(CONTROL, '').replace(/\s+/g, ' ')
    );

    return truncateBytes(cleaned, 255);
}
