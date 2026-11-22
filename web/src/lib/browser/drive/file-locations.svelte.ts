import { SvelteSet } from 'svelte/reactivity';
import { childFolders, fileKey, ownerKey, type FileGroup } from '@madkarmaa/phodrive-core/files';
import {
    FileLocationsRequestSchema,
    FileLocationsResponseSchema,
    GOOGLE_ACCOUNT_HEADER,
    MAX_FILE_LOCATION_EDITS,
    type FileLocationEdit
} from '@madkarmaa/phodrive-core/models';
import { apiJson } from '@madkarmaa/phodrive-core/browser/api';
import { schemaResult } from '@madkarmaa/phodrive-core/validation';
import type { DriveLibrary } from '#browser/drive/library.svelte';

export const FILE_LOCATION_CONTROLS = Symbol('fileLocationControls');

function firstChunk(file: FileGroup) {
    return file.chunks.find((chunk) => chunk.chunkIndex === 0);
}

function selectionKey(file: FileGroup) {
    return fileKey(file) + ':' + (firstChunk(file)?.mediaKey ?? '');
}

export class DriveFileLocations {
    private readonly keys = new SvelteSet<string>();
    readonly selected = $derived.by(() =>
        this.library.files.filter((file) => this.keys.has(selectionKey(file)))
    );
    readonly owner = $derived(this.selected[0]);
    saving = $state(false);
    renaming = $state<string | null>(null);
    moving = $state(false);
    destination = $state('');
    error = $state('');

    readonly folders = $derived.by(() => {
        const owner = this.owner?.accountId;
        if (!owner) return [];
        const files = this.library.files.filter((file) => file.accountId === owner);
        return childFolders(files, this.destination);
    });

    constructor(
        private readonly library: DriveLibrary,
        private readonly blocked: () => boolean
    ) {}

    get disabled() {
        return this.saving || this.blocked() || this.library.loading;
    }

    canEdit(file: FileGroup) {
        return !!file.accountId && !!firstChunk(file);
    }

    isSelected(file: FileGroup) {
        return this.keys.has(selectionKey(file));
    }

    canSelect(file: FileGroup) {
        if (this.disabled || this.moving || !this.canEdit(file)) return false;
        if (this.isSelected(file)) return true;
        return (
            this.selected.length < MAX_FILE_LOCATION_EDITS &&
            (!this.owner || ownerKey(file) === ownerKey(this.owner))
        );
    }

    select(file: FileGroup, checked: boolean) {
        if (!this.canSelect(file)) return;
        const key = selectionKey(file);
        if (!checked) {
            this.keys.delete(key);
            return;
        }

        const present = new Set(this.selected.map(selectionKey));
        for (const saved of this.keys) if (!present.has(saved)) this.keys.delete(saved);
        this.keys.add(key);
    }

    clearSelection() {
        this.keys.clear();
        this.moving = false;
        this.error = '';
    }

    reset() {
        this.clearSelection();
        this.renaming = null;
    }

    isRenaming(file: FileGroup) {
        return this.renaming === selectionKey(file);
    }

    startRename(file: FileGroup) {
        if (this.disabled || this.moving || !this.canEdit(file)) return;
        this.error = '';
        this.renaming = selectionKey(file);
    }

    closeRename() {
        if (this.saving) return;
        this.renaming = null;
        this.error = '';
    }

    async rename(file: FileGroup, name: string) {
        const chunk = firstChunk(file);
        if (!file.accountId || !chunk || !this.isRenaming(file)) return;
        if (file.name === name) {
            this.closeRename();
            return;
        }
        const edited = await this.save(file.accountId, [
            { fileId: file.fileId, mediaKey: chunk.mediaKey, name }
        ]);
        if (edited) this.closeRename();
    }

    startMove() {
        if (this.disabled || !this.owner) return;
        this.closeRename();
        this.destination = '';
        this.moving = true;
    }

    closeMove() {
        if (this.saving) return;
        this.error = '';
        this.moving = false;
    }

    async move() {
        const accountId = this.owner?.accountId;
        if (!this.moving || !accountId) return;
        const edits: FileLocationEdit[] = [];
        for (const item of this.selected) {
            const chunk = firstChunk(item);
            if (chunk && item.folder !== this.destination) {
                edits.push({
                    fileId: item.fileId,
                    mediaKey: chunk.mediaKey,
                    folder: this.destination
                });
            }
        }
        if (!edits.length) return;
        const edited = await this.save(accountId, edits);
        if (edited) this.clearSelection();
    }

    private async save(accountId: string, files: FileLocationEdit[]) {
        if (this.disabled) return false;

        const request = FileLocationsRequestSchema.safeParse({ files });
        if (!request.success) {
            this.error = 'Enter a valid file name or folder.';
            return false;
        }

        this.saving = true;
        this.error = '';
        try {
            const fallback = 'Could not save the file location.';
            const saved = await apiJson(
                '/api/files/location',
                {
                    method: 'PATCH',
                    headers: {
                        'content-type': 'application/json',
                        [GOOGLE_ACCOUNT_HEADER]: accountId
                    },
                    body: JSON.stringify(request.data)
                },
                fallback
            ).andThen((data) => schemaResult(FileLocationsResponseSchema, data, fallback));
            return saved.match({
                Ok: () => {
                    this.library.applyLocations(accountId, files);
                    return true;
                },
                Err: (error) => {
                    this.error = error.message;
                    return false;
                }
            });
        } finally {
            this.saving = false;
        }
    }
}
