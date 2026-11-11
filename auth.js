import { initStorage } from './storage.js';
import { applyThemePreference } from './theme-utils.js';

const ADMIN_ONLY_EMAILS = new Set(['savieisaiah54@gmail.com']);

export function isAdminOnlyEmail(email = '') {
    return ADMIN_ONLY_EMAILS.has(String(email).trim().toLowerCase());
}

export function setupAuthRouter(options = {}) {
    const { onRoleResolved } = options;
    const { auth, db } = initStorage();
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const authMessage = document.getElementById('authMessage');
    const loginSubmitButton = loginForm?.querySelector('button[type="submit"]');
    const registerSubmitButton = registerForm?.querySelector('button[type="submit"]');
    const showRegisterButton = document.getElementById('showRegisterButton');
    const showLoginButton = document.getElementById('showLoginButton');
    const seedButton = document.getElementById('seedButton');
    const showResetButton = document.getElementById('showResetButton');
    const passwordResetForm = document.getElementById('passwordResetForm');
    const resetPasswordButton = document.getElementById('resetPasswordButton');

    if (!loginForm || !registerForm) return;

    const setMessage = (message, tone = 'info') => {
        if (!authMessage) return;
        authMessage.textContent = message;
        authMessage.className = `auth-message auth-message-${tone}`;
    };

    const redirect = (role) => {
        if (['admin', 'seller', 'customer', 'delivery_person'].includes(role)) {
            window.setTimeout(() => onRoleResolved?.(role), 500);
        }
    };

    const roleForUser = async (user) => {
        if (isAdminOnlyEmail(user.email)) return 'admin';
        const snapshot = await db.collection('users').doc(user.uid).get();
        if (snapshot.exists) {
            const profile = snapshot.data() || {};
            applyThemePreference(profile);
            return profile.role || 'customer';
        }
        const emailSnapshot = await db.collection('users').where('email', '==', user.email).limit(1).get();
        const profile = emailSnapshot.docs[0]?.data() || {};
        applyThemePreference(profile);
        return profile.role || 'customer';
    };

    showRegisterButton?.addEventListener('click', () => {
        loginForm.classList.add('hidden');
        registerForm.classList.remove('hidden');
        showRegisterButton.classList.add('hidden');
        showLoginButton?.classList.remove('hidden');
        passwordResetForm?.classList.add('hidden');
    });

    showLoginButton?.addEventListener('click', () => {
        registerForm.classList.add('hidden');
        loginForm.classList.remove('hidden');
        showRegisterButton.classList.remove('hidden');
        showLoginButton.classList.add('hidden');
        passwordResetForm?.classList.add('hidden');
    });

    showResetButton?.addEventListener('click', () => passwordResetForm?.classList.toggle('hidden'));

    loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const email = document.getElementById('loginEmail')?.value.trim();
        const password = document.getElementById('loginPassword')?.value;
        if (!email || !password) return setMessage('Please enter both email and password.', 'error');
        if (loginSubmitButton) loginSubmitButton.disabled = true;
        try {
            const result = await auth.signInWithEmailAndPassword(email, password);
            setMessage('Signed in successfully. Redirecting...', 'success');
            redirect(await roleForUser(result.user));
        } catch (error) {
            setMessage(error.message, 'error');
        } finally {
            if (loginSubmitButton) loginSubmitButton.disabled = false;
        }
    });

    registerForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const name = document.getElementById('registerName')?.value.trim();
        const email = document.getElementById('registerEmail')?.value.trim();
        const password = document.getElementById('registerPassword')?.value;
        const role = document.getElementById('registerRole')?.value || 'customer';
        if (!name || !email || !password) return setMessage('Please complete the registration form.', 'error');
        if (registerSubmitButton) registerSubmitButton.disabled = true;
        try {
            const result = await auth.createUserWithEmailAndPassword(email, password);
            await result.user.updateProfile({ displayName: name });
            await db.collection('users').doc(result.user.uid).set({ role, displayName: name, email }, { merge: true });
            setMessage('Account created. Redirecting...', 'success');
            redirect(role);
        } catch (error) {
            setMessage(error.message, 'error');
        } finally {
            if (registerSubmitButton) registerSubmitButton.disabled = false;
        }
    });

    resetPasswordButton?.addEventListener('click', () => setMessage('Password recovery is managed locally. Create a new account if you no longer know the password.', 'info'));
    document.getElementById('loginGoogleButton')?.addEventListener('click', () => setMessage('Google sign-in is unavailable in local mode.', 'info'));
    document.getElementById('registerGoogleButton')?.addEventListener('click', () => setMessage('Google sign-in is unavailable in local mode.', 'info'));
    document.querySelectorAll('[id*="Phone"]').forEach((button) => button.addEventListener('click', () => setMessage('Phone sign-in is unavailable in local mode.', 'info')));

    seedButton?.addEventListener('click', async () => {
        if (typeof window.seedDatabase === 'function') {
            await window.seedDatabase();
            setMessage('Demo data seeded locally.', 'success');
        }
    });

    auth.onAuthStateChanged((user) => {
        if (user) roleForUser(user).then(redirect);
    });
}
