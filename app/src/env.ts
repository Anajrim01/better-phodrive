import { defineEnvVars } from '@sveltejs/kit/env';
import { z } from 'zod';

const OptionalEnvironmentValueSchema = z.string().optional();

export const variables = defineEnvVars({
    PHODRIVE_DEFAULT_THEME: { schema: OptionalEnvironmentValueSchema },
    PHODRIVE_DEFAULT_SORT: { schema: OptionalEnvironmentValueSchema },
    PHODRIVE_DEFAULT_REFRESH_INTERVAL_SECONDS: { schema: OptionalEnvironmentValueSchema },
    PHODRIVE_DEFAULT_CONCURRENT_WORKERS: { schema: OptionalEnvironmentValueSchema },
    PHODRIVE_PROBE_CACHE: { schema: OptionalEnvironmentValueSchema },
    PHODRIVE_LIBRARY_STATE: { schema: OptionalEnvironmentValueSchema }
});
