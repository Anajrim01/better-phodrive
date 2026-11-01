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

    const options = $derived([
        {
            value: '',
            label: currentEmail ? `Current account (${currentEmail})` : 'Current account'
        },
        ...groups.map((group) => ({
            value: group.id,
            label: group.accounts.length < 2 ? `${group.name} (needs 2 accounts)` : group.name,
            disabled: group.accounts.length < 2
        }))
    ]);
</script>

{#if groups.length}
    <div class="mb-2">
        <Select
            label="Upload to"
            {options}
            {value}
            {disabled}
            onchange={(event) => onchange(event.currentTarget.value)}
        />
        {#if unavailable}
            <p class="mt-1 text-xs leading-relaxed text-muted">
                {unavailable} needs at least two connected accounts. Using the current account.
            </p>
        {/if}
    </div>
{/if}
