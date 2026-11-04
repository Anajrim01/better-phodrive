import type { GoogleAccountGroup, GoogleAccountSummary } from '@madkarmaa/phodrive-core/models';
import type { DriveController } from '#browser/drive/index.svelte';

export const TEST_ACCOUNT: GoogleAccountSummary = {
    id: 'account-test',
    email: 'test@example.com'
};

export const SECOND_ACCOUNT: GoogleAccountSummary = {
    id: 'account-second',
    email: 'second@example.com'
};

export const THIRD_ACCOUNT: GoogleAccountSummary = {
    id: 'account-third',
    email: 'third@example.com'
};

/** Point the drive at one account without making the account-list request. */
export function useAccount(drive: DriveController, account = TEST_ACCOUNT) {
    drive.context.accounts = [account];
    drive.context.groups = [];
    drive.context.current = { kind: 'account', account };
}

/** Point the drive at a group and publish its member list as the known accounts. */
export function useGroup(
    drive: DriveController,
    group: GoogleAccountGroup,
    accounts: GoogleAccountSummary[] = group.members
) {
    drive.context.accounts = accounts;
    drive.context.groups = [group];
    drive.context.current = { kind: 'group', group };
}
