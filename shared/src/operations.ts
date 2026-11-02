let controller = new AbortController();

export function operationSignal(): AbortSignal {
    return controller.signal;
}

export function stopOperations(): void {
    controller.abort();
    controller = new AbortController();
}
