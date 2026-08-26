import { setupAuthRouter } from './auth.js';

function resolvePanel(role) {
    const map = {
        admin: './admin.html',
        seller: './seller.html',
        customer: './customer.html',
        delivery_person: './delivery.html'
    };
    return map[role] || './customer.html';
}

const PWA_INSTALL_KEY = 'mannaInstallPromptDismissed';
let deferredPwaPrompt = null;

function isIos() {
    const userAgent = window.navigator.userAgent.toLowerCase();
    return /iphone|ipad|ipod/.test(userAgent) && !window.MSStream;
}

function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function createPwaInstallBanner() {
    const banner = document.createElement('div');
    banner.className = 'pwa-install-banner';
    banner.innerHTML = `
        <p>Install Manna Marketplace as an app for a better experience.</p>
        <div class="pwa-action-buttons">
            <button type="button" class="secondary-btn pwa-dismiss-button">Dismiss</button>
            <button type="button" class="primary-btn pwa-install-button">Install</button>
        </div>
    `;
    banner.querySelector('.pwa-install-button')?.addEventListener('click', async () => {
        if (!deferredPwaPrompt) return;
        deferredPwaPrompt.prompt();
        const choiceResult = await deferredPwaPrompt.userChoice;
        if (choiceResult.outcome === 'accepted') {
            localStorage.setItem(PWA_INSTALL_KEY, 'accepted');
        } else {
            localStorage.setItem(PWA_INSTALL_KEY, 'dismissed');
        }
        deferredPwaPrompt = null;
        banner.remove();
    });
    banner.querySelector('.pwa-dismiss-button')?.addEventListener('click', () => {
        localStorage.setItem(PWA_INSTALL_KEY, 'dismissed');
        banner.remove();
    });
    document.body.appendChild(banner);
}

function createIosInstallModal() {
    if (document.getElementById('pwaIosInstallModal')) return;
    const backdrop = document.createElement('div');
    backdrop.className = 'pwa-install-backdrop';
    backdrop.id = 'pwaIosInstallBackdrop';

    const modal = document.createElement('div');
    modal.className = 'pwa-install-modal';
    modal.id = 'pwaIosInstallModal';
    modal.innerHTML = `
        <div class="modal-card">
            <h3>Add Manna Marketplace to your home screen</h3>
            <p>Tap the Share button and select 'Add to Home Screen' to install Manna Marketplace as an app.</p>
            <div class="pwa-action-buttons">
                <button type="button" class="secondary-btn pwa-dismiss-button">Dismiss</button>
                <button type="button" class="ghost-btn pwa-howto-button">How to install</button>
            </div>
        </div>
    `;

    const dismissButton = modal.querySelector('.pwa-dismiss-button');
    dismissButton?.addEventListener('click', () => {
        localStorage.setItem(PWA_INSTALL_KEY, 'dismissed');
        backdrop.remove();
        modal.remove();
    });

    modal.querySelector('.pwa-howto-button')?.addEventListener('click', () => {
        window.alert("Open Safari, tap the Share icon, then choose \"Add to Home Screen\".");
    });

    document.body.appendChild(backdrop);
    document.body.appendChild(modal);
}

function tryShowIosPrompt() {
    if (!isIos() || isStandalone() || localStorage.getItem(PWA_INSTALL_KEY)) return;
    setTimeout(createIosInstallModal, 1200);
}

function tryShowInstallBanner() {
    if (!deferredPwaPrompt || localStorage.getItem(PWA_INSTALL_KEY) || isIos() || isStandalone()) return;
    setTimeout(createPwaInstallBanner, 1200);
}

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch((err) => {
            console.warn('[Manna Marketplace] Service worker registration failed:', err);
        });
    }
}

if (history.scrollRestoration) {
    history.scrollRestoration = 'manual';
}

window.addEventListener('load', () => {
    window.scrollTo(0, 0);
});

window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPwaPrompt = event;
    tryShowInstallBanner();
});

window.addEventListener('appinstalled', () => {
    localStorage.setItem(PWA_INSTALL_KEY, 'accepted');
    deferredPwaPrompt = null;
});

window.addEventListener('DOMContentLoaded', () => {
    registerServiceWorker();
    tryShowIosPrompt();
    setupAuthRouter({
        onRoleResolved: (role) => {
            const panelUrl = new URL(resolvePanel(role), window.location.href);
            panelUrl.search = window.location.search;
            panelUrl.hash = window.location.hash;
            window.location.replace(panelUrl.href);
        }
    });

    const toggleOtherRoles = document.getElementById('toggleOtherRoles');
    const otherRolesMenu = document.getElementById('otherRolesMenu');
    if (toggleOtherRoles && otherRolesMenu) {
        toggleOtherRoles.addEventListener('click', () => {
            otherRolesMenu.classList.toggle('hidden');
        });

        document.addEventListener('click', (event) => {
            if (!otherRolesMenu.contains(event.target) && !toggleOtherRoles.contains(event.target)) {
                otherRolesMenu.classList.add('hidden');
            }
        });
    }

});

window.addEventListener('popstate', () => {
    const currentPath = window.location.pathname.toLowerCase();
    if (currentPath.includes('customer.html') || currentPath.includes('seller.html') || currentPath.includes('admin.html') || currentPath.includes('delivery.html')) {
        window.scrollTo(0, 0);
    }
});
