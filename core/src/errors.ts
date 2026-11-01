/** Recoverable failures carry a stable code and a user-facing message. */
export type ApplicationError =
    | {
          readonly code:
              | 'ACCOUNT_CONNECTION_FAILED'
              | 'DELETE_FAILED'
              | 'DOWNLOAD_RECEIVE_FAILED'
              | 'DOWNLOAD_SAVE_FAILED'
              | 'INCOMPLETE_DOWNLOAD_CHUNKS'
              | 'INVALID_ALBUM_KEY'
              | 'INVALID_CONCURRENT_WORKERS'
              | 'INVALID_DELETE_RESPONSE'
              | 'INVALID_RESTORE_RESPONSE'
              | 'INVALID_GROUP'
              | 'INVALID_JSON_REQUEST'
              | 'INVALID_OAUTH_CREDENTIALS'
              | 'INVALID_REFRESH_INTERVAL'
              | 'INVALID_SCHEMA'
              | 'INVALID_STORED_JSON'
              | 'INVALID_UPLOAD_PROGRESS'
              | 'OAUTH_EXCHANGE_FAILED'
              | 'OWNER_NOT_IN_GROUP'
              | 'OWNER_PAUSED'
              | 'REPEATED_LIBRARY_PAGE'
              | 'REQUEST_FAILED'
              | 'STORAGE_UNAVAILABLE'
              | 'UPLOAD_FAILED'
              | 'UPLOAD_STREAM_INTERRUPTED'
              | 'HASH_INITIALIZATION_FAILED'
              | 'FILE_READ_FAILED'
              | 'INVALID_CHUNK_SIZE'
              | 'INVALID_CHUNK_METADATA'
              | 'CHUNK_TOO_LARGE'
              | 'FILE_EXISTS';
          readonly message: string;
      }
    | ThrottledError;

export type ThrottledError = {
    readonly code: 'THROTTLED';
    readonly message: string;
    readonly retryAfterSeconds: number;
};
