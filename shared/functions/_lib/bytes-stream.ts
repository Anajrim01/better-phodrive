export function releaseBody(
    body: ReadableStream<Uint8Array>,
    release: () => void,
    limit: number,
    controller: AbortController,
    idleTimeoutMs: number
): ReadableStream<Uint8Array> {
    const reader = body.getReader();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let outputController: ReadableStreamDefaultController<Uint8Array> | null = null;
    let forwarded = 0;
    let finished = false;

    const clearTimer = () => {
        if (timer === undefined) return;

        clearTimeout(timer);
        timer = undefined;
    };
    const finish = () => {
        if (finished) return;
        finished = true;
        clearTimer();
        release();
    };
    const armTimer = () => {
        clearTimer();
        timer = setTimeout(() => {
            controller.abort();
            finish();

            try {
                outputController?.error(new Error('Upstream body timed out'));
            } catch {
                return;
            }
        }, idleTimeoutMs);
    };

    return new ReadableStream<Uint8Array>({
        start(output) {
            outputController = output;
            armTimer();
        },
        async pull(output) {
            if (finished) return;

            armTimer();

            try {
                const next = await reader.read();
                if (finished) {
                    void reader.cancel().catch(() => undefined);

                    return;
                }

                if (next.done) {
                    finish();
                    output.close();

                    return;
                }

                if (forwarded + next.value.byteLength > limit) {
                    finish();
                    void reader.cancel().catch(() => undefined);
                    output.error(new Error('Upstream body exceeded the proxy limit'));

                    return;
                }

                forwarded += next.value.byteLength;
                output.enqueue(next.value);
                armTimer();
            } catch (error) {
                if (finished) return;

                finish();
                output.error(error);
            }
        },
        cancel(reason) {
            finish();

            try {
                void reader.cancel(reason).catch(() => undefined);
            } catch {
                return;
            }
        }
    });
}

export function discardUpstream(response: Response, controller: AbortController): void {
    controller.abort();

    try {
        void response.body?.cancel().catch(() => undefined);
    } catch {
        return;
    }
}
