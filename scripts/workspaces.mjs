import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const task = process.argv[2];
const forwarded = process.argv.slice(3);
const tasks = {
    prepare: [
        ['core', 'build'],
        ['app', 'prepare']
    ],
    build: [
        ['core', 'build'],
        ['app', 'build'],
        ['cli', 'build']
    ],
    check: [
        ['core', 'build'],
        ['core', 'check'],
        ['app', 'check'],
        ['cli', 'check']
    ],
    test: [
        ['core', 'build'],
        ['core', 'test'],
        ['app', 'test'],
        ['cli', 'test']
    ],
    cli: [
        ['core', 'build'],
        ['cli', 'build'],
        ['cli', 'start']
    ],
    dev: [
        ['core', 'build'],
        ['app', 'dev']
    ],
    preview: [['app', 'preview']],
    start: [['app', 'start']],
    'start:bun': [['app', 'start:bun']],
    'check:watch': [
        ['core', 'build'],
        ['app', 'check:watch']
    ]
};

if (!Object.hasOwn(tasks, task)) throw new Error(`Unknown workspace task: ${task}`);

// Use the package manager that invoked this script, with no shell or platform-specific commands.
const packageManager = process.env.npm_execpath;
if (!packageManager) throw new Error('Run workspace tasks through bun run or npm run.');
const useBun = /^bun(?:\.exe)?$/.test(basename(packageManager));
const executable = useBun ? packageManager : process.execPath;

for (const [index, [workspace, script]] of tasks[task].entries()) {
    const args = useBun
        ? [...(process.versions.bun ? ['--bun'] : []), 'run', script]
        : [packageManager, 'run', script, '--'];
    if (index === tasks[task].length - 1) args.push(...forwarded);

    const child = spawn(executable, args, {
        cwd: fileURLToPath(new URL(`../${workspace}/`, import.meta.url)),
        stdio: 'inherit',
        env: process.env
    });
    const interrupt = () => child.kill('SIGINT');
    const terminate = () => child.kill('SIGTERM');
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', terminate);

    const code = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    });
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
    if (code !== 0) {
        process.exitCode = code;
        break;
    }
}
