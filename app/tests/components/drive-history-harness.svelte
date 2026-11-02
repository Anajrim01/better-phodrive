<script lang="ts">
    import { onMount } from 'svelte';
    import { DriveController } from '#browser/drive/index.svelte';

    interface Props {
        onready: (drive: DriveController) => void;
    }

    let { onready }: Props = $props();
    const drive = new DriveController();

    onMount(() => {
        drive.initialize();
        onready(drive);
    });
</script>
