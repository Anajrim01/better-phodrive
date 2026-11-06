import type { ShareDownloadSyncAccessHandle } from './share-download-protocol';

declare global {
    interface FileSystemFileHandle {
        createSyncAccessHandle(): Promise<ShareDownloadSyncAccessHandle>;
    }

    interface Window {
        showSaveFilePicker?(options?: {
            readonly suggestedName?: string;
        }): Promise<FileSystemFileHandle>;
    }
}

export {};
