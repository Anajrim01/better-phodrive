import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import type { FileGroup } from '@madkarmaa/phodrive-core/files';
import type { RouteMember } from '@madkarmaa/phodrive-core/groups';
import type { ManageResponse } from '@madkarmaa/phodrive-core/manage';
import type { RemoteBmp } from '@madkarmaa/phodrive-core/models';
import type { AsyncResult } from 'results-ts';
import type { EntryTarget } from '#browser/drive/menu-types';

export type ManageDialog = 'rename' | 'move' | 'details' | 'delete-folder' | 'preview';
export type MoveDestination = { value: string; label: string };

export type ManageDeps = {
    account: () => { email: string; token: string | undefined };
    groupMode: () => boolean;
    routeMembers: () => readonly RouteMember[];
    files: () => readonly FileGroup[];
    busy: () => boolean;
    loading: () => boolean;
    workers: () => number;
    feedback: (message: string) => void;
    applyItems: (email: string, items: readonly RemoteBmp[], revision: number) => void;
    openFolder: (path: string) => void;
    currentFolder: () => string;
};

export type Route = { email: string; token: string } | { email: string; message: string };
export type Failure = { email: string; message: string };
export type ManageAction = (
    email: string,
    token: string
) => AsyncResult<ManageResponse, ApplicationError>;

export type Navigation = { from: string; to: string } | null;

export function targetName(target: EntryTarget): string {
    return target.kind === 'file' ? target.item.name : target.entry.name;
}

export function targetFolderPath(target: EntryTarget): string {
    return target.kind === 'file' ? target.item.folder : target.entry.path;
}
