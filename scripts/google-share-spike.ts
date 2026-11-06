import { setTimeout as sleep } from 'node:timers/promises';
import { photosFetch } from '@madkarmaa/phodrive-core/server/fetcher';
import { runSpike } from './google-share-spike/cli.ts';

try {
    process.exitCode = await runSpike(process.argv.slice(2), {
        fetcher: photosFetch,
        write: (line) => console.log(line),
        sleep: async (milliseconds) => {
            await sleep(milliseconds);
        }
    });
} catch {
    // An unexpected exception could quote a key or URL, so its message is never printed.
    console.log(JSON.stringify({ stage: 'spike', status: 'unexpected-exception' }));
    process.exitCode = 1;
}
