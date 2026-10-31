import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import { PersistedState } from 'runed';
import type { Result } from 'results-ts';
import { readState, readStoredJson, writeState } from '#browser/persisted';

export const UPLOAD_TARGET_KEY = 'phodrive-upload-target';
export const UPLOAD_TARGET_SERIALIZER = {
    serialize: (id: string) => JSON.stringify(id),
    deserialize: (raw: string): string => {
        const parsed = readStoredJson(raw);

        return typeof parsed === 'string' ? parsed : '';
    }
};

export class UploadTargetStore {
    private readonly state = new PersistedState<string>(UPLOAD_TARGET_KEY, '', {
        serializer: UPLOAD_TARGET_SERIALIZER
    });

    get value(): string {
        return readState(this.state).unwrapOr('');
    }

    save(id: string): Result<void, ApplicationError> {
        return writeState(this.state, id);
    }
}
