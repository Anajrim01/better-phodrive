import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import { PersistedState } from 'runed';
import { Err, type Result } from 'results-ts';
import { EmailSchema } from '@madkarmaa/phodrive-core/models';
import {
    MAX_SHARE_FILES,
    ShareRecordSchema,
    StoredSharesSchema,
    type ShareRecord,
    type StoredShares
} from '@madkarmaa/phodrive-core/share-models';
import { readState, readStoredJson, writeState } from '#browser/persisted';

export const SHARES_KEY = 'phodrive-shares';

export const SHARES_SERIALIZER = {
    serialize: (shares: StoredShares) => JSON.stringify(shares),
    deserialize: (raw: string): StoredShares => {
        const parsed = StoredSharesSchema.safeParse(readStoredJson(raw));

        return parsed.success ? parsed.data : {};
    }
};

export class ShareStore {
    private readonly state = new PersistedState<StoredShares>(
        SHARES_KEY,
        {},
        {
            serializer: SHARES_SERIALIZER
        }
    );

    list(email: string): ShareRecord[] {
        const parsed = EmailSchema.safeParse(email);
        if (!parsed.success) return [];

        const shares: StoredShares = readState(this.state).unwrapOr({});

        return shares[parsed.data] ?? [];
    }

    get(email: string, envelopeKey: string): ShareRecord | undefined {
        return this.list(email).find((record) => record.envelopeKey === envelopeKey);
    }

    save(email: string, record: ShareRecord): Result<void, ApplicationError> {
        const parsedEmail = EmailSchema.safeParse(email);
        const parsedRecord = ShareRecordSchema.safeParse(record);
        if (!parsedEmail.success || !parsedRecord.success)
            return Err({
                code: 'INVALID_SCHEMA',
                message: 'Could not save the share in this browser.'
            } as const);

        const shares: StoredShares = readState(this.state).unwrapOr({});
        const current = shares[parsedEmail.data] ?? [];
        const existing = current.some(
            (entry) => entry.envelopeKey === parsedRecord.data.envelopeKey
        );
        if (!existing && current.length >= MAX_SHARE_FILES)
            return Err({
                code: 'INVALID_SCHEMA',
                message: 'Could not save more than 100 shares in this browser.'
            } as const);

        const updated = [
            parsedRecord.data,
            ...current.filter((entry) => entry.envelopeKey !== parsedRecord.data.envelopeKey)
        ].toSorted((left, right) => right.createdAt - left.createdAt);

        return writeState(this.state, { ...shares, [parsedEmail.data]: updated });
    }

    remove(email: string, envelopeKey: string): Result<void, ApplicationError> {
        const parsed = EmailSchema.safeParse(email);
        if (!parsed.success) return Err({ code: 'INVALID_SCHEMA', message: 'Invalid account.' });

        const shares: StoredShares = readState(this.state).unwrapOr({});
        const updated = (shares[parsed.data] ?? []).filter(
            (record) => record.envelopeKey !== envelopeKey
        );

        return writeState(this.state, { ...shares, [parsed.data]: updated });
    }
}
