import { SERVER_ERRORS, throttleError, type ServerError } from '../errors';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { randomBytes } from 'node:crypto';
import { parseAuthFields } from '../aas';
import { photosFetch, type Fetcher } from '../fetcher';
import { guardedSend, readBody } from './transport';
import { throttleWaitSeconds } from './throttle';
import { utf8 } from '../protobuf';
import { AccountSchema } from '../../models';

const AUTH_URL = 'https://android.googleapis.com/auth';
const APP = 'com.google.android.apps.photos';
const SIGNATURE = '24bb24c05e47e0aefa68a58a766179d9b613a600';
const AUTH_CACHE_MARGIN_MS = 30_000;

export type PhotosHeaders = {
    commonHeaders: Record<string, string>;
    rpcHeaders: Record<string, string>;
};

type CachedAuth = { headers: PhotosHeaders; expiresAt: number };

const AUTH_CACHE = new Map<string, CachedAuth>();

export function clearAuthCache(): void {
    AUTH_CACHE.clear();
}

export function authenticatedHeaders(
    email: string,
    token: string,
    fetcher: Fetcher,
    force = false
): AsyncResult<PhotosHeaders, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        if (!AccountSchema.safeParse({ email, token }).success)
            return Err(SERVER_ERRORS.INVALID_ACCOUNT);

        const key = `${email}\u0000${token}`;
        if (!force) {
            const cached = AUTH_CACHE.get(key);
            if (cached && cached.expiresAt - AUTH_CACHE_MARGIN_MS > Date.now())
                return Ok(cached.headers);
        }

        const wait = throttleWaitSeconds(email);
        if (wait !== null) return Err(throttleError(wait));

        const androidId = randomBytes(8).toString('hex');
        const form = new URLSearchParams({
            Email: email,
            Token: token,
            androidId,
            app: APP,
            callerPkg: APP,
            callerSig: SIGNATURE,
            client_sig: SIGNATURE,
            device_country: 'us',
            operatorCountry: 'us',
            google_play_services_version: '240913000',
            lang: 'en_US',
            oauth2_foreground: '1',
            sdk_version: '33',
            source: 'android',
            service:
                'oauth2:openid https://www.googleapis.com/auth/mobileapps.native https://www.googleapis.com/auth/photos.native'
        });

        const authenticated = await guardedSend(
            email,
            fetcher,
            AUTH_URL,
            {
                method: 'POST',
                redirect: 'manual',
                headers: {
                    app: APP,
                    device: androidId,
                    'user-agent': 'GoogleAuth/1.4 (Pixel XL PQ2A.190205.001); gzip',
                    'content-type': 'application/x-www-form-urlencoded',
                    'accept-encoding': 'identity'
                },
                body: form
            },
            'Authentication'
        );

        const failure = authenticated.match<ServerError | null>({
            Ok: () => null,
            Err: (error) => error
        });
        if (failure) {
            if (
                failure.code === 'REQUEST_FAILED' &&
                (failure.status === 401 || failure.status === 403)
            )
                AUTH_CACHE.delete(key);

            return Err(failure);
        }

        const parsed = authenticated.andThenAsync((response) =>
            readBody(response, 'Authentication').andThen(utf8).andThen(authHeadersFromResponse)
        );

        return parsed.map(({ headers, expiresAt }) => {
            AUTH_CACHE.set(key, { headers, expiresAt });

            return headers;
        });
    });
}

function authHeadersFromResponse(
    text: string
): Result<{ headers: PhotosHeaders; expiresAt: number }, ServerError> {
    const authFields = Object.fromEntries(parseAuthFields(text));
    if (authFields.Error || !authFields.Auth || Number(authFields.Expiry) <= Date.now() / 1000)
        return Err(SERVER_ERRORS.AAS_AUTHENTICATION_FAILED);

    const commonHeaders = {
        Authorization: `Bearer ${authFields.Auth}`,
        'user-agent':
            'com.google.android.apps.photos/49029607 (Linux; U; Android 9; en_US; Pixel XL; Build/PQ2A.190205.001; Cronet/127.0.6510.5) (gzip)',
        'accept-encoding': 'identity',
        'accept-language': 'en_US'
    };
    const rpcHeaders = {
        ...commonHeaders,
        'content-type': 'application/x-protobuf',
        'x-goog-ext-173412678-bin': 'CgcIAhClARgC',
        'x-goog-ext-174067345-bin': 'CgIIAg=='
    };

    return Ok({
        headers: { commonHeaders, rpcHeaders },
        expiresAt: Number(authFields.Expiry) * 1000
    });
}

/** Confirm Google accepts this email and AAS token for Photos without exposing the bearer token. */
export function validateAasAccount(
    email: string,
    token: string,
    fetcher: Fetcher = photosFetch
): AsyncResult<void, ServerError> {
    return authenticatedHeaders(email, token, fetcher, true).map(() => undefined);
}
