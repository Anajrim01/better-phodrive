const locks = new Map<string, Promise<unknown>>();

/** Serialize index reads and writes for one account across syncs and edits. */
export function withAccountLock<T>(email: string, task: () => Promise<T>): Promise<T> {
    const key = email.toLowerCase();
    const previous = locks.get(key) ?? Promise.resolve();
    const run = previous.then(task, task);
    locks.set(
        key,
        run.catch(() => undefined)
    );

    return run;
}
