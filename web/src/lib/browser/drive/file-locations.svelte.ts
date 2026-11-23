import { SvelteSet } from 'svelte/reactivity';
import { fileKey, ownerKey, type FileGroup } from '@madkarmaa/phodrive-core/files';
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
    saving = $state(false);
    renaming = $state<string | null>(null);
    /** Move mode: the files view picks the destination, which is the folder it shows. */
    moving = $state(false);
    error = $state('');
    readonly movesHere = $derived(
        this.selected.some((file) => file.folder !== this.library.folder)
    );

    constructor(
        private readonly library: DriveLibrary,
        private readonly blocked: () => boolean,
        private readonly context: () => DriveContext | null,
        private readonly feedback: (message: string) => void
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

    /** Header checkbox: select every visible file this selection can hold, or clear them. */
    selectAll(files: readonly FileGroup[], checked: boolean) {
        for (const file of files) this.select(file, checked);
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
        this.error = '';
        this.moving = true;
    }

    closeMove() {
        if (this.saving) return;
        this.error = '';
        this.moving = false;
    }

    /** Move the selection into the open folder, or into a new subfolder of it. */
    async move(newFolder = '') {
        if (!this.moving) return;
        const name = newFolder.trim();
        const folder = name
            ? [this.library.folder, name].filter(Boolean).join('/')
            : this.library.folder;
        const edits: AccountFileLocationEdit[] = [];
        for (const item of this.selected) {
            const chunk = firstChunk(item);
            if (!item.accountId || !chunk || item.folder === folder) continue;

            edits.push({
                accountId: item.accountId,
                fileId: item.fileId,
                mediaKey: chunk.mediaKey,
                folder
            });
        }
        const edited = await this.save(edits, folder, this.group?.id);
        if (!edited) return;

        this.clearSelection();
        // A new folder exists only once files are in it, so open it after the move.
        if (name) this.library.openFolder(folder);
        const files = edits.length === 1 ? '1 file' : `${edits.length} files`;
        this.feedback(`Moved ${files} to ${folder.split('/').at(-1) || 'My files'}.`);
    }

    private async save(files: AccountFileLocationEdit[], folder = '', groupId?: string) {
        const accountId = files[0]?.accountId;
        if (this.disabled || !accountId) return false;

        const request = groupId
            ? GroupMoveRequestSchema.safeParse({ folder, files })
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
