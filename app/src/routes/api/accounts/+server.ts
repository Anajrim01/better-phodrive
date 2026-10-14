import { NewAccountSchema } from '@phodrive/core/models';
import { schemaResult } from '@phodrive/core/validation';
import { connectGoogleAccount } from '@phodrive/core/server/accounts';
import { readJson } from '@phodrive/core/server/request';
import type { z } from 'zod';
import type { RequestHandler } from './$types';

const RESPONSE_HEADERS = { 'cache-control': 'no-store' };

export const POST: RequestHandler = async ({ request }) => {
    const body = await readJson(request);

    const parsed = body.andThen((value) =>
        schemaResult(NewAccountSchema, value, 'Invalid account')
    );
    const input = parsed.match<z.infer<typeof NewAccountSchema> | Response>({
        Ok: (value) => value,
        Err: (error) =>
            Response.json({ error: error.message }, { status: 400, headers: RESPONSE_HEADERS })
    });
    if (input instanceof Response) return input;

    const connected = await connectGoogleAccount(input.email, input.token);

    return connected.match({
        Ok: (token) => Response.json({ token }, { headers: RESPONSE_HEADERS }),
        Err: (error) =>
            Response.json({ error: error.message }, { status: 400, headers: RESPONSE_HEADERS })
    });
};
