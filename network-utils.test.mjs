import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithTimeout } from './network-utils.mjs';

test('fetchWithTimeout forwards request options and returns the response', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, options) => {
        assert.equal(input, '/sample');
        assert.equal(options.method, 'GET');
        assert.ok(options.signal instanceof AbortSignal);
        return { ok: true };
    };

    try {
        const response = await fetchWithTimeout('/sample', { method: 'GET' }, 100);
        assert.equal(response.ok, true);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('fetchWithTimeout aborts requests after the configured deadline', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (_input, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('request aborted')), { once: true });
    });

    try {
        await assert.rejects(fetchWithTimeout('/slow', {}, 5), /request aborted/);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('fetchWithTimeout rejects invalid timeout values', async () => {
    await assert.rejects(fetchWithTimeout('/sample', {}, 0), RangeError);
});
