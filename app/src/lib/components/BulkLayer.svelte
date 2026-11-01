<script lang="ts">
    import type { DriveBulk } from '#browser/drive/bulk.svelte';
    import MoveDialog from '#components/MoveDialog.svelte';
    import DetailsDialog from '#components/DetailsDialog.svelte';

    interface Props {
        bulk: DriveBulk;
    }

    let { bulk }: Props = $props();

    const count = $derived(bulk.moveFiles.length);
    const noun = $derived(count === 1 ? 'file' : 'files');
    const headline = $derived(`Move ${count} ${noun}`);
    const note = $derived(
        `This moves ${count} ${noun} in Phodrive only. Google Photos albums are unchanged.`
    );
</script>

<MoveDialog
    open={bulk.moveOpen}
    target={null}
    destinations={bulk.moveDestinations}
    value={bulk.moveValue}
    error={bulk.moveError}
    busy={bulk.moveBusy}
    {headline}
    {note}
    disableWhenUnchanged={false}
    onmove={(destination) => {
        void bulk.move(destination);
    }}
    onclose={() => bulk.closeMove()}
/>

<DetailsDialog
    open={bulk.detailsOpen}
    target={null}
    files={[]}
    owners={[]}
    selection={bulk.detailFiles}
    onclose={() => bulk.closeDetails()}
/>
