import { hashingWorkload } from './hashing';
import { libraryWorkload } from './library';
import { metadataWorkload } from './metadata';
import { transferWorkload } from './transfer';
import { uploadWorkload } from './upload';
import type { TransportState, Workload } from '../fixtures';

export async function createWorkload(name: string, transport: TransportState): Promise<Workload> {
    return (
        (await hashingWorkload(name)) ??
        metadataWorkload(name) ??
        (await transferWorkload(name)) ??
        libraryWorkload(name) ??
        uploadWorkload(name, transport)
    );
}
