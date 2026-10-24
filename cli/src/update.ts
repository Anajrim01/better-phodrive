import { createHash, randomUUID, type Hash } from 'node:crypto';
import { chmod, open, realpath, rename, rm, type FileHandle } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import prettyBytes from 'pretty-bytes';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { z } from 'zod';
import { schemaResult } from '@madkarmaa/phodrive-core/validation';
import { version } from '../package.json';
import type { CliContext, CliError } from './context';
import { activity, status, transferProgress } from './output';

// Release builds define this as their GitHub release asset name; npm builds leave it undefined.
declare const PHODRIVE_RELEASE_ASSET: string | undefined;

export const RELEASE_ASSET =
    typeof PHODRIVE_RELEASE_ASSET === 'string' ? PHODRIVE_RELEASE_ASSET : undefined;

const LATEST_RELEASE_URL = 'https://api.github.com/repos/madkarmaa/phodrive/releases/latest';
const EXECUTABLE_MODE = 0o755;
const SHA256_PREFIX = 'sha256:';

const ReleaseSchema = z.object({
    tag_name: z.string(),
    assets: z.array(
        z.object({
            name: z.string(),
            size: z.int().nonnegative(),
            browser_download_url: z.url(),
            digest: z.string().nullish()
        })
    )
});

type Release = z.infer<typeof ReleaseSchema>;
type Asset = Release['assets'][number];

function updateFailure(message: string): CliError {
    return { code: 'UPDATE_FAILED', message } as const;
}

function fetchLatestRelease(context: CliContext): AsyncResult<Release, CliError> {
    return Ok(undefined).andThenAsync<Release, CliError>(async () => {
        const indicator = activity(context, 'Checking for updates');
        let body: unknown;

        try {
            const response = await fetch(LATEST_RELEASE_URL, {
                headers: {
                    Accept: 'application/vnd.github+json',
                    'User-Agent': `phodrive/${version}`
                },
                signal: context.signal
            });
            if (!response.ok) {
                indicator.fail();

                return Err(updateFailure(`GitHub answered with HTTP ${response.status}.`));
            }

            body = await response.json();
        } catch {
            indicator.fail();

            return Err(updateFailure('Could not reach GitHub.'));
        }

        indicator.stop('Checked for updates');

        return schemaResult(ReleaseSchema, body, 'GitHub returned an unexpected release.');
    });
}

function findAsset(release: Release, name: string): Result<Asset, CliError> {
    const asset = release.assets.find((candidate) => candidate.name === name);
    if (!asset)
        return Err(
            updateFailure(`The latest release, ${release.tag_name}, has no ${name} download.`)
        );

    return Ok(asset);
}

function copyBody(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    handle: FileHandle,
    hash: Hash,
    onProgress: (written: number) => void
): AsyncResult<number, CliError> {
    return Ok(undefined).andThenAsync<number, CliError>(async () => {
        let written = 0;

        while (true) {
            let next: ReadableStreamReadResult<Uint8Array>;

            try {
                next = await reader.read();
            } catch {
                return Err(updateFailure('The download was interrupted.'));
            }
            if (next.done) return Ok(written);

            try {
                await handle.write(next.value);
            } catch {
                return Err(updateFailure('Could not save the new version.'));
            }

            hash.update(next.value);
            written += next.value.byteLength;
            onProgress(written);
        }
    });
}

/** The asset size and GitHub's SHA-256 digest must both match before anything is replaced. */
function verifyDownload(asset: Asset, written: number, hash: Hash): Result<void, CliError> {
    if (written !== asset.size)
        return Err(updateFailure(`The download stopped after ${prettyBytes(written)}.`));

    const digest = `${SHA256_PREFIX}${hash.digest('hex')}`;
    if (asset.digest && asset.digest !== digest)
        return Err(updateFailure('The download does not match the checksum GitHub published.'));

    return Ok(undefined);
}

function downloadAsset(
    context: CliContext,
    asset: Asset,
    path: string
): AsyncResult<void, CliError> {
    return Ok(undefined).andThenAsync<void, CliError>(async () => {
        let body: ReadableStream<Uint8Array>;
        let handle: FileHandle;

        try {
            const response = await fetch(asset.browser_download_url, { signal: context.signal });
            if (!response.ok || !response.body)
                return Err(updateFailure(`GitHub answered with HTTP ${response.status}.`));

            body = response.body;
        } catch {
            return Err(updateFailure('Could not reach GitHub.'));
        }

        try {
            handle = await open(path, 'wx', EXECUTABLE_MODE);
        } catch {
            await body.cancel().catch(() => {});

            return Err(updateFailure(`Could not write to ${dirname(path)}.`));
        }

        const bar = transferProgress(context, `Downloading ${asset.name}`, asset.size);
        const hash = createHash('sha256');
        const reader = body.getReader();

        const copied = await copyBody(reader, handle, hash, (written) =>
            bar.update(written, `${prettyBytes(written)} of ${prettyBytes(asset.size)}`)
        );

        await reader.cancel().catch(() => {});
        reader.releaseLock();

        try {
            await handle.close();
            // The file mode passed to open is reduced by the umask.
            await chmod(path, EXECUTABLE_MODE);
        } catch {
            bar.fail();

            return copied.andThen(() => Err(updateFailure('Could not save the new version.')));
        }

        const verified = copied.andThen((written) => verifyDownload(asset, written, hash));
        verified.match({
            Ok: () => bar.stop(`Downloaded ${asset.name}`),
            Err: () => bar.fail()
        });

        return verified;
    });
}

/** Windows locks a running executable but still lets it be renamed out of the way. */
function replaceWindowsExecutable(temporary: string, target: string): AsyncResult<void, CliError> {
    return Ok(undefined).andThenAsync(async () => {
        const previous = `${target}.old`;

        try {
            await rm(previous, { force: true });
            await rename(target, previous);
        } catch {
            return Err(updateFailure(`Could not replace ${target}.`));
        }

        try {
            await rename(temporary, target);
        } catch {
            await rename(previous, target).catch(() => {});

            return Err(updateFailure(`Could not replace ${target}.`));
        }

        return Ok(undefined);
    });
}

function replaceExecutable(temporary: string, target: string): AsyncResult<void, CliError> {
    if (process.platform === 'win32') return replaceWindowsExecutable(temporary, target);

    return Ok(undefined).andThenAsync(async () => {
        try {
            await rename(temporary, target);
        } catch {
            return Err(updateFailure(`Could not replace ${target}.`));
        }

        return Ok(undefined);
    });
}

/** The download lands beside the executable so the final rename stays on one filesystem. */
function installAsset(
    context: CliContext,
    executable: string,
    asset: Asset
): AsyncResult<void, CliError> {
    return Ok(undefined).andThenAsync<void, CliError>(async () => {
        let target: string;

        try {
            target = await realpath(executable);
        } catch {
            return Err(updateFailure(`Could not find ${executable}.`));
        }

        const temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.part`);

        const downloaded = await downloadAsset(context, asset, temporary);
        const installed = await downloaded.andThenAsync(() => replaceExecutable(temporary, target));

        if (installed.isErr()) await rm(temporary, { force: true }).catch(() => {});

        return installed;
    });
}

export function updateExecutable(context: CliContext): AsyncResult<void, CliError> {
    return Ok(undefined).andThenAsync<void, CliError>(async () => {
        const { release } = context;
        if (!release)
            return Err({
                code: 'UPDATE_UNSUPPORTED',
                message:
                    '`phodrive update` replaces executables downloaded from GitHub releases. Update an npm install with `npm install --global @madkarmaa/phodrive-cli@latest`.'
            } as const);

        return await fetchLatestRelease(context).andThenAsync<void, CliError>(async (latest) => {
            const latestVersion = latest.tag_name.replace(/^v/, '');
            if (latestVersion === version) {
                status(context).success(`phodrive ${version} is up to date`);

                return Ok(undefined);
            }

            const installed = await findAsset(latest, release.asset).andThenAsync((asset) =>
                installAsset(context, release.executable, asset)
            );

            return installed.map(() =>
                status(context).success(`Updated phodrive from ${version} to ${latestVersion}`)
            );
        });
    });
}
