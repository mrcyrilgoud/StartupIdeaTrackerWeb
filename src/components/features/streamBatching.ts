export interface StreamBatcher {
    push: (delta: string) => void;
    flush: () => void;
    clear: () => void;
    dispose: () => void;
}

export function createStreamBatcher(onFlush: (content: string) => void, intervalMs: number): StreamBatcher {
    let buffer = '';
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        if (!buffer) return;
        const nextContent = buffer;
        buffer = '';
        onFlush(nextContent);
    };

    const push = (delta: string) => {
        if (!delta) return;
        buffer += delta;
        if (timer) return;
        timer = setTimeout(() => {
            timer = null;
            flush();
        }, intervalMs);
    };

    const clear = () => {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        buffer = '';
    };

    return { push, flush, clear, dispose: clear };
}
