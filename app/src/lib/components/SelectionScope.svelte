<script lang="ts">
    interface Props {
        scope: string;
        onreset: () => void;
    }

    let { scope, onreset }: Props = $props();
    let previous = $state<string | null>(null);

    $effect(() => {
        if (previous === null) {
            previous = scope;

            return;
        }
        if (scope === previous) return;

        previous = scope;
        onreset();
    });
</script>
