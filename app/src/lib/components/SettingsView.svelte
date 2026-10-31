<script lang="ts">
    import type { PreferencesDefaults } from '@madkarmaa/phodrive-core/models';
    import type { DriveController } from '#browser/drive/index.svelte';
    import SettingsPanel from '#components/SettingsPanel.svelte';

    interface Props {
        drive: DriveController;
        defaults: PreferencesDefaults;
    }

    let { drive, defaults }: Props = $props();
</script>

<SettingsPanel
    {defaults}
    refreshIntervalSeconds={drive.settings.refreshIntervalSeconds}
    concurrentWorkers={drive.settings.concurrentWorkers}
    compression={drive.settings.compression}
    theme={drive.settings.themeMode}
    onrefreshinterval={(seconds) => drive.settings.chooseRefreshInterval(seconds)}
    onworkers={(workers) => drive.settings.chooseConcurrentWorkers(workers)}
    oncompression={(enabled) => drive.settings.chooseCompression(enabled)}
    onresetrefreshinterval={() => drive.settings.resetRefreshInterval()}
    onresetworkers={() => drive.settings.resetConcurrentWorkers()}
    onresetcompression={() => drive.settings.resetCompression()}
    groupSettings={drive.groupSettings}
/>
