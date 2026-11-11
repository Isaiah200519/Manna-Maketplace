import { initStorage, clearStoredAuthState, serverTimestamp } from './storage.js';
import { formatCurrency, formatDate, createToast, escapeHtml, getAvatarHtml, getProductThumbnailUrl } from './utils.js';
import { getVariantDisplayEntries } from './category-variants.js';
import { getQRCardHTML, initQRCode, bindQRDownloadHandlers } from './qr-utils.js';
import { isAdminOnlyEmail } from './auth.js';
import { createRoleNotification } from './notification-utils.js';
import { bindSoundToggle, playSoundEffect, renderSoundToggle } from './sound-effects.js';
import { applyThemePreference, bindThemePreferenceControl, renderThemePreferenceControl } from './theme-utils.js';
import { watchMaintenanceMode } from './maintenance-mode.js';

let deliveryNotificationSnapshotReady = false;
const deliveryOrderSnapshots = { ready: new Map(), assigned: new Map() };

const state = {
    authUser: null,
    profile: null,
    sellers: [],
    deliveryRequests: [],
    deliveryPartnerRequests: [],
    allOrders: [],
    notifications: [],
    supportRequests: [],
    chatMessages: [],
    helpArticles: [],
    payoutPreferences: {},
    financialPayouts: [],
    selectedOrder: null,
    activeSection: 'dashboard',
    pendingClaimOrderIds: new Set(),
    loading: false,
    profileUnsubscribe: null,
    sellersUnsubscribe: null,
    deliveryRequestsUnsubscribe: null,
    deliveryPartnerRequestsUnsubscribe: null,
    readyOrdersUnsubscribe: null,
    assignedOrdersUnsubscribe: null,
    notificationsUnsubscribe: null,
    chatsUnsubscribe: null
    ,walletUnsubscribes: []
};

const elements = {
    authScreen: document.getElementById('authScreen'),
    appShell: document.getElementById('appShell'),
    loginForm: document.getElementById('loginForm'),
    registerForm: document.getElementById('registerForm'),
    authMessage: document.getElementById('authMessage'),
    showRegisterButton: document.getElementById('showRegisterButton'),
    showLoginButton: document.getElementById('showLoginButton'),
    forgotPasswordButton: document.getElementById('forgotPasswordButton'),
    logoutButton: document.getElementById('logoutButton'),
    refreshButton: document.getElementById('refreshButton'),
    saveProfileButton: document.getElementById('saveProfileButton'),
    supportButton: document.getElementById('supportButton'),
    notificationBell: document.getElementById('notificationBell'),
    notificationDropdown: document.getElementById('notificationDropdown'),
    notificationCount: document.getElementById('notificationCount'),
    mobileNavToggle: document.getElementById('mobileNavToggle'),
    mobileNavSheet: document.getElementById('mobileNavSheet'),
    mobileNavClose: document.getElementById('mobileNavClose'),
    mobileMenuButton: document.getElementById('mobileMenuButton'),
    sidebarToggle: document.getElementById('sidebarToggle'),
    sidebar: document.getElementById('sidebar'),
    sidebarBackdrop: document.getElementById('sidebarBackdrop'),
    sidebarClose: document.getElementById('sidebarClose'),
    pageTitle: document.getElementById('pageTitle'),
    pageSubtitle: document.getElementById('pageSubtitle'),
    pageHeading: document.getElementById('pageHeading'),
    pageBreadcrumb: document.getElementById('pageBreadcrumb'),
    modalBackdrop: document.getElementById('modalBackdrop'),
    modalTitle: document.getElementById('modalTitle'),
    modalBody: document.getElementById('modalBody'),
    modalClose: document.getElementById('modalClose'),
    loadingOverlay: document.getElementById('loadingOverlay')
};

let storage = null;
let db = null;
let auth = null;
let authBootstrapTimer = null;
let payoutListenerUnsubscribe = null;

function clearAuthBootstrapTimer() {
    if (authBootstrapTimer) {
        clearTimeout(authBootstrapTimer);
        authBootstrapTimer = null;
    }
}

function scheduleAuthFallback() {
    clearAuthBootstrapTimer();
    authBootstrapTimer = window.setTimeout(() => {
        authBootstrapTimer = null;
        if (!state.authUser && !auth?.currentUser) {
            elements.authScreen.classList.remove('hidden');
            elements.appShell.classList.add('hidden');
        }
    }, 900);
}

function init() {
    bindEvents();
    ensureDeliveryWalletSection();
    const storageApi = initStorage();
    storage = storageApi;
    auth = storageApi.auth;
    db = storageApi.db;
    watchMaintenanceMode(db);
    if (auth) {
        auth.setPersistence().catch(() => { });
    }
    if (!auth || !db) {
        createToast('local storage is not ready. Please refresh the page.', 'error');
        return;
    }
    auth.onAuthStateChanged(handleAuthStateChange);
}

function ensureDeliveryWalletSection() {
    if (document.getElementById('earningsSection')) return;
    const nav = document.querySelector('.nav-links');
    const button = document.createElement('button');
    button.className = 'nav-item';
    button.dataset.section = 'earnings';
    button.innerHTML = '<span class="nav-icon">$</span><span>Earnings</span>';
    button.addEventListener('click', () => showSection('earnings'));
    nav?.appendChild(button);
    const section = document.createElement('section');
    section.id = 'earningsSection';
    section.className = 'section-panel';
    section.innerHTML = `<div class="panel-card"><div class="panel-card-header"><h3>Earnings</h3><span class="badge">Delivery balance</span></div><div class="wallet-balance-card"><div class="wbc-label">Available earnings</div><div class="wbc-amount" id="deliveryBalanceAmount">L$0.00</div><div class="wbc-actions"><button class="ghost-btn" id="deliveryWithdrawButton" type="button">Withdraw</button></div></div><div class="wallet-summary-grid"><div class="summary-item"><div class="summary-label">Total Earnings</div><div class="summary-amount" id="deliveryTotalEarnings">L$0.00</div></div><div class="summary-item"><div class="summary-label">Total Withdrawn</div><div class="summary-amount" id="deliveryTotalWithdrawn">L$0.00</div></div><div class="summary-item"><div class="summary-label">Pending Balance</div><div class="summary-amount" id="deliveryPendingBalance">L$0.00</div></div></div><form class="wallet-form-card hidden" id="deliveryWithdrawForm"><h4>Request withdrawal</h4><p class="muted">Your balance will be deducted immediately and held until your request is processed.</p><label>Amount (LRD)<input name="amount" type="number" min="1" required /></label><label>Recipient name<input name="recipientName" required /></label><label>Mobile money number<input name="recipientPhone" type="tel" required /></label><div class="wfc-actions"><button class="primary-btn" type="submit">Request withdrawal</button><button class="ghost-btn" id="cancelDeliveryWithdraw" type="button">Cancel</button></div></form><div class="wallet-section-block"><h4>Withdrawal requests</h4><div id="deliveryWithdrawalsList"></div></div><div class="wallet-section-block"><h4>Earnings history</h4><div id="deliveryTransactionsList"></div></div></div>`;
    document.querySelector('.main-panel')?.appendChild(section);
    document.getElementById('deliveryWithdrawButton')?.addEventListener('click', () => document.getElementById('deliveryWithdrawForm')?.classList.remove('hidden'));
    document.getElementById('cancelDeliveryWithdraw')?.addEventListener('click', () => document.getElementById('deliveryWithdrawForm')?.classList.add('hidden'));
    document.getElementById('deliveryWithdrawForm')?.addEventListener('submit', (event) => {
        event.preventDefault();
        const button = event.currentTarget.querySelector('button[type="submit"]');
        const data = Object.fromEntries(new FormData(event.currentTarget));
        withButtonState(button, async () => { await submitWithdrawalRequest(state.authUser.uid, 'delivery', state.profile?.displayName || state.profile?.email, data.amount, data.recipientName, data.recipientPhone); event.currentTarget.reset(); event.currentTarget.classList.add('hidden'); }, { loadingText: 'Submitting...', successText: 'Request placed', permanent: false });
    });
}

async function initDeliveryWallet() {
    ensureDeliveryWalletSection();
    const userId = state.authUser.uid;
    await autoReceiveOldWithdrawals(userId);
    state.walletUnsubscribes.forEach((unsubscribe) => unsubscribe());
    state.walletUnsubscribes = [
        db.collection('users').doc(userId).onSnapshot((snapshot) => { const balance = Number(snapshot.data()?.balance || 0); const element = document.getElementById('deliveryBalanceAmount'); if (element) element.textContent = formatLRD(balance); }),
        db.collection('withdrawalRequests').where('userId', '==', userId).orderBy('createdAt', 'desc').onSnapshot((snapshot) => renderDeliveryWalletRequests(snapshot.docs))
    ];
    
    // Load and display transaction statistics
    const transactions = await loadTransactionHistory(userId);
    const container = document.getElementById('deliveryTransactionsList');
    if (container) container.innerHTML = transactions.length ? transactions.map((transaction) => `<div class="wallet-tx-row"><span>${escapeHtml(transaction.description || transaction.type)}</span><strong class="${transaction.amount >= 0 ? 'amount-credit' : 'amount-debit'}">${transaction.amount >= 0 ? '+' : '-'}${formatLRD(Math.abs(transaction.amount))}</strong></div>`).join('') : '<div class="empty-state">No earnings yet.</div>';
    
    // Calculate wallet summary statistics - only for earnings (no deposits for delivery)
    const earningTransactions = transactions.filter((t) => t.type === 'order_earning' && t.amount > 0);
    const withdrawalTransactions = transactions.filter((t) => t.type === 'withdrawal' && t.amount < 0);
    const totalEarnings = earningTransactions.reduce((sum, t) => sum + Number(t.amount || 0), 0);
    const totalWithdrawn = Math.abs(withdrawalTransactions.reduce((sum, t) => sum + Number(t.amount || 0), 0));
    
    // Get pending withdrawals
    const withdrawalsSnapshot = await db.collection('withdrawalRequests').where('userId', '==', userId).orderBy('createdAt', 'desc').get();
    const pendingBalance = withdrawalsSnapshot.docs.filter((doc) => doc.data().status === 'pending').reduce((sum, doc) => sum + Number(doc.data().amount || 0), 0);
    
    // Update summary displays
    const summaryElements = {
        'deliveryTotalEarnings': totalEarnings,
        'deliveryTotalWithdrawn': totalWithdrawn,
        'deliveryPendingBalance': pendingBalance
    };
    
    Object.entries(summaryElements).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = formatLRD(value);
    });
}

function renderDeliveryWalletRequests(docs) {
    const container = document.getElementById('deliveryWithdrawalsList');
    if (!container) return;
    container.innerHTML = docs.length ? docs.map((doc) => { const item = doc.data(); return `<div class="wallet-tx-row"><span>${formatLRD(item.amount)} to ${escapeHtml(item.recipientPhone)}</span><span class="status-badge status-${escapeHtml(item.status)}">${escapeHtml(item.status)}</span>${item.status === 'paid' ? `<button class="ghost-btn wallet-confirm-received" data-id="${doc.id}" type="button">Confirm received</button>` : ''}</div>`; }).join('') : '<div class="empty-state">No withdrawal requests yet.</div>';
    container.querySelectorAll('.wallet-confirm-received').forEach((button) => button.addEventListener('click', () => withButtonState(button, () => db.collection('withdrawalRequests').doc(button.dataset.id).update({ status: 'received', receivedAt: new Date() }), { loadingText: 'Confirming...', successText: 'Received', permanent: true })));
}

function bindEvents() {
    elements.loginForm.addEventListener('submit', handleLogin);
    elements.registerForm.addEventListener('submit', handleRegister);
    elements.showRegisterButton.addEventListener('click', () => toggleAuthMode(true));
    elements.forgotPasswordButton.addEventListener('click', handleForgotPassword);
    elements.showLoginButton.addEventListener('click', () => toggleAuthMode(false));
    elements.forgotPasswordButton.addEventListener('click', handleForgotPassword);
    elements.logoutButton.addEventListener('click', handleLogout);
    elements.refreshButton.addEventListener('click', () => refreshData());
    if (elements.saveProfileButton) {
        elements.saveProfileButton.addEventListener('click', (event) => {
            event.preventDefault();
            saveProfile();
        });
    }
    elements.notificationBell.addEventListener('click', () => {
        showSection('notifications');
        setMobileNavOpen(false);
    });
    elements.supportButton?.addEventListener('click', () => showSection('help'));
    if (elements.mobileNavToggle) {
        const openMobileMenu = (event) => {
            if (event) {
                event.preventDefault();
                event.stopPropagation();
            }
            setMobileNavOpen(true);
        };
        elements.mobileNavToggle.addEventListener('click', openMobileMenu);
    }
    if (elements.mobileNavClose) {
        elements.mobileNavClose.addEventListener('click', (event) => {
            event.stopPropagation();
            setMobileNavOpen(false);
        });
    }
    if (elements.sidebarClose) {
        elements.sidebarClose.addEventListener('click', () => setMobileNavOpen(false));
    }
    if (elements.sidebarBackdrop) {
        elements.sidebarBackdrop.addEventListener('click', () => setMobileNavOpen(false));
    }
    if (elements.mobileMenuButton) {
        elements.mobileMenuButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            setMobileNavOpen(true);
        });
    }
    if (elements.sidebarToggle) {
        elements.sidebarToggle.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            setMobileNavOpen(true);
        });
    }
    if (elements.mobileNavSheet) {
        elements.mobileNavSheet.addEventListener('click', (event) => {
            if (event.target === elements.mobileNavSheet) {
                setMobileNavOpen(false);
            }
        });
    }
    // sync desktop nav into mobile menu
    (function syncMobileNavItems() {
        const mobileList = document.querySelector('.mobile-nav-list');
        if (!mobileList) return;
        const desktopItems = Array.from(document.querySelectorAll('.nav-item[data-section]')).filter(i => !i.closest('.mobile-nav-list'));
        desktopItems.forEach(item => {
            const section = item.getAttribute('data-section');
            if (!section) return;
            if (mobileList.querySelector(`.mobile-nav-item[data-section="${section}"]`)) return;
            const mobileBtn = document.createElement('button');
            mobileBtn.className = 'nav-item mobile-nav-item';
            mobileBtn.setAttribute('data-section', section);
            const icon = item.querySelector('.nav-icon')?.innerHTML || '';
            const label = item.textContent.trim() || section;
            mobileBtn.innerHTML = `<span class="nav-icon">${icon}</span><span>${label}</span>`;
            mobileList.appendChild(mobileBtn);
        });
        mobileList.addEventListener('click', (e) => {
            const btn = e.target.closest('.mobile-nav-item');
            if (!btn) return;
            const section = btn.getAttribute('data-section');
            if (section) {
                showSection(section);
                setMobileNavOpen(false);
            }
        });
        // dedupe mobile entries (keep first occurrence)
        const seen = new Set();
        Array.from(mobileList.querySelectorAll('.mobile-nav-item')).forEach((el) => {
            const s = el.getAttribute('data-section');
            if (!s) return;
            if (seen.has(s)) el.remove(); else seen.add(s);
        });
    })();

    // notification badge behavior
    (function () {
        const badge = document.getElementById('notificationCount') || document.getElementById('notificationBadge');
        if (!badge) return;
        const getCount = () => (state.notifications || state.data?.notifications || []).filter(n => !n.read).length;
        const count = getCount();
        badge.textContent = count || '';
        badge.style.display = count ? 'inline-flex' : 'none';
        const toggle = document.getElementById('notificationsToggle');
        if (toggle) {
            toggle.addEventListener('click', () => {
                (state.notifications || state.data?.notifications || []).forEach(n => n.read = true);
                badge.textContent = '';
                badge.style.display = 'none';
                showSection && showSection('notifications');
            });
        }
    })();
    document.getElementById('mobileLogoutButton')?.addEventListener('click', handleLogout);
    document.querySelectorAll('.nav-item[data-section], .mobile-nav-item[data-section]').forEach((button) => {
        button.addEventListener('click', () => showSection(button.dataset.section));
    });
    elements.modalClose.addEventListener('click', closeModal);
    elements.modalBackdrop.addEventListener('click', (event) => {
        if (event.target === elements.modalBackdrop) closeModal();
    });
    window.addEventListener('keydown', handleModalEscape);

    const onboardingOverlay = document.getElementById('onboardingOverlay');
    const closeOnboarding = document.getElementById('closeOnboarding');
    if (closeOnboarding) {
        closeOnboarding.addEventListener('click', () => {
            if (onboardingOverlay) {
                onboardingOverlay.classList.add('hidden');
                onboardingOverlay.setAttribute('aria-hidden', 'true');
            }
            localStorage.setItem('manna-onboarding-seen-delivery', 'true');
        });
    }
    if (onboardingOverlay && !localStorage.getItem('manna-onboarding-seen-delivery')) {
        onboardingOverlay.classList.remove('hidden');
        onboardingOverlay.setAttribute('aria-hidden', 'false');
    }

    document.addEventListener('click', (event) => {
        if (event.target.closest('#mobileMenuButton')) {
            event.preventDefault();
            event.stopPropagation();
            setMobileNavOpen(true);
            return;
        }
        const sectionButton = event.target.closest('[data-section]');
        if (sectionButton && !sectionButton.closest('.nav-item') && !sectionButton.closest('.mobile-nav-item')) {
            const section = sectionButton.dataset.section;
            if (section) showSection(section);
        }

        const actionButton = event.target.closest('[data-action]');
        if (actionButton) {
            const action = actionButton.dataset.action;
            if (action === 'respond-delivery-invitation') {
                handleAction(action, actionButton.dataset.id, actionButton.dataset.response);
                return;
            }
            const options = {
                'pick-up-order': {
                    loadingText: 'Picking Up...',
                    successText: 'Picked Up ✓',
                    permanent: true
                },
                'deliver-order': {
                    loadingText: 'Confirming Delivery...',
                    successText: 'Delivered ✓',
                    permanent: true
                }
            }[action];
            if (options && window.withButtonState) {
                withButtonState(actionButton, async () => {
                    const result = await handleAction(action, actionButton.dataset.id);
                    if (result === false) throw new Error('Unable to complete this delivery action.');
                    return result;
                }, options).catch(() => { });
            } else {
                handleAction(action, actionButton.dataset.id);
            }
        }
    });
}

function setMobileNavOpen(isOpen) {
    const isMobile = window.innerWidth <= 767;

    if (elements.mobileNavSheet) {
        elements.mobileNavSheet.classList.toggle('open', false);
        elements.mobileNavSheet.setAttribute('aria-hidden', 'true');
    }

    if (elements.sidebar) {
        elements.sidebar.classList.toggle('open', isMobile && isOpen);
    }

    if (elements.sidebarBackdrop) {
        elements.sidebarBackdrop.classList.toggle('open', isMobile && isOpen);
    }

    document.body.style.overflow = isMobile && isOpen ? 'hidden' : '';
}

function setActiveNavigation(section) {
    document.querySelectorAll('.nav-item[data-section], .mobile-nav-item[data-section]').forEach((button) => {
        button.classList.toggle('active', button.getAttribute('data-section') === section);
    });
}

function toggleAuthMode(showRegister) {
    elements.loginForm.classList.toggle('hidden', showRegister);
    elements.registerForm.classList.toggle('hidden', !showRegister);
    elements.authMessage.textContent = '';
}

function resolvePasswordResetEmail(fallbackEmail = '') {
    const profileEmail = state.profile?.email || state.authUser?.email || '';
    if (profileEmail) return profileEmail;
    const loginEmail = document.getElementById('loginEmail')?.value?.trim() || '';
    return loginEmail || fallbackEmail;
}

function setLoading(isLoading) {
    state.loading = isLoading;
    elements.loadingOverlay.classList.toggle('hidden', !isLoading);
}

async function handleLogin(event) {
    event.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    setLoading(true);
    try {
        await auth.signInWithEmailAndPassword(email, password);
    } catch (error) {
        elements.authMessage.textContent = error.message;
        createToast(error.message, 'error');
    } finally {
        setLoading(false);
    }
}

async function handleRegister(event) {
    event.preventDefault();
    const name = document.getElementById('registerName').value.trim();
    const phone = document.getElementById('registerPhone').value.trim();
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;
    const confirmPassword = document.getElementById('registerConfirmPassword').value;
    const vehicleType = document.getElementById('registerVehicleType').value;
    if (!name || !phone || !email || !password || password !== confirmPassword) {
        elements.authMessage.textContent = 'Please complete all fields and make sure passwords match.';
        return;
    }
    setLoading(true);
    try {
        const result = await auth.createUserWithEmailAndPassword(email, password);
        const user = result.user;
        await user.updateProfile({ displayName: name });
        await db.collection('users').doc(user.uid).set({
            uid: user.uid,
            displayName: name,
            phone,
            email,
            role: 'delivery_person',
            vehicleType,
            vehiclePlate: '',
            isActive: true,
            rating: 4.9,
            totalDeliveries: 0,
            totalEarnings: 0,
            balance: 0,
            approvedSellers: [],
            createdAt: new Date(),
            updatedAt: new Date()
        });
        toggleAuthMode(false);
        createToast('Delivery account created. Welcome to Manna Marketplace.', 'success');
    } catch (error) {
        elements.authMessage.textContent = error.message;
        createToast(error.message, 'error');
    } finally {
        setLoading(false);
    }
}

async function handleForgotPassword() {
    const email = resolvePasswordResetEmail();
    if (!email) {
        const enteredEmail = prompt('Enter the email linked to your account');
        if (!enteredEmail) return;
        const targetEmail = enteredEmail.trim();
        if (!targetEmail) return;
        try {
            await auth.sendPasswordResetEmail(targetEmail);
            createToast('Password reset email sent.', 'success');
        } catch (error) {
            createToast(error.message, 'error');
        }
        return;
    }
    try {
        await auth.sendPasswordResetEmail(email);
        createToast('Password reset email sent.', 'success');
    } catch (error) {
        createToast(error.message, 'error');
    }
}

async function handleLogout() {
    clearAuthBootstrapTimer();
    try {
        await auth.signOut();
    } catch (error) {
        console.warn('[Manna Marketplace] Logout warning:', error);
    } finally {
        clearStoredAuthState();
        cleanupListeners();
        state.profile = null;
        state.sellers = [];
        state.allOrders = [];
        state.notifications = [];
        elements.authScreen.classList.remove('hidden');
        elements.appShell.classList.add('hidden');
    }
}

async function handleAuthStateChange(user) {
    if (!user) {
        if (state.authUser) {
            clearAuthBootstrapTimer();
            cleanupListeners();
            state.authUser = null;
            state.profile = null;
            elements.authScreen.classList.remove('hidden');
            elements.appShell.classList.add('hidden');
            return;
        }
        scheduleAuthFallback();
        return;
    }
    clearAuthBootstrapTimer();
    setLoading(true);
    try {
        const userDocRef = db.collection('users').doc(user.uid);
        const userDoc = await userDocRef.get();
        if (!userDoc.exists) {
            await userDocRef.set({
                uid: user.uid,
                displayName: user.displayName || user.email,
                email: user.email,
                phone: '',
                role: 'delivery_person',
                vehicleType: 'Motorcycle',
                vehiclePlate: '',
                isActive: true,
                rating: 4.9,
                totalDeliveries: 0,
                totalEarnings: 0,
                approvedSellers: [],
                createdAt: new Date(),
                updatedAt: new Date()
            });
        }
        const profile = userDoc.exists ? userDoc.data() : { role: 'delivery_person' };
        const role = profile?.role || 'delivery_person';
        if (isAdminOnlyEmail(user.email) || role !== 'delivery_person') {
            elements.authMessage.textContent = 'This account is not authorized for the delivery panel.';
            elements.authScreen.classList.remove('hidden');
            elements.appShell.classList.add('hidden');
            createToast('Please use the correct panel for this account.', 'warning');
            return;
        }
        state.authUser = user;
        state.profile = profile;
        applyThemePreference(profile);
        elements.authScreen.classList.add('hidden');
        elements.appShell.classList.remove('hidden');
        showSection(state.activeSection);
        setupRealtimeListeners(user.uid);
        renderAll();
        await initDeliveryWallet();
    } catch (error) {
        console.error(error);
        createToast(error.message || 'Unable to load the delivery dashboard.', 'error');
    } finally {
        setLoading(false);
    }
}

function setupRealtimeListeners(userId) {
    cleanupListeners();
    state.profileUnsubscribe = db.collection('users').doc(userId).onSnapshot((doc) => {
        state.profile = doc.data() || {};
        applyThemePreference(state.profile);
        renderProfile();
        renderSettings();
        renderDashboard();
    }, (error) => {
        console.error('[Manna Marketplace] Delivery profile listener failed:', error);
    });

    state.sellersUnsubscribe = db.collection('sellers').onSnapshot((snapshot) => {
        state.sellers = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        renderSellers();
        renderDashboard();
    }, (error) => {
        console.error('[Manna Marketplace] Delivery sellers listener failed:', error);
    });

    state.deliveryRequestsUnsubscribe = db.collection('deliveryRequests').where('deliveryPersonUid', '==', userId).onSnapshot((snapshot) => {
        state.deliveryRequests = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        renderSellers();
        renderDashboard();
        renderPartnerRequests();
    }, (error) => {
        console.error('[Manna Marketplace] Delivery requests listener failed:', error);
    });
    state.deliveryPartnerRequestsUnsubscribe = db.collection('deliveryPartnerRequests').where('deliveryPersonUid', '==', userId).onSnapshot((snapshot) => {
        state.deliveryPartnerRequests = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        renderSellers();
        renderPartnerRequests();
    }, (error) => {
        console.error('[Manna Marketplace] Delivery partner invitations listener failed:', error);
    });

    state.readyOrdersUnsubscribe = db.collection('orders').where('status', '==', 'ready').onSnapshot((snapshot) => {
        updateDeliveryOrderSnapshot('ready', snapshot);
    }, (error) => {
        console.error('[Manna Marketplace] Ready delivery orders listener failed:', error);
    });
    state.assignedOrdersUnsubscribe = db.collection('orders').where('deliveryPersonUid', '==', userId).onSnapshot((snapshot) => {
        updateDeliveryOrderSnapshot('assigned', snapshot);
    }, (error) => {
        console.error('[Manna Marketplace] Assigned delivery orders listener failed:', error);
    });

    state.notificationsUnsubscribe = db.collection('notifications').where('recipientUid', '==', userId).orderBy('createdAt', 'desc').onSnapshot({ includeMetadataChanges: true }, (snapshot) => {
        const notifications = snapshot.docs
            .map((doc) => ({ id: doc.id, ...doc.data() }))
            .filter((item) => !item.recipientRole || item.recipientRole === 'delivery_person');
        if (deliveryNotificationSnapshotReady && !snapshot.metadata.fromCache) {
            const existingIds = new Set(state.notifications.map((item) => item.id));
            if (notifications.some((item) => !item.read && !item.isDeleted && !existingIds.has(item.id))) {
                playSoundEffect('notification');
            }
        }
        state.notifications = notifications;
        if (!snapshot.metadata.fromCache) deliveryNotificationSnapshotReady = true;
        renderNotifications();
        renderHeaderNotifications();
    }, (error) => {
        console.error('[Manna Marketplace] Delivery notifications listener failed:', error);
    });

    db.collection('helpArticles').where('targetRoles', 'array-contains', 'delivery').onSnapshot((snapshot) => {
        state.helpArticles = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        renderHelpArticles();
    }, (error) => {
        console.error('[Manna Marketplace] Delivery help articles listener failed:', error);
    });
}

function updateDeliveryOrderSnapshot(source, snapshot) {
    deliveryOrderSnapshots[source] = new Map(snapshot.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() }]));
    const combinedOrders = new Map(deliveryOrderSnapshots.ready);
    deliveryOrderSnapshots.assigned.forEach((order, id) => combinedOrders.set(id, order));
    state.allOrders = [...combinedOrders.values()];
    renderAllLists();
}

function cleanupListeners() {
    deliveryNotificationSnapshotReady = false;
    state.notifications = [];
    [state.profileUnsubscribe, state.sellersUnsubscribe, state.deliveryRequestsUnsubscribe, state.deliveryPartnerRequestsUnsubscribe, state.readyOrdersUnsubscribe, state.assignedOrdersUnsubscribe, state.notificationsUnsubscribe, state.chatsUnsubscribe].forEach((unsubscribe) => { if (unsubscribe) unsubscribe(); });
    deliveryOrderSnapshots.ready.clear();
    deliveryOrderSnapshots.assigned.clear();
    state.profileUnsubscribe = null;
    state.sellersUnsubscribe = null;
    state.deliveryRequestsUnsubscribe = null;
    state.deliveryPartnerRequestsUnsubscribe = null;
    state.readyOrdersUnsubscribe = null;
    state.assignedOrdersUnsubscribe = null;
    state.notificationsUnsubscribe = null;
    state.chatsUnsubscribe = null;
}

function renderAll() {
    renderDashboard();
    renderAvailableOrders();
    renderActiveDeliveries();
    renderHistory();
    renderSellers();
    renderPartnerRequests();
    renderHelpArticles();
    renderProfile();
    renderSettings();
    renderNotifications();
    renderHeaderNotifications();
}

function renderAllLists() {
    renderAvailableOrders();
    renderActiveDeliveries();
    renderHistory();
    renderSellers();
    renderNotifications();
    renderDashboard();
}

function isOrderAvailableForDelivery(order, approvedSellerIds) {
    const isSignupReward = order.orderType === 'signup_blind_box';
    const sellerIsApprovedForDriver = isSignupReward
        ? state.profile?.status === 'approved'
        : approvedSellerIds.includes(order.sellerId);
    return !order.isDeleted
        && !isDeliveryDeadlineExpired(order)
        && order.paymentStatus === 'confirmed'
        && sellerIsApprovedForDriver
        && order.status === 'ready'
        && !order.deliveryPersonUid;
}

function renderDashboard() {
    const approvedSellerIds = state.profile?.approvedSellers || [];
    const available = state.profile?.isActive === false ? [] : state.allOrders.filter((order) => isOrderAvailableForDelivery(order, approvedSellerIds));
    const active = state.allOrders.filter((order) => !order.isDeleted && order.deliveryPersonUid === state.authUser?.uid && order.status === 'out_for_delivery');
    const history = state.allOrders.filter((order) => !order.isDeleted && order.deliveryPersonUid === state.authUser?.uid && ['delivered', 'received'].includes(order.status));
    const today = history.filter((order) => {
        const updated = order.updatedAt?.toDate ? order.updatedAt.toDate() : new Date(order.updatedAt || Date.now());
        const todayDate = new Date();
        return updated.toDateString() === todayDate.toDateString();
    });

    document.getElementById('statAvailable').textContent = available.length;
    document.getElementById('statActive').textContent = active.length;
    document.getElementById('statToday').textContent = today.length;
    document.getElementById('statRating').textContent = Number(state.profile?.rating || 0).toFixed(1);

    const recent = [...history].sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0)).slice(0, 5);
    document.getElementById('recentActivityList').innerHTML = recent.length ? recent.map((order) => `
    <div class="item-card">
      <div class="panel-card-header"><strong>#${order.orderNumber || order.id.slice(0, 6)}</strong><span class="badge">${order.status}</span></div>
      <div class="muted">${order.sellerName || 'Seller'} • ${formatDate(order.updatedAt || order.createdAt)}</div>
    </div>`).join('') : '<div class="empty-state">No completed deliveries yet.</div>';

    const mySellers = state.sellers.filter((seller) => approvedSellerIds.includes(seller.id));
    document.getElementById('mySellersList').innerHTML = mySellers.length ? mySellers.map((seller) => `
    <div class="item-card">
      <div class="panel-card-header"><strong>${seller.name}</strong><span class="badge">Approved</span></div>
      <div class="muted">${seller.location || 'Location unavailable'}</div>
      <div class="action-row">
        <button class="danger-btn" data-action="leave-seller" data-id="${seller.id}">Leave</button>
      </div>
    </div>`).join('') : '<div class="empty-state">You have not been approved by any seller yet.</div>';
}

function getDeliveryLocationMeta(order) {
    const latitude = Number(order.deliveryLat ?? order.coordinates?.latitude ?? order.deliveryLocation?.latitude ?? order.lat ?? order.latitude ?? null);
    const longitude = Number(order.deliveryLng ?? order.coordinates?.longitude ?? order.deliveryLocation?.longitude ?? order.lng ?? order.longitude ?? null);
    const address = order.address || order.deliveryLocation?.address || order.deliveryDetails || order.deliveryLandmark || '';
    const label = order.deliveryLocationLabel || order.deliveryLandmark || order.deliveryDetails || address || 'Delivery address';
    const mapsUrl = Number.isFinite(latitude) && Number.isFinite(longitude)
        ? `https://www.google.com/maps?q=${latitude},${longitude}&z=16`
        : `https://www.google.com/maps?q=${encodeURIComponent(address || label)}`;
    return { latitude, longitude, address, label, mapsUrl };
}

function getDeliveryDeadline(order) {
    if (!order?.deliveryDeadlineAt) return null;
    const deadline = order.deliveryDeadlineAt.toDate ? order.deliveryDeadlineAt.toDate() : new Date(order.deliveryDeadlineAt);
    return Number.isNaN(deadline.getTime()) ? null : deadline;
}

function isDeliveryDeadlineExpired(order) {
    const deadline = getDeliveryDeadline(order);
    return Boolean(deadline && deadline.getTime() <= Date.now());
}

function renderDeliveryLocationMap(order) {
    const { latitude, longitude, label, mapsUrl } = getDeliveryLocationMeta(order);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return '';
    }
    return `
      <div class="delivery-map-card">
        <div class="map-hint">Google Maps • Live directions</div>
        <iframe
          title="Delivery location map"
          loading="lazy"
          referrerpolicy="no-referrer-when-downgrade"
          src="https://www.google.com/maps?q=${latitude},${longitude}&z=15&output=embed"
        ></iframe>
        <div class="muted" style="font-size: 12px;">${label}</div>
        <div class="action-row">
          <a class="primary-btn" href="${mapsUrl}" target="_blank" rel="noopener noreferrer">Open in Google Maps</a>
        </div>
      </div>`;
}

function renderDeliveryOrderVariantDetails(order) {
    return (Array.isArray(order.items) ? order.items : []).map((item) => {
        const variants = getVariantDisplayEntries(item);
        return variants.length ? `<div class="muted">${escapeHtml(item.name || 'Item')}: ${variants.map((variant) => `${escapeHtml(variant.label)} ${escapeHtml(variant.value)}`).join(' • ')}</div>` : '';
    }).join('');
}

function renderAvailableOrders() {
    const approvedSellerIds = state.profile?.approvedSellers || [];
    const available = state.profile?.isActive === false ? [] : state.allOrders.filter((order) => isOrderAvailableForDelivery(order, approvedSellerIds));
    const availableOrdersList = document.getElementById('availableOrdersList');
    availableOrdersList.innerHTML = available.length ? available.map((order, index) => {
        const isClaiming = state.pendingClaimOrderIds.has(order.id);
        return `
    <div class="item-card">
    <img src="./images/placeholder.png" data-mobile-loader data-mobile-src="${escapeHtml(getProductThumbnailUrl(getImagePath(order.items?.[0]?.imagePath || order.items?.[0]?.image || order.items?.[0]?.imageFilename || '', 'products')))}" data-full-src="${escapeHtml(getImagePath(order.items?.[0]?.imagePath || order.items?.[0]?.image || order.items?.[0]?.imageFilename || '', 'products'))}" loading="${index < 2 ? 'eager' : 'lazy'}" fetchpriority="${index < 2 ? 'high' : 'auto'}" decoding="async" alt="${escapeHtml(order.items?.[0]?.name || 'Order')}" />
      <div class="panel-card-header"><strong>#${order.orderNumber || order.id.slice(0, 6)}</strong><span class="badge">${order.status || 'accepted'}</span></div>
      <div class="meta-stack">
        <div class="meta-row"><span>${order.items?.[0]?.name || 'Order'} × ${order.items?.[0]?.quantity || 1}</span><span>${order.orderType === 'signup_blind_box' ? `Delivery earning ${formatCurrency(order.deliveryFee || 0, 'LRD')}` : formatCurrency(order.total || 0)}</span></div>
        ${renderDeliveryOrderVariantDetails(order)}
        <div class="meta-row"><span>${order.address || 'Address unavailable'}</span><span>${order.deliveryLocationLabel || 'Standard'}</span></div>
        <div class="muted">${order.deliveryLandmark || order.deliveryDetails || 'No delivery notes'}</div>
        <div class="muted">${order.orderType === 'signup_blind_box' ? 'Platform reward · regular delivery' : `Delivery deadline: ${getDeliveryDeadline(order) ? formatDate(getDeliveryDeadline(order)) : '48 hours after ready'}`}</div>
      </div>
      ${renderDeliveryLocationMap(order)}
      <div class="action-row">
        <button class="primary-btn" data-action="pick-up-order" data-id="${order.id}" ${isClaiming ? 'disabled' : ''}>${isClaiming ? 'Claiming...' : 'Pick Up'}</button>
        <button class="ghost-btn" data-action="open-chat" data-id="${order.id}">Chat</button>
      </div>
    </div>`;
    }).join('') : '<div class="empty-state">No available orders from your approved sellers yet.</div>';
    availableOrdersList.querySelectorAll('[data-action="pick-up-order"]').forEach((button) => {
        const order = state.allOrders.find((entry) => entry.id === button.dataset.id);
        if (order?.deliveryPersonUid === state.authUser?.uid) {
            setButtonReflectedState(button, 'success', 'Picked Up ✓');
        }
    });
}

function renderActiveDeliveries() {
    const active = state.allOrders.filter((order) => !order.isDeleted && !order.archived && order.deliveryPersonUid === state.authUser?.uid && order.status === 'out_for_delivery');
    const activeDeliveriesList = document.getElementById('activeDeliveriesList');
    activeDeliveriesList.innerHTML = active.length ? active.map((order, index) => `
    <div class="item-card">
    <img src="./images/placeholder.png" data-mobile-loader data-mobile-src="${escapeHtml(getProductThumbnailUrl(getImagePath(order.items?.[0]?.imagePath || order.items?.[0]?.image || order.items?.[0]?.imageFilename || '', 'products')))}" data-full-src="${escapeHtml(getImagePath(order.items?.[0]?.imagePath || order.items?.[0]?.image || order.items?.[0]?.imageFilename || '', 'products'))}" loading="${index < 2 ? 'eager' : 'lazy'}" fetchpriority="${index < 2 ? 'high' : 'auto'}" decoding="async" alt="${escapeHtml(order.items?.[0]?.name || 'Order')}" />
      <div class="panel-card-header"><strong>#${order.orderNumber || order.id.slice(0, 6)}</strong><span class="badge">${order.status}</span></div>
      <div class="meta-stack">
        <div class="meta-row"><span>${order.customerName || 'Customer'}</span><span>${order.items?.[0]?.name || 'Order'} × ${order.items?.[0]?.quantity || 1}</span></div>
        ${renderDeliveryOrderVariantDetails(order)}
        <div class="muted">${order.address || 'Address unavailable'}</div>
        <div class="muted">${order.deliveryLandmark || order.deliveryDetails || 'No delivery notes'}</div>
      </div>
      ${renderDeliveryLocationMap(order)}
    <div class="muted">Placed: ${formatDate(order.placedAt || order.createdAt)} • ${order.orderType === 'signup_blind_box' ? 'Platform reward · regular delivery' : `Delivery deadline: ${getDeliveryDeadline(order) ? formatDate(getDeliveryDeadline(order)) : '48 hours after ready'}`} • Refund: ${order.refundStatus || 'none'}</div>
      <div class="action-row">
        <button class="primary-btn" data-action="deliver-order" data-id="${order.id}">Delivered</button>
        <button class="ghost-btn" data-action="report-issue" data-id="${order.id}">Report Issue</button>
        <button class="ghost-btn" data-action="open-chat" data-id="${order.id}">Chat</button>
      </div>
    </div>`).join('') : '<div class="empty-state">No active deliveries right now.</div>';
    activeDeliveriesList.querySelectorAll('[data-action="deliver-order"]').forEach((button) => {
        const order = state.allOrders.find((entry) => entry.id === button.dataset.id);
        if (order?.status === 'delivered') {
            setButtonReflectedState(button, 'success', 'Delivered ✓');
        }
    });
}

function renderHistory() {
    const history = state.allOrders.filter((order) => !order.isDeleted && order.deliveryPersonUid === state.authUser?.uid && ['delivered', 'received'].includes(order.status));
    document.getElementById('historyList').innerHTML = history.length ? history.map((order) => `
    <div class="item-card">
      <div class="panel-card-header"><strong>#${order.orderNumber || order.id.slice(0, 6)}</strong><span class="badge">${order.status}</span></div>
    <div class="muted">${order.sellerName || 'Seller'} • ${order.orderType === 'signup_blind_box' ? `Delivery earning ${formatCurrency(order.deliveryFee || 0, 'LRD')}` : formatCurrency(order.total || 0)}</div>
      <div class="muted">${order.customerName || 'Customer'} • ${formatDate(order.updatedAt || order.createdAt)}</div>
    ${renderDeliveryOrderVariantDetails(order)}
      <div class="action-row">
        <button class="ghost-btn" data-action="open-chat" data-id="${order.id}">Chat</button>
      </div>
    </div>`).join('') : '<div class="empty-state">Delivery history is empty.</div>';
}

function renderPartnerRequests() {
    const list = document.getElementById('partnerRequestsList') || document.getElementById('myRequestsList');
    if (!list) return;
    const pending = state.deliveryRequests.filter((request) => request.status === 'pending');
        const invitations = state.deliveryPartnerRequests || [];
        list.innerHTML = pending.length || invitations.length ? `${pending.map((request) => `
      <div class="item-card">
        <div class="panel-card-header"><strong>${request.sellerName || 'Seller'}</strong><span class="badge">Pending</span></div>
        <div class="muted">Your request to partner with this seller is awaiting review.</div>
            </div>`).join('')}${invitations.map((invitation) => {
                const statusLabel = invitation.status === 'approved' ? 'Accepted' : invitation.status === 'rejected' ? 'Declined' : 'Invitation';
                const response = invitation.status === 'pending' ? `<div class="action-row"><button class="primary-btn" data-action="respond-delivery-invitation" data-id="${invitation.id}" data-response="approved">Accept</button><button class="ghost-btn" data-action="respond-delivery-invitation" data-id="${invitation.id}" data-response="rejected">Decline</button></div>` : '';
                return `<div class="item-card"><div class="panel-card-header"><strong>${invitation.sellerName || 'Seller'}</strong><span class="badge">${statusLabel}</span></div><div class="muted">${invitation.message || 'This seller invited you to join their delivery network.'}</div>${response}</div>`;
            }).join('')}` : '<div class="empty-state">You have no active partner requests right now.</div>';
}

function renderHelpArticles() {
    const container = document.getElementById('helpArticlesList');
    if (!container) return;
    const categoryFilter = String(document.getElementById('helpArticleCategoryFilter')?.value || '').trim().toLowerCase();
    const tagFilter = String(document.getElementById('helpArticleTagFilter')?.value || '').trim().toLowerCase();
    const filteredArticles = state.helpArticles.filter((article) => {
        const matchesCategory = !categoryFilter || String(article.category || '').trim().toLowerCase() === categoryFilter;
        const tags = Array.isArray(article.tags) ? article.tags : String(article.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean);
        const tagText = tags.join(' ').toLowerCase();
        const matchesTag = !tagFilter || tagText.includes(tagFilter);
        return matchesCategory && matchesTag;
    });
    const featuredArticles = filteredArticles.filter((article) => Boolean(article.featured));
    const regularArticles = filteredArticles.filter((article) => !article.featured);
    const renderArticleCard = (article) => `
      <div class="help-card">
        <img src="${article.image ? `images/help-video-images/${article.image}` : 'images/placeholders/wrap.jpg'}" alt="${article.title || 'Help guide'}" onerror="this.src='images/placeholders/wrap.jpg'" />
        <div class="help-card__body">
          <h4>${article.title || 'Help article'}</h4>
          <p>${article.description || ''}</p>
          <div class="action-row" style="flex-wrap: wrap; gap: 8px;">
            ${article.featured ? '<span class="badge featured-badge">📌 Featured</span>' : ''}
            ${article.category ? `<span class="badge">${article.category}</span>` : ''}
            ${(Array.isArray(article.tags) ? article.tags : String(article.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean)).map((tag) => `<span class="badge">${tag}</span>`).join('')}
          </div>
          <div class="action-row">
            ${article.videoUrl ? `<a class="primary-btn" href="${article.videoUrl}" target="_blank" rel="noopener noreferrer">Watch Video</a>` : '<span class="badge">Video coming soon</span>'}
          </div>
        </div>
      </div>`;
    container.innerHTML = filteredArticles.length ? `
      <div class="stack">
        ${featuredArticles.length ? `<div class="help-featured-section"><div class="panel-card-header"><h4>Featured guides</h4></div>${featuredArticles.map(renderArticleCard).join('')}</div>` : ''}
        ${regularArticles.length ? `<div class="help-featured-section"><div class="panel-card-header"><h4>More guides</h4></div>${regularArticles.map(renderArticleCard).join('')}</div>` : ''}
      </div>` : '<div class="empty-state">No help articles match the current filters.</div>';
}

function renderSellers() {
    const approvedSellerIds = state.profile?.approvedSellers || [];
    const isAdminApproved = state.profile?.status === 'approved';
    const requestCards = state.deliveryRequests.length ? state.deliveryRequests.map((request) => {
        const seller = state.sellers.find((entry) => entry.id === request.sellerId);
        const statusLabel = request.status === 'approved' ? 'Approved' : request.status === 'rejected' ? 'Declined' : 'Pending';
        return `
        <div class="item-card">
          <div class="panel-card-header"><strong>${seller?.name || 'Seller'}</strong><span class="badge">${statusLabel}</span></div>
          <div class="muted">${seller?.location || 'Location unavailable'}</div>
          <div class="muted">${request.status === 'pending' ? 'Waiting for seller confirmation.' : request.status === 'approved' ? 'You are now approved to deliver for this seller.' : 'Your request was declined.'}</div>
        </div>`;
    }).join('') : '<div class="empty-state">You have not requested any seller partnerships yet.</div>';
    const approvedCards = state.sellers.filter((seller) => approvedSellerIds.includes(seller.id)).length ? state.sellers.filter((seller) => approvedSellerIds.includes(seller.id)).map((seller) => `
    <div class="item-card">
      <img src="${getImagePath(seller.logo, 'sellers')}" alt="${seller.name}" />
      <div class="panel-card-header"><strong>${seller.name}</strong><span class="badge">Approved</span></div>
      <div class="muted">${seller.location || 'Location unavailable'} • ${seller.category || 'Seller'}</div>
                <div class="action-row"><button class="danger-btn" data-action="leave-seller" data-id="${seller.id}">Unassign from seller</button></div>
    </div>`).join('') : '<div class="empty-state">No approved seller partners yet.</div>';
    document.getElementById('sellersList').innerHTML = state.sellers.length ? state.sellers.map((seller) => `
    <div class="item-card">
      <img src="${getImagePath(seller.logo, 'sellers')}" alt="${seller.name}" />
      <div class="panel-card-header"><strong>${seller.name}</strong><span class="badge">${seller.rating || 'New'}</span></div>
      <div class="muted">${seller.location || 'Location unavailable'} • ${seller.category || 'Seller'}</div>
      <div class="action-row">
        <button class="${approvedSellerIds.includes(seller.id) ? 'ghost-btn' : 'primary-btn'}" data-action="request-delivery" data-id="${seller.id}" ${!isAdminApproved && !approvedSellerIds.includes(seller.id) ? 'disabled' : ''}>${approvedSellerIds.includes(seller.id) ? 'Approved' : isAdminApproved ? 'Request to Deliver' : 'Awaiting admin approval'}</button>
      </div>
    </div>`).join('') : '<div class="empty-state">No sellers are available right now.</div>';
    document.getElementById('myRequestsList').innerHTML = requestCards;
    document.getElementById('approvedSellersList').innerHTML = approvedCards;
    renderPartnerRequests();
}

function renderProfile() {
    const profile = state.profile || {};
    const displayName = profile.displayName || profile.email || 'Delivery Person';
    document.getElementById('profileForm').innerHTML = `
    <div style="display: flex; gap: 20px; margin-bottom: 20px; align-items: flex-start;">
      <div style="flex-shrink: 0;">
        ${getAvatarHtml(displayName, '80px')}
      </div>
      <div style="flex: 1;">
        <p class="muted" style="margin: 0 0 8px 0;">Your profile avatar</p>
        <p style="font-size: 12px; color: var(--muted); margin: 0;">Shown as ${escapeHtml(displayName)}'s initials</p>
      </div>
    </div>
    <label>Name<input id="profileName" value="${profile.displayName || ''}" /></label>
    <label>Phone<input id="profilePhone" value="${profile.phone || ''}" /></label>
    <label>Email<input value="${profile.email || ''}" readonly /></label>
    <label>Vehicle Type<select id="profileVehicleType">
      <option value="Bicycle" ${profile.vehicleType === 'Bicycle' ? 'selected' : ''}>Bicycle</option>
      <option value="Motorcycle" ${profile.vehicleType === 'Motorcycle' ? 'selected' : ''}>Motorcycle</option>
      <option value="Car" ${profile.vehicleType === 'Car' ? 'selected' : ''}>Car</option>
    </select></label>
    <label>Vehicle Plate<input id="profileVehiclePlate" value="${profile.vehiclePlate || ''}" /></label>
    <label>Rating<input value="${profile.rating || 0}" readonly /></label>
    <label>Total Deliveries<input value="${profile.totalDeliveries || 0}" readonly /></label>
    ${getQRCardHTML('deliveryQrContainer', 'deliveryQrCard')}
  `;
    initQRCode('deliveryQrContainer');
    bindQRDownloadHandlers();
}

function renderSettings() {
    const profile = state.profile || {};
    document.getElementById('settingsContent').innerHTML = `
        <div class="item-card">
            <div class="panel-card-header"><strong>Appearance</strong></div>
            ${renderThemePreferenceControl()}
        </div>
    <div class="item-card">
      <div class="panel-card-header"><strong>Availability</strong><span class="badge">${profile.isActive ? 'Online' : 'Offline'}</span></div>
    <label><input type="checkbox" id="availabilityToggle" ${profile.isActive !== false ? 'checked' : ''} /> Available for deliveries (turn off for break mode)</label>
      <div class="action-row">
        <button class="primary-btn" data-action="change-password">Change Password</button>
        <button class="danger-btn" data-action="deactivate-account">Deactivate Account</button>
      </div>
    </div>
    <div class="item-card">
      <div class="panel-card-header"><strong>Payment preferences</strong></div>
    <label>Mobile money number<input id="payoutPhone" type="tel" value="${state.payoutPreferences?.paymentPhone || ''}" /></label>
      <label>Provider<select id="payoutProvider">
        <option value="orange" ${state.payoutPreferences?.provider === 'orange' ? 'selected' : ''}>Orange Money</option>
        <option value="lonestar" ${state.payoutPreferences?.provider === 'lonestar' ? 'selected' : ''}>Lonestar</option>
      </select></label>
      <div class="action-row">
        <button class="primary-btn" id="savePayoutPreferences">Save payment preferences</button>
      </div>
    </div>`;
        bindThemePreferenceControl(document.getElementById('settingsContent'), {
                db,
                userId: state.authUser?.uid,
                onError: () => createToast('Theme changed on this device, but could not sync to your account.', 'warning')
        });
    const availabilityToggle = document.getElementById('availabilityToggle');
    if (availabilityToggle) {
        availabilityToggle.addEventListener('change', () => {
            const isOnline = availabilityToggle.checked;
            const options = isOnline
                ? { loadingText: 'Going Online...', successText: 'Online', permanent: true }
                : { loadingText: 'Going Offline...', successText: 'Offline', permanent: false };
            const updateAvailability = async () => {
                await db.collection('users').doc(state.authUser.uid).set({ isActive: availabilityToggle.checked, updatedAt: new Date() }, { merge: true });
                createToast(availabilityToggle.checked ? 'You are online for new deliveries.' : 'You are offline for now.', 'success');
            };
            if (window.withButtonState) {
                withButtonState(availabilityToggle, updateAvailability, options)
                    .then(() => { availabilityToggle.disabled = false; })
                    .catch(() => { });
            } else {
                updateAvailability();
            }
        });
    }
    document.getElementById('savePayoutPreferences')?.addEventListener('click', async () => {
        const paymentPhone = document.getElementById('payoutPhone').value.trim();
        const provider = document.getElementById('payoutProvider').value;
        await db.collection('users').doc(state.authUser.uid).set({ payoutPreferences: { provider, paymentPhone }, updatedAt: new Date() }, { merge: true });
        state.payoutPreferences = { provider, paymentPhone };
        createToast('Payment preferences saved.', 'success');
    });
}

function renderNotifications() {
    const list = document.getElementById('notificationsList');
    if (!list) return;
    const visible = state.notifications.filter((item) => !item.isDeleted);
    list.innerHTML = `
            <div class="action-row notification-actions" style="margin-bottom: 12px;">
        <button class="ghost-btn" data-clear-all-notifications="true" ${visible.length ? '' : 'disabled'}>Clear all</button>
                ${renderSoundToggle()}
      </div>
      ${visible.length ? visible.map((item) => `
      <div class="item-card notification-card ${item.read ? '' : 'unread'}">
        <div class="panel-card-header"><strong>${item.title || 'Update'}</strong><span class="badge">${item.type || 'system'}</span></div>
        <div class="muted">${item.message || ''}</div>
        <div class="muted">${formatDate(item.createdAt)}</div>
        <div class="action-row">
          <button class="ghost-btn" data-action="mark-notification-read" data-id="${item.id}">${item.read ? 'Read' : 'Mark as Read'}</button>
          <button class="danger-btn" data-action="delete-notification" data-id="${item.id}">Delete</button>
        </div>
      </div>`).join('') : '<div class="empty-state">No notifications yet.</div>'}`;
    list.querySelectorAll('[data-clear-all-notifications]').forEach((button) => {
        button.addEventListener('click', clearAllNotifications);
    });
    bindSoundToggle(list);
}

function renderHeaderNotifications() {
    const unread = state.notifications.filter((item) => !item.isDeleted && !item.read).length;
    elements.notificationCount.textContent = unread;
    elements.notificationCount.classList.toggle('hidden', unread === 0);
    elements.notificationDropdown.innerHTML = state.notifications.filter((item) => !item.isDeleted).length ? state.notifications.filter((item) => !item.isDeleted).slice(0, 5).map((item) => `<div class="item-card notification-card ${item.read ? '' : 'unread'}"><strong>${item.title || 'Update'}</strong><div class="muted">${item.message || ''}</div></div>`).join('') : '<div class="empty-state">No recent updates.</div>';
}

function toggleNotifications() {
    showSection('notifications');
    setMobileNavOpen(false);
}

function showSection(section) {
    state.activeSection = section;
    setActiveNavigation(section);
    setMobileNavOpen(false);
    document.querySelectorAll('.section-panel').forEach((panel) => panel.classList.toggle('active', panel.id === `${section}Section`));
    if (section === 'help') {
        renderHelpSession();
    }
    if (section === 'settings') {
        renderSettings();
    }
    const titleMap = {
        dashboard: ['Dashboard', 'Pick up, deliver, and keep your route moving.', 'Delivery Console', 'Dashboard / Overview'],
        available: ['Available Orders', 'Orders ready for pickup from approved sellers.', 'Available Orders', 'Dashboard / Orders'],
        active: ['Active Deliveries', 'Orders currently assigned to you.', 'Active Deliveries', 'Dashboard / Deliveries'],
        history: ['Delivery History', 'Completed deliveries and your route summary.', 'Delivery History', 'Dashboard / History'],
        sellers: ['Sellers', 'Request deliveries from sellers you want to work with.', 'Sellers', 'Dashboard / Sellers'],
        partners: ['Partner Requests', 'Track your pending delivery partnerships.', 'Partner Requests', 'Dashboard / Partners'],
        notifications: ['Notifications', 'Stay updated on your deliveries.', 'Notifications', 'Dashboard / Alerts'],
        profile: ['Profile', 'Update your profile and vehicle details.', 'Profile', 'Dashboard / Profile'],
        settings: ['Settings', 'Manage availability and account options.', 'Settings', 'Dashboard / Preferences'],
        help: ['Help Center', 'Find guides and support resources for delivery partners.', 'Help Center', 'Dashboard / Help']
    };
    const [title, subtitle, heading, breadcrumb] = titleMap[section] || titleMap.dashboard;
    elements.pageTitle.textContent = title;
    elements.pageSubtitle.textContent = subtitle;
    if (elements.pageHeading) elements.pageHeading.textContent = heading;
    if (elements.pageBreadcrumb) elements.pageBreadcrumb.textContent = breadcrumb;
}

function setClaimButtonState(orderId, isClaiming) {
    if (!orderId) return;
    document.querySelectorAll(`[data-action="pick-up-order"][data-id="${orderId}"]`).forEach((button) => {
        button.disabled = isClaiming;
        button.classList.toggle('is-busy', isClaiming);
        if (isClaiming) {
            button.dataset.originalText = button.textContent.trim();
            button.textContent = 'Claiming...';
        } else if (button.dataset.originalText) {
            button.textContent = button.dataset.originalText;
            delete button.dataset.originalText;
        }
    });
}

async function handleAction(action, id, response) {
    if (!state.authUser) return;
    switch (action) {
        case 'pick-up-order':
            return pickUpOrder(id);
        case 'deliver-order':
            return markDelivered(id);
        case 'report-issue':
            await reportIssue(id);
            break;
        case 'request-delivery':
            await requestDelivery(id);
            break;
        case 'leave-seller':
            await leaveSeller(id);
            break;
        case 'respond-delivery-invitation':
            await respondToDeliveryInvitation(id, response);
            break;
        case 'mark-notification-read':
            await markNotificationRead(id);
            break;
        case 'delete-notification':
            await deleteNotification(id);
            break;
        case 'change-password':
            await handleForgotPassword();
            break;
        case 'deactivate-account':
            await deactivateAccount();
            break;
        case 'open-chat':
            await openChat(id);
            break;
        default:
            break;
    }
}

async function respondToDeliveryInvitation(invitationId, response) {
    const invitation = state.deliveryPartnerRequests.find((entry) => entry.id === invitationId);
    if (!invitation || invitation.status !== 'pending' || !['approved', 'rejected'].includes(response)) return;
    try {
        if (response === 'approved') {
            const approvedSellers = Array.from(new Set([...(state.profile?.approvedSellers || []), invitation.sellerId]));
            const seller = state.sellers.find((entry) => entry.id === invitation.sellerId);
            await Promise.all([
                db.collection('deliveryPartnerRequests').doc(invitationId).update({ status: 'approved', updatedAt: new Date() }),
                db.collection('users').doc(state.authUser.uid).set({ approvedSellers, updatedAt: new Date() }, { merge: true }),
                db.collection('sellers').doc(invitation.sellerId).set({ deliveryPersons: Array.from(new Set([...(seller?.deliveryPersons || []), state.authUser.uid])), updatedAt: new Date() }, { merge: true })
            ]);
            createToast('Invitation accepted.', 'success');
        } else {
            await db.collection('deliveryPartnerRequests').doc(invitationId).update({ status: 'rejected', updatedAt: new Date() });
            createToast('Invitation declined.', 'success');
        }
    } catch (error) {
        createToast(error.message || 'Unable to respond to the invitation.', 'error');
    }
}

async function pickUpOrder(orderId) {
    if (state.profile?.status !== 'approved') {
        createToast('Your delivery account is awaiting admin approval.', 'warning');
        return false;
    }
    if (!ensureDeliveryProfileComplete()) return false;
    if (state.profile?.isActive === false) {
        createToast('Break mode is on. Turn availability back on before accepting deliveries.', 'warning');
        return false;
    }
    if (!orderId || state.pendingClaimOrderIds.has(orderId)) return false;

    state.pendingClaimOrderIds.add(orderId);
    setClaimButtonState(orderId, true);

    const profile = state.profile || {};
    const order = state.allOrders.find((entry) => entry.id === orderId);
    let assignedSuccessfully = false;

    try {
        const orderRef = db.collection('orders').doc(orderId);
        const serverTimestamp = new Date();

        await db.runTransaction(async (transaction) => {
            const orderDoc = await transaction.get(orderRef);
            if (!orderDoc.exists) {
                throw new Error('This order no longer exists.');
            }

            const orderData = orderDoc.data() || {};
            const deliveryProfileDoc = await transaction.get(db.collection('users').doc(state.authUser.uid));
            if (deliveryProfileDoc.data()?.isActive === false) {
                throw new Error('Break mode is on. Turn availability back on before accepting deliveries.');
            }
            if (orderData.deliveryPersonUid) {
                throw new Error('This order has already been claimed by another driver.');
            }
            if (orderData.paymentStatus !== 'confirmed') {
                throw new Error('This order is waiting for admin payment confirmation.');
            }
            if (isDeliveryDeadlineExpired(orderData)) {
                throw new Error('The 48-hour delivery window for this order has expired.');
            }
            if (!['accepted', 'preparing', 'ready'].includes(orderData.status)) {
                throw new Error('This order is not available for pickup right now.');
            }

            transaction.update(orderRef, {
                status: 'out_for_delivery',
                deliveryPersonUid: state.authUser.uid,
                deliveryPersonName: profile.displayName || profile.email || 'Delivery person',
                deliveryPersonPhone: profile.phone || '',
                deliveryPersonVehicleType: profile.vehicleType || '',
                assignedAt: serverTimestamp,
                updatedAt: new Date()
            });
        });

        assignedSuccessfully = true;
        await Promise.all([
            createNotification(state.authUser.uid, 'Order assigned', 'You picked up an order and it is now in transit.', 'delivery', 'delivery_person'),
            order?.customerUid ? createNotification(order.customerUid, 'Order on the way', 'Your order is now on the way with a delivery partner.', 'delivery', 'customer') : Promise.resolve(),
            order?.sellerId ? (async () => {
                const seller = state.sellers.find((entry) => entry.id === order.sellerId);
                if (seller?.ownerUid) {
                    await createNotification(seller.ownerUid, 'Delivery assigned', 'A delivery partner is now on the way with one of your orders.', 'delivery', 'seller');
                }
            })() : Promise.resolve()
        ]);
        createToast('Order picked up and assigned to you.', 'success');
    } catch (error) {
        const message = error.message || 'Unable to claim this order.';
        if (message.includes('already been claimed')) {
            createToast('Sorry, this order was just claimed by another driver.', 'warning');
        } else if (message.includes('not available')) {
            createToast('This order is no longer available for pickup.', 'warning');
        } else {
            createToast(message, 'error');
        }
    } finally {
        state.pendingClaimOrderIds.delete(orderId);
        if (!assignedSuccessfully) {
            setClaimButtonState(orderId, false);
        }
    }
    return assignedSuccessfully;
}

async function markDelivered(orderId) {
    if (!ensureDeliveryProfileComplete()) return false;
    const order = state.allOrders.find((entry) => entry.id === orderId);
    if (isDeliveryDeadlineExpired(order)) {
        createToast('The 48-hour delivery window for this order has expired.', 'warning');
        return false;
    }
    try {
        await db.collection('orders').doc(orderId).update({ status: 'delivered', updatedAt: new Date() });
        const deliveryEarning = Number(order?.deliveryFee || 0);
        if (deliveryEarning > 0 && order?.orderType !== 'signup_blind_box') {
            await creditDeliveryForOrder(state.authUser.uid, deliveryEarning, orderId);
        }
        if (order?.customerUid) {
            await createNotification(order.customerUid, 'Delivery completed', 'Your order was delivered successfully.', 'delivery', 'customer');
        }
        if (order?.sellerId) {
            const seller = state.sellers.find((entry) => entry.id === order.sellerId);
            if (seller?.ownerUid) {
                await createNotification(seller.ownerUid, 'Delivery completed', 'A delivery was completed for your seller.', 'delivery', 'seller');
            }
        }
        createToast('Delivery marked as complete.', 'success');
        return true;
    } catch (error) {
        createToast(error.message, 'error');
        return false;
    }
}

async function reportIssue(orderId) {
    const message = prompt('Describe the issue');
    if (!message) return;
    try {
        await db.collection('reports').add({ orderId, deliveryPersonUid: state.authUser.uid, message, createdAt: new Date() });
        createToast('Issue reported to the admin team.', 'success');
    } catch (error) {
        createToast(error.message, 'error');
    }
}

async function requestDelivery(sellerId) {
    if (state.profile?.status !== 'approved') {
        createToast('Your delivery account must be approved by an admin before joining sellers.', 'warning');
        return;
    }
    try {
        const seller = state.sellers.find((entry) => entry.id === sellerId);
        const existing = await db.collection('deliveryRequests').where('deliveryPersonUid', '==', state.authUser.uid).where('sellerId', '==', sellerId).limit(1).get();
        if (!existing.empty) {
            const currentStatus = existing.docs[0].data()?.status || 'pending';
            createToast(currentStatus === 'approved' ? 'You are already approved for this seller.' : 'You already have a request for this seller.', 'info');
            return;
        }
        const requestPayload = {
            deliveryPersonUid: state.authUser.uid,
            deliveryPersonName: state.profile?.displayName || state.profile?.email || 'Delivery person',
            sellerId,
            sellerName: seller?.name || '',
            status: 'pending',
            createdAt: new Date()
        };
        await db.collection('deliveryRequests').add(requestPayload);
        if (seller?.ownerUid) {
            await createRoleNotification(db, seller.ownerUid, 'seller', {
                title: 'New delivery request',
                message: `${requestPayload.deliveryPersonName} wants to join ${seller.name || 'your seller'}.`,
                type: 'delivery'
            });
        }
        createToast('Delivery request sent to the seller.', 'success');
    } catch (error) {
        createToast(error.message, 'error');
    }
}

async function leaveSeller(sellerId) {
    try {
        const sellerRef = db.collection('sellers').doc(sellerId);
        const sellerDoc = await sellerRef.get();
        const current = sellerDoc.data()?.deliveryPersons || [];
        const next = current.filter((uid) => uid !== state.authUser.uid);
        await sellerRef.update({ deliveryPersons: next, updatedAt: new Date() });
        const profileApproved = state.profile?.approvedSellers || [];
        await db.collection('users').doc(state.authUser.uid).set({ approvedSellers: profileApproved.filter((id) => id !== sellerId), updatedAt: new Date() }, { merge: true });
        createToast('You have left this seller network.', 'success');
    } catch (error) {
        createToast(error.message, 'error');
    }
}

async function markNotificationRead(notificationId) {
    try {
        await db.collection('notifications').doc(notificationId).set({ read: true, updatedAt: new Date() }, { merge: true });
        state.notifications = state.notifications.map((item) => (item.id === notificationId ? { ...item, read: true } : item));
        renderNotifications();
    } catch (error) {
        createToast(error.message, 'error');
    }
}

async function deleteNotification(notificationId) {
    try {
        await db.collection('notifications').doc(notificationId).set({ read: true, isDeleted: true, updatedAt: new Date() }, { merge: true });
        state.notifications = state.notifications.map((item) => (item.id === notificationId ? { ...item, read: true, isDeleted: true } : item));
        renderNotifications();
    } catch (error) {
        createToast(error.message, 'error');
    }
}

async function clearAllNotifications() {
    const visible = state.notifications.filter((item) => !item.isDeleted);
    if (!visible.length) return;
    try {
        await Promise.all(visible.map((item) => db.collection('notifications').doc(item.id).set({ read: true, isDeleted: true, updatedAt: new Date() }, { merge: true })));
        state.notifications = state.notifications.map((item) => (visible.some((entry) => entry.id === item.id) ? { ...item, read: true, isDeleted: true } : item));
        renderNotifications();
        createToast('All notifications cleared.', 'success');
    } catch (error) {
        createToast(error.message, 'error');
    }
}

async function deactivateAccount() {
    try {
        await db.collection('users').doc(state.authUser.uid).set({ isActive: false, isDeleted: true, updatedAt: new Date() }, { merge: true });
        await auth.signOut();
        createToast('Your account has been deactivated.', 'success');
    } catch (error) {
        createToast(error.message, 'error');
    }
}

async function updateUserProfile(uid, updates) {
    if (!uid) {
        throw new Error('A user id is required to save the profile.');
    }
    const button = document.querySelector('#saveProfileButton');
    if (button) {
        button.disabled = true;
        button.textContent = 'Saving…';
    }
    try {
        const payload = {
            ...updates,
            updatedAt: new Date()
        };
        await db.collection('users').doc(uid).set(payload, { merge: true });
        state.profile = { ...state.profile, ...payload };
        createToast('Profile saved to local database.', 'success');
        return payload;
    } catch (error) {
        createToast(error.message || 'Unable to save your profile.', 'error');
        throw error;
    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = 'Save';
        }
    }
}

async function saveProfile() {
    try {
        const name = document.getElementById('profileName').value.trim();
        const phone = document.getElementById('profilePhone').value.trim();
        const vehicleType = document.getElementById('profileVehicleType').value;
        const vehiclePlate = document.getElementById('profileVehiclePlate').value.trim();
        await updateUserProfile(state.authUser.uid, { displayName: name, phone, vehicleType, vehiclePlate });
    } catch (error) {
        createToast(error.message, 'error');
    }
}

async function refreshData() {
    renderAll();
    createToast('Data refreshed.', 'success');
}

async function openChat(orderId) {
    state.selectedOrder = state.allOrders.find((entry) => entry.id === orderId);
    if (!state.selectedOrder) return;
    elements.modalTitle.textContent = `Chat for #${state.selectedOrder.orderNumber || orderId.slice(0, 6)}`;
    elements.modalBody.innerHTML = `
    <div id="chatMessages" class="chat-list"></div>
    <form id="chatForm" class="form-grid">
      <textarea id="chatInput" placeholder="Send a message to the seller or customer..."></textarea>
      <button class="primary-btn" type="submit">Send</button>
    </form>`;
    elements.modalBackdrop.classList.remove('hidden');
    await loadChatMessages(orderId);
    document.getElementById('chatForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        const text = document.getElementById('chatInput').value.trim();
        if (!text) return;
        await db.collection('orders').doc(orderId).collection('messages').add({ text, senderRole: 'delivery_person', senderUid: state.authUser.uid, read: false, isDeleted: false, createdAt: new Date(), updatedAt: new Date() });
        document.getElementById('chatInput').value = '';
    });
}

function loadChatMessages(orderId) {
    if (state.chatsUnsubscribe) state.chatsUnsubscribe();
    state.chatsUnsubscribe = db.collection('orders').doc(orderId).collection('messages').orderBy('createdAt', 'asc').onSnapshot((snapshot) => {
        state.chatMessages = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).filter((message) => !message.isDeleted);
        document.getElementById('chatMessages').innerHTML = state.chatMessages.length ? state.chatMessages.map((message) => `
      <div class="chat-bubble ${message.senderRole === 'delivery_person' ? 'self' : ''}">
        <div class="panel-card-header">
          <strong>${message.senderRole === 'delivery_person' ? 'You' : message.senderRole === 'seller' ? 'Seller' : 'Customer'}</strong>
          <span class="badge">${message.read ? 'Read' : 'Unread'}</span>
        </div>
        <div>${message.text}</div>
        <div class="muted">${formatDate(message.createdAt)}</div>
        <div class="action-row">
          <button class="ghost-btn" type="button" data-delete-chat-message="${message.id}">Delete</button>
        </div>
      </div>`).join('') : '<div class="empty-state">No messages yet.</div>';
        document.querySelectorAll('[data-delete-chat-message]').forEach((button) => {
            button.addEventListener('click', async () => {
                await db.collection('orders').doc(orderId).collection('messages').doc(button.dataset.deleteChatMessage).set({ isDeleted: true, updatedAt: new Date() }, { merge: true });
            });
        });
    });
}

function openModal(title, body) {
    elements.modalTitle.textContent = title;
    elements.modalBody.innerHTML = body;
    elements.modalBackdrop.classList.remove('hidden');
    elements.modalBackdrop.setAttribute('aria-hidden', 'false');
    elements.modalClose.addEventListener('click', closeModal);
    window.addEventListener('keydown', handleModalEscape);
}

function closeModal() {
    elements.modalBackdrop.classList.add('hidden');
    elements.modalBody.innerHTML = '';
    elements.modalTitle.textContent = 'Dialog';
    elements.modalBackdrop.setAttribute('aria-hidden', 'true');
    window.removeEventListener('keydown', handleModalEscape);
}

function handleModalEscape(event) {
    if (event.key === 'Escape') {
        closeModal();
    }
}

function toggleSupportModal() {
    if (!elements.modalBackdrop.classList.contains('hidden') && elements.modalTitle.textContent === 'Help & support') {
        closeModal();
        return;
    }
    openSupportModal();
}

function ensureDeliveryProfileComplete() {
    const profile = state.profile || {};
    const hasRequiredFields = Boolean(profile.phone || profile.mobile || profile.contactPhone) && Boolean(profile.vehicleType || profile.vehicleNumber || profile.vehicle || profile.deliveryVehicle);
    if (!hasRequiredFields) {
        createToast('Please complete your delivery profile before picking up orders.', 'warning');
        return false;
    }
    return true;
}

function openSupportModal() {
    openModal('Help & support', `
      <form id="supportForm" class="form-grid" style="padding:8px 0;">
        <label>Topic<select name="category"><option value="delivery">Delivery issue</option><option value="payment">Payment</option><option value="account">Account</option><option value="other">Other</option></select></label>
        <label>Message<textarea name="message" required placeholder="Describe what you need help with."></textarea></label>
        <label>Email<input name="email" value="${state.profile?.email || state.authUser?.email || ''}" /></label>
        <div class="row-actions">
          <button class="primary-btn" id="submitSupport" type="button">Send request</button>
          <button class="ghost-btn" id="cancelSupport" type="button">Cancel</button>
        </div>
      </form>
    `);

    document.getElementById('submitSupport').addEventListener('click', async () => {
        const form = document.getElementById('supportForm');
        const data = new FormData(form);
        const payload = {
            panel: 'delivery',
            category: String(data.get('category') || 'other'),
            message: String(data.get('message') || '').trim(),
            email: String(data.get('email') || state.profile?.email || state.authUser?.email || '').trim(),
            userId: state.authUser?.uid || '',
            status: 'new',
            createdAt: new Date()
        };
        if (!payload.message) {
            createToast('Please describe your issue before sending.', 'warning');
            return;
        }
        try {
            await db.collection('supportRequests').add(payload);
            createToast('Support request sent. We will follow up shortly.', 'success');
            closeModal();
        } catch (error) {
            createToast(error.message || 'Unable to send support request.', 'error');
        }
    });
    document.getElementById('cancelSupport').addEventListener('click', closeModal);
}

async function createNotification(recipientUid, title, message, type = 'system', recipientRole = '') {
    return createRoleNotification(db, recipientUid, recipientRole, { title, message, type });
}

function getImagePath(filename, folder = 'products') {
    if (!filename) return './images/placeholders/wrap.jpg';
    const normalized = String(filename).trim();
    if (!normalized) return './images/placeholders/wrap.jpg';
    if (/^https?:\/\//i.test(normalized)) return normalized;
    if (normalized.startsWith('./') || normalized.startsWith('../') || normalized.startsWith('/')) return normalized.replace(/^\.\//, '').startsWith('images/') ? `./${normalized.replace(/^\.\//, '')}` : normalized;
    if (normalized.startsWith('images/')) return `./${normalized}`;
    return `./images/${folder}/${normalized}`;
}

document.addEventListener('DOMContentLoaded', init);
