import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import { PersistedState } from 'runed';
import { Err, type Result } from 'results-ts';
import { EmailSchema } from '@madkarmaa/phodrive-core/models';
import {
    MAX_STORED_SHARES,
    ShareRecordSchema,
    StoredSharesSchema,
    type ShareRecord,
    type StoredShares
} from '@madkarmaa/phodrive-core/share-models';
import { readState, readStoredJson, STORAGE_UNAVAILABLE, writeState } from '#browser/persisted';

export const SHARES_KEY = 'phodrive-shares';

function sharesSerializer(onInvalid: () => void) {
    return {
        serialize: (shares: StoredShares) => JSON.stringify(shares),
        deserialize: (raw: string): StoredShares => {
            const parsed = StoredSharesSchema.safeParse(readStoredJson(raw));
            if (parsed.success) return parsed.data;

            onInvalid();

            return {};
        }
    };
}

export const SHARES_SERIALIZER = sharesSerializer(() => undefined);

export class ShareStore {
    private corrupt = false;
    private readonly state = new PersistedState<StoredShares>(
        SHARES_KEY,
        {},
        {
            serializer: sharesSerializer(() => {
                this.corrupt = true;
            })
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
        if (this.corrupt) return Err(STORAGE_UNAVAILABLE);

        const parsedEmail = EmailSchema.safeParse(email);
        const parsedRecord = ShareRecordSchema.safeParse(record);
        if (!parsedEmail.success || !parsedRecord.success)
            return Err({
                code: 'INVALID_SCHEMA',
                message: 'Could not save the share in this browser.'
            } as const);

        const shares = readState(this.state).match({
            Ok: (value) => value,
            Err: () => null
        });
        if (shares === null) return Err(STORAGE_UNAVAILABLE);

        const current = shares[parsedEmail.data] ?? [];
        const existing = current.some(
            (entry) => entry.envelopeKey === parsedRecord.data.envelopeKey
        );
        if (!existing && current.length >= MAX_STORED_SHARES)
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
        if (this.corrupt) return Err(STORAGE_UNAVAILABLE);

        const parsed = EmailSchema.safeParse(email);
        if (!parsed.success) return Err({ code: 'INVALID_SCHEMA', message: 'Invalid account.' });

        const shares = readState(this.state).match({
            Ok: (value) => value,
            Err: () => null
        });
        if (shares === null) return Err(STORAGE_UNAVAILABLE);

        const updated = (shares[parsed.data] ?? []).filter(
            (record) => record.envelopeKey !== envelopeKey
        );

        return writeState(this.state, { ...shares, [parsed.data]: updated });
    }
}
