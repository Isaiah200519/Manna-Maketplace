import { formatMaintenanceCountdown, getMaintenanceExpiryMs, isMaintenanceActive } from './maintenance-utils.mjs';

function createElement(documentRef, tagName, className, text) {
    const element = documentRef.createElement(tagName);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
}

function createMaintenanceScreen(documentRef) {
    const screen = createElement(documentRef, 'main', 'maintenance-screen');
    screen.id = 'maintenanceScreen';
    screen.hidden = true;
    screen.setAttribute('role', 'alertdialog');
    screen.setAttribute('aria-modal', 'true');
    screen.setAttribute('aria-labelledby', 'maintenanceTitle');
    screen.setAttribute('aria-describedby', 'maintenanceDescription');

    const card = createElement(documentRef, 'section', 'maintenance-card');
    const brand = createElement(documentRef, 'div', 'maintenance-brand');
    const logo = createElement(documentRef, 'img', 'maintenance-logo');
    logo.src = './images/logo/marketplace-logo.svg';
    logo.alt = 'Manna Marketplace';
    brand.appendChild(logo);
    brand.appendChild(createElement(documentRef, 'span', '', 'Manna Marketplace'));

    const status = createElement(documentRef, 'p', 'maintenance-status', 'Temporarily unavailable');
    const title = createElement(documentRef, 'h1', '', 'We’ll be back soon');
    title.id = 'maintenanceTitle';
    title.tabIndex = -1;

    const description = createElement(
        documentRef,
        'p',
        'maintenance-description',
        'We’re making improvements to Manna Marketplace. The marketplace is temporarily paused, and your account information remains safe. Please check back shortly.'
    );
    description.id = 'maintenanceDescription';

    const countdown = createElement(documentRef, 'p', 'maintenance-countdown');
    countdown.id = 'maintenanceCountdown';
    countdown.hidden = true;

    card.append(brand, status, title, description, countdown);
    screen.appendChild(card);
    return screen;
}

export function watchMaintenanceMode(db, documentRef = globalThis.document, runtime = {}) {
    if (!db || typeof db.collection !== 'function') {
        console.error('[Manna Marketplace] Maintenance mode could not start because the database is unavailable.');
        return () => {};
    }
    if (!documentRef?.body) {
        console.error('[Manna Marketplace] Maintenance mode could not start because the document is unavailable.');
        return () => {};
    }

    const screen = documentRef.getElementById('maintenanceScreen') || createMaintenanceScreen(documentRef);
    if (!screen.isConnected) documentRef.body.appendChild(screen);
    const previousInertValues = new Map();
    let active = false;
    let maintenanceSettings = {};
    let expiryTimer = null;
    const now = runtime.now || Date.now;
    const startInterval = runtime.setInterval || globalThis.setInterval;
    const stopInterval = runtime.clearInterval || globalThis.clearInterval;

    const updateCountdown = () => {
        const expiresAt = getMaintenanceExpiryMs(maintenanceSettings.maintenanceUntil);
        const countdown = documentRef.getElementById('maintenanceCountdown');
        if (!countdown) return;
        if (expiresAt === null) {
            countdown.hidden = true;
            countdown.textContent = '';
            return;
        }
        countdown.hidden = false;
        countdown.textContent = `Estimated time remaining: ${formatMaintenanceCountdown(expiresAt - now())}`;
    };

    const setActive = (enabled) => {
        if (enabled === active) {
            if (enabled) updateCountdown();
            return;
        }
        active = enabled;
        screen.hidden = !enabled;

        if (enabled) {
            Array.from(documentRef.body.children).forEach((element) => {
                if (element === screen) return;
                previousInertValues.set(element, element.inert);
                element.inert = true;
            });
            documentRef.getElementById('maintenanceTitle')?.focus();
            updateCountdown();
            if (getMaintenanceExpiryMs(maintenanceSettings.maintenanceUntil) !== null) {
                expiryTimer = startInterval(() => {
                    if (!isMaintenanceActive(maintenanceSettings, now())) {
                        setActive(false);
                        return;
                    }
                    updateCountdown();
                }, 1000);
            }
            return;
        }

        if (expiryTimer !== null) {
            stopInterval(expiryTimer);
            expiryTimer = null;
        }
        const countdown = documentRef.getElementById('maintenanceCountdown');
        if (countdown) {
            countdown.hidden = true;
            countdown.textContent = '';
        }
        previousInertValues.forEach((wasInert, element) => {
            element.inert = wasInert;
        });
        previousInertValues.clear();
    };

    const unsubscribe = db.collection('settings').doc('maintenance').onSnapshot((snapshot) => {
        maintenanceSettings = snapshot.exists ? snapshot.data() || {} : {};
        setActive(isMaintenanceActive(maintenanceSettings, now()));
    }, (error) => {
        console.error('[Manna Marketplace] Maintenance mode status listener failed.', error);
    });

    return () => {
        unsubscribe();
        setActive(false);
        screen.remove();
    };
}
