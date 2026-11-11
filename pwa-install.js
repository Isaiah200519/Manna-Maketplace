(() => {
    const INSTALL_STATE_KEY = 'mannaInstallState';
    const DISMISS_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
    let deferredPwaPrompt = null;

    function isIos() {
        const userAgent = window.navigator.userAgent.toLowerCase();
        return /iphone|ipad|ipod/.test(userAgent) && !window.MSStream;
    }

    function isStandalone() {
        return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    }

    function hasAcceptedInstall() {
        return localStorage.getItem(INSTALL_STATE_KEY) === 'accepted';
    }

    function canShowInstallGuide() {
        if (isStandalone() || hasAcceptedInstall()) return false;
        const lastDismissed = Number(localStorage.getItem(INSTALL_STATE_KEY) || 0);
        return !lastDismissed || Date.now() - lastDismissed > DISMISS_RETRY_MS;
    }

    function markDismissed() {
        localStorage.setItem(INSTALL_STATE_KEY, String(Date.now()));
    }

    function markAccepted() {
        localStorage.setItem(INSTALL_STATE_KEY, 'accepted');
    }

    function createAndroidInstallBanner() {
        if (document.getElementById('pwaAndroidInstallBanner') || !canShowInstallGuide()) return;
        const banner = document.createElement('div');
        banner.className = 'pwa-install-banner';
        banner.id = 'pwaAndroidInstallBanner';
        banner.innerHTML = `
            <p>Add Manna Marketplace to your home screen for quick access.</p>
            <div class="pwa-action-buttons">
                <button type="button" class="secondary-btn pwa-dismiss-button">Later</button>
                <button type="button" class="primary-btn pwa-install-button">Add to home screen</button>
            </div>`;
        banner.querySelector('.pwa-install-button')?.addEventListener('click', async () => {
            if (!deferredPwaPrompt) return;
            deferredPwaPrompt.prompt();
            const choiceResult = await deferredPwaPrompt.userChoice;
            if (choiceResult.outcome === 'accepted') markAccepted();
            else markDismissed();
            deferredPwaPrompt = null;
            banner.remove();
        });
        banner.querySelector('.pwa-dismiss-button')?.addEventListener('click', () => {
            markDismissed();
            banner.remove();
        });
        document.body.appendChild(banner);
    }

    function createIosInstallModal() {
        if (document.getElementById('pwaIosInstallModal') || !canShowInstallGuide()) return;
        const backdrop = document.createElement('div');
        backdrop.className = 'pwa-install-backdrop';
        backdrop.id = 'pwaIosInstallBackdrop';
        const modal = document.createElement('div');
        modal.className = 'pwa-install-modal';
        modal.id = 'pwaIosInstallModal';
        modal.innerHTML = `
            <div class="modal-card">
                <h3>Add Manna Marketplace to your home screen</h3>
                <p>In Safari, tap the Share button, choose <strong>Add to Home Screen</strong>, then tap Add.</p>
                <div class="pwa-action-buttons">
                    <button type="button" class="secondary-btn pwa-dismiss-button">Later</button>
                    <button type="button" class="ghost-btn pwa-howto-button">Got it</button>
                </div>
            </div>`;
        const close = () => {
            markDismissed();
            backdrop.remove();
            modal.remove();
        };
        modal.querySelector('.pwa-dismiss-button')?.addEventListener('click', close);
        modal.querySelector('.pwa-howto-button')?.addEventListener('click', close);
        document.body.appendChild(backdrop);
        document.body.appendChild(modal);
    }

    function registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./sw.js').catch((error) => {
                console.warn('[Manna Marketplace] Service worker registration failed:', error);
            });
        }
    }

    window.addEventListener('beforeinstallprompt', (event) => {
        event.preventDefault();
        deferredPwaPrompt = event;
        window.setTimeout(createAndroidInstallBanner, 900);
    });

    window.addEventListener('appinstalled', () => {
        markAccepted();
        deferredPwaPrompt = null;
        document.getElementById('pwaAndroidInstallBanner')?.remove();
    });

    window.addEventListener('DOMContentLoaded', () => {
        registerServiceWorker();
        if (isIos()) window.setTimeout(createIosInstallModal, 1200);
    });
})();
