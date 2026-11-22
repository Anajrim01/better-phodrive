import { SvelteSet } from 'svelte/reactivity';
import { childFolders, fileKey, ownerKey, type FileGroup } from '@madkarmaa/phodrive-core/files';
import {
    FileLocationsRequestSchema,
    FileLocationsResponseSchema,
    GOOGLE_ACCOUNT_HEADER,
    GroupMoveRequestSchema,
    MAX_FILE_LOCATION_EDITS,
    type AccountFileLocationEdit
} from '@madkarmaa/phodrive-core/models';
import { apiJson } from '@madkarmaa/phodrive-core/browser/api';
import { schemaResult } from '@madkarmaa/phodrive-core/validation';
import type { DriveContext } from '#browser/drive/context.svelte';
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
    private readonly owner = $derived(this.selected[0]);
    private readonly group = $derived.by(() => {
        const context = this.context();
        return context?.kind === 'group' ? context.group : null;
    });
    readonly destinationLabel = $derived(this.group?.name ?? this.owner?.email);
    saving = $state(false);
    renaming = $state<string | null>(null);
    moving = $state(false);
    destination = $state('');
    error = $state('');

    readonly folders = $derived.by(() => {
        const owner = this.owner?.accountId;
        if (!owner) return [];
        const files = this.group
            ? this.library.files
            : this.library.files.filter((file) => file.accountId === owner);
        return childFolders(files, this.destination);
    });

    constructor(
        private readonly library: DriveLibrary,
        private readonly blocked: () => boolean,
        private readonly context: () => DriveContext | null
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
            (this.group !== null || !this.owner || ownerKey(file) === ownerKey(this.owner))
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
        const edited = await this.save([
            { accountId: file.accountId, fileId: file.fileId, mediaKey: chunk.mediaKey, name }
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
        if (!this.moving) return;
        const edits: AccountFileLocationEdit[] = [];
        for (const item of this.selected) {
            const chunk = firstChunk(item);
            if (!item.accountId || !chunk || item.folder === this.destination) continue;

            edits.push({
                accountId: item.accountId,
                fileId: item.fileId,
                mediaKey: chunk.mediaKey,
                folder: this.destination
            });
        }
        const edited = await this.save(edits, this.group?.id);
        if (edited) this.clearSelection();
    }

    private async save(files: AccountFileLocationEdit[], groupId?: string) {
        const accountId = files[0]?.accountId;
        if (this.disabled || !accountId) return false;

        const request = groupId
            ? GroupMoveRequestSchema.safeParse({ folder: this.destination, files })
            : FileLocationsRequestSchema.safeParse({ files });
        if (!request.success) {
            this.error = 'Enter a valid file name or folder.';
            return false;
        }

        this.saving = true;
        this.error = '';
        try {
            const fallback = 'Could not save the file location.';
            const path = groupId
                ? '/api/account/groups/' + encodeURIComponent(groupId) + '/files/location'
                : '/api/files/location';
            const saved = await apiJson(
                path,
                {
                    method: 'PATCH',
                    headers: {
                        'content-type': 'application/json',
                        ...(groupId ? {} : { [GOOGLE_ACCOUNT_HEADER]: accountId })
                    },
                    body: JSON.stringify(request.data)
                },
                fallback
            ).andThen((data) => schemaResult(FileLocationsResponseSchema, data, fallback));
            return saved.match({
                Ok: () => {
                    this.library.applyLocations(files);
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
