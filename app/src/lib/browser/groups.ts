import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import { GroupsSchema, StoredGroupsSchema } from '@madkarmaa/phodrive-core/groups';
import type { Group } from '@madkarmaa/phodrive-core/models';
import { PersistedState } from 'runed';
import { Err, type Result } from 'results-ts';
import { readState, readStoredJson, writeState } from '#browser/persisted';

export const GROUPS_KEY = 'phodrive-groups';
export const GROUPS_SERIALIZER = {
    serialize: (groups: Group[]) => JSON.stringify(groups),
    deserialize: (raw: string): Group[] => {
        const parsed = StoredGroupsSchema.safeParse(readStoredJson(raw));

        return parsed.success ? parsed.data : [];
    }
};

export class GroupStore {
    private readonly state = new PersistedState<Group[]>(GROUPS_KEY, [], {
        serializer: GROUPS_SERIALIZER
    });

    get groups(): Group[] {
        return readState(this.state).unwrapOr([]);
    }

    save(groups: Group[]): Result<void, ApplicationError> {
        const parsed = GroupsSchema.safeParse(groups);
        if (!parsed.success)
            return Err({
                code: 'INVALID_GROUP',
                message:
                    'A group needs a name and at least one unique account. Remove duplicate accounts or delete the group.'
            } as const);

        return writeState(this.state, parsed.data);
    }
}
