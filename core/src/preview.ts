import { z } from 'zod';
import { AccountRequestSchema, FileNameSchema, RemoteBmpSchema, Sha256HexSchema } from './models';

export enum PreviewMode {
    Image = 'image',
    Text = 'text'
}

export enum PreviewUnavailableReason {
    MultiChunk = 'multi-chunk',
    TooLarge = 'too-large',
    UnsupportedImage = 'unsupported-image',
    IncompleteImage = 'incomplete-image',
    DecodeFailed = 'decode-failed',
    Binary = 'binary',
    Incomplete = 'incomplete',
    Unsupported = 'unsupported'
}

export const PREVIEW_TEXT_BYTES = 64 * 1024;
export const PREVIEW_TEXT_LINES = 200;
export const MAX_IMAGE_PREVIEW_BYTES = 32 * 1024 * 1024;

const IMAGE_EXTENSIONS = new Set(['gif', 'jpeg', 'jpg', 'png', 'webp']);
const TEXT_EXTENSIONS = new Set([
    'astro',
    'bash',
    'bat',
    'c',
    'cc',
    'cfg',
    'cjs',
    'clj',
    'cljs',
    'cmd',
    'conf',
    'cpp',
    'cs',
    'css',
    'csv',
    'cts',
    'cxx',
    'dart',
    'diff',
    'env',
    'erl',
    'ex',
    'exs',
    'fish',
    'gql',
    'gitignore',
    'go',
    'graphql',
    'h',
    'hpp',
    'hrl',
    'hs',
    'ini',
    'java',
    'js',
    'json',
    'jsonl',
    'jsx',
    'kt',
    'kts',
    'less',
    'log',
    'lua',
    'markdown',
    'md',
    'mdx',
    'mjs',
    'ml',
    'mli',
    'mts',
    'ndjson',
    'nim',
    'php',
    'properties',
    'proto',
    'ps1',
    'py',
    'r',
    'rb',
    'rs',
    'sass',
    'scala',
    'scss',
    'sh',
    'sql',
    'svelte',
    'swift',
    'text',
    'toml',
    'ts',
    'tsv',
    'tsx',
    'txt',
    'vue',
    'xml',
    'yaml',
    'yml',
    'zig',
    'zsh'
]);

/** Only listed extensions are previewable; HTML and SVG stay out of the renderer entirely. */
export function previewModeFor(name: string): PreviewMode | null {
    const dot = name.lastIndexOf('.');
    if (dot < 0 || dot === name.length - 1) return null;

    const extension = name.slice(dot + 1).toLowerCase();
    if (IMAGE_EXTENSIONS.has(extension)) return PreviewMode.Image;
    if (TEXT_EXTENSIONS.has(extension)) return PreviewMode.Text;

    return null;
}

export const FilePreviewRequestSchema = AccountRequestSchema.extend({
    mode: z.enum(PreviewMode),
    name: FileNameSchema,
    fileHash: Sha256HexSchema,
    fileId: Sha256HexSchema,
    chunks: z.array(RemoteBmpSchema).nonempty()
});
export const PreviewTextResponseSchema = z.object({
    text: z.string(),
    truncated: z.boolean()
});
export const PreviewUnavailableResponseSchema = z.object({
    reason: z.enum(PreviewUnavailableReason)
});
export type FilePreviewRequest = z.infer<typeof FilePreviewRequestSchema>;
export type PreviewTextResponse = z.infer<typeof PreviewTextResponseSchema>;
export type PreviewResult =
    | { kind: 'image'; bytes: Uint8Array; contentType: string }
    | { kind: 'text'; text: string; truncated: boolean }
    | { kind: 'unavailable'; reason: PreviewUnavailableReason };
