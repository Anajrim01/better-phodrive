import { SERVER_ERRORS, type ServerError } from '../errors';
import { Err, Ok, type Result } from 'results-ts';
import {
    SplitHeaderSchema,
    SPLIT_FLAGS_MAX,
    splitHeaderIsCompressed,
    type SplitHeader
} from '../../models';
import {
    hashHex,
    isSplitBmp,
    readSplitFolder,
    readSplitName,
    readVarint,
    splitMagic
} from './fields';
import { BMP_HEADER_BYTES, SPLIT_MAGIC_WITH_FOLDER, FILE_HASH_BYTES } from '../../bmp/format';
export {
    BMP_HEADER_BYTES,
    MAX_PHOTOS_BMP_BYTES,
    MAX_CHUNK_PAYLOAD_BYTES,
    MAX_SPLIT_HEADER_BYTES,
    splitHeaderByteLength,
    splitBmpByteLength
} from '../../bmp/format';

/** Read metadata from the beginning of a BMP without loading its payload. */
export function decodeSplitHeader(
    prefix: Uint8Array,
    totalSize: number
): Result<{ header: SplitHeader; payloadOffset: number }, ServerError> {
    const invalid = () => Err(SERVER_ERRORS.INVALID_DOWNLOADED_BMP);
    if (!isSplitBmp(prefix, totalSize)) return invalid();

    const magic = splitMagic(prefix)!;
    const withFolder = magic === SPLIT_MAGIC_WITH_FOLDER;
    let offset = BMP_HEADER_BYTES + magic.length;
    const fileHash = hashHex(prefix.subarray(offset, offset + FILE_HASH_BYTES));
    offset += FILE_HASH_BYTES;

    const fileId = hashHex(prefix.subarray(offset, offset + FILE_HASH_BYTES));
    offset += FILE_HASH_BYTES;

    const metadata = readVarint(prefix, offset).andThen((index) => {
        if (index.next >= prefix.length) return invalid();

        const flags = prefix[index.next];
        if ((flags & ~SPLIT_FLAGS_MAX) !== 0) return invalid();

        return readVarint(prefix, index.next + 1).andThen((size) => {
            const header = {
                fileHash,
                fileId,
                chunkIndex: index.value,
                flags,
                payloadSize: size.value,
                payloadOffset: size.next
            };
            if (!splitHeaderIsCompressed(flags)) return Ok(header);

            return readVarint(prefix, size.next).map((original) => ({
                ...header,
                originalSize: original.value,
                payloadOffset: original.next
            }));
        });
    });

    return metadata
        .andThen((header) =>
            readSplitName(prefix, header.payloadOffset, header.chunkIndex).map((name) => ({
                ...header,
                ...name
            }))
        )
        .andThen((header) =>
            withFolder
                ? readSplitFolder(prefix, header.payloadOffset, header.chunkIndex).map(
                      (folder) => ({
                          ...header,
                          ...folder
                      })
                  )
                : Ok(header)
        )
        .andThen(
            ({
                payloadOffset,
                ...header
            }): Result<{ header: SplitHeader; payloadOffset: number }, ServerError> => {
                if (header.payloadSize > totalSize - payloadOffset) return invalid();

                const parsed = SplitHeaderSchema.safeParse(header);
                if (!parsed.success) return Err(SERVER_ERRORS.INVALID_CHUNK_METADATA);

                return Ok({ header: parsed.data, payloadOffset });
            }
        );
}
