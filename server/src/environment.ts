import { ProcessingModeSchema, type PreferencesDefaults } from '@madkarmaa/phodrive-core/models';
import { parsePreferencesDefaults } from '@madkarmaa/phodrive-core/preferences';
import { Err, Ok, type Result } from 'results-ts';
import { z } from 'zod';
import { validCapabilityKey } from './shares/capability';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3000;
const MAX_PORT = 65_535;
const MIN_AUTH_SECRET_LENGTH = 32;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// Compose passes an unset variable through as an empty string.
function unsetWhenBlank<T extends z.ZodType>(schema: T) {
    return z.preprocess((value) => (value === '' ? undefined : value), schema.optional());
}

function validEdgeOrigin(value: string): boolean {
    if (!URL.canParse(value)) return false;

    const url = new URL(value);
    const scheme =
        url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname));

    return scheme && value.replace(/\/$/, '') === url.origin;
}

export const DatabaseUrlSchema = z.url({ protocol: /^postgres(ql)?$/ });
export const AuthSecretSchema = z.string().min(MIN_AUTH_SECRET_LENGTH);

export const EnvironmentSchema = z.object({
    HOST: z
        .string()
        .trim()
        .pipe(z.union([z.hostname(), z.ipv4(), z.ipv6()]))
        .default(DEFAULT_HOST),
    PORT: z
        .string()
        .trim()
        .regex(/^\d+$/)
        .transform(Number)
        .pipe(z.int().min(0).max(MAX_PORT))
        .default(DEFAULT_PORT),
    DATABASE_URL: DatabaseUrlSchema,
    /** Signs sessions and encrypts stored Google tokens. */
    BETTER_AUTH_SECRET: AuthSecretSchema,
    SHARE_CAPABILITY_KEY: unsetWhenBlank(
        z.string().refine(validCapabilityKey, 'Must be padded base64 of exactly 32 bytes.')
    ),
    PUBLIC_EDGE_URL: unsetWhenBlank(
        z.string().refine(validEdgeOrigin, 'Must be an https origin, or http on loopback.')
    ),
    /** Public origin; derived from each request when unset. */
    BETTER_AUTH_URL: z.url().optional(),
    /** Where files are split and encoded. There is no default: it depends on the hardware. */
    PHODRIVE_PROCESSING: ProcessingModeSchema,
    PHODRIVE_DISABLE_SIGNUP: z.stringbool().default(false)
});

export type ShareConfig = { capabilityKey: Buffer; edgeUrl: string };

export function sharingDiagnostic(env: Environment): string | null {
    return Boolean(env.SHARE_CAPABILITY_KEY) !== Boolean(env.PUBLIC_EDGE_URL)
        ? 'Public sharing disabled: SHARE_CAPABILITY_KEY and PUBLIC_EDGE_URL must both be configured.'
        : null;
}

export type Environment = z.infer<typeof EnvironmentSchema> & {
    preferencesDefaults: PreferencesDefaults;
    sharing: ShareConfig | null;
};

/** Diagnostics name invalid variables but never include their values. */
export function parseEnvironment(
    environment: Record<string, string | undefined>
): Result<Environment, string> {
    const parsed = EnvironmentSchema.safeParse(environment);

    if (!parsed.success) {
        const invalidVariables = parsed.error.issues.map((issue) => issue.path.join('.'));

        return Err(`Invalid server environment: ${invalidVariables.join(', ')}.`);
    }

    const { SHARE_CAPABILITY_KEY, PUBLIC_EDGE_URL } = parsed.data;

    return Ok({
        ...parsed.data,
        preferencesDefaults: parsePreferencesDefaults(environment),
        sharing:
            SHARE_CAPABILITY_KEY && PUBLIC_EDGE_URL
                ? {
                      capabilityKey: Buffer.from(SHARE_CAPABILITY_KEY, 'base64'),
                      edgeUrl: PUBLIC_EDGE_URL.replace(/\/$/, '')
                  }
                : null
    });
}
