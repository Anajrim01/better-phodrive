import type { FileAction } from '@madkarmaa/phodrive-core/files';
import type { UploadJob } from '#browser/files';
import type { ConfirmTarget, DriveFiles } from '#browser/drive/files.svelte';
import type { DriveUploads } from '#browser/drive/uploads.svelte';

export abstract class DriveView {
    protected abstract readonly uploads: DriveUploads;
    protected abstract readonly files: DriveFiles;

    get busy() {
        return this.uploads.busy;
    }

    set busy(value: boolean) {
        this.uploads.busy = value;
    }

    get uploadPanelOpen() {
        return this.uploads.panelOpen;
    }

    set uploadPanelOpen(open: boolean) {
        this.uploads.panelOpen = open;
    }

    get uploadJobs(): UploadJob[] {
        return this.uploads.jobs;
    }

    set uploadJobs(jobs: UploadJob[]) {
        this.uploads.jobs = jobs;
    }

    get fileAction(): FileAction | null {
        return this.files.action;
    }

    get confirmOpen(): boolean {
        return this.files.confirmOpen;
    }

    set confirmOpen(open: boolean) {
        this.files.confirmOpen = open;
    }

    get confirmTarget(): ConfirmTarget | null {
        return this.files.confirmTarget;
    }

    set confirmTarget(target: ConfirmTarget | null) {
        this.files.confirmTarget = target;
    }
}
