import { createHash } from 'node:crypto';
import { open, readFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Err, Ok, type AsyncResult } from 'results-ts';
import { z } from 'zod';

const StepSchema = z.enum(['none', 'pending', 'ok', 'rejected', 'uncertain']);

const FixtureSchema = z.strictObject({
    name: z.string().min(1),
    sha1: z.string().regex(/^[a-f0-9]{40}$/),
    size: z.int().positive(),
    upload: z.union([StepSchema, z.literal('preexisting')]),
    mediaKey: z.string().min(1).optional(),
    trash: StepSchema,
    remove: StepSchema,
    presence: z.enum(['unknown', 'present', 'absent'])
});

const LedgerSchema = z.strictObject({
    accountHash: z.string().min(1),
    fixtures: z.array(FixtureSchema).min(1),
    album: z.strictObject({
        title: z.string().min(1),
        create: StepSchema,
        key: z.string().min(1).optional(),
        remove: StepSchema
    }),
    envelope: z.strictObject({
        create: StepSchema,
        key: z.string().min(1).optional(),
        remove: StepSchema
    }),
    link: z.strictObject({
        enable: StepSchema,
        disable: StepSchema,
        shortUrl: z.string().min(1).optional(),
        authKey: z.string().min(1).optional(),
        canonicalUrl: z.string().min(1).optional()
    }),
    directUrls: z.array(z.string().min(1))
});

export type Step = z.infer<typeof StepSchema>;
export type LedgerFixture = z.infer<typeof FixtureSchema>;
export type Ledger = z.infer<typeof LedgerSchema>;
export type LedgerError = {
    readonly code:
        | 'LEDGER_CREATE_FAILED'
        | 'LEDGER_WRITE_FAILED'
        | 'LEDGER_INVALID'
        | 'LEDGER_ACCOUNT_MISMATCH';
};

const PRIVATE_FILE_MODE = 0o600;

export function accountHash(email: string): string {
    return createHash('sha256').update(email).digest('hex');
}

async function writeSynced(path: string, ledger: Ledger, flags: 'wx' | 'w'): Promise<void> {
    const file = await open(path, flags, PRIVATE_FILE_MODE);

    try {
        await file.writeFile(`${JSON.stringify(ledger, null, 2)}\n`);
        await file.sync();
    } finally {
        await file.close();
    }
}

async function syncParent(path: string): Promise<void> {
    // Node cannot sync directory handles on Windows; power-loss durability is not promised there.
    if (process.platform === 'win32') return;

    const directory = await open(dirname(path), 'r');
    try {
        await directory.sync();
    } finally {
        await directory.close();
    }
}

/** Refuses an existing path: a run starts from a fresh ledger and is never resumed. */
export function createLedgerFile(path: string, ledger: Ledger): AsyncResult<void, LedgerError> {
    return Ok(undefined).andThenAsync<void, LedgerError>(async () => {
        try {
            await writeSynced(path, ledger, 'wx');
            await syncParent(path);

            return Ok(undefined);
        } catch {
            return Err({ code: 'LEDGER_CREATE_FAILED' });
        }
    });
}

/** Await the synced replacement before another RPC; hardware power-loss guarantees vary. */
export function saveLedger(path: string, ledger: Ledger): AsyncResult<void, LedgerError> {
    return Ok(undefined).andThenAsync<void, LedgerError>(async () => {
        const temporary = `${path}.tmp`;

        try {
            await writeSynced(temporary, ledger, 'w');
            await rename(temporary, path);
            await syncParent(path);

            return Ok(undefined);
        } catch {
            return Err({ code: 'LEDGER_WRITE_FAILED' });
        }
    });
}

export function loadLedger(path: string): AsyncResult<Ledger, LedgerError> {
    return Ok(undefined).andThenAsync<Ledger, LedgerError>(async () => {
        try {
            const parsed = LedgerSchema.safeParse(JSON.parse(await readFile(path, 'utf8')));

            return parsed.success ? Ok(parsed.data) : Err({ code: 'LEDGER_INVALID' });
        } catch {
            return Err({ code: 'LEDGER_INVALID' });
        }
    });
}

function unresolved(step: Step): boolean {
    return step === 'pending' || step === 'uncertain';
}

function resourceResidue(resource: { create: Step; key?: string; remove: Step }): number {
    if (unresolved(resource.create)) return 1;

    return resource.key !== undefined && resource.remove !== 'ok' ? 1 : 0;
}

export function linkMayBeOn({ link }: Ledger): boolean {
    return link.enable !== 'none' && link.enable !== 'rejected';
}

export function shareResidue(ledger: Ledger): number {
    const link = linkMayBeOn(ledger) && ledger.link.disable !== 'ok' ? 1 : 0;
    const missingDirect = linkMayBeOn(ledger) && ledger.directUrls.length === 0 ? 1 : 0;

    return link + missingDirect + resourceResidue(ledger.album) + resourceResidue(ledger.envelope);
}

export function mediaResidue({ fixtures }: Ledger): number {
    return fixtures.filter((fixture) => {
        if (fixture.upload === 'pending' || fixture.upload === 'uncertain') return true;

        return (
            fixture.upload === 'ok' && (fixture.remove !== 'ok' || fixture.presence !== 'absent')
        );
    }).length;
}
