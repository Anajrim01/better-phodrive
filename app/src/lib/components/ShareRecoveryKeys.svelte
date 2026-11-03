<script lang="ts">
    interface Props {
        recovery: { envelopeKey?: string; albumKey: string };
    }

    let { recovery }: Props = $props();
</script>

<div class="share-recovery mt-3">
    <p class="share-recovery-title">
        The link may already be live. Keep these keys if you need to manage or remove it later.
    </p>
    <dl class="share-keys">
        {#if recovery.envelopeKey}
            <dt class="share-key-label">Envelope key</dt>
            <dd class="share-key-value">{recovery.envelopeKey}</dd>
        {/if}
        <dt class="share-key-label">Album key</dt>
        <dd class="share-key-value">{recovery.albumKey}</dd>
    </dl>
</div>

<style>
    .share-recovery {
        border: 1px solid var(--app-border);
        border-radius: 16px;
        background: var(--app-panel);
        padding: 0.75rem;
    }

    .share-recovery-title {
        margin: 0;
        color: var(--app-muted);
        font-size: 0.8125rem;
        line-height: 1.25rem;
    }

    .share-keys {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: 0.25rem 0.75rem;
        margin: 0.5rem 0 0;
        font-size: 0.75rem;
        line-height: 1rem;
    }

    .share-key-label {
        color: var(--app-muted);
    }

    .share-key-value {
        margin: 0;
        overflow-wrap: anywhere;
        color: var(--app-text);
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        user-select: all;
    }
</style>
