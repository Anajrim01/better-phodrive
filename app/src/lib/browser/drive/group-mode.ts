import type { DriveGroups } from '#browser/drive/groups.svelte';
import { resolveGroupTarget, type GroupTarget } from '#browser/drive/group-target';
import type { DriveSettings } from '#browser/drive/settings.svelte';

export class DriveGroupMode {
    constructor(
        private readonly groups: () => DriveGroups,
        private readonly settings: () => DriveSettings,
        private readonly accounts: () => Record<string, string>,
        private readonly reset: () => void
    ) {}

    get target(): GroupTarget | null {
        return resolveGroupTarget(
            this.groups().groups,
            this.settings().uploadTarget,
            this.accounts(),
            (email) => this.groups().isPaused(email)
        );
    }

    get uploadTarget(): string {
        return this.target?.group.id ?? '';
    }

    choose(id: string): void {
        if (id && !this.groups().groups.some((group) => group.id === id)) return;
        if (id === this.settings().uploadTarget) return;

        this.settings().chooseUploadTarget(id);
        this.reset();
    }
}
