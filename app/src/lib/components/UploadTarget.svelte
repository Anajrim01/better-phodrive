<script lang="ts">
    import { Select } from 'noph-ui';
    import type { Group } from '@madkarmaa/phodrive-core/models';

    interface Props {
        groups: readonly Group[];
        value: string;
        currentEmail: string;
        onchange: (id: string) => void;
    }

    let { groups, value, currentEmail, onchange }: Props = $props();

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
            onchange={(event) => onchange(event.currentTarget.value)}
        />
    </div>
{/if}
