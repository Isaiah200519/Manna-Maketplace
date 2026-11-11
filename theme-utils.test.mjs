import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
    applyTheme,
    applyThemePreference,
    bindThemePreferenceControl,
    getCurrentTheme,
    saveThemePreference
} from './theme-utils.js';

const originalDocument = globalThis.document;
const originalLocalStorage = globalThis.localStorage;
const originalWindow = globalThis.window;
let localValues;

function setupBrowserMocks(theme = 'dark') {
    localValues = new Map();
    globalThis.localStorage = {
        getItem: (key) => localValues.get(key) ?? null,
        setItem: (key, value) => localValues.set(key, value)
    };
    globalThis.document = { documentElement: { dataset: { theme } } };
    globalThis.window = { location: { reload() { globalThis.reloadCount = (globalThis.reloadCount || 0) + 1; } } };
}

afterEach(() => {
    globalThis.document = originalDocument;
    globalThis.localStorage = originalLocalStorage;
    globalThis.window = originalWindow;
    delete globalThis.reloadCount;
});

test('account without a saved theme defaults to dark', () => {
    setupBrowserMocks('light');

    assert.equal(applyThemePreference({}), 'dark');
    assert.equal(document.documentElement.dataset.theme, 'dark');
    assert.equal(getCurrentTheme(), 'dark');
});

test('account preference applies immediately and is cached locally', () => {
    setupBrowserMocks();

    assert.equal(applyThemePreference({ themePreference: 'light' }), 'light');
    assert.equal(document.documentElement.dataset.theme, 'light');
    assert.equal(localStorage.getItem('manna-theme'), 'light');
});

test('settings control applies and saves a preference to the user profile', async () => {
    setupBrowserMocks();
    let savedProfile;
    const db = {
        collection(name) {
            assert.equal(name, 'users');
            return {
                doc(userId) {
                    assert.equal(userId, 'user-1');
                    return {
                        async set(profile, options) {
                            savedProfile = { profile, options };
                        }
                    };
                }
            };
        }
    };
    const select = {
        value: 'light',
        disabled: false,
        addEventListener(_event, listener) {
            this.onChange = listener;
        }
    };
    let appliedTheme = '';

    bindThemePreferenceControl({ querySelector: () => select }, {
        db,
        userId: 'user-1',
        onSaved: (theme) => { appliedTheme = theme; }
    });
    select.value = 'light';
    await select.onChange();

    assert.equal(document.documentElement.dataset.theme, 'light');
    assert.equal(localStorage.getItem('manna-theme'), 'light');
    assert.equal(appliedTheme, 'light');
    assert.equal(savedProfile.profile.themePreference, 'light');
    assert.equal(savedProfile.options.merge, true);
    assert.equal(select.disabled, false);
    assert.equal(globalThis.reloadCount, 1);
});

test('theme remains usable when no account database is available', async () => {
    setupBrowserMocks();

    assert.equal(await saveThemePreference(null, '', 'light'), 'light');
    assert.equal(document.documentElement.dataset.theme, 'light');
    assert.equal(localStorage.getItem('manna-theme'), 'light');
});

test('theme defaults gracefully without browser globals', () => {
    const previousDocument = globalThis.document;
    const previousLocalStorage = globalThis.localStorage;
    const previousWindow = globalThis.window;

    delete globalThis.document;
    delete globalThis.localStorage;
    delete globalThis.window;

    try {
        assert.equal(getCurrentTheme(), 'dark');
        assert.equal(applyTheme('light'), 'light');
        assert.equal(getCurrentTheme(), 'dark');
    } finally {
        globalThis.document = previousDocument;
        globalThis.localStorage = previousLocalStorage;
        globalThis.window = previousWindow;
    }
});
