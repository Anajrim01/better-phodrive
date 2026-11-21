<script lang="ts">
    import { page } from '$app/state';
    import { Button, LoadingIndicator } from 'noph-ui';
    import prettyBytes from 'pretty-bytes';
    import { PublicShareViewer } from '#browser/share-viewer.svelte';
    import IconFolder from '~icons/material-symbols/folder-outline';
    import IconDescription from '~icons/material-symbols/description-outline';
    import IconDownload from '~icons/material-symbols/download';

    const viewer = new PublicShareViewer();

    $effect(() => {
        void viewer.load(page.params.token ?? '');
        return () => viewer.dispose();
    });

    const folders = $derived.by(() => {
        if (!viewer.manifest || viewer.manifest.kind === 'file') return [];

        const prefix = viewer.folder ? `${viewer.folder}/` : '';
        const names = new Map<string, number>();

        for (const file of viewer.manifest.files) {
            if (!file.relativeFolder.startsWith(prefix)) continue;
            const rest = file.relativeFolder.slice(prefix.length);
            if (!rest) continue;
            const name = rest.split('/')[0];
            if (!name) continue;
            names.set(name, (names.get(name) ?? 0) + 1);
        }

        return [...names.entries()]
            .map(([name, count]) => ({ name, path: prefix + name, count }))
            .sort((first, second) => first.name.localeCompare(second.name));
    });

    const visibleFiles = $derived(
        viewer.manifest
            ? viewer.manifest.files.filter((file) => file.relativeFolder === viewer.folder)
            : []
    );
    const trail = $derived(
        viewer.folder
            ? viewer.folder
                  .split('/')
                  .map((name, index, all) => ({ name, path: all.slice(0, index + 1).join('/') }))
            : []
    );
    const title = $derived(viewer.manifest?.name ?? 'Phodrive share');
    const percent = $derived(
        viewer.progress.total ? Math.round((viewer.progress.done / viewer.progress.total) * 100) : 0
    );
</script>

<svelte:head>
    <title>{title} - Phodrive</title>
</svelte:head>

<main class="mx-auto min-h-screen w-full max-w-4xl px-4 py-8 text-text">
    <header class="mb-8 flex flex-wrap items-end justify-between gap-3">
        <div class="min-w-0">
            {#if viewer.manifest}<p class="m-0 text-sm text-muted">Phodrive share</p>{/if}
            <h1 class="m-0 mt-1 truncate text-2xl font-medium">{title}</h1>
            {#if viewer.manifest?.kind === 'folder'}
                <p class="m-0 mt-1 text-sm text-muted">
                    {viewer.manifest.files.length}
                    {viewer.manifest.files.length === 1 ? 'file' : 'files'}
                </p>
            {/if}
            {#if viewer.downloading}
                <p class="m-0 mt-1 text-sm text-muted" role="status">
                    Downloading {percent}%&hellip;
                </p>
            {/if}
            {#if viewer.downloadError}
                <p class="m-0 mt-1 text-sm text-error">{viewer.downloadError}</p>
            {/if}
        </div>
        <Button variant="outlined" size="s" href="/">Open Phodrive</Button>
    </header>

    {#if viewer.loading}
        <div class="grid place-items-center py-20">
            <LoadingIndicator aria-label="Loading share" />
        </div>
    {:else if viewer.error}
        <div class="grid place-items-center py-20 text-center">
            <p class="text-sm text-muted">{viewer.error}</p>
        </div>
    {:else if viewer.manifest}
        {#if viewer.manifest.kind === 'folder'}
            <nav aria-label="Folder path" class="mb-4 flex flex-wrap items-center gap-1 text-sm">
                <button
                    type="button"
                    class="rounded px-1 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    onclick={() => (viewer.folder = '')}>{viewer.manifest.name}</button
                >
                {#each trail as crumb (crumb.path)}
                    <span class="text-subtle" aria-hidden="true">/</span>
                    <button
                        type="button"
                        class="rounded px-1 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        onclick={() => (viewer.folder = crumb.path)}>{crumb.name}</button
                    >
                {/each}
            </nav>

            {#if folders.length}
                <ul
                    class="mb-4 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,200px),1fr))] gap-3 p-0"
                >
                    {#each folders as entry (entry.path)}
                        <li>
                            <button
                                type="button"
                                class="flex min-h-16 w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                                onclick={() => (viewer.folder = entry.path)}
                            >
                                <IconFolder
                                    aria-hidden="true"
                                    class="size-6 shrink-0 text-primary"
                                />
                                <span class="min-w-0">
                                    <span class="block truncate text-sm font-medium"
                                        >{entry.name}</span
                                    >
                                    <span class="block text-xs text-muted"
                                        >{entry.count} {entry.count === 1 ? 'file' : 'files'}</span
                                    >
                                </span>
                            </button>
                        </li>
                    {/each}
                </ul>
            {/if}

            {#if visibleFiles.length}
                <ul class="grid list-none gap-2 p-0">
                    {#each visibleFiles as file (file.id)}
                        <li
                            class="flex min-w-0 flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
                        >
                            <IconDescription
                                aria-hidden="true"
                                class="size-5 shrink-0 text-primary"
                            />
                            <span class="min-w-0 flex-1">
                                <span class="block truncate text-sm font-medium">{file.name}</span>
                                <span class="block text-xs text-muted"
                                    >{prettyBytes(file.size)}</span
                                >
                            </span>
                            <Button
                                variant="text"
                                size="xs"
                                loading={viewer.downloading === file.id}
                                loadingAriaLabel={`Downloading ${file.name}`}
                                disabled={!!viewer.downloading}
                                onclick={() => {
                                    void viewer.download(file);
                                }}
                            >
                                {#snippet start()}<IconDownload aria-hidden="true" />{/snippet}
                                Download
                            </Button>
                        </li>
                    {/each}
                </ul>
            {:else if !folders.length}
                <p class="text-sm text-muted">This folder is empty</p>
            {/if}
        {:else}
            {#each visibleFiles as file (file.id)}
                <div class="rounded-2xl border border-border bg-card p-6">
                    <IconDescription aria-hidden="true" class="size-10 text-primary" />
                    <h2 class="mt-4 text-lg font-medium">{file.name}</h2>
                    <p class="mt-1 text-sm text-muted">{prettyBytes(file.size)}</p>
                    <Button
                        class="mt-5"
                        variant="tonal"
                        loading={viewer.downloading === file.id}
                        loadingAriaLabel={`Downloading ${file.name}`}
                        disabled={!!viewer.downloading}
                        onclick={() => {
                            void viewer.download(file);
                        }}
                    >
                        {#snippet start()}<IconDownload aria-hidden="true" />{/snippet}
                        Download
                    </Button>
                </div>
            {/each}
        {/if}
    {/if}
</main>
