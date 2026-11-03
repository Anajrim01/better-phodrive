import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import type { FileGroup } from '@madkarmaa/phodrive-core/files';
import {
    requestShareCreate,
    requestShareRevoke,
    type ShareFailure
} from '@madkarmaa/phodrive-core/browser/shares';
import type {
    ShareCreateRequest,
    ShareCreateResponse,
    ShareFileInput,
    ShareRecord,
    ShareRecovery,
    ShareRevokeRequest,
    ShareRevokeResponse
} from '@madkarmaa/phodrive-core/share-models';
import type { AsyncResult } from 'results-ts';
import { copyText, type CopyOutcome } from '#browser/clipboard';
import {
    checkShareViewer,
    readShareAvailability,
    type ShareAvailability
} from '#browser/share-viewer';
import { ShareStore } from '#browser/shares';
import {
    shareCandidateFiles,
    shareFileCounts,
    shareNameError,
    shareSelectionInputs,
    type ShareCandidate
} from '#lib/share-files';
import { shareCreateRequest, shareRevokeRequest } from '#lib/share-requests';

export type ShareCopyState = 'idle' | 'copied' | 'manual' | 'failed';
export type ShareDeps = {
    account: () => { email: string; token: string };
    busy: () => boolean;
    loading: () => boolean;
    store?: ShareStore;
    create?: (input: ShareCreateRequest) => AsyncResult<ShareCreateResponse, ShareFailure>;
    revoke?: (input: ShareRevokeRequest) => AsyncResult<ShareRevokeResponse, ShareFailure>;
    copy?: (text: string) => AsyncResult<CopyOutcome, ApplicationError>;
    checkViewer?: () => AsyncResult<boolean, ApplicationError>;
};

export class DriveShares {
    availability = $state<ShareAvailability>('checking');
    createOpen = $state(false);
    createFiles = $state<readonly FileGroup[]>([]);
    createInvalid = $state('');
    createBusy = $state(false);
    createError = $state('');
    createErrorCode = $state('');
    createRecovery = $state<ShareRecovery | null>(null);
    created = $state<ShareRecord | null>(null);
    storageNotice = $state('');
    copyState = $state<ShareCopyState>('idle');
    copiedKey = $state('');
    copyError = $state('');

    revokeOpen = $state(false);
    revokeTarget = $state<ShareRecord | null>(null);
    revokeBusy = $state(false);
    revokeError = $state('');
    revokeErrorCode = $state('');
    revokeRecovery = $state<ShareRecovery | null>(null);
    revokeNotice = $state('');

    private inputs = $state<ShareFileInput[]>([]);
    private readonly store: ShareStore;
    private requestId = 0;

    constructor(private readonly deps: ShareDeps) {
        this.store = deps.store ?? new ShareStore();
    }

    get records(): ShareRecord[] {
        return this.store.list(this.deps.account().email);
    }

    get fileCounts(): ReadonlyMap<string, number> {
        return shareFileCounts(this.records);
    }

    get overlayOpen(): boolean {
        return this.createOpen || this.revokeOpen;
    }

    get shareAvailable(): boolean {
        return this.availability === 'available';
    }

    async checkAvailability(): Promise<void> {
        if (this.availability !== 'checking') return;

        const outcome = await (this.deps.checkViewer ?? checkShareViewer)();

        this.availability = readShareAvailability(outcome);
    }

    open(files: readonly ShareCandidate[]): void {
        if (!this.shareAvailable || this.deps.busy() || this.deps.loading()) return;

        this.resetCreate();
        this.revokeNotice = '';
        this.createFiles = shareCandidateFiles(files);

        if (!this.deps.account().email) {
            this.createInvalid = 'Connect an account before creating a share.';
        } else {
            shareSelectionInputs(files).match({
                Ok: (inputs) => {
                    this.inputs = inputs;
                    this.createInvalid = '';
                },
                Err: (error) => {
                    this.inputs = [];
                    this.createInvalid = error.message;
                }
            });
        }

        this.createOpen = true;
    }

    closeCreate(): void {
        if (this.createBusy) return;

        this.resetCreate();
    }

    async create(name: string): Promise<void> {
        if (!this.shareAvailable || !this.createOpen) return;
        if (this.createBusy || this.created !== null) return;
        if (this.createErrorCode === 'SHARE_LINK_UNCERTAIN') return;
        if (this.createInvalid) {
            this.createError = this.createInvalid;

            return;
        }

        const nameError = shareNameError(name);
        if (nameError !== null) {
            this.createError = nameError;

            return;
        }

        const account = this.deps.account();
        if (!account.email || !account.token) {
            this.createError = 'Connect an account before creating a share.';

            return;
        }

        this.createBusy = true;
        this.copyState = 'idle';
        this.copyError = '';
        const requestId = ++this.requestId;

        const outcome = await (this.deps.create ?? requestShareCreate)(
            shareCreateRequest(account, name.trim(), this.inputs)
        );

        if (requestId !== this.requestId) return;

        outcome.match({
            Ok: (response) => {
                this.created = response.record;
                this.createError = '';
                this.createErrorCode = '';
                this.createRecovery = null;
                this.copyState = 'idle';
                this.copyError = '';

                this.store.save(account.email, response.record).match({
                    Ok: () => {
                        this.storageNotice = '';
                    },
                    Err: () => {
                        this.storageNotice =
                            'This share was created, but it was not saved in this browser.';
                    }
                });
            },
            Err: (failure) => {
                this.createError = failure.message;
                this.createErrorCode = failure.code;
                if (failure.recovery !== undefined) this.createRecovery = failure.recovery;
            }
        });

        this.createBusy = false;
    }

    async copy(record: ShareRecord): Promise<void> {
        const outcome = await (this.deps.copy ?? copyText)(record.shareUrl);

        this.copiedKey = record.envelopeKey;
        outcome.match({
            Ok: (value) => {
                this.copyState = value;
                this.copyError = '';
            },
            Err: (error) => {
                this.copyState = 'failed';
                this.copyError = error.message;
            }
        });
    }

    openRevoke(record: ShareRecord): void {
        if (this.deps.busy() || this.deps.loading() || this.revokeBusy) return;

        this.revokeTarget = record;
        this.revokeError = '';
        this.revokeErrorCode = '';
        this.revokeRecovery = null;
        this.revokeOpen = true;
        this.revokeNotice = '';
    }

    closeRevoke(): void {
        if (this.revokeBusy) return;

        this.revokeOpen = false;
        this.revokeTarget = null;
        this.revokeError = '';
        this.revokeErrorCode = '';
        this.revokeRecovery = null;
    }

    async revoke(): Promise<void> {
        const record = this.revokeTarget;
        if (record === null || this.revokeBusy) return;

        const account = this.deps.account();
        if (!account.email || !account.token) {
            this.revokeError = 'Connect an account before revoking a share.';

            return;
        }

        this.revokeBusy = true;
        this.revokeError = '';
        this.revokeErrorCode = '';
        this.revokeRecovery = null;
        const requestId = ++this.requestId;

        const outcome = await (this.deps.revoke ?? requestShareRevoke)(
            shareRevokeRequest(account, record)
        );

        if (requestId !== this.requestId) return;

        outcome.match({
            Ok: () => {
                this.store.remove(account.email, record.envelopeKey).match({
                    Ok: () => {
                        this.revokeOpen = false;
                        this.revokeTarget = null;
                        this.revokeNotice = 'Share revoked. The link no longer opens.';
                    },
                    Err: (error) => {
                        this.revokeError = `The share link was revoked, but this browser could not remove the record. ${error.message}`;
                    }
                });
            },
            Err: (failure) => {
                this.revokeError = failure.message;
                this.revokeErrorCode = failure.code;
                this.revokeRecovery = failure.recovery ?? null;
            }
        });

        this.revokeBusy = false;
    }

    reset(): void {
        this.requestId++;
        this.resetCreate();
        this.revokeOpen = false;
        this.revokeTarget = null;
        this.revokeBusy = false;
        this.revokeError = '';
        this.revokeErrorCode = '';
        this.revokeRecovery = null;
        this.revokeNotice = '';
    }

    private resetCreate(): void {
        this.createOpen = false;
        this.createFiles = [];
        this.createInvalid = '';
        this.createBusy = false;
        this.createError = '';
        this.createErrorCode = '';
        this.createRecovery = null;
        this.created = null;
        this.storageNotice = '';
        this.copyState = 'idle';
        this.copiedKey = '';
        this.copyError = '';
        this.inputs = [];
    }
}
