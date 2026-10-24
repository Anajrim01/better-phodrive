import { afterEach, beforeEach, expect, test } from 'vitest';
import { runCli, temporaryFolder } from './helpers/cli';

let folder: Awaited<ReturnType<typeof temporaryFolder>>;

beforeEach(async () => {
    folder = await temporaryFolder();
});

afterEach(() => folder.remove());

test('help, --help, and -h show the same help for nested commands', async () => {
    const command = await runCli(['help', 'file', 'upload'], { folder: folder.path });
    const long = await runCli(['file', 'upload', '--help'], { folder: folder.path });
    const short = await runCli(['file', 'upload', '-h'], { folder: folder.path });

    expect(command.exitCode).toBe(0);
    expect(command.stdout).toContain('Usage: phodrive file upload');
    expect(long.stdout).toBe(command.stdout);
    expect(short.stdout).toBe(command.stdout);
});

test('help without a command lists every command', async () => {
    const help = await runCli(['help'], { folder: folder.path });

    expect(help.exitCode).toBe(0);
    for (const command of ['account', 'file', 'setting', 'help'])
        expect(help.stdout).toContain(`  ${command}`);
});

test('help for an unknown command fails', async () => {
    const help = await runCli(['help', 'file', 'bogus'], { folder: folder.path });

    expect(help.failures).toMatchObject([{ code: 'UNKNOWN_COMMAND' }]);
    expect(help.stderr).toContain('Unknown command `phodrive file bogus`');
    expect(help.stdout).toBe('');
});
