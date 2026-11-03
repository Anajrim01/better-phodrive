<script lang="ts">
    import { Select } from 'noph-ui';
    import type { Group } from '@madkarmaa/phodrive-core/models';

    interface Props {
        groups: readonly Group[];
        value: string;
        currentEmail: string;
        unavailable?: string | null;
        disabled?: boolean;
        onchange: (id: string) => void;
    }

    let {
        groups,
        value,
        currentEmail,
        unavailable = null,
        disabled = false,
        onchange
    }: Props = $props();

    // Group ids are limited to 64 characters, so this sentinel cannot collide with a stored id.
    const CURRENT_ACCOUNT_VALUE = '__current_account__'.padEnd(65, '_');

    const options = $derived([
        {
            value: CURRENT_ACCOUNT_VALUE,
            label: currentEmail ? `Current account (${currentEmail})` : 'Current account'
        },
        ...groups.map((group) => ({
            value: group.id,
            label:
                group.accounts.length < 2
                    ? `${group.name} (needs at least two accounts)`
                    : group.name,
            disabled: group.accounts.length < 2
        }))
    ]);

    const selectedValue = $derived(value === '' ? CURRENT_ACCOUNT_VALUE : value);

    function choose(next: string) {
        onchange(next === CURRENT_ACCOUNT_VALUE ? '' : next);
    }
</script>

{#if groups.length}
    <div class="mb-2 min-w-0">
        <Select
            class="upload-target"
            style="display: flex; width: 100%; min-width: 0; --np-select-min-width: 0;"
            label="Upload to"
            {options}
            value={selectedValue}
            {disabled}
            onchange={(event) => choose(event.currentTarget.value)}
        />
        {#if unavailable}
            <p class="mt-1 text-xs leading-relaxed text-muted">
                {unavailable} needs at least two accounts. Using the current account.
            </p>
        {/if}
    </div>
{/if}
