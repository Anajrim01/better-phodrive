import type { DriveGroups } from '#browser/drive/groups.svelte';
import { resolveGroupTarget, type GroupTarget } from '#browser/drive/group-target';
import type { DriveSettings } from '#browser/drive/settings.svelte';

type GroupModeStore = Pick<DriveGroups, 'groups' | 'pausedUntilFor' | 'clearPauses' | 'clearError'>;
type GroupModeSettings = Pick<DriveSettings, 'uploadTarget' | 'chooseUploadTarget'>;

export class DriveGroupMode {
    constructor(
        private readonly groups: () => GroupModeStore,
        private readonly settings: () => GroupModeSettings,
        private readonly accounts: () => Record<string, string>,
        private readonly reset: () => void
    ) {}

    get target(): GroupTarget | null {
        return resolveGroupTarget(
            this.groups().groups,
            this.settings().uploadTarget,
            this.accounts(),
            (email) => this.groups().pausedUntilFor(email)
        );
    }

    get uploadTarget(): string {
        return this.target?.group.id ?? '';
    }

    get unavailableTargetName(): string | null {
        const group = this.groups().groups.find(
            (current) => current.id === this.settings().uploadTarget
        );

        return group && !this.target ? group.name : null;
    }

    choose(id: string): void {
        if (id && !this.groups().groups.some((group) => group.id === id)) return;
        if (id === this.settings().uploadTarget) return;

        this.groups().clearPauses();
        this.groups().clearError();
        this.settings().chooseUploadTarget(id);
        this.reset();
    }
}
