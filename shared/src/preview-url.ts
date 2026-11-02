let current: string | null = null;

export function replacePreviewUrl(url?: string): void {
    if (current) URL.revokeObjectURL(current);
    current = url ?? null;
}

export function clearPreviewUrl(): void {
    replacePreviewUrl();
}
