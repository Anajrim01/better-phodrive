<script lang="ts">
    import { Checkbox } from 'noph-ui';
    import { getContext } from 'svelte';
    import type { FileGroup } from '@madkarmaa/phodrive-core/files';
    import {
        FILE_LOCATION_CONTROLS,
        type DriveFileLocations
    } from '#browser/drive/file-locations.svelte';

    /** One file's checkbox, or the header checkbox when given every visible file. */
    let { file, files }: { file?: FileGroup; files?: readonly FileGroup[] } = $props();
    const readLocations = getContext<(() => DriveFileLocations) | undefined>(
        FILE_LOCATION_CONTROLS
    );
    const locations = $derived(readLocations?.());
    const targets = $derived(files ?? (file ? [file] : []));
    const selectedCount = $derived(targets.filter((item) => locations?.isSelected(item)).length);
    const label = $derived(file ? `Select ${file.name}` : 'Select all files');
</script>

{#if locations}
    <Checkbox
        aria-label={label}
        checked={!!targets.length && selectedCount === targets.length}
        indeterminate={selectedCount > 0 && selectedCount < targets.length}
        disabled={!targets.some((item) => locations.canSelect(item))}
        onchange={(event) => locations.selectAll(targets, event.currentTarget.checked)}
    />
{/if}
