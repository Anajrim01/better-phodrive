import { hashingWorkload } from './hashing';
import { libraryWorkload } from './library';
import { metadataWorkload } from './metadata';
import { transferWorkload } from './transfer';
import { uploadWorkload } from './upload';
import type { TransportState, Workload } from '../fixtures';

export async function createWorkload(name: string, transport: TransportState): Promise<Workload> {
    const workload =
        (await hashingWorkload(name)) ??
        metadataWorkload(name) ??
        (await transferWorkload(name)) ??
        libraryWorkload(name) ??
        uploadWorkload(name, transport);
    if (!workload) throw new Error(`Unknown performance case: ${name}`);

    return workload;
}
