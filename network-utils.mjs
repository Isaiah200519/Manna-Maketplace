export async function fetchWithTimeout(input, options = {}, timeoutMs = 10000) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new RangeError('Request timeout must be a positive number of milliseconds.');
    }

    const controller = new AbortController();
    const externalSignal = options.signal;
    const abortFromExternalSignal = () => controller.abort(externalSignal.reason);
    if (externalSignal?.aborted) {
        abortFromExternalSignal();
    } else {
        externalSignal?.addEventListener('abort', abortFromExternalSignal, { once: true });
    }

    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(input, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timeoutId);
        externalSignal?.removeEventListener('abort', abortFromExternalSignal);
    }
}
