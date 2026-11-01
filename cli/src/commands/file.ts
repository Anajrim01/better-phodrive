import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../context';
import { listFiles } from '../file-list';
import { download, remove, upload } from '../file-transfer';
import type { Runner } from '../program';

export function registerFileCommands(program: Command, context: CliContext, run: Runner) {
    const file = program.command('file').description('List, upload, download, and trash files');

    file.command('list')
        .description('List files, newest first by default')
        .argument('[search]', 'show names containing this text')
        .option('--type <extension>', 'show one file type, for example pdf')
        .option('--days <days>', 'show files modified in the last number of days')
        .option('--sort <order>', 'modified-desc, modified-asc, name-asc, or name-desc')
        .option('--folder <path>', 'show files in one folder, . for the library root')
        .option('--folders', 'show folders instead of files')
        .option('--json', 'print JSON')
        .option('-a, --account <email>', 'use this account instead of the active one')
        .option('-g, --group <name>', 'list the merged files of a group')
        .action((search, options) => run(() => listFiles(context, search, options)));

    file.command('upload')
        .description('Upload files, and every file inside folders')
        .argument('<paths...>', 'files or folders')
        .option('-w, --workers <count>', 'concurrent transfers')
        .option('--compress', 'compress uploads when it saves at least 5%')
        .option('--no-compress', 'send raw chunks even when compression is on')
        .option('-a, --account <email>', 'use this account instead of the active one')
        .option('-g, --group <name>', 'spread files across a group of accounts')
        .action((paths, options) => run(() => upload(context, paths, options)));

    file.command('download')
        .description('Download files by name or ID')
        .argument('<files...>', 'file names or IDs from `phodrive file list`')
        .option('-o, --output <path>', 'destination folder, or file path for one file')
        .option('-f, --force', 'replace existing local files')
        .option('-a, --account <email>', 'use this account instead of the active one')
        .option('-g, --group <name>', 'download each file from its owner')
        .action((targets, options) => run(() => download(context, targets, options)));

    file.command('delete')
        .description('Move files to the Google Photos trash')
        .argument('<files...>', 'file names or IDs from `phodrive file list`')
        .option('-y, --yes', 'skip the confirmation')
        .option('-w, --workers <count>', 'concurrent requests')
        .option('-a, --account <email>', 'use this account instead of the active one')
        .option('-g, --group <name>', 'move each file to trash on its owner')
        .action((targets, options) => run(() => remove(context, targets, options)));
}
