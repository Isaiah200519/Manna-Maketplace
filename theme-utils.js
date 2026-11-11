const THEME_STORAGE_KEY = 'manna-theme';
const VALID_THEMES = new Set(['dark', 'light']);

function getDocumentElement() {
    return typeof document !== 'undefined' && document?.documentElement ? document.documentElement : null;
}

export function getCurrentTheme() {
    try {
        if (typeof localStorage !== 'undefined') {
            const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
            if (VALID_THEMES.has(savedTheme)) return savedTheme;
        }
    } catch (error) {
        console.warn('[Manna Marketplace] Could not read the saved theme.', error);
    }

    const docElement = getDocumentElement();
    return docElement?.dataset?.theme === 'light' ? 'light' : 'dark';
}

export function applyTheme(theme) {
    const selectedTheme = VALID_THEMES.has(theme) ? theme : 'dark';
    const docElement = getDocumentElement();
    if (docElement) {
        docElement.dataset.theme = selectedTheme;
    }
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(THEME_STORAGE_KEY, selectedTheme);
        }
    } catch (error) {
        console.warn('[Manna Marketplace] Could not cache the selected theme.', error);
    }
    return selectedTheme;
}

export function applyThemePreference(profile) {
    const preference = profile?.themePreference;
    return applyTheme(VALID_THEMES.has(preference) ? preference : 'dark');
}

export function renderThemePreferenceControl() {
    const selectedTheme = getCurrentTheme();
    return `
        <label class="theme-preference-control">Color appearance
            <select data-theme-preference aria-label="Color appearance">
                <option value="dark" ${selectedTheme === 'dark' ? 'selected' : ''}>Dark</option>
                <option value="light" ${selectedTheme === 'light' ? 'selected' : ''}>Light</option>
            </select>
        </label>`;
}

export async function saveThemePreference(db, userId, theme) {
    const selectedTheme = applyTheme(theme);
    if (db && userId) {
        await db.collection('users').doc(userId).set({
            themePreference: selectedTheme,
            updatedAt: new Date()
        }, { merge: true });
    }
    return selectedTheme;
}

export function bindThemePreferenceControl(root, { db, userId, onSaved, onError } = {}) {
    const select = root?.querySelector('[data-theme-preference]');
    if (!select) return;
    select.value = getCurrentTheme();
    select.addEventListener('change', async () => {
        select.disabled = true;
        const selectedTheme = applyTheme(select.value);
        onSaved?.(selectedTheme);
        try {
            await saveThemePreference(db, userId, selectedTheme);
            if (typeof window !== 'undefined') window.location.reload();
        } catch (error) {
            onError?.(error);
        } finally {
            select.disabled = false;
        }
    });
}