import type { ApplicationError } from '../errors';
import type { AsyncResult } from 'results-ts';
import {
    FileManageAction,
    FolderManageAction,
    ManageResponseSchema,
    type ManageResponse
} from '../manage';
import { schemaResult } from '../validation';
import { apiJson } from './api';

const FILES_MANAGE_URL = '/api/files/manage';
const FOLDERS_URL = '/api/folders';

function postManage(
    url: string,
    body: Record<string, unknown>,
    fallback: string
): AsyncResult<ManageResponse, ApplicationError> {
    return apiJson(
        url,
        {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body)
        },
        fallback
    ).andThen((value) => schemaResult(ManageResponseSchema, value, fallback));
}

export function renameFile(
    email: string,
    token: string,
    fileId: string,
    name: string
): AsyncResult<ManageResponse, ApplicationError> {
    return postManage(
        FILES_MANAGE_URL,
        { action: FileManageAction.Rename, email, token, fileId, name },
        'Rename failed'
    );
}

export function moveFile(
    email: string,
    token: string,
    fileId: string,
    folder: string
): AsyncResult<ManageResponse, ApplicationError> {
    return postManage(
        FILES_MANAGE_URL,
        { action: FileManageAction.Move, email, token, fileId, folder },
        'Move failed'
    );
}

export function renameFolder(
    email: string,
    token: string,
    folder: string,
    name: string
): AsyncResult<ManageResponse, ApplicationError> {
    return postManage(
        FOLDERS_URL,
        { action: FolderManageAction.Rename, email, token, folder, name },
        'Rename folder failed'
    );
}

export function moveFolder(
    email: string,
    token: string,
    folder: string,
    destination: string
): AsyncResult<ManageResponse, ApplicationError> {
    return postManage(
        FOLDERS_URL,
        { action: FolderManageAction.Move, email, token, folder, destination },
        'Move folder failed'
    );
}

export function moveFolderContents(
    email: string,
    token: string,
    folder: string
): AsyncResult<ManageResponse, ApplicationError> {
    return postManage(
        FOLDERS_URL,
        { action: FolderManageAction.MoveContents, email, token, folder },
        'Move folder contents failed'
    );
}

export function deleteFolder(
    email: string,
    token: string,
    folder: string,
    workers: number
): AsyncResult<ManageResponse, ApplicationError> {
    return postManage(
        FOLDERS_URL,
        { action: FolderManageAction.Delete, email, token, folder, workers },
        'Delete folder failed'
    );
}
