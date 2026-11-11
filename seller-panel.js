import { initStorage, clearStoredAuthState } from './storage.js';
import { formatCurrency, formatDate, escapeHtml, createToast, copyText, getImageUrl, getProductThumbnailUrl, getSellerImageUrl, getCommunityOptions, isDateInRange, normalizeCurrency, confirmDialog, convertCurrency, getAvatarHtml } from './utils.js';
import { renderExpandableDescription } from './description-utils.js';
import { createRoleNotification } from './notification-utils.js';
import { bindSoundToggle, playSoundEffect, renderSoundToggle } from './sound-effects.js';

let sellerNotificationSnapshotReady = false;
import { DEFAULT_CATEGORY_TAXONOMY, getCategoryDisplayName, getCategoryOptions } from './category-taxonomy.js';
import { getCategoryVariantConfig, getVariantDisplayEntries } from './category-variants.js';
import { getQRCardHTML, initQRCode, bindQRDownloadHandlers } from './qr-utils.js';
import { isAdminOnlyEmail } from './auth.js';
import { getActiveCatalogPriceRule, getCatalogPriceBreakdown } from './pricing-utils.mjs';
import { canFulfillCustomizedOrder } from './customization-utils.mjs';
import { generateLocalListingDraft } from './listing-assistant.mjs';
import { applyThemePreference, bindThemePreferenceControl, renderThemePreferenceControl } from './theme-utils.js';
import { watchMaintenanceMode } from './maintenance-mode.js';

const state = {
    authUser: null,
    sellerId: null,
    sellerProfile: null,
    adminWhatsAppNumber: '',
    adminCatalogPriceRule: null,
    catalogPriceRuleExpiryTimer: null,
    userProfile: null,
    masterProducts: [],
    internationalProducts: [],
    internationalInventory: [],
    menuItems: [],
    categories: [],
    orders: [],
    reviews: [],
    promotions: [],
    coupons: [],
    deliveryRequests: [],
    notifications: [],
    settings: {},
    chats: [],
    supportRequests: [],
    deliveryUsers: [],
    deliveryPartnerRequests: [],
    deliveryPersons: [],
    deliveryPersonsFilter: { search: '', location: 'all', vehicle: 'all', rating: 'all', online: 'all' },
    deliveryPersonsPageSize: 12,
    deliveryPersonsLoadedCount: 0,
    deliveryPartnersActiveTab: 'all',
    deliveryPartnersListeners: {},
    pendingDeliveryPartnerRemovalId: null,
    helpArticles: [],
    financialPayouts: [],
    platformFeePayments: [],
    walletUnsubscribes: [],
    activeSection: 'dashboard',
    viewMode: 'grid',
    activeOrderChatId: null,
    orderChatMessages: [],
    orderChatUnsubscribe: null,
    menuFilters: { search: '', category: 'all', availability: 'all', sort: 'added' },
    selectedMenuIds: new Set(),
    orderFilter: 'all',
    catalogFilters: { search: '', category: 'all', status: 'all' },
    isLoading: false
};

const authScreen = document.getElementById('authScreen');
const appShell = document.getElementById('appShell');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const loginButton = document.getElementById('loginButton');
const registerButton = document.getElementById('registerButton');
const showRegisterButton = document.getElementById('showRegisterButton');
const showLoginButton = document.getElementById('showLoginButton');
const forgotPasswordButton = document.getElementById('forgotPasswordButton');
const authMessage = document.getElementById('authMessage');
const logoutButton = document.getElementById('logoutButton');
const mobileNavToggle = document.getElementById('mobileNavToggle') || document.getElementById('mobileMenuButton');
const mobileNavSheet = document.getElementById('mobileNavSheet');
const mobileNavClose = document.getElementById('mobileNavClose');
const mobileMenuButton = document.getElementById('mobileMenuButton');
const sidebarToggle = document.getElementById('sidebarToggle');
const sidebar = document.getElementById('sidebar');
const sidebarBackdrop = document.getElementById('sidebarBackdrop');
const sidebarClose = document.getElementById('sidebarClose');
const navItems = Array.from(document.querySelectorAll('.nav-item[data-section]'));
const sectionPanels = Array.from(document.querySelectorAll('.section-panel'));
const pageTitle = document.getElementById('pageTitle');
const pageSubtitle = document.getElementById('pageSubtitle');
const userBadge = document.getElementById('userBadge');
const supportButton = document.getElementById('supportButton');
const notificationsToggle = document.getElementById('notificationsToggle');
const modalBackdrop = document.getElementById('modalBackdrop');
const modalTitle = document.getElementById('modalTitle');
const modalBody = document.getElementById('modalBody');
const modalActions = document.getElementById('modalActions');
const modalClose = document.getElementById('modalClose');

let storage = null;
let db = null;
let auth = null;
let approvalBanner = null;
let authBootstrapTimer = null;
let financialPayoutsUnsubscribe = null;
let platformFeePaymentsUnsubscribe = null;

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
            authScreen.classList.remove('hidden');
            appShell.classList.add('hidden');
        }
    }, 900);
}

function unsubscribeFinancialListeners() {
    if (financialPayoutsUnsubscribe) {
        financialPayoutsUnsubscribe();
        financialPayoutsUnsubscribe = null;
    }
    if (platformFeePaymentsUnsubscribe) {
        platformFeePaymentsUnsubscribe();
        platformFeePaymentsUnsubscribe = null;
    }
}

function ensureFinancialSection() {
    if (document.getElementById('financialsSection')) return;

    const sidebarNav = document.querySelector('.nav-links');
    const mobileNav = document.querySelector('.mobile-nav-list');
    const targetShell = document.querySelector('.main-panel');
    if (!targetShell) return;

    const financialsButton = document.createElement('button');
    financialsButton.className = 'nav-item';
    financialsButton.setAttribute('data-section', 'financials');
    financialsButton.innerHTML = '<span class="nav-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16v10H4z"/><path d="M8 11h8"/><path d="M8 15h5"/></svg></span><span>Financials</span>';
    financialsButton.addEventListener('click', () => {
        showSection('financials');
        if (window.innerWidth <= 1023) {
            setMobileNavOpen(false);
        }
    });
    sidebarNav?.appendChild(financialsButton);

    const mobileFinancialsButton = document.createElement('button');
    mobileFinancialsButton.className = 'nav-item mobile-nav-item';
    mobileFinancialsButton.setAttribute('data-section', 'financials');
    mobileFinancialsButton.innerHTML = '<span class="nav-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16v10H4z"/><path d="M8 11h8"/><path d="M8 15h5"/></svg></span><span>Financials</span>';
    mobileFinancialsButton.addEventListener('click', () => {
        showSection('financials');
        setMobileNavOpen(false);
    });
    mobileNav?.appendChild(mobileFinancialsButton);

    const section = document.createElement('section');
    section.id = 'financialsSection';
    section.className = 'section-panel';
    section.innerHTML = `
      <div class="panel-card">
        <div class="panel-card-header">
          <h3>Financials</h3>
          <span class="badge">Payouts & fees</span>
        </div>
        <div id="financialsContent" class="stack"></div>
      </div>
    `;
    targetShell.appendChild(section);
}

function ensureSellerWalletSection() {
    if (document.getElementById('walletSection')) return;
    const nav = document.querySelector('.nav-links');
    const button = document.createElement('button');
    button.className = 'nav-item';
    button.dataset.section = 'wallet';
    button.innerHTML = '<span class="nav-icon">$</span><span>Wallet</span>';
    button.addEventListener('click', () => showSection('wallet'));
    nav?.appendChild(button);
    const section = document.createElement('section');
    section.id = 'walletSection';
    section.className = 'section-panel';
    section.innerHTML = `<div class="panel-card"><div class="panel-card-header"><h3>Wallet</h3><span class="badge">Seller balance</span></div><div class="wallet-balance-card"><div class="wbc-label">Available balance</div><div class="wbc-amount" id="sellerBalanceAmount">L$0.00</div><div class="wbc-actions"><button class="primary-btn" id="sellerDepositButton" type="button">Deposit</button><button class="ghost-btn" id="sellerWithdrawButton" type="button">Withdraw</button></div></div><div class="wallet-summary-grid"><div class="summary-item"><div class="summary-label">Total Earnings</div><div class="summary-amount" id="sellerTotalEarnings">L$0.00</div></div><div class="summary-item"><div class="summary-label">Total Deposited</div><div class="summary-amount" id="sellerTotalDeposited">L$0.00</div></div><div class="summary-item"><div class="summary-label">Total Withdrawn</div><div class="summary-amount" id="sellerTotalWithdrawn">L$0.00</div></div><div class="summary-item"><div class="summary-label">Pending Balance</div><div class="summary-amount" id="sellerPendingBalance">L$0.00</div></div></div><div class="wallet-info-bar hidden" id="sellerDepositInfo"></div><form class="wallet-form-card hidden" id="sellerDepositForm"><h4>Submit deposit request</h4><div class="muted">Default payment is USD. Choose the payment method that matches your transfer before submitting.</div><label>Amount (USD default)<input name="amount" type="number" min="1" required /></label><label>Payment method<select name="paymentMethod"><option value="uba_usd" selected>UBA USD Account</option><option value="uba_lrd">UBA LRD Account</option><option value="orange_money">Orange Money</option><option value="lonestar_mobile_money">Lonestar Cell</option></select></label><label>Phone sent from<input name="senderPhone" type="tel" required /></label><label>Payment reference<input name="paymentRef" required /></label><div class="wfc-actions"><button class="primary-btn" type="submit">Submit request</button><button class="ghost-btn" id="cancelSellerDeposit" type="button">Cancel</button></div></form><form class="wallet-form-card hidden" id="sellerWithdrawForm"><h4>Request withdrawal</h4><p class="muted">Your balance will be deducted immediately and held until your request is processed.</p><label>Amount (LRD)<input name="amount" type="number" min="1" required /></label><label>Recipient name<input name="recipientName" required /></label><label>Mobile money number<input name="recipientPhone" type="tel" required /></label><div class="wfc-actions"><button class="primary-btn" type="submit">Request withdrawal</button><button class="ghost-btn" id="cancelSellerWithdraw" type="button">Cancel</button></div></form><div class="wallet-section-block"><h4>Withdrawal requests</h4><div id="sellerWithdrawalsList"></div></div><div class="wallet-section-block"><h4>Transaction history</h4><div id="sellerTransactionsList"></div></div></div>`;
    document.querySelector('.main-panel')?.appendChild(section);
    document.getElementById('sellerDepositButton')?.addEventListener('click', () => { document.getElementById('sellerDepositForm')?.classList.remove('hidden'); document.getElementById('sellerWithdrawForm')?.classList.add('hidden'); });
    document.getElementById('sellerWithdrawButton')?.addEventListener('click', () => { document.getElementById('sellerWithdrawForm')?.classList.remove('hidden'); document.getElementById('sellerDepositForm')?.classList.add('hidden'); });
    document.getElementById('cancelSellerDeposit')?.addEventListener('click', () => document.getElementById('sellerDepositForm')?.classList.add('hidden'));
    document.getElementById('cancelSellerWithdraw')?.addEventListener('click', () => document.getElementById('sellerWithdrawForm')?.classList.add('hidden'));
    document.getElementById('sellerDepositForm')?.addEventListener('submit', (event) => {
        event.preventDefault();
        const button = event.currentTarget.querySelector('button[type="submit"]');
        const data = Object.fromEntries(new FormData(event.currentTarget));
        withButtonState(button, async () => { const paymentMethod = data.paymentMethod || ''; const paymentCurrency = data.paymentCurrency || 'USD'; if (!paymentMethod) throw new Error('No payment method is configured for this currency.'); await submitDepositRequest(state.sellerId, 'seller', state.sellerProfile?.name || state.sellerProfile?.businessName, state.sellerProfile?.email || '', data.amount, data.paymentRef, data.senderPhone, paymentMethod, paymentCurrency); event.currentTarget.reset(); event.currentTarget.classList.add('hidden'); }, { loadingText: 'Submitting...', successText: 'Request sent', permanent: false });
    });
    document.getElementById('sellerWithdrawForm')?.addEventListener('submit', (event) => {
        event.preventDefault();
        const button = event.currentTarget.querySelector('button[type="submit"]');
        const data = Object.fromEntries(new FormData(event.currentTarget));
        withButtonState(button, async () => { await submitWithdrawalRequest(state.sellerId, 'seller', state.sellerProfile?.name || state.sellerProfile?.businessName, data.amount, data.recipientName, data.recipientPhone); event.currentTarget.reset(); event.currentTarget.classList.add('hidden'); }, { loadingText: 'Submitting...', successText: 'Request placed', permanent: false });
    });
}

async function initSellerWallet() {
    ensureSellerWalletSection();
    await autoReceiveOldWithdrawals(state.sellerId);
    const config = await loadWalletConfig();
    const depositForm = document.getElementById('sellerDepositForm');
    let currencySelect = depositForm?.querySelector('select[name="paymentCurrency"]');
    if (depositForm && !currencySelect) {
        currencySelect = document.createElement('select');
        currencySelect.name = 'paymentCurrency';
        currencySelect.innerHTML = '<option value="USD">USD</option><option value="LRD">LRD</option>';
        const methodField = depositForm.querySelector('select[name="paymentMethod"]')?.closest('label');
        const currencyLabel = Object.assign(document.createElement('label'), { textContent: 'Deposit currency' });
        currencyLabel.appendChild(currencySelect);
        methodField?.before(currencyLabel);
    }
    const methodSelect = depositForm?.querySelector('select[name="paymentMethod"]');
    const methodField = methodSelect?.closest('label');
    const methodCards = document.createElement('div');
    methodCards.className = 'payment-method-selector compact-payment-methods';
    methodCards.setAttribute('role', 'radiogroup');
    methodCards.setAttribute('aria-label', 'Deposit payment method');
    const methodValue = document.createElement('input');
    methodValue.type = 'hidden';
    methodValue.name = 'paymentMethod';
    methodSelect?.replaceWith(methodValue);
    methodField?.after(methodCards);
    const preview = document.createElement('img');
    preview.dataset.depositMethodImage = 'true';
    preview.style.cssText = 'width:48px;height:48px;object-fit:contain;border-radius:10px;margin:8px 0;';
    methodSelect?.after(preview);
    const updateDepositMethods = () => {
        const methods = window.getConfiguredDepositMethods?.(config, currencySelect?.value || 'USD') || [];
        methodCards.innerHTML = methods.length ? methods.map((method, index) => `<label class="payment-method-option compact-payment-method ${index === 0 ? 'selected' : ''}"><input type="radio" name="sellerDepositMethodChoice" value="${escapeHtml(method.value)}" ${index === 0 ? 'checked' : ''} /><img src="${escapeHtml(method.image || './images/logo/marketplace-logo.svg')}" alt="${escapeHtml(method.label)}" /><span>${escapeHtml(method.label)}</span><small>${escapeHtml(method.details)}</small></label>`).join('') : '<div class="muted">No payment method configured</div>';
        methodValue.value = methods[0]?.value || '';
        methodCards.querySelectorAll('input').forEach((input) => input.addEventListener('change', () => { methodValue.value = input.value; methodCards.querySelectorAll('.payment-method-option').forEach((card) => card.classList.toggle('selected', card.contains(input))); }));
        if (preview) { preview.src = methods[0]?.image || './images/logo/marketplace-logo.svg'; preview.alt = methods[0]?.label || 'Payment method'; }
    };
    currencySelect?.addEventListener('change', updateDepositMethods);
    methodCards.addEventListener('change', (event) => { const method = (window.getConfiguredDepositMethods?.(config, currencySelect?.value || 'USD') || []).find((entry) => entry.value === event.target.value); if (preview) { preview.src = method?.image || './images/logo/marketplace-logo.svg'; preview.alt = method?.label || 'Payment method'; } });
    updateDepositMethods();
    const info = document.getElementById('sellerDepositInfo');
    if (config.adminMobileNumber && info) { info.innerHTML = `<strong>Deposit instructions:</strong> Send mobile money to ${escapeHtml(config.adminMobileName || 'Manna Marketplace')} at ${escapeHtml(config.adminMobileNumber)}, then submit your reference.`; info.classList.remove('hidden'); }
    state.walletUnsubscribes.forEach((unsubscribe) => unsubscribe());
    state.walletUnsubscribes = [
        db.collection('sellers').doc(state.sellerId).onSnapshot((snapshot) => { const data = snapshot.data() || {}; const balance = Number(data.balance || 0); const balanceUSD = Number(data.balanceUSD || 0); const element = document.getElementById('sellerBalanceAmount'); if (element) element.textContent = `L$${balance.toLocaleString('en-LR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} • $${balanceUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }),
        db.collection('withdrawalRequests').where('userId', '==', state.sellerId).orderBy('createdAt', 'desc').onSnapshot((snapshot) => renderWalletRequests('sellerWithdrawalsList', snapshot.docs)),
    ];
    
    // Load and display transaction statistics
    const transactions = await loadTransactionHistory(state.sellerId);
    const container = document.getElementById('sellerTransactionsList');
    if (container) container.innerHTML = transactions.length ? transactions.map((transaction) => `<div class="wallet-tx-row"><span>${escapeHtml(transaction.description || transaction.type)}</span><strong class="${transaction.amount >= 0 ? 'amount-credit' : 'amount-debit'}">${transaction.amount >= 0 ? '+' : '-'}${formatLRD(Math.abs(transaction.amount))}</strong></div>`).join('') : '<div class="empty-state">No transactions yet.</div>';
    
    // Calculate wallet summary statistics
    const depositTransactions = transactions.filter((t) => t.type === 'deposit' && t.amount > 0);
    const withdrawalTransactions = transactions.filter((t) => t.type === 'withdrawal' && t.amount < 0);
    const earningTransactions = transactions.filter((t) => t.type === 'order_earning' && t.amount > 0);
    const totalDeposited = depositTransactions.reduce((sum, t) => sum + Number(t.amount || 0), 0);
    const totalWithdrawn = Math.abs(withdrawalTransactions.reduce((sum, t) => sum + Number(t.amount || 0), 0));
    const totalEarnings = earningTransactions.reduce((sum, t) => sum + Number(t.amount || 0), 0);
    
    // Get pending withdrawals
    const withdrawalsSnapshot = await db.collection('withdrawalRequests').where('userId', '==', state.sellerId).where('status', '==', 'pending').get();
    const pendingBalance = withdrawalsSnapshot.docs.reduce((sum, doc) => sum + Number(doc.data().amount || 0), 0);
    
    // Update summary displays
    const summaryElements = {
        'sellerTotalDeposited': totalDeposited,
        'sellerTotalWithdrawn': totalWithdrawn,
        'sellerTotalEarnings': totalEarnings,
        'sellerPendingBalance': pendingBalance
    };
    
    Object.entries(summaryElements).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = formatLRD(value);
    });
}

function renderWalletRequests(containerId, docs) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = docs.length ? docs.map((doc) => { const item = doc.data(); return `<div class="wallet-tx-row"><span>${formatLRD(item.amount)} to ${escapeHtml(item.recipientPhone)}</span><span class="status-badge status-${escapeHtml(item.status)}">${escapeHtml(item.status)}</span>${item.status === 'paid' ? `<button class="ghost-btn wallet-confirm-received" data-id="${doc.id}" type="button">Confirm received</button>` : ''}</div>`; }).join('') : '<div class="empty-state">No withdrawal requests yet.</div>';
    container.querySelectorAll('.wallet-confirm-received').forEach((button) => button.addEventListener('click', () => withButtonState(button, () => db.collection('withdrawalRequests').doc(button.dataset.id).update({ status: 'received', receivedAt: new Date() }), { loadingText: 'Confirming...', successText: 'Received', permanent: true })));
}

function ensureInternationalSection() {
    if (document.querySelector('[data-section="international-products"]')) return;
    const addButton = (container, className = 'nav-item') => {
        if (!container) return;
        const button = document.createElement('button');
        button.className = className;
        button.setAttribute('data-section', 'international-products');
        button.innerHTML = '<span class="nav-icon">$</span><span>International Products</span>';
        button.addEventListener('click', () => showSection('international-products'));
        container.appendChild(button);
    };
    addButton(document.querySelector('.nav-links'));
    addButton(document.querySelector('.mobile-nav-list'), 'nav-item mobile-nav-item');
}

function init() {
    bindEvents();
    ensureSellerWalletSection();
    const storageApi = initStorage();
    storage = storageApi;
    auth = storageApi.auth;
    db = storageApi.db;
    watchMaintenanceMode(db);
    if (auth) {
        auth.setPersistence().catch(() => { });
    }
    if (!auth || !db) {
        createToast('local storage is not ready yet. Please refresh the page.', 'error');
        return;
    }
    auth.onAuthStateChanged(handleAuthStateChange);
}

function bindEvents() {
    ensureFinancialSection();
    ensureInternationalSection();
    loginForm?.addEventListener('submit', handleLogin);
    registerForm?.addEventListener('submit', handleRegister);
    showRegisterButton?.addEventListener('click', () => toggleAuthMode(true));
    showLoginButton?.addEventListener('click', () => toggleAuthMode(false));
    forgotPasswordButton?.addEventListener('click', handleForgotPassword);
    logoutButton?.addEventListener('click', handleLogout);
    const openMobileMenu = (event) => {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        setMobileNavOpen(true);
    };
    mobileNavToggle?.addEventListener('click', openMobileMenu);
    sidebarToggle?.addEventListener('click', openMobileMenu);
    if (mobileNavClose) {
        mobileNavClose.addEventListener('click', () => setMobileNavOpen(false));
    }
    if (sidebarClose) {
        sidebarClose.addEventListener('click', () => setMobileNavOpen(false));
    }
    if (sidebarBackdrop) {
        sidebarBackdrop.addEventListener('click', () => setMobileNavOpen(false));
    }
    if (mobileMenuButton) {
        mobileMenuButton.addEventListener('click', () => setMobileNavOpen(true));
    }
    if (mobileNavSheet) {
        mobileNavSheet.addEventListener('click', (event) => {
            if (event.target === mobileNavSheet) {
                setMobileNavOpen(false);
            }
        });
    }
    document.getElementById('mobileLogoutButton')?.addEventListener('click', handleLogout);
    navItems.forEach((button) => {
        button.addEventListener('click', () => {
            const section = button.dataset.section;
            if (section) {
                showSection(section);
                if (window.innerWidth <= 1023) {
                    setMobileNavOpen(false);
                }
            }
        });
    });
    syncMobileNavItems();
    updateNotificationBadge();
    document.querySelectorAll('[data-section]').forEach((button) => {
        button.addEventListener('click', () => showSection(button.dataset.section));
    });
    document.querySelectorAll('[data-view]').forEach((button) => {
        button.addEventListener('click', () => {
            document.querySelectorAll('[data-view]').forEach((item) => item.classList.remove('active'));
            button.classList.add('active');
            state.viewMode = button.dataset.view;
            renderMenu();
        });
    });
    document.getElementById('catalogSearch')?.addEventListener('input', (event) => {
        state.catalogFilters.search = event.target.value.toLowerCase();
        renderCatalog();
    });
    document.getElementById('catalogCategoryFilter')?.addEventListener('change', (event) => {
        state.catalogFilters.category = event.target.value;
        renderCatalog();
    });
    document.getElementById('catalogStatusFilter')?.addEventListener('change', (event) => {
        state.catalogFilters.status = event.target.value;
        renderCatalog();
    });
    document.getElementById('menuSearch')?.addEventListener('input', (event) => {
        state.menuFilters.search = event.target.value.toLowerCase();
        renderMenu();
    });
    document.getElementById('menuCategoryFilter')?.addEventListener('change', (event) => {
        state.menuFilters.category = event.target.value;
        renderMenu();
    });
    document.getElementById('menuAvailabilityFilter')?.addEventListener('change', (event) => {
        state.menuFilters.availability = event.target.value;
        renderMenu();
    });
    document.getElementById('menuSort')?.addEventListener('change', (event) => {
        state.menuFilters.sort = event.target.value;
        renderMenu();
    });
    document.getElementById('orderStatusFilter')?.addEventListener('change', (event) => {
        state.orderFilter = event.target.value;
        renderOrders();
    });
    document.getElementById('saveProfileButton')?.addEventListener('click', saveProfile);
    document.getElementById('saveSettingsButton')?.addEventListener('click', saveSettings);
    supportButton?.addEventListener('click', () => showSection('help'));
    notificationsToggle?.addEventListener('click', () => {
        showSection('notifications');
        if (window.innerWidth <= 780) {
            setMobileNavOpen(false);
        }
    });
    document.getElementById('createPromotionButton')?.addEventListener('click', openPromotionModal);
    document.getElementById('createCouponButton')?.addEventListener('click', openCouponModal);
    document.getElementById('analyticsApplyRangeButton')?.addEventListener('click', () => renderAnalytics());
    document.getElementById('bulkActivateButton')?.addEventListener('click', () => bulkUpdateMenu(true));
    document.getElementById('bulkDeactivateButton')?.addEventListener('click', () => bulkUpdateMenu(false));
    document.getElementById('bulkDeleteButton')?.addEventListener('click', bulkDeleteMenu);
    document.getElementById('chatForm')?.addEventListener('submit', submitChat);
    document.querySelectorAll('[data-delivery-partners-tab]').forEach((button) => {
        button.addEventListener('click', () => {
            const tab = button.getAttribute('data-delivery-partners-tab');
            state.deliveryPartnersActiveTab = tab || 'all';
            renderDeliveryPartners();
        });
    });
    modalClose?.addEventListener('click', closeModal);
    modalBackdrop?.addEventListener('click', (event) => {
        if (event.target === modalBackdrop) closeModal();
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
            localStorage.setItem('manna-onboarding-seen-seller', 'true');
        });
    }
    if (onboardingOverlay && !localStorage.getItem('manna-onboarding-seen-seller')) {
        onboardingOverlay.classList.remove('hidden');
        onboardingOverlay.setAttribute('aria-hidden', 'false');
    }
}

function setMobileNavOpen(isOpen) {
    const isSmallScreen = window.innerWidth <= 1023;

    if (mobileNavSheet) {
        mobileNavSheet.classList.remove('open');
        mobileNavSheet.setAttribute('aria-hidden', 'true');
    }
    if (sidebar) {
        sidebar.classList.toggle('open', isSmallScreen && isOpen);
    }
    if (sidebarBackdrop) {
        sidebarBackdrop.classList.toggle('open', isSmallScreen && isOpen);
    }
    document.body.style.overflow = isSmallScreen && isOpen ? 'hidden' : '';
}

// ensure mobile nav mirrors desktop nav
function syncMobileNavItems() {
    const mobileList = document.querySelector('.mobile-nav-list');
    if (!mobileList) return;

    const desktopItems = Array.from(document.querySelectorAll('.nav-item[data-section]'))
        .filter((item) => !item.closest('.mobile-nav-list'));

    const preferredSections = [
        'dashboard', 'profile', 'catalog', 'menu', 'orders', 'reviews', 'promotions',
        'coupons', 'analytics', 'notifications', 'settings', 'chat'
    ];

    const sections = Array.from(new Set([...preferredSections, ...desktopItems.map((item) => item.getAttribute('data-section')).filter(Boolean)]));

    mobileList.innerHTML = '';
    sections.forEach((section) => {
        const sourceItem = desktopItems.find((item) => item.getAttribute('data-section') === section);
        const mobileBtn = document.createElement('button');
        mobileBtn.className = 'nav-item mobile-nav-item';
        mobileBtn.setAttribute('data-section', section);
        const icon = sourceItem?.querySelector('.nav-icon')?.innerHTML || '';
        const label = sourceItem?.textContent.trim() || section;
        mobileBtn.innerHTML = `<span class="nav-icon">${icon}</span><span>${label}</span>`;
        mobileList.appendChild(mobileBtn);
    });

    if (!mobileList.dataset.boundMobileNav) {
        mobileList.addEventListener('click', (event) => {
            const button = event.target.closest('.mobile-nav-item[data-section]');
            if (!button) return;
            const section = button.getAttribute('data-section');
            if (section) {
                showSection(section);
                if (window.innerWidth <= 1023) {
                    setMobileNavOpen(false);
                }
            }
        });
        mobileList.dataset.boundMobileNav = 'true';
    }
}

function updateNotificationBadge() {
    const count = (state.notifications || []).filter((item) => !item.read).length;
    const sectionBadge = document.getElementById('notificationBadge');
    const headerBadge = document.getElementById('notificationBadgeCount');

    if (sectionBadge) {
        sectionBadge.textContent = count ? `${count} unread` : '0 unread';
    }

    if (headerBadge) {
        headerBadge.textContent = `${count}`;
        headerBadge.classList.toggle('hidden', count === 0);
    }
}

function setActiveNavigation(section) {
    document.querySelectorAll('.nav-item[data-section], .mobile-nav-item[data-section]').forEach((button) => {
        button.classList.toggle('active', button.getAttribute('data-section') === section);
    });
}

function setupFinancialListeners() {
    if (!db || !state.sellerId) return;
    unsubscribeFinancialListeners();

    financialPayoutsUnsubscribe = db.collection('deliveryPayouts')
        .where('sellerId', '==', state.sellerId)
        .onSnapshot((snapshot) => {
            state.financialPayouts = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
            if (state.activeSection === 'financials') {
                renderFinancials();
            }
        });

    platformFeePaymentsUnsubscribe = db.collection('platformFeePayments')
        .where('sellerId', '==', state.sellerId)
        .onSnapshot((snapshot) => {
            state.platformFeePayments = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
            if (state.activeSection === 'financials') {
                renderFinancials();
            }
        });
}

function toggleAuthMode(showRegister) {
    loginForm.classList.toggle('hidden', showRegister);
    registerForm.classList.toggle('hidden', !showRegister);
    authMessage.textContent = '';
}

function setAuthPending(isPending, isRegister = false) {
    const button = isRegister ? registerButton : loginButton;
    button.disabled = isPending;
    button.textContent = isPending
        ? (isRegister ? 'Creating account...' : 'Signing in...')
        : (isRegister ? 'Create Account' : 'Sign In');
}

async function handleLogin(event) {
    event.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    if (!email || !password) {
        authMessage.textContent = 'Please enter your email and password.';
        return;
    }
    setAuthPending(true);
    try {
        await auth.signInWithEmailAndPassword(email, password);
        createToast('Signed in successfully', 'success');
    } catch (error) {
        authMessage.textContent = error.message;
        createToast(error.message, 'error');
    } finally {
        setAuthPending(false);
    }
}

async function handleRegister(event) {
    event.preventDefault();
    const businessName = document.getElementById('registerBusinessName').value.trim();
    const ownerName = document.getElementById('registerOwnerName').value.trim();
    const phone = document.getElementById('registerPhone').value.trim();
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;
    const confirmPassword = document.getElementById('registerConfirmPassword').value;

    if (!businessName || !ownerName || !phone || !email || !password) {
        authMessage.textContent = 'Please complete all seller registration details.';
        return;
    }

    if (password.length < 6) {
        authMessage.textContent = 'Password must be at least 6 characters.';
        return;
    }

    if (password !== confirmPassword) {
        authMessage.textContent = 'Passwords do not match.';
        return;
    }

    setAuthPending(true, true);
    try {
        const result = await auth.createUserWithEmailAndPassword(email, password);
        const user = result.user;
        await user.updateProfile({ displayName: ownerName });

        await db.collection('users').doc(user.uid).set({
            uid: user.uid,
            email,
            role: 'seller',
            displayName: ownerName,
            createdAt: new Date()
        });

        await db.collection('sellers').doc(user.uid).set({
            ownerUid: user.uid,
            ownerName,
            businessName,
            name: businessName,
            email,
            phone,
            address: '',
            city: '',
            county: '',
            description: '',
            logo: '',
            banner: '',
            openingHours: { open: '08:00', close: '22:00' },
            workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
            deliveryRadius: 8,
            estimatedPrepTime: 25,
            acceptedPaymentMethods: ['mobile_money', 'cash'],
            mobileMoneyNumber: '',
            orangeMoneyNumber: '',
            lonestarMoneyNumber: '',
            balance: 0,
            status: 'pending',
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date()
        });

        authMessage.textContent = 'Account created. Your seller is pending admin approval.';
        createToast('Account created. Your seller is pending admin approval.', 'success');
        document.getElementById('loginEmail').value = email;
        document.getElementById('loginPassword').value = password;
        toggleAuthMode(false);
    } catch (error) {
        authMessage.textContent = error.message;
        createToast(error.message, 'error');
    } finally {
        setAuthPending(false, true);
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
            createToast(error.message || 'Unable to send reset email.', 'error');
        }
        return;
    }
    try {
        await auth.sendPasswordResetEmail(email);
        createToast('Password reset email sent.', 'success');
    } catch (error) {
        createToast(error.message || 'Unable to send reset email.', 'error');
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
        state.authUser = null;
        state.sellerId = null;
        state.sellerProfile = null;
        authScreen.classList.remove('hidden');
        appShell.classList.add('hidden');
        authMessage.textContent = '';
    }
}

async function ensureSellerProfile(user, userData) {
    const sellerIdFromUser = userData?.sellerId || userData?.sellerDocId || null;
    if (sellerIdFromUser) {
        const directDoc = await db.collection('sellers').doc(sellerIdFromUser).get();
        if (directDoc.exists) {
            return {
                id: directDoc.id,
                data: directDoc.data()
            };
        }
    }

    const queryCandidates = [];
    if (user?.uid) {
        queryCandidates.push(db.collection('sellers').where('ownerUid', '==', user.uid).limit(1));
    }
    if (userData?.email) {
        queryCandidates.push(db.collection('sellers').where('email', '==', userData.email).limit(1));
    }
    if (userData?.businessName) {
        queryCandidates.push(db.collection('sellers').where('businessName', '==', userData.businessName).limit(1));
    }

    for (const query of queryCandidates) {
        const snapshot = await query.get();
        if (!snapshot.empty) {
            const doc = snapshot.docs[0];
            return {
                id: doc.id,
                data: doc.data()
            };
        }
    }

    const defaultSeller = {
        ownerUid: user.uid,
        ownerName: user.displayName || userData?.displayName || userData?.ownerName || userData?.businessName || 'Your Seller',
        businessName: userData?.businessName || 'Your Seller',
        name: userData?.businessName || 'Your Seller',
        email: userData?.email || user.email || '',
        phone: userData?.phone || '',
        address: userData?.address || '',
        city: userData?.city || '',
        county: userData?.county || '',
        category: userData?.category || '',
        description: '',
        logo: '',
        banner: '',
        openingHours: { open: '08:00', close: '22:00' },
        workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
        deliveryRadius: 8,
        estimatedPrepTime: 25,
        acceptedPaymentMethods: ['mobile_money', 'cash'],
        mobileMoneyNumber: '',
        orangeMoneyNumber: '',
        lonestarMoneyNumber: '',
        status: userData?.sellerStatus || userData?.status || 'pending',
        isActive: userData?.isApproved ?? (userData?.sellerStatus === 'approved' || userData?.status === 'approved'),
        createdAt: new Date(),
        updatedAt: new Date()
    };

    const sellerRef = db.collection('sellers').doc(user.uid);
    await sellerRef.set(defaultSeller, { merge: true });
    return {
        id: sellerRef.id,
        data: defaultSeller
    };
}

async function handleAuthStateChange(user) {
    if (!user) {
        if (state.authUser) {
            clearAuthBootstrapTimer();
            state.authUser = null;
            state.userProfile = null;
            state.sellerId = null;
            state.sellerProfile = null;
            authScreen.classList.remove('hidden');
            appShell.classList.add('hidden');
            return;
        }
        scheduleAuthFallback();
        return;
    }
    clearAuthBootstrapTimer();
    state.authUser = user;
    userBadge.textContent = user.email || 'Seller';
    try {
        const userDocRef = db.collection('users').doc(user.uid);
        let userDoc = await userDocRef.get();
        if (!userDoc.exists) {
            await userDocRef.set({ uid: user.uid, email: user.email, role: 'seller', createdAt: new Date() });
            userDoc = await userDocRef.get();
        }

        const userData = userDoc.exists ? userDoc.data() : {};
        applyThemePreference(userData);
        const role = userData.role || 'seller';
        if (isAdminOnlyEmail(user.email) || role !== 'seller') {
            authMessage.textContent = 'This account is not authorized for the seller panel.';
            authScreen.classList.remove('hidden');
            appShell.classList.add('hidden');
            createToast('Please use the correct panel for this account.', 'warning');
            return;
        }

        const resolvedSeller = await ensureSellerProfile(user, userData);
        const sellerData = resolvedSeller.data || {};
        const normalizedStatus = sellerData.status || userData.sellerStatus || userData.status || 'pending';
        const normalizedProfile = {
            ...sellerData,
            status: normalizedStatus,
            isActive: sellerData.isActive ?? (normalizedStatus === 'approved')
        };

        await userDocRef.set({
            uid: user.uid,
            email: userData.email || user.email || '',
            role: 'seller',
            displayName: user.displayName || userData.displayName || userData.ownerName || '',
            businessName: sellerData.businessName || userData.businessName || '',
            ownerName: sellerData.ownerName || userData.ownerName || user.displayName || '',
            phone: sellerData.phone || userData.phone || '',
            sellerId: resolvedSeller.id,
            sellerStatus: normalizedStatus,
            isApproved: normalizedStatus === 'approved',
            updatedAt: new Date()
        }, { merge: true });

        state.userProfile = {
            ...userData,
            uid: user.uid,
            email: userData.email || user.email || '',
            role: 'seller',
            displayName: user.displayName || userData.displayName || userData.ownerName || '',
            businessName: sellerData.businessName || userData.businessName || '',
            ownerName: sellerData.ownerName || userData.ownerName || user.displayName || '',
            phone: sellerData.phone || userData.phone || '',
            sellerId: resolvedSeller.id,
            sellerStatus: normalizedStatus,
            isApproved: normalizedStatus === 'approved'
        };
        state.sellerId = resolvedSeller.id;
        state.sellerProfile = normalizedProfile;
        setupFinancialListeners();
        authScreen.classList.add('hidden');
        appShell.classList.remove('hidden');
        showSection('dashboard');
        await loadSellerData();
        await initSellerWallet();
    } catch (error) {
        console.error(error);
        createToast(error.message || 'Could not initialize seller dashboard.', 'error');
    }
}

function cleanupListeners() {
    sellerNotificationSnapshotReady = false;
    state.notifications = [];
    state.walletUnsubscribes.forEach((unsubscribe) => unsubscribe());
    state.walletUnsubscribes = [];
    if (state.catalogPriceRuleExpiryTimer) window.clearTimeout(state.catalogPriceRuleExpiryTimer);
    state.catalogPriceRuleExpiryTimer = null;
    [state.sellerDocUnsubscribe, state.adminSettingsUnsubscribe, state.deliveryUsersUnsubscribe, state.menuUnsubscribe, state.ordersUnsubscribe, state.reviewsUnsubscribe, state.promotionsUnsubscribe, state.couponsUnsubscribe, state.notificationsUnsubscribe, state.settingsUnsubscribe, state.chatsUnsubscribe, state.categoriesUnsubscribe, state.orderChatUnsubscribe].forEach((unsubscribe) => {
        if (unsubscribe) unsubscribe();
    });
    Object.values(state.deliveryPartnersListeners || {}).forEach((unsubscribe) => {
        if (unsubscribe) unsubscribe();
    });
    state.deliveryPartnersListeners = {};
    state.sellerDocUnsubscribe = null;
    state.adminSettingsUnsubscribe = null;
    state.deliveryUsersUnsubscribe = null;
    state.menuUnsubscribe = null;
    state.ordersUnsubscribe = null;
    state.reviewsUnsubscribe = null;
    state.promotionsUnsubscribe = null;
    state.couponsUnsubscribe = null;
    state.notificationsUnsubscribe = null;
    state.settingsUnsubscribe = null;
    state.chatsUnsubscribe = null;
    state.categoriesUnsubscribe = null;
    state.orderChatUnsubscribe = null;
    state.activeOrderChatId = null;
    state.orderChatMessages = [];
}

function setupRealtimeListeners() {
    if (!state.sellerId) return;
    cleanupListeners();
    state.sellerDocUnsubscribe = db.collection('sellers').doc(state.sellerId).onSnapshot((doc) => {
        state.sellerProfile = doc.data() || {};
        renderProfileForm();
        renderDeliveryPartners();
        updateApprovalGate();
        renderAll();
    }, (error) => {
        console.error('[Manna Marketplace] Seller profile listener failed:', error);
    });
    state.adminSettingsUnsubscribe = db.collection('adminSettings').doc('config').onSnapshot((doc) => {
        const settings = doc.exists ? doc.data() || {} : {};
        const nextRule = getActiveCatalogPriceRule(settings);
        const ruleChanged = JSON.stringify(nextRule) !== JSON.stringify(state.adminCatalogPriceRule);
        if (state.catalogPriceRuleExpiryTimer) window.clearTimeout(state.catalogPriceRuleExpiryTimer);
        state.catalogPriceRuleExpiryTimer = null;
        state.adminCatalogPriceRule = nextRule;
        const expiresAt = Date.parse(nextRule?.expiresAt || '');
        if (Number.isFinite(expiresAt) && expiresAt > Date.now()) {
            state.catalogPriceRuleExpiryTimer = window.setTimeout(() => {
                state.adminCatalogPriceRule = getActiveCatalogPriceRule(settings);
                renderAll();
            }, Math.min(expiresAt - Date.now() + 50, 2147483647));
        }
        state.adminWhatsAppNumber = String(settings.adminWhatsAppNumber || '').trim();
        renderHelpSession();
        if (ruleChanged) renderAll();
    }, (error) => {
        console.error('[Manna Marketplace] Admin settings listener failed:', error);
    });
    state.categoriesUnsubscribe = db.collection('sellers').doc(state.sellerId).collection('categories').onSnapshot((snapshot) => {
        state.categories = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).sort((a, b) => (a.order || 0) - (b.order || 0));
        renderCategoryFilters();
        renderCatalog();
    }, (error) => {
        console.error('[Manna Marketplace] Seller categories listener failed:', error);
    });
    state.menuUnsubscribe = db.collection('sellers').doc(state.sellerId).collection('menu').onSnapshot((snapshot) => {
        state.menuItems = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        renderMenu();
        renderCatalog();
    }, (error) => {
        console.error('[Manna Marketplace] Seller menu listener failed:', error);
    });
    state.ordersUnsubscribe = db.collection('orders').where('sellerId', '==', state.sellerId).onSnapshot((snapshot) => {
        state.orders = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        renderOrders();
        renderDashboard();
    }, (error) => {
        console.error('[Manna Marketplace] Seller orders listener failed:', error);
    });
    state.reviewsUnsubscribe = db.collection('reviews').where('sellerId', '==', state.sellerId).onSnapshot((snapshot) => {
        state.reviews = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        renderReviews();
    }, (error) => {
        console.error('[Manna Marketplace] Seller reviews listener failed:', error);
    });
    state.promotionsUnsubscribe = db.collection('sellers').doc(state.sellerId).collection('promotions').onSnapshot((snapshot) => {
        state.promotions = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        renderPromotions();
    }, (error) => {
        console.error('[Manna Marketplace] Seller promotions listener failed:', error);
    });
    state.couponsUnsubscribe = db.collection('sellers').doc(state.sellerId).collection('coupons').onSnapshot((snapshot) => {
        state.coupons = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        renderCoupons();
    }, (error) => {
        console.error('[Manna Marketplace] Seller coupons listener failed:', error);
    });
    const recipientUid = state.authUser?.uid;
    if (recipientUid) {
        state.notificationsUnsubscribe = db.collection('notifications').where('recipientUid', '==', recipientUid).orderBy('createdAt', 'desc').onSnapshot({ includeMetadataChanges: true }, (snapshot) => {
            const notifications = snapshot.docs
                .map((doc) => ({ id: doc.id, ...doc.data() }))
                .filter((item) => !item.recipientRole || item.recipientRole === 'seller')
                .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
            if (sellerNotificationSnapshotReady && !snapshot.metadata.fromCache) {
                const existingIds = new Set(state.notifications.map((item) => item.id));
                if (notifications.some((item) => !item.read && !item.isDeleted && !existingIds.has(item.id))) {
                    playSoundEffect('notification');
                }
            }
            state.notifications = notifications;
            if (!snapshot.metadata.fromCache) sellerNotificationSnapshotReady = true;
            renderNotifications();
        }, (error) => {
            console.error('[Manna Marketplace] Seller notifications listener failed:', error);
        });
    } else {
        state.notifications = [];
        renderNotifications();
    }
    db.collection('deliveryRequests').where('sellerId', '==', state.sellerId).onSnapshot((snapshot) => {
        state.deliveryRequests = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        renderDeliveryRequests();
    }, (error) => {
        console.error('[Manna Marketplace] Seller delivery requests listener failed:', error);
    });
    db.collection('deliveryPartnerRequests').where('sellerId', '==', state.sellerId).onSnapshot((snapshot) => {
        state.deliveryPartnerRequests = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        renderDeliveryPartnerRequests();
        renderDeliveryPartners();
    }, (error) => {
        console.error('[Manna Marketplace] Seller delivery partner requests listener failed:', error);
    });
    state.settingsUnsubscribe = db.collection('sellers').doc(state.sellerId).collection('settings').doc('store').onSnapshot((doc) => {
        state.settings = doc.exists ? doc.data() : {};
        renderSettingsForm();
    }, (error) => {
        console.error('[Manna Marketplace] Seller settings listener failed:', error);
    });
    state.chatsUnsubscribe = db.collection('sellers').doc(state.sellerId).collection('chats').onSnapshot((snapshot) => {
        state.chats = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
        renderChat();
    }, (error) => {
        console.error('[Manna Marketplace] Seller chats listener failed:', error);
    });
    db.collection('helpArticles').where('targetRoles', 'array-contains', 'seller').onSnapshot((snapshot) => {
        state.helpArticles = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        renderHelpArticles();
    }, (error) => {
        console.error('[Manna Marketplace] Seller help articles listener failed:', error);
    });
    db.collection('supportRequests').where('sellerId', '==', state.sellerId).onSnapshot((snapshot) => {
        state.supportRequests = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        renderSupportRequests();
    }, (error) => {
        console.error('[Manna Marketplace] Seller support requests listener failed:', error);
    });
    state.deliveryUsersUnsubscribe = db.collection('users').where('role', '==', 'delivery_person').onSnapshot((snapshot) => {
        state.deliveryUsers = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        renderProfileForm();
        renderDeliveryPartners();
    }, (error) => {
        console.error('[Manna Marketplace] Delivery users listener failed:', error);
    });
}

async function loadSellerData() {
    if (!state.sellerId) return;
    try {
        setupRealtimeListeners();
        await Promise.all([
            loadMasterProducts(),
            loadInternationalProducts()
        ]);
        renderAll();
    } catch (error) {
        console.error(error);
        createToast('Unable to load seller data right now.', 'error');
    }
}

async function loadProfile() {
    const doc = await db.collection('sellers').doc(state.sellerId).get();
    state.sellerProfile = doc.data() || {};
    renderProfileForm();
    updateApprovalGate();
}

async function loadMasterProducts() {
    const snapshot = await db.collection('masterProducts').where('status', '==', 'active').get();
    state.masterProducts = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    renderCatalogFilters();
}

async function loadInternationalProducts() {
    const [offers, inventory] = await Promise.all([
        db.collection('internationalProducts').where('status', '==', 'active').get(),
        db.collection('sellers').doc(state.sellerId).collection('internationalInventory').get()
    ]);
    state.internationalProducts = offers.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    state.internationalInventory = inventory.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function loadCategories() {
    const snapshot = await db.collection('sellers').doc(state.sellerId).collection('categories').orderBy('order').get();
    state.categories = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    renderCategoryFilters();
}

async function loadMenuItems() {
    const snapshot = await db.collection('sellers').doc(state.sellerId).collection('menu').get();
    state.menuItems = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function loadOrders() {
    const snapshot = await db.collection('orders').where('sellerId', '==', state.sellerId).orderBy('createdAt', 'desc').get();
    state.orders = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function loadReviews() {
    const snapshot = await db.collection('reviews').where('sellerId', '==', state.sellerId).orderBy('createdAt', 'desc').get();
    state.reviews = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function loadPromotions() {
    const snapshot = await db.collection('sellers').doc(state.sellerId).collection('promotions').orderBy('createdAt', 'desc').get();
    state.promotions = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function loadCoupons() {
    const snapshot = await db.collection('sellers').doc(state.sellerId).collection('coupons').orderBy('createdAt', 'desc').get();
    state.coupons = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function loadNotifications() {
    if (!state.authUser?.uid) {
        state.notifications = [];
        return;
    }
    const snapshot = await db.collection('notifications').where('recipientUid', '==', state.authUser.uid).orderBy('createdAt', 'desc').get();
    state.notifications = snapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter((item) => !item.recipientRole || item.recipientRole === 'seller')
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
}

async function loadDeliveryRequests() {
    const snapshot = await db.collection('deliveryRequests').where('sellerId', '==', state.sellerId).get();
    state.deliveryRequests = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
}

async function loadSettings() {
    const doc = await db.collection('sellers').doc(state.sellerId).collection('settings').doc('store').get();
    state.settings = doc.exists ? doc.data() : {};
    renderSettingsForm();
}

async function loadChats() {
    const snapshot = await db.collection('sellers').doc(state.sellerId).collection('chats').orderBy('createdAt', 'asc').get();
    state.chats = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    renderChat();
}

function updateApprovalGate() {
    const banner = ensureApprovalBanner();
    const isApproved = state.sellerProfile?.status === 'approved' && state.sellerProfile?.isActive !== false;
    state.canSell = isApproved;

    if (!banner) return;

    if (!isApproved) {
        const status = state.sellerProfile?.status || 'pending';
        const title = status === 'suspended' ? 'Account suspended' : status === 'rejected' ? 'Application rejected' : 'Verification pending';
        const message = status === 'suspended'
            ? 'Your seller account has been suspended. Please contact support to restore access.'
            : status === 'rejected'
                ? 'Your seller application was not approved. Please contact support for next steps.'
                : 'Your seller is waiting for admin verification before you can start selling on the platform.';
        banner.innerHTML = `<strong>${title}</strong><span>${message}</span>`;
        banner.classList.remove('hidden');
    } else {
        banner.classList.add('hidden');
        banner.innerHTML = '';
    }

    navItems.forEach((button) => {
        const allowed = isApproved || button.dataset.section === 'profile';
        button.disabled = !allowed;
        button.classList.toggle('disabled', !allowed);
    });
}

function ensureApprovalBanner() {
    if (approvalBanner) return approvalBanner;
    const mainPanel = document.querySelector('.main-panel');
    if (!mainPanel) return null;
    approvalBanner = document.createElement('div');
    approvalBanner.className = 'approval-banner hidden';
    mainPanel.insertBefore(approvalBanner, mainPanel.firstChild);
    return approvalBanner;
}

function renderAll() {
    renderDashboard();
    renderProfileForm();
    renderDeliveryPartnerRequests();
    renderDeliveryPartners();
    renderHelpArticles();
    if (!state.canSell) {
        return;
    }
    renderCatalog();
    renderMenu();
    renderOrders();
    renderReviews();
    renderPromotions();
    renderCoupons();
    renderNotifications();
    renderAnalytics();
}

function setElementHtml(id, html) {
    const element = document.getElementById(id);
    if (element) {
        element.innerHTML = html;
    }
    return element;
}

function renderDashboard() {
    renderDeliveryRequests();
    renderDeliveryPartnerRequests();
    const stats = [
        { label: 'Today\'s Orders', value: state.orders.filter((order) => isToday(order.createdAt)).length, tone: 'stat-card' },
        { label: 'Today\'s Revenue', value: formatCurrency(sumRevenue(state.orders.filter((order) => isToday(order.createdAt) && ['delivered', 'received'].includes(order.status)))), tone: 'stat-card' },
        { label: 'Pending Orders', value: state.orders.filter((order) => order.status === 'pending').length, tone: 'stat-card' },
        { label: 'Low Stock', value: state.menuItems.filter((item) => item.stockStatus === 'low_stock').length, tone: 'stat-card' }
    ];
    setElementHtml('dashboardStats', stats.map((stat) => `
    <div class="panel-card stat-card">
      <h4>${stat.label}</h4>
      <div class="value">${stat.value}</div>
    </div>`).join(''));

    const recentOrders = state.orders.slice(0, 4);
    setElementHtml('recentOrdersList', recentOrders.length ? recentOrders.map((order) => `
    <div class="list-item">
      <div class="panel-card-header">
        <strong>#${order.orderNumber || order.id.slice(0, 6)}</strong>
        <span class="badge">${order.status || 'pending'}</span>
      </div>
      <div class="muted">${order.customerName || 'Customer'} • ${formatCurrency(order.total || 0)}</div>
    </div>`).join('') : '<div class="empty-state">No orders yet.</div>');

    const lowStock = state.menuItems.filter((item) => item.stockStatus === 'low_stock').slice(0, 5);
    setElementHtml('lowStockList', lowStock.length ? lowStock.map((item) => `
    <div class="list-item">
      <strong>${item.sellerDescription || item.name || 'Item'}</strong>
      <div class="muted">${item.stockStatus}</div>
    </div>`).join('') : '<div class="empty-state">Everything is stocked.</div>');
}

function renderDeliveryRequests() {
    const list = document.getElementById('deliveryRequestsList');
    if (!list) return;
    const visible = (state.deliveryRequests || []).filter((request) => request.sellerId === state.sellerId);
    list.innerHTML = visible.length ? visible.map((request) => `
    <div class="list-item">
      <div class="panel-card-header">
        <strong>${request.deliveryPersonName || 'Delivery person'}</strong>
        <span class="badge">${request.status || 'pending'}</span>
      </div>
      <div class="muted">${request.deliveryPersonEmail || ''}</div>
      <div class="muted">Requested ${request.createdAt ? new Date(request.createdAt.seconds ? request.createdAt.seconds * 1000 : request.createdAt).toLocaleString() : 'recently'}</div>
      <div class="modal-actions">
        ${request.status === 'pending' ? `<button class="primary-btn" data-delivery-request-action="approve" data-delivery-request-id="${request.id}">Approve</button><button class="ghost-btn" data-delivery-request-action="reject" data-delivery-request-id="${request.id}">Reject</button>` : '<span class="badge">Handled</span>'}
      </div>
    </div>`).join('') : '<div class="empty-state">No delivery requests yet.</div>';
    document.querySelectorAll('[data-delivery-request-action]').forEach((button) => {
        button.addEventListener('click', () => handleDeliveryRequestAction(button.dataset.deliveryRequestAction, button.dataset.deliveryRequestId));
    });
}

function renderCatalogFilters() {
    const categoryFilter = document.getElementById('catalogCategoryFilter');
    const categories = [...new Set(state.masterProducts.map((item) => getCategoryDisplayName(item.category)).filter(Boolean))];
    categoryFilter.innerHTML = '<option value="all">All categories</option>' + categories.map((category) => `<option value="${category}">${category}</option>`).join('');
}

function getSellerMenuDisplayPrice(item) {
    if (!item.masterProductId || item.isSellerOwned === true || item.orderFlow === 'seller_owned') {
        return Number(item.priceInLRD ?? item.price ?? 0);
    }
    const sellerMarkup = Number(item.sellerMarkup || 0);
    const basePrice = Number(item.defaultPrice ?? Math.max(0, Number(item.price || 0) - sellerMarkup));
    const pricing = getCatalogPriceBreakdown(basePrice, sellerMarkup, state.adminCatalogPriceRule, item.category);
    return convertCurrency(pricing.totalPrice, 'LRD', normalizeCurrency(item.currency));
}

function renderCategoryFilters() {
    const menuCategoryFilter = document.getElementById('menuCategoryFilter');
    if (!menuCategoryFilter) return;
    const categories = [...new Set(state.menuItems.map((item) => String(item.category || '').trim()).filter(Boolean))].sort((first, second) => first.localeCompare(second));
    if (state.menuFilters.category !== 'all' && !categories.includes(state.menuFilters.category)) state.menuFilters.category = 'all';
    menuCategoryFilter.innerHTML = '<option value="all">All categories</option>' + categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join('');
    menuCategoryFilter.value = state.menuFilters.category;
}

function renderCatalog() {
    const search = state.catalogFilters.search;
    const category = state.catalogFilters.category;
    const status = state.catalogFilters.status;
    const products = state.masterProducts.filter((product) => {
        const matchesSearch = !search || `${product.name} ${product.description || ''} ${product.category || ''}`.toLowerCase().includes(search);
        const matchesCategory = category === 'all' || product.category === category;
        const matchesStatus = status === 'all' || (status === 'active' ? product.status === 'active' : product.status !== 'active');
        return matchesSearch && matchesCategory && matchesStatus;
    });
    const addedMasterProductIds = new Set(state.menuItems.map((item) => item.masterProductId).filter(Boolean));
    products.sort((first, second) => Number(addedMasterProductIds.has(first.id)) - Number(addedMasterProductIds.has(second.id)));
    document.getElementById('catalogGrid').innerHTML = products.length ? products.map((product, index) => `
    <div class="menu-item-card">
    <img src="./images/placeholder.png" data-mobile-loader data-mobile-src="${escapeHtml(getProductThumbnailUrl(product.imageFilename || product.image || ''))}" data-full-src="${escapeHtml(getImageUrl(product.imageFilename || product.image || ''))}" loading="${index < 4 ? 'eager' : 'lazy'}" fetchpriority="${index < 2 ? 'high' : 'auto'}" decoding="async" alt="${escapeHtml(product.name)}" />
      <div class="panel-card-header">
        <strong>${product.name}</strong>
        <span class="badge">${product.category || 'General'}</span>
      </div>
            <div class="muted">Current catalog price: ${formatCurrency(getCatalogPriceBreakdown(product.defaultPrice ?? product.standardPrice ?? product.price ?? 0, product.sellerMarkup || 0, state.adminCatalogPriceRule, product.category).totalPrice, 'LRD')}</div>
    ${renderExpandableDescription(product.description || 'A fresh menu option ready for your store.')}
      <div class="modal-actions">
        <button class="primary-btn" data-add-product="${product.id}">Add to My Store</button>
      </div>
    </div>`).join('') : '<div class="empty-state">No catalog items found.</div>';
    document.querySelectorAll('[data-add-product]').forEach((button) => {
        const productId = button.dataset.addProduct;
        const alreadyAdded = state.menuItems.some((item) => item.masterProductId === productId);
        if (alreadyAdded) {
            setButtonReflectedState?.(button, 'success', 'In My Store');
            return;
        }
        button.addEventListener('click', () => withButtonState(button, () => addToMenu(productId), {
            loadingText: 'Adding...',
            successText: 'In My Store',
            permanent: true
        }));
    });
}

function renderInternationalCatalog() {
    const catalog = document.getElementById('catalogGrid');
    if (!catalog) return;
    catalog.innerHTML = state.internationalProducts.length ? state.internationalProducts.map((product) => {
        const owned = state.internationalInventory.find((item) => item.internationalProductId === product.id);
        return `<div class="menu-item-card"><div class="panel-card-header"><strong>${escapeHtml(product.name)}</strong><span class="badge">${formatCurrency(product.wholesalePrice || 0, product.currency || 'USD')}</span></div>${renderExpandableDescription(product.description || 'International wholesale product')}<div class="muted">Minimum quantity: ${Number(product.minimumQuantity || 1)}</div><div class="modal-actions"><button class="primary-btn" data-buy-international="${product.id}" ${owned ? 'disabled' : ''}>${owned ? 'Purchased' : 'Buy for resale'}</button>${owned ? `<button class="ghost-btn" data-edit-international="${owned.id}">Edit resale details</button>` : ''}</div></div>`;
    }).join('') : '<div class="empty-state">No international products are available yet.</div>';
    catalog.querySelectorAll('[data-buy-international]').forEach((button) => button.addEventListener('click', () => buyInternationalProduct(button.dataset.buyInternational)));
    catalog.querySelectorAll('[data-edit-international]').forEach((button) => button.addEventListener('click', () => editInternationalInventory(button.dataset.editInternational)));
}

async function buyInternationalProduct(productId) {
    const product = state.internationalProducts.find((item) => item.id === productId);
    if (!product) return;
    const quantity = Number(window.prompt(`Quantity to buy (minimum ${product.minimumQuantity || 1})`, product.minimumQuantity || 1));
    if (!Number.isInteger(quantity) || quantity < Number(product.minimumQuantity || 1)) {
        createToast('Enter a valid quantity at or above the minimum.', 'warning');
        return;
    }
    const master = state.masterProducts.find((item) => item.id === product.masterProductId) || {};
    await db.collection('sellers').doc(state.sellerId).collection('internationalInventory').add({ internationalProductId: product.id, masterProductId: product.masterProductId, name: product.name || master.name, sourceDescription: product.description || master.description || '', image: master.image || master.imageFilename || '', imageFilename: master.imageFilename || master.image || '', purchasePrice: Number(product.wholesalePrice || 0), purchaseCurrency: product.currency || 'USD', quantity, resalePrice: Number(product.wholesalePrice || 0), resaleCurrency: product.currency || 'USD', resaleDescription: product.description || master.description || '', status: 'active', purchasedAt: new Date(), createdAt: new Date(), updatedAt: new Date() });
    await loadInternationalProducts();
    renderInternationalCatalog();
    createToast('International product added to your resale inventory.', 'success');
}

function editInternationalInventory(inventoryId) {
    const item = state.internationalInventory.find((entry) => entry.id === inventoryId);
    if (!item) return;
    modalTitle.textContent = 'Edit Resale Product';
    modalBody.innerHTML = `<form id="internationalInventoryForm" class="form-grid"><label>Resale Price<input name="resalePrice" type="number" min="0" step="0.01" value="${item.resalePrice || 0}" /></label><label>Currency<select name="resaleCurrency"><option value="USD" ${item.resaleCurrency !== 'LRD' ? 'selected' : ''}>USD</option><option value="LRD" ${item.resaleCurrency === 'LRD' ? 'selected' : ''}>LRD</option></select></label><label>Quantity<input name="quantity" type="number" min="0" value="${item.quantity || 0}" /></label><label class="full">Resale Details<textarea name="resaleDescription">${escapeHtml(item.resaleDescription || '')}</textarea></label></form>`;
    modalActions.innerHTML = '<button class="ghost-btn" id="cancelEditor">Cancel</button><button class="primary-btn" id="saveInternationalInventory">Save</button>';
    modalBackdrop.classList.remove('hidden');
    document.getElementById('saveInternationalInventory').addEventListener('click', async () => {
        const data = Object.fromEntries(new FormData(document.getElementById('internationalInventoryForm')));
        await db.collection('sellers').doc(state.sellerId).collection('internationalInventory').doc(inventoryId).update({ resalePrice: Number(data.resalePrice || 0), resaleCurrency: data.resaleCurrency, quantity: Number(data.quantity || 0), resaleDescription: data.resaleDescription || '', updatedAt: new Date() });
        closeModal();
        await loadInternationalProducts();
        renderInternationalCatalog();
    });
    document.getElementById('cancelEditor').addEventListener('click', closeModal);
}

function renderMenu() {
    renderCategoryFilters();
    const filtered = state.menuItems.filter((item) => {
        const term = `${item.sellerDescription || ''} ${item.sellerTags?.join(' ') || ''}`.toLowerCase();
        const matchesSearch = !state.menuFilters.search || term.includes(state.menuFilters.search) || (item.name || '').toLowerCase().includes(state.menuFilters.search);
        const matchesCategory = state.menuFilters.category === 'all' || item.category === state.menuFilters.category;
        const matchesAvailability = state.menuFilters.availability === 'all' || (state.menuFilters.availability === 'available' ? item.availability : !item.availability);
        return matchesSearch && matchesCategory && matchesAvailability;
    });
    const sorted = [...filtered].sort((first, second) => {
        if (state.menuFilters.sort === 'price') return (first.price || 0) - (second.price || 0);
        if (state.menuFilters.sort === 'popularity') return (second.popularity || 0) - (first.popularity || 0);
        if (state.menuFilters.sort === 'name') return (first.name || '').localeCompare(second.name || '');
        const firstCreatedAt = getMenuItemCreatedAt(first);
        const secondCreatedAt = getMenuItemCreatedAt(second);
        return secondCreatedAt - firstCreatedAt;
    });
    const content = document.getElementById('menuContent');
    if (state.viewMode === 'list') {
        content.innerHTML = sorted.length ? `
      <div class="list-stack">
        ${sorted.map((item) => `
          <div class="list-item table-row">
            <input type="checkbox" data-select-menu="${item.id}" />
            <div>
              <strong>${item.name || 'Untitled item'}</strong>
              <div class="muted">${item.category || 'General'}</div>
                            <div class="muted">${formatCurrency(getSellerMenuDisplayPrice(item), item.currency || 'LRD')}</div>
            </div>
            <div>${formatCurrency(item.price || 0, item.isSellerOwned === true ? item.currency : 'LRD')}</div>
            <label><input type="checkbox" data-toggle-availability="${item.id}" ${item.availability ? 'checked' : ''} /> Available</label>
            <button class="ghost-btn" data-edit-menu="${item.id}">Edit</button>
            <button class="ghost-btn" data-share-menu="${item.id}">Share link</button>
            <button class="danger-btn" data-delete-menu="${item.id}">Remove from store</button>
          </div>`).join('')}
    </div>` : '<div class="empty-state">Your store is empty.</div>';
    } else {
                content.innerHTML = sorted.length ? sorted.map((item, index) => `
      <div class="menu-item-card">
                <img src="./images/placeholder.png" data-mobile-loader data-mobile-src="${escapeHtml(getProductThumbnailUrl(item.imageFilename || item.image || ''))}" data-full-src="${escapeHtml(getImageUrl(item.imageFilename || item.image || ''))}" loading="${index < 4 ? 'eager' : 'lazy'}" fetchpriority="${index < 2 ? 'high' : 'auto'}" decoding="async" alt="${escapeHtml(item.name || 'Menu item')}" />
        <div class="panel-card-header">
          <strong>${item.name || 'Untitled item'}</strong>
          <span class="badge">${item.category || 'General'}</span>
        </div>
                <div class="muted">${formatCurrency(getSellerMenuDisplayPrice(item), item.currency || 'LRD')}</div>
        ${renderExpandableDescription(item.sellerDescription || 'Custom seller description')}
        <div class="modal-actions">
          <label class="badge"><input type="checkbox" data-toggle-availability="${item.id}" ${item.availability ? 'checked' : ''} /> Available</label>
          <button class="ghost-btn" data-edit-menu="${item.id}">Edit</button>
          <button class="ghost-btn" data-share-menu="${item.id}">Share link</button>
          <button class="danger-btn" data-delete-menu="${item.id}">Remove from store</button>
        </div>
    </div>`).join('') : '<div class="empty-state">Your store is empty.</div>';
    }
    document.querySelectorAll('[data-toggle-availability]').forEach((checkbox) => {
        checkbox.addEventListener('change', (event) => toggleMenuAvailability(event.target.dataset.toggleAvailability, event.target.checked));
    });
    document.querySelectorAll('[data-edit-menu]').forEach((button) => {
        button.addEventListener('click', () => openMenuEditor(button.dataset.editMenu));
    });
    document.querySelectorAll('[data-share-menu]').forEach((button) => {
        button.addEventListener('click', () => shareMenuItem(button.dataset.shareMenu));
    });
    document.querySelectorAll('[data-delete-menu]').forEach((button) => {
        button.addEventListener('click', () => deleteMenuItem(button.dataset.deleteMenu));
    });
    document.querySelectorAll('[data-select-menu]').forEach((checkbox) => {
        checkbox.addEventListener('change', (event) => {
            if (event.target.checked) state.selectedMenuIds.add(event.target.dataset.selectMenu);
            else state.selectedMenuIds.delete(event.target.dataset.selectMenu);
        });
    });
}

function getMenuItemCreatedAt(item) {
    const createdAt = item.createdAt;
    if (typeof createdAt?.toMillis === 'function') return createdAt.toMillis();
    if (Number.isFinite(createdAt?.seconds)) return createdAt.seconds * 1000;
    const timestamp = new Date(createdAt || 0).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function getMenuItemShareUrl(menuId) {
    const shareUrl = new URL('https://celadon-kleicha-be1d68.netlify.app/');
    shareUrl.searchParams.set('sellerId', state.sellerId);
    shareUrl.searchParams.set('productId', menuId);
    return shareUrl.href;
}

async function shareMenuItem(menuId) {
    const item = state.menuItems.find((entry) => entry.id === menuId);
    if (!item || !state.sellerId) return;
    const copied = await copyText(getMenuItemShareUrl(menuId));
    createToast(copied ? 'Product checkout link copied.' : 'Unable to copy the product link.', copied ? 'success' : 'error');
}

function renderOrders() {
    const filtered = state.orders.filter((order) => !order.isDeleted && order.paymentStatus === 'confirmed' && (state.orderFilter === 'all' || order.status === state.orderFilter));
    document.getElementById('ordersList').innerHTML = filtered.length ? filtered.map((order) => {
        const currentStatus = order.status || 'pending';
        const shouldDisableActions = Boolean(order.archived);
        const isReceived = currentStatus === 'received';
        const readyButtonClass = ['preparing', 'ready'].includes(currentStatus) && !shouldDisableActions ? 'primary-btn is-active' : 'ghost-btn';
        const rejectButtonClass = ['preparing', 'ready'].includes(currentStatus) && !shouldDisableActions ? 'ghost-btn' : 'ghost-btn';
        const rejectDisabled = ['cancelled', 'delivered', 'received'].includes(currentStatus) || shouldDisableActions;
        const readyDisabled = !['preparing', 'ready'].includes(currentStatus) || shouldDisableActions;
        return `
    <div class="list-item ${shouldDisableActions ? 'archived-order-card' : ''}">
      <div class="panel-card-header">
        <strong>${order.customerName || 'Customer'} • #${order.orderNumber || order.id.slice(0, 6)}</strong>
        <span class="badge">${currentStatus}</span>
      </div>
      <div class="muted">${formatCurrency(order.total || 0)} • ${order.address || 'No address provided'}</div>
    ${(Array.isArray(order.items) ? order.items : []).map((item) => {
        const variants = getVariantDisplayEntries(item);
        return variants.length ? `<div class="muted">${escapeHtml(item.name || 'Item')}: ${variants.map((variant) => `${escapeHtml(variant.label)} ${escapeHtml(variant.value)}`).join(' • ')}</div>` : '';
    }).join('')}
    ${order.items?.length ? `<img src="./images/placeholder.png" data-mobile-loader data-mobile-src="${escapeHtml(getProductThumbnailUrl(order.items[0]?.imagePath || order.items[0]?.image || order.items[0]?.imageFilename || ''))}" data-full-src="${escapeHtml(getImageUrl(order.items[0]?.imagePath || order.items[0]?.image || order.items[0]?.imageFilename || ''))}" loading="lazy" decoding="async" alt="${escapeHtml(order.items[0]?.name || 'Item')}" style="width:64px;height:64px;object-fit:cover;border-radius:12px;margin-top:8px;" />` : ''}
    ${order.customizationRequested ? `<div class="customization-order-panel"><strong>Customized order</strong><div class="muted">${escapeHtml(order.customizationDetails || 'Customer will send design details through admin WhatsApp.')}</div><div class="muted">Customization fee: ${order.customizationFeePaymentStatus === 'waived' ? 'Waived' : order.customizationFeePaymentStatus === 'paid' ? 'Paid' : 'Awaiting admin/customer payment confirmation'}</div></div>` : ''}
    ${order.customizationRequested && !canFulfillCustomizedOrder(order) ? '<div class="muted">This order stays on hold until the customization fee is confirmed.</div>' : ''}
      <div class="muted">Delivery: ${order.deliveryLocationLabel || 'Standard'} • ${order.deliveryLandmark || order.deliveryDetails || 'No landmark provided'}</div>
    <div class="muted">Payment: ${order.paymentMethod || 'pending'} • Phone: ${order.paymentPhone || order.customerPhone || '—'} • Placed: ${formatDate(order.placedAt || order.createdAt)} • Estimated delivery: ${order.estimatedDeliveryTime ? formatDate(order.estimatedDeliveryTime) : 'Pending'}</div>
      <div class="muted">Partner: ${order.deliveryPersonName || (order.deliveryPersonUid ? 'Assigned delivery person' : 'Awaiting assignment')} • Refund: ${order.refundStatus || 'none'}${order.refundRequested ? ' • requested by customer' : ''}</div>
      <div class="modal-actions">
                ${isReceived ? `<button class="ghost-btn" data-open-order-chat="${order.id}">Chat</button>` : `
        <button class="${readyButtonClass}" data-order-action="ready" data-order-id="${order.id}" ${readyDisabled ? 'disabled' : ''}>Ready</button>
        <button class="${rejectButtonClass}" data-order-action="reject" data-order-id="${order.id}" ${rejectDisabled ? 'disabled' : ''}>Reject</button>
        ${order.refundStatus === 'requested' ? `<button class="ghost-btn" data-order-action="approve-refund" data-order-id="${order.id}">Approve Refund</button><button class="ghost-btn" data-order-action="reject-refund" data-order-id="${order.id}">Reject Refund</button>` : ''}
        <button class="ghost-btn" data-order-action="details" data-order-id="${order.id}">Details</button>
        <button class="ghost-btn" data-open-order-chat="${order.id}">Chat</button>
        `}
      </div>
    </div>`;
    }).join('') : '<div class="empty-state">No orders found.</div>';
    document.querySelectorAll('[data-order-action]').forEach((button) => {
        button.addEventListener('click', () => handleOrderAction(button.dataset.orderAction, button.dataset.orderId));
    });
    document.querySelectorAll('[data-open-order-chat]').forEach((button) => {
        button.addEventListener('click', () => openOrderChat(button.dataset.openOrderChat));
    });
}

function renderReviews() {
    document.getElementById('reviewsList').innerHTML = state.reviews.length ? state.reviews.map((review) => `
    <div class="review-card">
      <div class="panel-card-header">
        <strong>${review.customerName || 'Anonymous'}</strong>
        <span class="badge">${'★'.repeat(review.rating || 0)}</span>
      </div>
      <div class="muted">${review.reviewText || review.text || 'No review text yet.'}</div>
      <div class="modal-actions">
        <button class="ghost-btn" data-reply-review="${review.id}">Reply</button>
        <button class="ghost-btn" data-report-review="${review.id}">Report</button>
      </div>
    </div>`).join('') : '<div class="empty-state">No reviews yet.</div>';
    document.querySelectorAll('[data-reply-review]').forEach((button) => {
        button.addEventListener('click', () => replyToReview(button.dataset.replyReview));
    });
    document.querySelectorAll('[data-report-review]').forEach((button) => {
        button.addEventListener('click', () => reportReview(button.dataset.reportReview));
    });
}

function renderPromotions() {
        const eligibleProducts = state.menuItems.filter((item) => item.masterProductId && item.isSellerOwned !== true && Number(item.defaultPrice || 0) > 0 && Number(item.sellerMarkup || 0) > 0);
        document.getElementById('promotionsList').innerHTML = state.promotions.length ? state.promotions.map((promotion) => {
                const scopeLabel = promotion.scope === 'selected'
                        ? (promotion.productIds || []).map((productId) => eligibleProducts.find((item) => item.id === productId)?.name).filter(Boolean).join(', ') || 'Selected products'
                        : 'All eligible products';
                return `
    <div class="promotion-card">
            <strong>${escapeHtml(promotion.title || 'Promotion')}</strong>
            <div class="muted">${escapeHtml(promotion.description || '')}</div>
            <div class="badge">${Number(promotion.discountPercent || 0)}% off seller profit</div>
            <div class="muted">${escapeHtml(scopeLabel)}</div>
            <div class="muted">${escapeHtml(promotion.validFrom || 'Now')} to ${escapeHtml(promotion.validUntil || 'No end date')} · ${escapeHtml(promotion.status || 'active')}</div>
        </div>`;
        }).join('') : '<div class="empty-state">No promotions yet.</div>';
}

function renderCoupons() {
        const eligibleProducts = state.menuItems.filter((item) => item.masterProductId && item.isSellerOwned !== true && Number(item.defaultPrice || 0) > 0 && Number(item.sellerMarkup || 0) > 0);
        document.getElementById('couponsList').innerHTML = state.coupons.length ? state.coupons.map((coupon) => {
                const scopeLabel = coupon.scope === 'selected'
                        ? (coupon.productIds || []).map((productId) => eligibleProducts.find((item) => item.id === productId)?.name).filter(Boolean).join(', ') || 'Selected products'
                        : 'All eligible products';
                return `
    <div class="coupon-card">
      <div class="panel-card-header">
                <strong>${escapeHtml(coupon.code || '')}</strong>
                <span class="badge">${escapeHtml(coupon.status || 'active')}</span>
      </div>
            <div class="muted">${coupon.type === 'percentage' ? `${Number(coupon.value)}% of seller profit` : `${formatCurrency(Number(coupon.value || 0), 'LRD')} from seller profit`}</div>
            <div class="muted">${escapeHtml(scopeLabel)}</div>
            <div class="muted">Minimum ${formatCurrency(Number(coupon.minimumOrderValue || 0), 'LRD')} · Expires ${escapeHtml(coupon.expiryDate || 'Never')}</div>
        </div>`;
        }).join('') : '<div class="empty-state">No coupons yet.</div>';
}

function renderNotifications() {
    const visible = state.notifications.filter((item) => !item.isDeleted);
    updateNotificationBadge();
    document.getElementById('notificationBadge').textContent = `${visible.filter((item) => !item.read).length} unread`;
    document.getElementById('notificationsList').innerHTML = `
            <div class="action-row notification-actions" style="margin-bottom: 12px;">
        <button class="ghost-btn" data-clear-all-notifications="true" ${visible.length ? '' : 'disabled'}>Clear all</button>
                ${renderSoundToggle()}
      </div>
      ${visible.length ? visible.map((item) => `
      <div class="list-item">
        <strong>${item.title || 'Notification'}</strong>
        <div class="muted">${item.message || ''}</div>
        <div class="modal-actions">
          <button class="ghost-btn" data-read-notification="${item.id}">Mark read</button>
          <button class="ghost-btn" data-delete-notification="${item.id}">Delete</button>
        </div>
      </div>`).join('') : '<div class="empty-state">No notifications yet.</div>'}`;
    document.querySelectorAll('[data-clear-all-notifications]').forEach((button) => {
        button.addEventListener('click', clearAllNotifications);
    });
    document.querySelectorAll('[data-read-notification]').forEach((button) => {
        button.addEventListener('click', () => markNotificationRead(button.dataset.readNotification));
    });
    document.querySelectorAll('[data-delete-notification]').forEach((button) => {
        button.addEventListener('click', () => deleteNotification(button.dataset.deleteNotification));
    });
    bindSoundToggle(document.getElementById('notificationsList'));
}

function renderAnalytics() {
    const startDateInput = document.getElementById('analyticsStartDate');
    const endDateInput = document.getElementById('analyticsEndDate');
    const startDate = startDateInput?.value ? new Date(`${startDateInput.value}T00:00:00`) : null;
    const endDate = endDateInput?.value ? new Date(`${endDateInput.value}T23:59:59`) : null;

    const totals = state.orders.filter((order) => ['delivered', 'received'].includes(order.status) && isDateInRange(order.createdAt, startDate, endDate));
    const revenue = sumRevenue(totals);
    const avgOrder = totals.length ? revenue / totals.length : 0;
    const refundAmount = state.orders.filter((order) => ['refunded', 'refund_requested'].includes(order.status) || order.refundRequested).filter((order) => isDateInRange(order.createdAt, startDate, endDate)).reduce((sum, order) => sum + Number(order.refundAmount || order.total || 0), 0);
    const pendingOrders = state.orders.filter((order) => order.status === 'pending' && isDateInRange(order.createdAt, startDate, endDate)).length;
    const cancellationRate = totals.length ? Math.round((totals.filter((order) => order.status === 'cancelled').length / totals.length) * 100) : 0;
    const feeRevenue = totals.reduce((sum, order) => sum + Number(order.deliveryFee || 0), 0);
    const netEarnings = revenue - feeRevenue;

    document.getElementById('analyticsSummary').innerHTML = `
    <div class="panel-card stat-card"><h4>Revenue</h4><div class="value">${formatCurrency(revenue)}</div></div>
    <div class="panel-card stat-card"><h4>Net earnings</h4><div class="value">${formatCurrency(netEarnings)}</div></div>
    <div class="panel-card stat-card"><h4>Orders</h4><div class="value">${totals.length}</div></div>
    <div class="panel-card stat-card"><h4>Average Order</h4><div class="value">${formatCurrency(avgOrder)}</div></div>
    <div class="panel-card stat-card"><h4>Pending Orders</h4><div class="value">${pendingOrders}</div></div>
    <div class="panel-card stat-card"><h4>Refunded</h4><div class="value">${formatCurrency(refundAmount)}</div></div>`;

    const chartSeries = totals.length ? totals.slice(0, 8).map((order) => ({
        label: order.orderNumber || order.id.slice(0, 6),
        amount: Number(order.total || 0),
        date: order.createdAt ? new Date(order.createdAt.seconds ? order.createdAt.seconds * 1000 : order.createdAt) : new Date()
    })) : [];

    document.getElementById('revenueChart').innerHTML = chartSeries.length ? `
      <div class="stack">
        ${chartSeries.map((entry) => `
          <div class="list-item">
            <div class="panel-card-header">
              <strong>${entry.label}</strong>
              <span>${formatCurrency(entry.amount)}</span>
            </div>
            <div class="muted">${entry.date.toLocaleDateString('en-LR', { month: 'short', day: 'numeric' })}</div>
          </div>`).join('')}
      </div>` : '<div class="empty-state">No completed orders in the selected range.</div>';

    const productRows = state.menuItems.slice(0, 6).map((item) => `
      <div class="panel-card-header">
        <strong>${item.name || 'Item'}</strong>
        <span>${item.availability ? 'Live' : 'Offline'}</span>
      </div>`).join('');
    document.getElementById('productChart').innerHTML = productRows || '<div class="empty-state">No menu items yet.</div>';
    document.getElementById('analyticsInsights').innerHTML = `
      <div class="panel-card inset-card">
        <h4>Snapshot</h4>
        <div class="muted">Revenue range: ${formatCurrency(revenue)} • Delivery fees: ${formatCurrency(feeRevenue)}</div>
        <div class="muted">Cancellation rate: ${cancellationRate}% • Refunds: ${formatCurrency(refundAmount)}</div>
      </div>`;
}

function renderProfileForm() {
    const form = document.getElementById('profileForm');
    const profile = state.sellerProfile || {};
    const selectedCategory = String(profile.category || '').trim().toLowerCase();
    const categoryOptions = getCategoryOptions().map((category) => `<option value="${escapeHtml(category.name)}" ${selectedCategory === category.id.toLowerCase() || selectedCategory === category.name.toLowerCase() ? 'selected' : ''}>${escapeHtml(category.name)} (${escapeHtml(category.group)})</option>`).join('');
    const availableDeliveryUsers = state.deliveryUsers.filter((user) => user.status === 'approved' && user.isActive !== false);
    const deliveryUsersOptions = availableDeliveryUsers.length ? availableDeliveryUsers.map((user) => `<option value="${user.uid || user.id}">${user.displayName || user.email || 'Delivery person'}</option>`).join('') : '<option value="">No delivery people available yet</option>';
    const sellerDeliveryUids = Array.from(new Set([
        ...(profile.deliveryPersons || []),
        ...(state.deliveryUsers || [])
            .filter((user) => (user.approvedSellers || []).includes(state.sellerId))
            .map((user) => user.uid || user.id)
            .filter(Boolean)
    ])).filter(Boolean);
    const assignedChips = sellerDeliveryUids.length ? sellerDeliveryUids.map((uid) => {
        const user = state.deliveryUsers.find((entry) => (entry.uid || entry.id) === uid);
        return `<div class="chip">${user?.displayName || user?.email || uid}</div>`;
    }).join('') : '<div class="empty-state">No delivery partners assigned yet.</div>';
    const ownerDisplayName = profile.ownerName || profile.businessName || state.authUser?.email || 'Seller';
    const assignedChipsWithAvatars = sellerDeliveryUids.length ? sellerDeliveryUids.map((uid) => {
        const user = state.deliveryUsers.find((entry) => (entry.uid || entry.id) === uid);
        const userName = user?.displayName || user?.email || uid;
        return `<div class="chip" style="display: flex; align-items: center; gap: 8px; padding: 4px 12px;">${getAvatarHtml(userName, '24px')} <span>${escapeHtml(userName)}</span></div>`;
    }).join('') : '<div class="empty-state">No delivery partners assigned yet.</div>';
    form.innerHTML = `
    <div style="display: flex; gap: 20px; margin-bottom: 20px; align-items: flex-start;">
      <div style="flex-shrink: 0;">
        ${getAvatarHtml(ownerDisplayName, '80px')}
      </div>
      <div style="flex: 1;">
        <p class="muted" style="margin: 0 0 8px 0;">Your profile avatar</p>
        <p style="font-size: 12px; color: var(--muted); margin: 0;">Shown as ${escapeHtml(ownerDisplayName)}'s initials. Add a store image below to replace it.</p>
      </div>
    </div>
    <label class="full">Business Name<input name="businessName" value="${profile.businessName || ''}" /></label>
    <label>Owner Name<input name="ownerName" value="${profile.ownerName || ''}" /></label>
    <label>Phone<input name="phone" type="tel" value="${profile.phone || ''}" /></label>
    <label>WhatsApp Number<input name="whatsappNumber" type="tel" value="${profile.whatsappNumber || profile.phone || ''}" placeholder="e.g. +231770000000" /></label>
    <label class="full">Store Website or Link<input name="websiteUrl" type="url" value="${escapeHtml(profile.websiteUrl || '')}" placeholder="https://example.com/your-store" /></label>
    <label>Mobile money receiver<input name="mobileMoneyNumber" type="tel" value="${profile.mobileMoneyNumber || ''}" /></label>
    <label>Orange Money Phone Number<input name="orangeMoneyNumber" type="tel" value="${profile.orangeMoneyNumber || ''}" /></label>
    <label>Lonestar Cell Phone Number<input name="lonestarMoneyNumber" type="tel" value="${profile.lonestarMoneyNumber || ''}" /></label>
    <label>Facebook URL<input name="facebookUrl" type="url" value="${profile.facebookUrl || ''}" placeholder="https://facebook.com/your-page" /></label>
    <label>Instagram URL<input name="instagramUrl" type="url" value="${profile.instagramUrl || ''}" placeholder="https://instagram.com/your-page" /></label>
    <label>YouTube URL<input name="youtubeUrl" type="url" value="${profile.youtubeUrl || ''}" placeholder="https://youtube.com/@your-channel" /></label>
    <label>Email<input name="email" value="${profile.email || state.authUser?.email || ''}" /></label>
    <label>Address<input name="address" value="${profile.address || ''}" /></label>
    <label>City<input name="city" value="${profile.city || ''}" /></label>
    <label>County<input name="county" value="${profile.county || ''}" /></label>
        <label>Seller Category<select name="category" required>
            <option value="">Choose a marketplace category</option>
            ${categoryOptions}
        </select></label>
    <label>Community<select name="community">
      <option value="">Select community</option>
      ${getCommunityOptions().map((community) => `<option value="${escapeHtml(community)}" ${profile.community === community ? 'selected' : ''}>${escapeHtml(community)}</option>`).join('')}
    </select></label>
    <label>District<input name="district" value="${profile.district || ''}" /></label>
        <label>Image Path<input name="imagePath" id="sellerProfileImagePath" value="${profile.imagePath || profile.logo || profile.image || ''}" /></label>
        <div class="seller-profile-image-preview" style="display: grid; gap: 6px; margin-top: -4px;">
            <img id="sellerProfileImagePreview" src="${getSellerImageUrl(profile)}" alt="Seller image preview" style="display: ${profile.imagePath || profile.logo || profile.image ? 'block' : 'none'}; width: 100%; max-width: 280px; height: 150px; object-fit: cover; border-radius: 12px;" />
            <span id="sellerProfileImageStatus" class="muted" style="font-size: 12px;">${profile.imagePath || profile.logo || profile.image ? 'Checking image path...' : 'Enter an image filename or path to preview it.'}</span>
        </div>
    <label>Banner Path<input name="banner" value="${profile.banner || ''}" /></label>
    <label class="full">Description<textarea name="description">${profile.description || ''}</textarea></label>
    <label>Opening Time<input name="open" value="${profile.openingHours?.open || ''}" /></label>
    <label>Closing Time<input name="close" value="${profile.openingHours?.close || ''}" /></label>
    <label>Delivery Radius<input name="deliveryRadius" type="number" value="${profile.deliveryRadius || 5}" /></label>
    <label>Standard Delivery Time (days)<input name="standardDeliveryDays" type="number" min="0.25" step="0.25" value="${profile.standardDeliveryDays ?? ''}" placeholder="Uses marketplace default" /></label>
    <label>Prep Time<input name="estimatedPrepTime" type="number" value="${profile.estimatedPrepTime || 20}" /></label>
    ${getQRCardHTML('sellerQrContainer', 'sellerQrCard')}
  `;
    initQRCode('sellerQrContainer');
    bindQRDownloadHandlers();
    const imagePathInput = document.getElementById('sellerProfileImagePath');
    const imagePreview = document.getElementById('sellerProfileImagePreview');
    const imageStatus = document.getElementById('sellerProfileImageStatus');
    let imagePreviewTimer = null;
    const updateImagePreview = () => {
        const imagePath = imagePathInput?.value.trim() || '';
        if (!imagePath) {
            imagePreview.style.display = 'none';
            imageStatus.textContent = 'Enter an image filename or path to preview it.';
            return;
        }
        imagePreview.style.display = 'block';
        imageStatus.textContent = 'Checking image path...';
        imagePreview.onload = () => {
            imageStatus.textContent = 'Image loaded successfully.';
        };
        imagePreview.onerror = () => {
            imageStatus.textContent = 'Image not found. Check the filename or path.';
        };
        imagePreview.src = getSellerImageUrl(imagePath);
    };
    const scheduleImagePreview = () => {
        window.clearTimeout(imagePreviewTimer);
        imagePreviewTimer = window.setTimeout(updateImagePreview, 300);
    };
    imagePathInput?.addEventListener('input', scheduleImagePreview);
    imagePathInput?.addEventListener('change', updateImagePreview);
    if (imagePathInput?.value.trim()) updateImagePreview();
    form.insertAdjacentHTML('afterend', `
      <div class="panel-card">
        <div class="panel-card-header">
          <h4>Delivery partners</h4>
          <button class="primary-btn" id="assignDeliveryPartnerButton" type="button">Assign partner</button>
        </div>
        <label>Select delivery person<select id="deliveryPartnerSelect">${deliveryUsersOptions}</select></label>
        <div class="chip-row">${assignedChipsWithAvatars}</div>
      </div>
    `);
    const assignButton = document.getElementById('assignDeliveryPartnerButton');
    if (assignButton) {
        assignButton.addEventListener('click', assignDeliveryPartner);
    }
}

function renderSettingsForm() {
    const form = document.getElementById('settingsForm');
    const settings = state.settings || {};
    form.innerHTML = `
    ${renderThemePreferenceControl()}
    <label>Opening Time<input name="open" value="${settings.open || ''}" /></label>
    <label>Closing Time<input name="close" value="${settings.close || ''}" /></label>
    <label>Delivery Radius<input name="deliveryRadius" type="number" value="${settings.deliveryRadius || 5}" /></label>
    <label>Minimum Order Value<input name="minimumOrderValue" type="number" value="${settings.minimumOrderValue || 0}" /></label>
    <label>Prep Time<input name="estimatedPrepTime" type="number" value="${settings.estimatedPrepTime || 20}" /></label>
    <label><input type="checkbox" name="vacationMode" ${settings.vacationMode ? 'checked' : ''} /> Vacation Mode</label>
    <label><input type="checkbox" name="breakMode" ${state.sellerProfile?.isActive === false ? 'checked' : ''} /> Break Mode</label>
    <label><input type="checkbox" name="acceptOrders" ${settings.acceptOrders !== false ? 'checked' : ''} /> Accept Orders</label>
    <label><input type="checkbox" name="autoAccept" ${settings.autoAccept ? 'checked' : ''} /> Auto Accept</label>
  `;
        bindThemePreferenceControl(form, {
                db,
                userId: state.authUser?.uid,
                onError: () => createToast('Theme changed on this device, but could not sync to your account.', 'warning')
        });
}

function renderChat() {
    const container = document.getElementById('chatMessages');
    container.innerHTML = state.chats.length ? state.chats.map((message) => `
    <div class="message ${message.sender === state.authUser?.uid ? 'self' : ''}">${message.text}</div>`).join('') : '<div class="empty-state">No messages yet.</div>';
}

function renderSupportRequests() {
    const container = document.getElementById('supportRequestsList');
    if (!container) return;
    container.innerHTML = state.supportRequests.length ? state.supportRequests.map((request) => `
    <div class="list-item">
      <strong>${request.subject || request.category || 'Support request'}</strong>
      <div class="muted">${request.message || ''}</div>
      <div class="muted">${request.email || ''}</div>
      <span class="badge">${request.status || 'new'}</span>
    </div>`).join('') : '<div class="empty-state">No support requests yet.</div>';
}

async function generateDeliveryPayout() {
    const selectedDeliveryUid = document.getElementById('financialPayoutDeliverySelect')?.value;
    if (!selectedDeliveryUid) {
        createToast('Select a delivery person first.', 'warning');
        return;
    }
    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - 7);
    const periodEnd = new Date();
    const ordersSnapshot = await db.collection('orders')
        .where('sellerId', '==', state.sellerId)
        .where('deliveryPersonUid', '==', selectedDeliveryUid)
        .where('status', '==', 'delivered')
        .get();

    let totalDeliveryFees = 0;
    ordersSnapshot.forEach((doc) => {
        const data = doc.data() || {};
        const deliveredAt = data.deliveredAt?.toDate ? data.deliveredAt.toDate() : data.deliveredAt ? new Date(data.deliveredAt) : null;
        if (deliveredAt && deliveredAt >= periodStart && deliveredAt <= periodEnd) {
            totalDeliveryFees += Number(data.deliveryFee || 0);
        }
    });

    if (!totalDeliveryFees) {
        createToast('No completed deliveries were found for that period.', 'warning');
        return;
    }

    const payoutPayload = {
        sellerId: state.sellerId,
        deliveryPersonUid: selectedDeliveryUid,
        deliveryPersonName: state.deliveryUsers.find((entry) => (entry.uid || entry.id) === selectedDeliveryUid)?.displayName || selectedDeliveryUid,
        periodStart,
        periodEnd,
        totalDeliveryFees,
        status: 'pending',
        paymentReference: '',
        payerPhone: '',
        amountPaid: 0,
        createdAt: new Date(),
        updatedAt: new Date()
    };
    await db.collection('deliveryPayouts').add(payoutPayload);
    await createNotification(selectedDeliveryUid, 'Payout request created', `A payout request for ${formatCurrency(totalDeliveryFees)} is waiting for your confirmation.`, 'payout_due', 'delivery_person');
    createToast('Delivery payout request created.', 'success');
}

async function generatePlatformFee() {
    const settingsDoc = await db.collection('adminSettings').doc('config').get();
    const settings = settingsDoc.data() || {};
    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - 7);
    const periodEnd = new Date();
    const ordersSnapshot = await db.collection('orders')
        .where('sellerId', '==', state.sellerId)
        .where('status', '==', 'delivered')
        .get();

    let totalSales = 0;
    let totalDeliveryFees = 0;
    ordersSnapshot.forEach((doc) => {
        const data = doc.data() || {};
        const deliveredAt = data.deliveredAt?.toDate ? data.deliveredAt.toDate() : data.deliveredAt ? new Date(data.deliveredAt) : null;
        if (deliveredAt && deliveredAt >= periodStart && deliveredAt <= periodEnd) {
            totalSales += Number(data.total || 0);
            totalDeliveryFees += Number(data.deliveryFee || 0);
        }
    });

    const totalSalesExcludingDelivery = Math.max(0, totalSales - totalDeliveryFees);
    const feeAmount = settings.platformFeeType === 'percentage'
        ? totalSalesExcludingDelivery * (Number(settings.platformFeeValue || 0) / 100)
        : Number(settings.platformFeeValue || 0);

    const feePayload = {
        sellerId: state.sellerId,
        periodStart,
        periodEnd,
        totalSalesExcludingDelivery,
        feeAmount,
        status: 'pending',
        paymentReference: '',
        payerPhone: '',
        amountPaid: 0,
        createdAt: new Date(),
        updatedAt: new Date()
    };
    await db.collection('platformFeePayments').add(feePayload);
    await createNotification(state.authUser?.uid, 'Platform fee due', `A platform fee of ${formatCurrency(feeAmount)} is ready to be paid.`, 'fee_due', 'seller');
    createToast('Platform fee payment record created.', 'success');
}

async function markPayoutAsPaid(payoutId) {
    const payout = state.financialPayouts.find((entry) => entry.id === payoutId);
    if (!payout) return;
    const paymentReference = window.prompt('Enter the payment reference');
    const payerPhone = window.prompt('Enter the payer phone number');
    const amountPaid = window.prompt('Enter the amount paid', String(payout.totalDeliveryFees || 0));
    if (!paymentReference || !payerPhone || !amountPaid) {
        createToast('Please fill all payment details before submitting.', 'warning');
        return;
    }
    await db.collection('deliveryPayouts').doc(payoutId).set({
        status: 'paid',
        paymentReference: paymentReference.trim(),
        payerPhone: payerPhone.trim(),
        amountPaid: Number(amountPaid || 0),
        updatedAt: new Date()
    }, { merge: true });
    const deliveryPersonUid = payout.deliveryPersonUid;
    if (deliveryPersonUid) {
        await createNotification(deliveryPersonUid, 'Payment marked as made', `The seller marked a payout of ${formatCurrency(Number(amountPaid || 0))} as paid.`, 'payout_awaiting_confirmation', 'delivery_person');
    }
    createToast('Payout marked as paid.', 'success');
}

async function markFeeAsPaid(feeId) {
    const fee = state.platformFeePayments.find((entry) => entry.id === feeId);
    if (!fee) return;
    const paymentReference = window.prompt('Enter the payment reference');
    const payerPhone = window.prompt('Enter the payer phone number');
    const amountPaid = window.prompt('Enter the amount paid', String(fee.feeAmount || 0));
    if (!paymentReference || !payerPhone || !amountPaid) {
        createToast('Please fill all payment details before submitting.', 'warning');
        return;
    }
    await db.collection('platformFeePayments').doc(feeId).set({
        status: 'paid',
        paymentReference: paymentReference.trim(),
        payerPhone: payerPhone.trim(),
        amountPaid: Number(amountPaid || 0),
        updatedAt: new Date()
    }, { merge: true });

    const adminQuery = await db.collection('users').where('role', '==', 'admin').limit(1).get();
    if (!adminQuery.empty) {
        const adminUser = adminQuery.docs[0];
        await createNotification(adminUser.id, 'Fee payment pending confirmation', `A platform fee payment of ${formatCurrency(Number(amountPaid || 0))} is waiting for confirmation.`, 'fee_awaiting_confirmation', 'admin');
    }
    createToast('Platform fee marked as paid.', 'success');
}

function renderFinancials() {
    const container = document.getElementById('financialsContent');
    if (!container) return;

    const payouts = (state.financialPayouts || []).filter((entry) => !entry.isDeleted).sort((a, b) => Number(b.createdAt?.seconds || b.createdAt || 0) - Number(a.createdAt?.seconds || a.createdAt || 0));
    const fees = (state.platformFeePayments || []).filter((entry) => !entry.isDeleted).sort((a, b) => Number(b.createdAt?.seconds || b.createdAt || 0) - Number(a.createdAt?.seconds || a.createdAt || 0));
    const payoutOptions = Array.from(new Set(
        state.orders
            .filter((order) => order.deliveryPersonUid && order.status === 'delivered')
            .map((order) => order.deliveryPersonUid)
            .filter(Boolean)
    ));
    const payoutSelectOptions = payoutOptions.length ? payoutOptions.map((uid) => {
        const deliveryUser = state.deliveryUsers.find((entry) => (entry.uid || entry.id) === uid);
        return `<option value="${uid}">${deliveryUser?.displayName || deliveryUser?.email || uid}</option>`;
    }).join('') : '<option value="">No completed deliveries yet</option>';

    container.innerHTML = `
      <div class="financial-grid">
        <div class="panel-card financial-card">
          <div class="panel-card-header">
            <h4>Delivery payouts</h4>
            <button class="primary-btn" type="button" data-financial-action="generate-payout">Generate payout</button>
          </div>
          <label>Delivery person<select id="financialPayoutDeliverySelect">${payoutSelectOptions}</select></label>
          ${payouts.length ? payouts.map((payout) => `
            <div class="financial-item">
              <div class="panel-card-header">
                <strong>${payout.deliveryPersonName || payout.deliveryPersonUid || 'Delivery person'}</strong>
                <span class="status-badge ${payout.status || 'pending'}">${(payout.status || 'pending').replace(/_/g, ' ')}</span>
              </div>
              <div class="muted">${formatCurrency(payout.totalDeliveryFees || 0)} • ${formatDate(payout.createdAt)}</div>
              <div class="muted">Reference: ${payout.paymentReference || 'Pending upload'}</div>
              ${payout.status === 'pending' ? `<div class="action-row"><button class="primary-btn" data-financial-action="mark-payout-paid" data-id="${payout.id}">Mark as paid</button></div>` : ''}
            </div>`).join('') : '<div class="empty-state">No delivery payouts created yet.</div>'}
        </div>
        <div class="panel-card financial-card">
          <div class="panel-card-header">
            <h4>Platform fees</h4>
            <button class="primary-btn" type="button" data-financial-action="generate-fee">Generate fee</button>
          </div>
          ${fees.length ? fees.map((fee) => `
            <div class="financial-item">
              <div class="panel-card-header">
                <strong>${formatCurrency(fee.feeAmount || 0)}</strong>
                <span class="status-badge ${fee.status || 'pending'}">${(fee.status || 'pending').replace(/_/g, ' ')}</span>
              </div>
              <div class="muted">Period: ${formatDate(fee.periodStart)} → ${formatDate(fee.periodEnd)}</div>
              <div class="muted">Reference: ${fee.paymentReference || 'Pending upload'}</div>
              ${fee.status === 'pending' ? `<div class="action-row"><button class="primary-btn" data-financial-action="mark-fee-paid" data-id="${fee.id}">Mark as paid</button></div>` : ''}
            </div>`).join('') : '<div class="empty-state">No platform fee payments generated yet.</div>'}
        </div>
      </div>
    `;

    container.querySelectorAll('[data-financial-action]').forEach((button) => {
        button.addEventListener('click', async () => {
            const action = button.dataset.financialAction;
            const id = button.dataset.id;
            if (action === 'generate-payout') {
                await generateDeliveryPayout();
            } else if (action === 'generate-fee') {
                await generatePlatformFee();
            } else if (action === 'mark-payout-paid') {
                await markPayoutAsPaid(id);
            } else if (action === 'mark-fee-paid') {
                await markFeeAsPaid(id);
            }
        });
    });
}

function renderHelpSession() {
    const formContainer = document.getElementById('helpSessionContent');
    const articleList = document.getElementById('helpArticlesList');
    if (!formContainer || !articleList) return;
    formContainer.innerHTML = `
    <div class="panel-card">
      <div class="panel-card-header">
        <h4>Need help?</h4>
        <span class="badge">Send a suggestion to Manna Marketplace</span>
      </div>
            ${state.adminWhatsAppNumber ? `<div class="action-row"><a class="primary-btn" href="https://wa.me/${String(state.adminWhatsAppNumber).replace(/[^\d]/g, '')}?text=${encodeURIComponent(`Hello Manna Marketplace admin, I need help with my seller account.`)}" target="_blank" rel="noopener noreferrer">Contact admin on WhatsApp</a></div>` : '<div class="muted">Admin WhatsApp support is not configured yet.</div>'}
      <form id="helpRequestForm" class="form-grid">
        <label>Topic<select name="category">
          <option value="account">Account</option>
          <option value="orders">Orders</option>
          <option value="payments">Payments</option>
          <option value="technical">Technical</option>
          <option value="other">Other</option>
        </select></label>
        <label>Subject<input name="subject" value="Support request" /></label>
        <label class="full">Message<textarea name="message" required placeholder="Tell us what you need help with."></textarea></label>
        <label>Email<input name="email" value="${state.authUser?.email || ''}" /></label>
        <div class="modal-actions"><button class="primary-btn" type="submit">Send suggestion</button></div>
      </form>
    </div>`;
    if (!document.getElementById('helpArticleCategoryFilter')) {
        articleList.insertAdjacentHTML('beforebegin', `
          <div class="help-filter-row">
            <select id="helpArticleCategoryFilter">
              <option value="">All categories</option>
              <option value="getting started">Getting started</option>
              <option value="orders">Orders</option>
              <option value="payments">Payments</option>
              <option value="account">Account</option>
              <option value="delivery">Delivery</option>
              <option value="technical">Technical</option>
            </select>
            <input id="helpArticleTagFilter" type="text" placeholder="Filter by tag" />
          </div>`);
        document.getElementById('helpArticleCategoryFilter')?.addEventListener('change', renderHelpArticles);
        document.getElementById('helpArticleTagFilter')?.addEventListener('input', renderHelpArticles);
    }
    document.getElementById('helpRequestForm')?.addEventListener('submit', handleHelpRequestSubmit);
    renderHelpArticles();
}

async function handleHelpRequestSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    const payload = {
        sellerId: state.sellerId,
        sellerName: state.sellerProfile?.businessName || state.sellerProfile?.name || '',
        panel: 'seller',
        category: data.category || 'other',
        subject: data.subject || data.category || 'Support request',
        message: String(data.message || '').trim(),
        email: String(data.email || state.authUser?.email || '').trim(),
        status: 'new',
        createdAt: new Date()
    };
    if (!payload.message) {
        createToast('Please describe your issue before sending.', 'warning');
        return;
    }
    try {
        await db.collection('supportRequests').add(payload);
        form.reset();
        createToast('Support request sent. The admin team will review it.', 'success');
    } catch (error) {
        createToast(error.message || 'Unable to send support request.', 'error');
    }
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
      <div class="help-card__body">
        <h4>${article.title || 'Help article'}</h4>
        <p>${article.description || ''}</p>
        <div class="action-row" style="flex-wrap: wrap; gap: 8px;">
          ${article.featured ? '<span class="badge featured-badge">📌 Featured</span>' : ''}
          ${article.category ? `<span class="badge">${article.category}</span>` : ''}
          ${(Array.isArray(article.tags) ? article.tags : String(article.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean)).map((tag) => `<span class="badge">${tag}</span>`).join('')}
        </div>
        <div class="action-row">
          ${article.videoUrl ? `<a class="primary-btn" href="${article.videoUrl}" target="_blank" rel="noopener noreferrer">Watch video</a>` : '<span class="badge">Video coming soon</span>'}
        </div>
      </div>
    </div>`;
    container.innerHTML = filteredArticles.length ? `
      <div class="stack">
        ${featuredArticles.length ? `<div class="help-featured-section"><div class="panel-card-header"><h4>Featured guides</h4></div>${featuredArticles.map(renderArticleCard).join('')}</div>` : ''}
        ${regularArticles.length ? `<div class="help-featured-section"><div class="panel-card-header"><h4>More guides</h4></div>${regularArticles.map(renderArticleCard).join('')}</div>` : ''}
      </div>` : '<div class="empty-state">No help articles match the current filters.</div>';
}

function renderDeliveryPartnerRequests() {
    const container = document.getElementById('deliveryPartnerRequestsList');
    if (!container) return;
    const entries = state.deliveryPartnerRequests || [];
    container.innerHTML = entries.length ? entries.map((request) => `
    <div class="list-item">
      <div class="panel-card-header">
        <strong>${request.deliveryPersonName || 'Delivery person'}</strong>
        <span class="badge">${request.status || 'pending'}</span>
      </div>
      <div class="muted">${request.deliveryPersonEmail || ''}</div>
      <div class="muted">${request.message || 'Requested to join your delivery network.'}</div>
      ${request.status === 'pending' ? `<div class="modal-actions"><button class="primary-btn" data-delivery-request-action="approve" data-delivery-request-id="${request.id}">Approve</button><button class="ghost-btn" data-delivery-request-action="reject" data-delivery-request-id="${request.id}">Reject</button></div>` : ''}
    </div>`).join('') : '<div class="empty-state">No delivery partner requests yet.</div>';
    document.querySelectorAll('[data-delivery-request-action]').forEach((button) => {
        button.addEventListener('click', () => handleDeliveryRequestAction(button.dataset.deliveryRequestAction, button.dataset.deliveryRequestId));
    });
}

function renderDeliveryPartners() {
    const container = document.getElementById('deliveryPartnersContent');
    if (!container) return;
    console.log('[delivery-partners] rendering', {
        sellerId: state.sellerId,
        activeTab: state.deliveryPartnersActiveTab || 'all',
        deliveryUsers: state.deliveryUsers || []
    });
    document.querySelectorAll('[data-delivery-partners-tab]').forEach((button) => {
        button.classList.toggle('active', button.getAttribute('data-delivery-partners-tab') === (state.deliveryPartnersActiveTab || 'all'));
    });

    const allUsers = (state.deliveryUsers || [])
        .filter((user) => user && (user.role || '').toLowerCase() === 'delivery_person' && user.status === 'approved' && user.isActive !== false)
        .sort((a, b) => (a.displayName || a.name || a.email || '').localeCompare(b.displayName || b.name || b.email || ''));

    const approvedUsers = allUsers.filter((user) => (user.approvedSellers || []).includes(state.sellerId));
    const activeTab = state.deliveryPartnersActiveTab || 'all';
    const visibleUsers = activeTab === 'approved' ? approvedUsers : allUsers;
    const matchingUsers = visibleUsers.filter((user) => {
        const search = state.deliveryPersonsFilter?.search || '';
        const haystack = `${user.displayName || user.name || ''} ${user.email || ''} ${user.phone || ''} ${user.address || ''}`.toLowerCase();
        const matchesSearch = !search || haystack.includes(search.toLowerCase());
        const matchesLocation = state.deliveryPersonsFilter?.location === 'all' || !state.deliveryPersonsFilter?.location || (user.area || user.location || '').toLowerCase().includes(state.deliveryPersonsFilter.location.toLowerCase());
        const matchesVehicle = state.deliveryPersonsFilter?.vehicle === 'all' || !state.deliveryPersonsFilter?.vehicle || (user.vehicleType || '').toLowerCase() === state.deliveryPersonsFilter.vehicle.toLowerCase();
        const matchesRating = state.deliveryPersonsFilter?.rating === 'all' || !state.deliveryPersonsFilter?.rating || (Number(user.rating || 0) >= Number(state.deliveryPersonsFilter.rating));
        const matchesOnline = state.deliveryPersonsFilter?.online === 'all' || !state.deliveryPersonsFilter?.online || (state.deliveryPersonsFilter.online === 'online' ? Boolean(user.isOnline) : !user.isOnline);
        return matchesSearch && matchesLocation && matchesVehicle && matchesRating && matchesOnline;
    });

    const shownUsers = matchingUsers.slice(0, state.deliveryPersonsLoadedCount || 12);
    const hasMore = matchingUsers.length > shownUsers.length;

    const renderCard = (user) => {
        const name = user.displayName || user.name || user.email || 'Delivery person';
        const phone = user.phone || user.mobileNumber || 'No phone provided';
        const email = user.email || 'Not provided';
        const location = user.address || [user.area, user.city, user.county].filter(Boolean).join(', ') || user.location || 'Location not set';
        const isApproved = (user.approvedSellers || []).includes(state.sellerId);
        const deliveryPersonId = user.id || user.uid || '';
        const hasPendingInvitation = (state.deliveryPartnerRequests || []).some((request) => request.deliveryPersonUid === deliveryPersonId && request.status === 'pending');
        return `
        <div class="list-item">
          <div class="panel-card-header">
            <strong>${escapeHtml(name)}</strong>
            <span class="badge">${isApproved ? 'Approved' : 'Available'}</span>
          </div>
          <div class="muted">Phone: ${escapeHtml(phone)}</div>
          <div class="muted">Email: ${escapeHtml(email)}</div>
          <div class="muted">Area: ${escapeHtml(location)}</div>
          <div class="action-row">
                        ${isApproved ? `<button class="primary-btn" type="button" disabled>Assigned Partner</button><button class="ghost-btn" data-delivery-partner-action="remove" data-delivery-partner-id="${escapeHtml(deliveryPersonId)}">Unassign</button>` : `<button class="primary-btn" data-delivery-partner-action="invite" data-delivery-partner-id="${escapeHtml(deliveryPersonId)}" ${hasPendingInvitation ? 'disabled' : ''}>${hasPendingInvitation ? 'Invitation sent' : 'Invite'}</button>`}
          </div>
        </div>`;
    };

    const title = activeTab === 'approved' ? 'Approved partners' : 'All delivery persons';
    const emptyMessage = activeTab === 'approved' ? 'No approved delivery partners yet.' : 'No matching delivery persons found.';

    const tabContent = `
      <div class="stack">
        <div class="panel-card-header">
          <h4>${title}</h4>
          <span class="badge">${matchingUsers.length} found</span>
        </div>
        <div class="form-grid" style="grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));">
          <label>Search<input id="deliveryPersonsSearch" value="${escapeHtml(state.deliveryPersonsFilter?.search || '')}" placeholder="Name, email, area" /></label>
          <label>Area<select id="deliveryPersonsLocationFilter"><option value="all" ${state.deliveryPersonsFilter?.location === 'all' ? 'selected' : ''}>All</option><option value="north" ${state.deliveryPersonsFilter?.location === 'north' ? 'selected' : ''}>North</option><option value="south" ${state.deliveryPersonsFilter?.location === 'south' ? 'selected' : ''}>South</option><option value="east" ${state.deliveryPersonsFilter?.location === 'east' ? 'selected' : ''}>East</option><option value="west" ${state.deliveryPersonsFilter?.location === 'west' ? 'selected' : ''}>West</option></select></label>
          <label>Vehicle<select id="deliveryPersonsVehicleFilter"><option value="all" ${state.deliveryPersonsFilter?.vehicle === 'all' ? 'selected' : ''}>All</option><option value="bike" ${state.deliveryPersonsFilter?.vehicle === 'bike' ? 'selected' : ''}>Bike</option><option value="car" ${state.deliveryPersonsFilter?.vehicle === 'car' ? 'selected' : ''}>Car</option><option value="van" ${state.deliveryPersonsFilter?.vehicle === 'van' ? 'selected' : ''}>Van</option></select></label>
          <label>Rating<select id="deliveryPersonsRatingFilter"><option value="all" ${state.deliveryPersonsFilter?.rating === 'all' ? 'selected' : ''}>All</option><option value="4" ${state.deliveryPersonsFilter?.rating === '4' ? 'selected' : ''}>4+</option><option value="4.5" ${state.deliveryPersonsFilter?.rating === '4.5' ? 'selected' : ''}>4.5+</option><option value="5" ${state.deliveryPersonsFilter?.rating === '5' ? 'selected' : ''}>5</option></select></label>
          <label>Availability<select id="deliveryPersonsOnlineFilter"><option value="all" ${state.deliveryPersonsFilter?.online === 'all' ? 'selected' : ''}>All</option><option value="online" ${state.deliveryPersonsFilter?.online === 'online' ? 'selected' : ''}>Online</option><option value="offline" ${state.deliveryPersonsFilter?.online === 'offline' ? 'selected' : ''}>Offline</option></select></label>
        </div>
        ${matchingUsers.length ? `
          <div class="list-stack">
            ${shownUsers.map(renderCard).join('')}
          </div>
          ${hasMore ? '<div class="modal-actions"><button class="ghost-btn" id="deliveryPersonsLoadMore">Load more</button></div>' : ''}
        ` : `<div class="empty-state">${emptyMessage}</div>`}
      </div>`;

    container.innerHTML = tabContent;
    document.getElementById('deliveryPersonsSearch')?.addEventListener('input', (event) => {
        state.deliveryPersonsFilter.search = event.target.value.toLowerCase();
        state.deliveryPersonsLoadedCount = 12;
        renderDeliveryPartners();
    });
    document.getElementById('deliveryPersonsLocationFilter')?.addEventListener('change', (event) => {
        state.deliveryPersonsFilter.location = event.target.value;
        state.deliveryPersonsLoadedCount = 12;
        renderDeliveryPartners();
    });
    document.getElementById('deliveryPersonsVehicleFilter')?.addEventListener('change', (event) => {
        state.deliveryPersonsFilter.vehicle = event.target.value;
        state.deliveryPersonsLoadedCount = 12;
        renderDeliveryPartners();
    });
    document.getElementById('deliveryPersonsRatingFilter')?.addEventListener('change', (event) => {
        state.deliveryPersonsFilter.rating = event.target.value;
        state.deliveryPersonsLoadedCount = 12;
        renderDeliveryPartners();
    });
    document.getElementById('deliveryPersonsOnlineFilter')?.addEventListener('change', (event) => {
        state.deliveryPersonsFilter.online = event.target.value;
        state.deliveryPersonsLoadedCount = 12;
        renderDeliveryPartners();
    });
    document.getElementById('deliveryPersonsLoadMore')?.addEventListener('click', () => {
        state.deliveryPersonsLoadedCount += 12;
        renderDeliveryPartners();
    });
    document.querySelectorAll('[data-delivery-partner-action]').forEach((button) => {
        button.addEventListener('click', async () => {
            const action = button.getAttribute('data-delivery-partner-action');
            const deliveryPersonId = button.getAttribute('data-delivery-partner-id');
            if (action === 'invite') {
                button.disabled = true;
                button.textContent = 'Invitation sent';
                const sent = await handleDeliveryPartnerInvite(deliveryPersonId);
                if (!sent) renderDeliveryPartners();
            } else if (action === 'remove') {
                openRemoveDeliveryPartnerConfirm(deliveryPersonId);
            }
        });
    });
}

function showSection(section) {
    const allowedSection = state.canSell || section === 'profile' || section === 'financials' || section === 'wallet' ? section : 'profile';
    state.activeSection = allowedSection;
    setActiveNavigation(allowedSection);
    setMobileNavOpen(false);
    const expectedPanelId = allowedSection === 'delivery-partners' ? 'deliveryPartnersSection' : allowedSection === 'international-products' ? 'catalogSection' : `${allowedSection}Section`;
    document.querySelectorAll('.section-panel').forEach((panel) => panel.classList.toggle('active', panel.id === expectedPanelId));
    if (allowedSection === 'help') {
        renderHelpSession();
    }
    if (allowedSection === 'financials') {
        renderFinancials();
    }
    if (allowedSection === 'delivery-partners') {
        renderDeliveryPartners();
    }
    if (allowedSection === 'international-products') {
        renderInternationalCatalog();
    }
    const titleMap = {
        dashboard: ['Dashboard', 'Track store performance and orders in real time.'],
        profile: ['Profile', 'Keep your seller profile accurate and current.'],
        catalog: ['Catalog', 'Browse the admin master catalog and add products.'],
        'international-products': ['International Products', 'Buy admin-managed products for resale on your store.'],
        menu: ['Store', 'Manage availability, pricing, and presentation.'],
        orders: ['Orders', 'Accept and prepare incoming orders.'],
        reviews: ['Reviews', 'Monitor customer feedback and reply.'],
        promotions: ['Promotions', 'Create time-based promotions.'],
        coupons: ['Coupons', 'Create coupon codes for customers.'],
        analytics: ['Analytics', 'Measure performance and growth.'],
        notifications: ['Notifications', 'Follow new order and store activity.'],
        settings: ['Settings', 'Tune your store preferences.'],
        'delivery-partners': ['Delivery Partners', 'Invite and approve delivery partners for your store.'],
        help: ['Help Center', 'Find guides and support resources for sellers.'],
        chat: ['Chat', 'Open a future-ready support conversation.'],
        financials: ['Financials', 'Track delivery payouts and weekly platform fees.']
        ,wallet: ['Wallet', 'Manage your balance, deposits, and withdrawals.']
    };
    const [title, subtitle] = titleMap[allowedSection] || titleMap.dashboard;
    pageTitle.textContent = title;
    pageSubtitle.textContent = subtitle;
}

async function handleDeliveryRequestAction(action, requestId) {
    const request = state.deliveryRequests.find((entry) => entry.id === requestId);
    if (!request) return;
    try {
        const requestRef = db.collection('deliveryRequests').doc(requestId);
        if (action === 'approve') {
            const deliveryPersonUid = request.deliveryPersonUid;
            const currentSellerIds = state.deliveryUsers.find((user) => (user.uid || user.id) === deliveryPersonUid)?.approvedSellers || [];
            const nextApprovedSellers = Array.from(new Set([...(currentSellerIds || []), state.sellerId]));
            await Promise.all([
                requestRef.update({ status: 'approved', updatedAt: new Date() }),
                db.collection('users').doc(deliveryPersonUid).set({ approvedSellers: nextApprovedSellers, updatedAt: new Date() }, { merge: true }),
                db.collection('sellers').doc(state.sellerId).set({ deliveryPersons: Array.from(new Set([...(state.sellerProfile?.deliveryPersons || []), deliveryPersonUid])), updatedAt: new Date() }, { merge: true }),
                createRoleNotification(db, deliveryPersonUid, 'delivery_person', { title: 'Seller approved', message: `Your request to join ${state.sellerProfile?.name || 'the seller'} was approved.`, type: 'delivery' })
            ]);
            createToast('Delivery request approved.', 'success');
        } else if (action === 'reject') {
            await Promise.all([
                requestRef.update({ status: 'rejected', updatedAt: new Date() }),
                createRoleNotification(db, request.deliveryPersonUid, 'delivery_person', { title: 'Seller request declined', message: `Your request to join ${state.sellerProfile?.name || 'the seller'} was declined.`, type: 'delivery' })
            ]);
            createToast('Delivery request declined.', 'success');
        }
    } catch (error) {
        createToast(error.message || 'Unable to update the delivery request.', 'error');
    }
}

async function handleInviteDeliveryPartner(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const payload = {
        sellerId: state.sellerId,
        sellerName: state.sellerProfile?.businessName || state.sellerProfile?.name || '',
        deliveryPersonName: String(formData.get('deliveryPersonName') || '').trim(),
        deliveryPersonEmail: String(formData.get('deliveryPersonEmail') || '').trim(),
        deliveryPersonPhone: String(formData.get('deliveryPersonPhone') || '').trim(),
        message: String(formData.get('message') || '').trim(),
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date()
    };
    if (!payload.deliveryPersonName && !payload.deliveryPersonEmail) {
        createToast('Please add a partner name or email before sending the invite.', 'warning');
        return;
    }
    try {
        await db.collection('deliveryPartnerRequests').add(payload);
        form.reset();
        createToast('Invitation sent to the delivery partner.', 'success');
    } catch (error) {
        createToast(error.message || 'Unable to send the invitation.', 'error');
    }
}

async function handleDeliveryPartnerInvite(deliveryPersonId) {
    if (!deliveryPersonId || !state.sellerId) return;
    const user = (state.deliveryUsers || []).find((entry) => (entry.id || entry.uid) === deliveryPersonId);
    if (!user) return;
    try {
        await db.collection('deliveryPartnerRequests').add({
            sellerId: state.sellerId,
            sellerName: state.sellerProfile?.businessName || state.sellerProfile?.name || '',
            deliveryPersonUid: deliveryPersonId,
            deliveryPersonName: user.displayName || user.name || user.email || 'Delivery person',
            deliveryPersonEmail: user.email || '',
            deliveryPersonPhone: user.phone || user.mobileNumber || '',
            message: `Hello! I would like to invite you to join my delivery network.`,
            status: 'pending',
            createdAt: new Date(),
            updatedAt: new Date()
        });
        createToast('Invite sent to the delivery person.', 'success');
        return true;
    } catch (error) {
        createToast(error.message || 'Unable to send the invite.', 'error');
        return false;
    }
}

async function handleDeliveryPartnerRemove(deliveryPersonId) {
    if (!deliveryPersonId || !state.sellerId) return false;
    const user = (state.deliveryUsers || []).find((entry) => (entry.id || entry.uid) === deliveryPersonId);
    if (!user) return false;
    try {
        const currentSellers = Array.isArray(user.approvedSellers) ? user.approvedSellers.filter((value) => value !== state.sellerId) : [];
        const currentDeliveryPersons = Array.isArray(state.sellerProfile?.deliveryPersons) ? state.sellerProfile.deliveryPersons.filter((value) => value !== deliveryPersonId) : [];
        await Promise.all([
            db.collection('users').doc(deliveryPersonId).set({ approvedSellers: currentSellers, updatedAt: new Date() }, { merge: true }),
            db.collection('sellers').doc(state.sellerId).set({ deliveryPersons: currentDeliveryPersons, updatedAt: new Date() }, { merge: true })
        ]);
        createToast('Delivery partner removed successfully.', 'success');
        return true;
    } catch (error) {
        createToast(error.message || 'Unable to remove the delivery partner.', 'error');
        return false;
    }
}

function openRemoveDeliveryPartnerConfirm(deliveryPersonId) {
    if (!deliveryPersonId) return;
    state.pendingDeliveryPartnerRemovalId = deliveryPersonId;
    const user = (state.deliveryUsers || []).find((entry) => (entry.id || entry.uid) === deliveryPersonId);
    const name = user?.displayName || user?.name || user?.email || 'this delivery person';
    modalTitle.textContent = 'Remove delivery partner';
    modalBody.innerHTML = `
      <div class="stack">
        <p>Remove ${escapeHtml(name)} from your approved delivery partners?</p>
        <p class="muted">This will remove the partnership for your seller only.</p>
      </div>`;
    modalActions.innerHTML = `
      <button class="ghost-btn" id="cancelDeliveryPartnerRemoval">Cancel</button>
      <button class="danger-btn" id="confirmDeliveryPartnerRemoval">Remove</button>`;
    modalBackdrop.classList.remove('hidden');
    modalBackdrop.setAttribute('aria-hidden', 'false');
    document.getElementById('cancelDeliveryPartnerRemoval')?.addEventListener('click', closeModal);
    document.getElementById('confirmDeliveryPartnerRemoval')?.addEventListener('click', async () => {
        const pendingId = state.pendingDeliveryPartnerRemovalId;
        if (!pendingId) return;
        const didRemove = await handleDeliveryPartnerRemove(pendingId);
        if (didRemove) {
            closeModal();
        }
    });
}

async function assignDeliveryPartner() {
    const select = document.getElementById('deliveryPartnerSelect');
    const deliveryPersonUid = select?.value;
    if (!deliveryPersonUid || !state.sellerId) return;
    try {
        const current = state.sellerProfile?.deliveryPersons || [];
        if (current.includes(deliveryPersonUid)) {
            createToast('This delivery person is already assigned to your seller.', 'info');
            return;
        }
        const nextDeliveryPersons = [...current, deliveryPersonUid];
        const deliveryUser = state.deliveryUsers.find((user) => (user.uid || user.id) === deliveryPersonUid);
        const approvedSellers = Array.from(new Set([...(deliveryUser?.approvedSellers || []), state.sellerId]));
        await Promise.all([
            db.collection('sellers').doc(state.sellerId).set({ deliveryPersons: nextDeliveryPersons, updatedAt: new Date() }, { merge: true }),
            db.collection('users').doc(deliveryPersonUid).set({ approvedSellers, updatedAt: new Date() }, { merge: true })
        ]);
        createToast('Delivery partner assigned successfully.', 'success');
    } catch (error) {
        console.error(error);
        createToast(error.message || 'Unable to assign delivery partner.', 'error');
    }
}

async function updateUserProfile(uid, updates) {
    if (!uid) {
        throw new Error('A user id is required to save the profile.');
    }
    const button = document.getElementById('saveProfileButton');
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
        state.userProfile = { ...state.userProfile, ...payload };
        createToast('Profile saved to local database.', 'success');
        return payload;
    } catch (error) {
        createToast(error.message || 'Unable to save your profile.', 'error');
        throw error;
    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = 'Save Profile';
        }
    }
}

async function saveProfile(event) {
    event.preventDefault();
    const form = document.getElementById('profileForm');
    const data = Object.fromEntries(new FormData(form));
    const phone = String(data.phone || '').trim();
    const whatsappNumber = String(data.whatsappNumber || '').trim();
    const city = String(data.city || '').trim();
    const county = String(data.county || '').trim();
    const category = String(data.category || '').trim();
    const mobileMoneyNumber = String(data.mobileMoneyNumber || '').trim();
    const orangeMoneyNumber = String(data.orangeMoneyNumber || '').trim();
    const lonestarMoneyNumber = String(data.lonestarMoneyNumber || '').trim();
    const websiteUrl = String(data.websiteUrl || '').trim();
    const standardDeliveryDays = String(data.standardDeliveryDays || '').trim();
    const facebookUrl = String(data.facebookUrl || '').trim();
    const instagramUrl = String(data.instagramUrl || '').trim();
    const youtubeUrl = String(data.youtubeUrl || '').trim();

    if (!category) {
        createToast('Please choose a marketplace category for your seller profile.', 'warning');
        return;
    }

    if (websiteUrl) {
        try {
            const parsedWebsiteUrl = new URL(websiteUrl);
            if (!['http:', 'https:'].includes(parsedWebsiteUrl.protocol)) throw new Error('Unsupported protocol');
        } catch (error) {
            createToast('Enter a valid http or https store link.', 'warning');
            return;
        }
    }

    if (standardDeliveryDays && (!Number.isFinite(Number(standardDeliveryDays)) || Number(standardDeliveryDays) <= 0)) {
        createToast('Standard delivery time must be greater than zero days.', 'warning');
        return;
    }

    const profilePayload = {
        businessName: data.businessName,
        ownerName: data.ownerName,
        phone,
        whatsappNumber: whatsappNumber || phone,
        websiteUrl,
        mobileMoneyNumber: mobileMoneyNumber || orangeMoneyNumber || '',
        orangeMoneyNumber,
        lonestarMoneyNumber,
        facebookUrl,
        instagramUrl,
        youtubeUrl,
        acceptedPaymentMethods: state.sellerProfile?.acceptedPaymentMethods || ['mobile_money', 'cash'],
        email: data.email,
        address: data.address,
        city,
        county,
        category,
        community: data.community || '',
        district: data.district || '',
        imagePath: data.imagePath || '',
        image: data.imagePath || '',
        logo: data.imagePath || '',
        banner: data.banner || '',
        description: data.description,
        openingHours: { open: data.open, close: data.close },
        deliveryRadius: Number(data.deliveryRadius || 0),
        standardDeliveryDays: standardDeliveryDays ? Number(standardDeliveryDays) : null,
        estimatedPrepTime: Number(data.estimatedPrepTime || 0),
        updatedAt: new Date()
    };
    await db.collection('sellers').doc(state.sellerId).set(profilePayload, { merge: true });
    await updateUserProfile(state.authUser?.uid, {
        displayName: data.ownerName || data.businessName || state.userProfile?.displayName || '',
        phone,
        whatsappNumber: whatsappNumber || phone,
        email: data.email || '',
        address: data.address || '',
        city,
        county,
        category
    });
    state.sellerProfile = { ...state.sellerProfile, ...profilePayload };
    createToast('Profile saved', 'success');
}

async function saveSettings(event) {
    event.preventDefault();
    const form = document.getElementById('settingsForm');
    const data = Object.fromEntries(new FormData(form));
    const payload = {
        open: data.open,
        close: data.close,
        deliveryRadius: Number(data.deliveryRadius || 0),
        minimumOrderValue: Number(data.minimumOrderValue || 0),
        estimatedPrepTime: Number(data.estimatedPrepTime || 0),
        vacationMode: Boolean(data.vacationMode),
        breakMode: Boolean(data.breakMode),
        acceptOrders: Boolean(data.acceptOrders),
        autoAccept: Boolean(data.autoAccept),
        updatedAt: new Date()
    };
    await Promise.all([
        db.collection('sellers').doc(state.sellerId).collection('settings').doc('store').set(payload, { merge: true }),
        db.collection('sellers').doc(state.sellerId).set({ isActive: !payload.breakMode, updatedAt: new Date() }, { merge: true })
    ]);
    state.settings = payload;
    state.sellerProfile = { ...state.sellerProfile, isActive: !payload.breakMode };
    updateApprovalGate();
    createToast('Settings saved', 'success');
}

async function addToMenu(productId) {
    const masterProduct = state.masterProducts.find((product) => product.id === productId);
    if (!masterProduct) return;
    const masterBasePrice = Number(masterProduct.defaultPrice ?? masterProduct.standardPrice ?? masterProduct.price ?? 0);
    const pricing = getCatalogPriceBreakdown(masterBasePrice, masterProduct.sellerMarkup || 0, state.adminCatalogPriceRule, masterProduct.category);
    const existing = await db.collection('sellers').doc(state.sellerId).collection('menu').where('masterProductId', '==', productId).limit(1).get();
    if (!existing.empty) {
        createToast('This product is already in your store.', 'error');
        return;
    }
    const payload = {
        masterProductId: productId,
        sellerId: state.sellerId,
        name: masterProduct.name,
        category: getCategoryDisplayName(masterProduct.category || 'General'),
        price: pricing.totalPrice,
        currency: 'LRD',
        isSellerOwned: false,
        defaultPrice: masterBasePrice,
        sellerMarkup: pricing.sellerMarkup,
        totalPrice: pricing.totalPrice,
        rating: Number(masterProduct.rating || 0),
        reviewCount: Number(masterProduct.reviewCount || 0),
        orderFlow: 'catalog',
        sellerDescription: masterProduct.description || '',
        storageOptions: Array.isArray(masterProduct.storageOptions) ? masterProduct.storageOptions : [],
        colorOptions: Array.isArray(masterProduct.colorOptions) ? masterProduct.colorOptions : [],
        shoeVariants: Array.isArray(masterProduct.shoeVariants) ? masterProduct.shoeVariants : [],
        ...(Array.isArray(masterProduct.variantOptions) ? {
            variantOptions: masterProduct.variantOptions.map((variant) => ({
                ...variant,
                priceModifier: convertCurrency(Number(variant.priceModifier || 0), masterProduct.standardCurrency || masterProduct.currency || 'USD', 'LRD')
            }))
        } : {}),
        availability: true,
        featured: false,
        recommended: false,
        todayDeal: false,
        discount: 0,
        preparationTime: masterProduct.preparationTime || 24,
        servingSize: 'Standard',
        sellerTags: [],
        stockStatus: 'in_stock',
        image: masterProduct.image || masterProduct.imageFilename || 'placeholder.svg',
        imageFilename: masterProduct.imageFilename || masterProduct.image || 'placeholder.svg',
        videoUrl: masterProduct.videoUrl || masterProduct.videoLink || '',
        createdAt: new Date(),
        updatedAt: new Date()
    };
    const menuReference = await db.collection('sellers').doc(state.sellerId).collection('menu').add(payload);
    await loadMenuItems();
    renderMenu();
    createToast(`${masterProduct.name} added to your store.`, 'success');
    await openMenuEditor(menuReference.id);
}

async function toggleMenuAvailability(itemId, isAvailable) {
    await db.collection('sellers').doc(state.sellerId).collection('menu').doc(itemId).update({ availability: isAvailable, updatedAt: new Date() });
    const item = state.menuItems.find((entry) => entry.id === itemId);
    if (item) item.availability = isAvailable;
    renderMenu();
}

async function bulkUpdateMenu(isAvailable) {
    const ids = Array.from(state.selectedMenuIds);
    await Promise.all(ids.map((id) => db.collection('sellers').doc(state.sellerId).collection('menu').doc(id).update({ availability: isAvailable, updatedAt: new Date() })));
    state.selectedMenuIds.clear();
    await loadMenuItems();
    renderMenu();
    createToast('Selected items updated.', 'success');
}

async function bulkDeleteMenu() {
    const ids = Array.from(state.selectedMenuIds);
    await Promise.all(ids.map((id) => db.collection('sellers').doc(state.sellerId).collection('menu').doc(id).delete()));
    state.selectedMenuIds.clear();
    await loadMenuItems();
    renderMenu();
    createToast('Selected items removed.', 'success');
}

async function deleteMenuItem(menuId) {
    const item = state.menuItems.find((entry) => entry.id === menuId);
    if (!item) return;
    if (!confirmDialog(`Remove "${escapeHtml(item.name || 'this product')}" from your store? You can add it back from the catalog anytime.`)) return;
    try {
        await db.collection('sellers').doc(state.sellerId).collection('menu').doc(menuId).delete();
        const index = state.menuItems.findIndex((entry) => entry.id === menuId);
        if (index >= 0) state.menuItems.splice(index, 1);
        renderMenu();
        createToast(`${item.name || 'Product'} removed from your store.`, 'success');
    } catch (error) {
        console.error(error);
        createToast('Failed to remove product from store.', 'error');
    }
}

async function openMenuEditor(menuId) {
    const item = state.menuItems.find((entry) => entry.id === menuId);
    if (!item) return;
    let variantOptionsDraft = Array.isArray(item.variantOptions) ? item.variantOptions.map((variant) => ({
        values: { ...(variant.values || {}) },
        priceModifier: Number(variant.priceModifier || 0),
        stockCount: Math.max(0, Number(variant.stockCount || 0))
    })) : [];
    let variantCategory = item.category || '';
    const storageVariants = Array.isArray(item.storageOptions) ? item.storageOptions.map((variant) => typeof variant === 'string'
        ? `${variant}|0|1`
        : `${variant.label}|${Number(variant.priceModifier || 0)}|${Math.max(0, Number(variant.stockCount || 0))}`).join('\n') : '';
    const shoeVariants = Array.isArray(item.shoeVariants) ? item.shoeVariants.map((variant) => `${variant.color} / ${variant.size}|${Number(variant.priceModifier || 0)}|${Math.max(0, Number(variant.stockCount || 0))}`).join('\n') : '';
    modalTitle.textContent = 'Edit Store Item';
    const isCatalogItem = item.isSellerOwned !== true && item.orderFlow !== 'seller_owned';
    const storedMinPriceLRD = Number(item.defaultPrice ?? item.price ?? 0);
    const minPriceLRD = isCatalogItem
        ? getCatalogPriceBreakdown(storedMinPriceLRD, item.sellerMarkup || 0, state.adminCatalogPriceRule, item.category).basePrice
        : storedMinPriceLRD;
    const currentCurrency = isCatalogItem ? 'LRD' : normalizeCurrency(item.currency) || 'LRD';
    const currentPriceInLRD = isCatalogItem
        ? minPriceLRD + Number(item.sellerMarkup || 0)
        : convertCurrency(Number(item.price ?? minPriceLRD), currentCurrency, 'LRD');
    const currentProfitInLRD = isCatalogItem
        ? Number(item.sellerMarkup || 0)
        : Math.max(0, currentPriceInLRD - minPriceLRD);
    const currentPriceInOriginalCurrency = currentCurrency === 'USD'
        ? convertCurrency(currentPriceInLRD, 'LRD', 'USD')
        : currentPriceInLRD;
    const categoryOptions = getCategoryOptions();
    const currentCategory = getCategoryDisplayName(item.category || 'General');
    const hasCurrentCategory = categoryOptions.some((category) => category.name === currentCategory);
    const managedVariantOptionsMarkup = isCatalogItem && variantOptionsDraft.length
        ? `<div class="variant-editor full"><strong>Product variants <span class="muted">(managed by admin)</span></strong>${variantOptionsDraft.map((variant) => {
            const values = getCategoryVariantConfig(item.category).fields.map((variantField) => `${variantField.label}: ${variant.values?.[variantField.key] || ''}`).filter((value) => !value.endsWith(': '));
            return values.length ? `<div class="muted">${values.map((value) => escapeHtml(value)).join(' • ')} • ${formatCurrency(variant.priceModifier || 0, 'LRD')} price modifier • Stock ${Math.max(0, Number(variant.stockCount || 0))}</div>` : '';
        }).join('')}</div>`
        : '';
    const renderVariantEditor = () => {
        const editor = document.getElementById('sellerVariantEditor');
        if (!editor) return;
        const sellerOwned = Boolean(document.querySelector('#menuEditorForm input[name="isSellerOwned"]')?.checked);
        const category = document.querySelector('#menuEditorForm input[name="category"]')?.value || '';
        const config = getCategoryVariantConfig(category);
        if (!sellerOwned || !config.fields.length) {
            editor.innerHTML = '';
            editor.classList.add('hidden');
            return;
        }
        editor.classList.remove('hidden');
        const isEnabled = variantOptionsDraft.length > 0;
        const optionsMarkup = config.fields.map((variantField) => {
            const selectedValues = new Set(variantOptionsDraft.map((variant) => String(variant.values?.[variantField.key] || '')));
            return `<div class="variant-editor full"><strong>${escapeHtml(variantField.label)}</strong><div class="variant-check-grid">${variantField.allowedOptions.map((option) => {
                const value = typeof option === 'string' ? option : option.value;
                const label = typeof option === 'string' ? option : option.label;
                const swatch = typeof option === 'string' ? '' : option.hex;
                return `<label>${variantField.inputType === 'color' && swatch ? `<span class="color-swatch" style="--swatch:${escapeHtml(swatch)}"></span>` : ''}<input type="checkbox" data-variant-field="${escapeHtml(variantField.key)}" value="${escapeHtml(value)}" ${selectedValues.has(value) ? 'checked' : ''} /> ${escapeHtml(label)}</label>`;
            }).join('')}</div></div>`;
        }).join('');
        editor.innerHTML = `<label class="full"><input type="checkbox" name="enableVariants" ${isEnabled ? 'checked' : ''} /> Configure product variants</label><div id="sellerVariantFields" class="full ${isEnabled ? '' : 'hidden'}">${optionsMarkup}<div id="sellerVariantRows" class="storage-variant-grid"></div></div>`;
        const fieldsContainer = document.getElementById('sellerVariantFields');
        const renderRows = () => {
            const rowsContainer = document.getElementById('sellerVariantRows');
            if (!rowsContainer) return;
            const selectedOptions = config.fields.map((variantField) => Array.from(editor.querySelectorAll(`[data-variant-field="${variantField.key}"]:checked`)).map((input) => input.value));
            if (selectedOptions.some((values) => !values.length)) {
                rowsContainer.innerHTML = '<p class="muted">Select at least one value for each field to configure stock and price.</p>';
                return;
            }
            const combinations = selectedOptions.reduce((rows, values, fieldIndex) => rows.flatMap((row) => values.map((value) => ({ ...row, [config.fields[fieldIndex].key]: value }))), [{}]);
            rowsContainer.innerHTML = combinations.map((values) => {
                const existing = variantOptionsDraft.find((variant) => config.fields.every((variantField) => String(variant.values?.[variantField.key] || '') === values[variantField.key])) || {};
                const label = config.fields.map((variantField) => `${variantField.label}: ${values[variantField.key]}`).join(' / ');
                return `<div class="storage-variant-row" data-variant-row data-variant-values="${escapeHtml(JSON.stringify(values))}"><label>${escapeHtml(label)}</label><input type="number" min="0" step="0.01" data-variant-price value="${Number(existing.priceModifier || 0)}" placeholder="Price +" aria-label="Price modifier for ${escapeHtml(label)}" /><input type="number" min="0" step="1" data-variant-stock value="${Math.max(0, Number(existing.stockCount || 0))}" placeholder="Stock" aria-label="Stock for ${escapeHtml(label)}" /></div>`;
            }).join('');
        };
        editor.querySelector('input[name="enableVariants"]')?.addEventListener('change', (event) => {
            fieldsContainer?.classList.toggle('hidden', !event.target.checked);
            if (!event.target.checked) variantOptionsDraft = [];
            else renderRows();
        });
        editor.querySelectorAll('[data-variant-field]').forEach((input) => input.addEventListener('change', renderRows));
        if (isEnabled) renderRows();
    };
    
    modalBody.innerHTML = `
    <form id="menuEditorForm" class="form-grid">
    <label>Product Name<input name="name" type="text" value="${escapeHtml(item.name || '')}" required /></label>
    <label>Category<select name="category"><option value="General" ${currentCategory === 'General' ? 'selected' : ''}>General</option>${categoryOptions.map((category) => `<option value="${escapeHtml(category.name)}" ${category.name === currentCategory ? 'selected' : ''}>${escapeHtml(category.name)}</option>`).join('')}${!hasCurrentCategory && currentCategory !== 'General' ? `<option value="${escapeHtml(item.category)}" selected>${escapeHtml(item.category)}</option>` : ''}</select></label>
    <label class="full">Product facts for AI draft<textarea id="listingDraftBrief" maxlength="1200" placeholder="Describe the product's real features, materials, size, and intended use."></textarea></label>
    <div class="row-actions full"><button class="secondary-btn" id="generateListingDraft" type="button">Draft Listing with AI</button><span class="muted" id="listingDraftStatus">Drafts are suggestions. Review before using.</span></div>
    <div class="panel-card full hidden" id="listingDraftPreview"></div>
    ${storageVariants ? `<label>Storage variants <span class="muted">(managed by admin)</span><textarea name="storageOptions" readonly>${escapeHtml(storageVariants)}</textarea></label>` : ''}
    ${shoeVariants ? `<label>Shoe size/color variants <span class="muted">(managed by admin)</span><textarea name="shoeVariants" readonly>${escapeHtml(shoeVariants)}</textarea></label>` : ''}
    ${managedVariantOptionsMarkup}
    <div id="sellerVariantEditor" class="full"></div>
    <div class="muted">Minimum allowed price (set by admin): ${formatCurrency(minPriceLRD, 'LRD')}</div>
    <label>Currency<select name="currency" id="priceCurrentencySelect"><option value="LRD" ${currentCurrency === 'LRD' ? 'selected' : ''}>LRD</option><option value="USD" ${currentCurrency === 'USD' ? 'selected' : ''}>USD</option></select></label>
    <label>Admin Default Price<input type="text" value="${formatCurrency(minPriceLRD, 'LRD')}" readonly /></label>
    <label>Seller Profit<input name="sellerProfit" type="number" min="0" step="0.01" id="sellerProfitInput" value="${currentCurrency === 'USD' ? convertCurrency(currentProfitInLRD, 'LRD', 'USD') : currentProfitInLRD}" required /></label>
    <label>Selling Price<input name="price" type="number" id="sellingPriceInput" value="${currentPriceInOriginalCurrency}" readonly /></label>
    <div class="muted" id="menuPriceInfo">Admin price + seller profit: ${formatCurrency(currentPriceInLRD, 'LRD')}</div>
    <div class="muted" id="menuPriceWarning"></div>
    <label><input name="isSellerOwned" type="checkbox" ${item.isSellerOwned ? 'checked' : ''} /> I physically own this product</label>
    <label>Preparation Time (hours)<input name="preparationTime" type="number" min="0.25" step="0.25" value="${item.preparationTime || 24}" /></label>
    <label>Delivery Time for This Product (days)<input name="deliveryDays" type="number" min="0.25" step="0.25" value="${item.deliveryDays ?? ''}" placeholder="Use store standard" /></label>
    <label>Serving Size<input name="servingSize" value="${escapeHtml(item.servingSize || '')}" /></label>
    <label>Stock Status<select name="stockStatus"><option ${item.stockStatus === 'in_stock' ? 'selected' : ''}>in_stock</option><option ${item.stockStatus === 'low_stock' ? 'selected' : ''}>low_stock</option><option ${item.stockStatus === 'out_of_stock' ? 'selected' : ''}>out_of_stock</option></select></label>
    <label class="full">Seller Description<textarea name="sellerDescription">${escapeHtml(item.sellerDescription || '')}</textarea></label>
    <label class="full">Search keywords<input name="sellerTags" value="${escapeHtml((Array.isArray(item.sellerTags) ? item.sellerTags : []).join(', '))}" placeholder="Search terms separated by commas" /></label>
    <label class="full">Seller Notes<textarea name="notes">${escapeHtml(item.notes || '')}</textarea></label>
    <label class="full">Product Video Link<input name="videoUrl" type="url" value="${escapeHtml(item.videoUrl || item.videoLink || '')}" placeholder="https://example.com/product-video" /></label>
    <label><input type="checkbox" name="availability" ${item.availability ? 'checked' : ''} /> Available</label>
    <label><input type="checkbox" name="featured" ${item.featured ? 'checked' : ''} /> Featured</label>
    <label><input type="checkbox" name="recommended" ${item.recommended ? 'checked' : ''} /> Recommended</label>
    <label><input type="checkbox" name="todayDeal" ${item.todayDeal ? 'checked' : ''} /> Today's Deal</label>
    </form>`;
    modalActions.innerHTML = `
    <button class="ghost-btn" id="cancelEditor">Cancel</button>
    <button class="ghost-btn" id="shareEditorLink">Share link</button>
    <button class="primary-btn" id="saveEditor">Save</button>`;
    modalBackdrop.classList.remove('hidden');
    document.getElementById('shareEditorLink')?.addEventListener('click', () => shareMenuItem(menuId));
    renderVariantEditor();
    let pendingListingDraft = null;
    const listingDraftForm = document.getElementById('menuEditorForm');
    const listingDraftPreview = document.getElementById('listingDraftPreview');
    const listingDraftStatus = document.getElementById('listingDraftStatus');
    const generateListingDraftButton = document.getElementById('generateListingDraft');
    generateListingDraftButton?.addEventListener('click', async () => {
        const productBrief = String(document.getElementById('listingDraftBrief')?.value || '').trim();
        if (!productBrief) {
            createToast('Describe the product facts before requesting a draft.', 'warning');
            return;
        }
        generateListingDraftButton.disabled = true;
        generateListingDraftButton.textContent = 'Drafting...';
        if (listingDraftStatus) listingDraftStatus.textContent = 'Learning from the master catalog and preparing a local draft...';
        try {
            pendingListingDraft = generateLocalListingDraft({
                productBrief,
                productName: String(listingDraftForm.elements.name.value || '').trim(),
                currentDescription: String(listingDraftForm.elements.sellerDescription.value || '').trim(),
                currentCategory: String(listingDraftForm.elements.category.value || '').trim(),
                catalogProducts: state.masterProducts
            });
            if (!pendingListingDraft?.title || !pendingListingDraft?.description) {
                throw new Error('The local assistant could not create a draft from those facts. Add a little more product detail and try again.');
            }
            listingDraftPreview.innerHTML = `
                <strong>Review local draft</strong>
                <p><b>Title:</b> ${escapeHtml(pendingListingDraft.title)}</p>
                <p><b>Description:</b> ${escapeHtml(pendingListingDraft.description)}</p>
                <p><b>Category suggestion:</b> ${escapeHtml(pendingListingDraft.suggestedCategory || 'No confident match; choose the category yourself.')}</p>
                <p><b>Search keywords:</b> ${escapeHtml((pendingListingDraft.keywords || []).join(', ') || 'None suggested')}</p>
                <p class="muted">Category classifier trained on ${pendingListingDraft.trainingExamples} active catalog products plus category definitions. Drafting runs on this device.</p>
                <div class="row-actions"><button class="primary-btn" id="useListingDraft" type="button">Use Text Draft</button>${pendingListingDraft.suggestedCategory ? '<button class="secondary-btn" id="useListingCategory" type="button">Use Suggested Category</button>' : ''}<button class="ghost-btn" id="discardListingDraft" type="button">Discard</button></div>
            `;
            listingDraftPreview.classList.remove('hidden');
            listingDraftPreview.querySelector('#useListingDraft')?.addEventListener('click', () => {
                listingDraftForm.elements.name.value = pendingListingDraft.title;
                listingDraftForm.elements.sellerDescription.value = pendingListingDraft.description;
                listingDraftForm.elements.sellerTags.value = (pendingListingDraft.keywords || []).join(', ');
                if (listingDraftStatus) listingDraftStatus.textContent = 'Text draft applied. Review it, then Save to update your listing.';
                pendingListingDraft = null;
                listingDraftPreview.classList.add('hidden');
            });
            listingDraftPreview.querySelector('#useListingCategory')?.addEventListener('click', () => {
                listingDraftForm.elements.category.value = pendingListingDraft.suggestedCategory;
                listingDraftForm.elements.category.dispatchEvent(new Event('change', { bubbles: true }));
                listingDraftForm.elements.name.value = pendingListingDraft.title;
                listingDraftForm.elements.sellerDescription.value = pendingListingDraft.description;
                listingDraftForm.elements.sellerTags.value = (pendingListingDraft.keywords || []).join(', ');
                if (listingDraftStatus) listingDraftStatus.textContent = 'Text and category applied. Review everything, then Save to update your listing.';
                pendingListingDraft = null;
                listingDraftPreview.classList.add('hidden');
            });
            listingDraftPreview.querySelector('#discardListingDraft')?.addEventListener('click', () => {
                pendingListingDraft = null;
                listingDraftPreview.classList.add('hidden');
                if (listingDraftStatus) listingDraftStatus.textContent = 'Draft discarded. Your listing was not changed.';
            });
            if (listingDraftStatus) listingDraftStatus.textContent = 'Draft ready. Nothing is saved until you choose Save.';
        } catch (error) {
            console.error('[Manna Marketplace] Local seller listing draft failed:', error);
            if (listingDraftStatus) listingDraftStatus.textContent = error.message || 'Unable to generate a draft right now.';
            createToast(error.message || 'Unable to generate a draft right now.', 'error');
        } finally {
            generateListingDraftButton.disabled = false;
            generateListingDraftButton.textContent = 'Draft Listing Locally';
        }
    });
    generateListingDraftButton.textContent = 'Draft Listing Locally';
    const categoryInput = document.querySelector('#menuEditorForm select[name="category"]');
    categoryInput?.addEventListener('change', () => {
        const nextCategory = categoryInput.value.trim();
        const hasConfiguredVariants = variantOptionsDraft.length || document.querySelector('#sellerVariantEditor input[name="enableVariants"]')?.checked;
        if (nextCategory !== variantCategory && hasConfiguredVariants && !confirmDialog('Changing category will clear the configured variant values for this product. Continue?')) {
            categoryInput.value = variantCategory;
            return;
        }
        if (nextCategory !== variantCategory) variantOptionsDraft = [];
        variantCategory = nextCategory;
        renderVariantEditor();
    });
    document.querySelector('#menuEditorForm input[name="isSellerOwned"]')?.addEventListener('change', renderVariantEditor);
    
    const priceInput = document.querySelector('#menuEditorForm input[name="price"]');
    const profitInput = document.querySelector('#menuEditorForm input[name="sellerProfit"]');
    const currencySelect = document.querySelector('#priceCurrentencySelect');
    const priceInfo = document.getElementById('menuPriceInfo');
    const priceWarning = document.getElementById('menuPriceWarning');
    let priceInLRD = currentPriceInLRD;
    
    const updatePriceDisplay = () => {
        const price = Number(priceInput?.value || 0);
        const currency = currencySelect?.value || 'LRD';
        
        // Update the info display
        if (priceInfo) {
            priceInfo.textContent = currency === 'USD'
                ? `${formatCurrency(price, 'USD')} = ${formatCurrency(priceInLRD, 'LRD')} (converted)`
                : `Current price: ${formatCurrency(price, 'LRD')}`;
        }
        
        // Validate minimum price
        if (priceInLRD < minPriceLRD) {
            priceWarning.textContent = `⚠️ Price cannot be below the admin minimum of ${formatCurrency(minPriceLRD, 'LRD')}`;
            priceWarning.style.color = '#e74c3c';
        } else {
            priceWarning.textContent = `✓ Price is valid (at or above minimum)`;
            priceWarning.style.color = '#27ae60';
        }
    };
    
    const handleCurrencyChange = () => {
        const newCurrency = currencySelect?.value;
        const newPrice = convertCurrency(priceInLRD, 'LRD', newCurrency);
        const newProfit = convertCurrency(currentProfitInLRD, 'LRD', newCurrency);
        priceInput.value = Math.round(newPrice * 100) / 100;
        profitInput.value = Math.round(newProfit * 100) / 100;
        updatePriceDisplay();
    };
    
    profitInput?.addEventListener('input', () => {
        const profitInLRD = convertCurrency(profitInput.value, currencySelect.value, 'LRD');
        priceInLRD = minPriceLRD + profitInLRD;
        priceInput.value = Math.round(convertCurrency(priceInLRD, 'LRD', currencySelect.value) * 100) / 100;
        updatePriceDisplay();
    });
    priceInput?.addEventListener('blur', updatePriceDisplay);
    currencySelect?.addEventListener('change', handleCurrencyChange);
    
    // Initial display update
    updatePriceDisplay();
    
    const saveButton = document.getElementById('saveEditor');
    saveButton?.addEventListener('click', async () => {
        const form = document.getElementById('menuEditorForm');
        const formData = new FormData(form);
        const videoUrl = String(formData.get('videoUrl') || '').trim();
        const sellingPrice = Number(formData.get('price') || 0);
        const selectedCurrency = formData.get('currency') || 'LRD';
        const sellerProfit = Math.max(0, priceInLRD - minPriceLRD);
        const deliveryDaysValue = String(formData.get('deliveryDays') || '').trim();
        const category = String(formData.get('category') || '').trim() || item.category;
        const variantConfig = getCategoryVariantConfig(category);
        const configureVariants = Boolean(formData.get('enableVariants'));
        
        // Validate price is not below minimum
        if (priceInLRD < minPriceLRD) {
            createToast(`Price cannot be below the minimum of ${formatCurrency(minPriceLRD, 'LRD')}`, 'error');
            return;
        }
        
        if (videoUrl) {
            try {
                const parsedVideoUrl = new URL(videoUrl);
                if (!['http:', 'https:'].includes(parsedVideoUrl.protocol)) throw new Error('Unsupported protocol');
            } catch (error) {
                createToast('Please enter a valid http or https video link.', 'warning');
                return;
            }
        }

        if (deliveryDaysValue && (!Number.isFinite(Number(deliveryDaysValue)) || Number(deliveryDaysValue) <= 0)) {
            createToast('Product delivery time must be greater than zero days.', 'warning');
            return;
        }

        if (configureVariants) {
            const selectedFields = variantConfig.fields.map((variantField) => ({
                field: variantField,
                values: Array.from(document.querySelectorAll(`#sellerVariantEditor [data-variant-field="${variantField.key}"]:checked`)).map((input) => input.value)
            }));
            if (!selectedFields.length || selectedFields.some(({ values }) => !values.length)) {
                createToast('Select at least one value for each configured variant field.', 'warning');
                return;
            }
            variantOptionsDraft = Array.from(document.querySelectorAll('#sellerVariantEditor [data-variant-row]')).map((row) => ({
                values: JSON.parse(row.dataset.variantValues || '{}'),
                priceModifier: Number(row.querySelector('[data-variant-price]')?.value || 0),
                stockCount: Math.max(0, Number(row.querySelector('[data-variant-stock]')?.value || 0))
            }));
        } else if (formData.get('enableVariants')) {
            createToast('Configure at least one variant combination before saving.', 'warning');
            return;
        }

        const payload = {
            name: String(formData.get('name') || '').trim() || item.name,
            category,
            storageOptions: Array.isArray(item.storageOptions) ? item.storageOptions : [],
            colorOptions: Array.isArray(item.colorOptions) ? item.colorOptions : [],
            shoeVariants: Array.isArray(item.shoeVariants) ? item.shoeVariants : [],
            variantOptions: variantOptionsDraft,
            price: sellingPrice,
            totalPrice: sellingPrice,
            currency: normalizeCurrency(selectedCurrency),
            priceInLRD,
            priceInUSD: convertCurrency(priceInLRD, 'LRD', 'USD'),
            defaultPrice: isCatalogItem ? storedMinPriceLRD : minPriceLRD,
            sellerMarkup: Math.max(0, priceInLRD - minPriceLRD),
            isSellerOwned: Boolean(formData.get('isSellerOwned')),
            orderFlow: formData.get('isSellerOwned') ? 'seller_owned' : 'catalog',
            preparationTime: Number(formData.get('preparationTime') || 24),
            deliveryDays: deliveryDaysValue ? Number(deliveryDaysValue) : null,
            servingSize: String(formData.get('servingSize') || '').trim(),
            stockStatus: formData.get('stockStatus'),
            sellerDescription: String(formData.get('sellerDescription') || '').trim(),
            sellerTags: String(formData.get('sellerTags') || '').split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 20),
            notes: String(formData.get('notes') || '').trim(),
            videoUrl,
            availability: Boolean(formData.get('availability')),
            featured: Boolean(formData.get('featured')),
            recommended: Boolean(formData.get('recommended')),
            todayDeal: Boolean(formData.get('todayDeal')),
            updatedAt: new Date()
        };
        await db.collection('sellers').doc(state.sellerId).collection('menu').doc(menuId).update(payload);
        closeModal();
        await loadMenuItems();
        renderMenu();
        createToast('Menu item updated', 'success');
    });
    document.getElementById('cancelEditor').addEventListener('click', closeModal);
}

function closeModal() {
    if (state.orderChatUnsubscribe) {
        state.orderChatUnsubscribe();
        state.orderChatUnsubscribe = null;
    }
    state.activeOrderChatId = null;
    state.orderChatMessages = [];
    modalBackdrop.classList.add('hidden');
    modalBody.innerHTML = '';
    modalActions.innerHTML = '';
    modalBackdrop.setAttribute('aria-hidden', 'true');
    window.removeEventListener('keydown', handleModalEscape);
}

function handleModalEscape(event) {
    if (event.key === 'Escape') {
        closeModal();
    }
}

function toggleSupportModal() {
    if (!modalBackdrop.classList.contains('hidden') && modalTitle.textContent === 'Help & support') {
        closeModal();
        return;
    }
    openSupportModal();
}

function openSupportModal() {
    modalTitle.textContent = 'Help & support';
    modalBody.innerHTML = `
    <form id="supportForm" class="form-grid">
      <label>Topic<select name="category">
        <option value="account">Account</option>
        <option value="orders">Orders</option>
        <option value="payments">Payments</option>
        <option value="technical">Technical</option>
        <option value="other">Other</option>
      </select></label>
      <label>Subject<input name="subject" value="Support request" /></label>
      <label class="full">Message<textarea name="message" required placeholder="Tell us what you need help with."></textarea></label>
      <label>Email<input name="email" value="${state.authUser?.email || ''}" /></label>
    </form>`;
    modalActions.innerHTML = `
    <button class="ghost-btn" id="cancelSupport">Cancel</button>
    <button class="primary-btn" id="submitSupport">Send request</button>`;
    modalBackdrop.classList.remove('hidden');
    modalBackdrop.setAttribute('aria-hidden', 'false');
    document.getElementById('submitSupport').addEventListener('click', async () => {
        const form = document.getElementById('supportForm');
        const formData = Object.fromEntries(new FormData(form));
        const payload = {
            sellerId: state.sellerId,
            sellerName: state.sellerProfile?.businessName || state.sellerProfile?.name || '',
            panel: 'seller',
            category: formData.category || 'other',
            subject: formData.subject || formData.category || 'Support request',
            message: String(formData.message || '').trim(),
            email: String(formData.email || state.authUser?.email || '').trim(),
            status: 'new',
            createdAt: new Date()
        };
        if (!payload.message) {
            createToast('Please describe your issue before sending.', 'warning');
            return;
        }
        try {
            await db.collection('supportRequests').add(payload);
            closeModal();
            createToast('Support request sent. We will follow up shortly.', 'success');
        } catch (error) {
            createToast(error.message || 'Unable to send support request.', 'error');
        }
    });
    document.getElementById('cancelSupport').addEventListener('click', closeModal);
}

function openPromotionModal() {
        const eligibleProducts = state.menuItems.filter((item) => item.masterProductId && item.isSellerOwned !== true && Number(item.defaultPrice || 0) > 0 && Number(item.sellerMarkup || 0) > 0);
    modalTitle.textContent = 'Create Promotion';
    modalBody.innerHTML = `
    <form id="promotionForm" class="form-grid">
      <label class="full">Title<input name="title" /></label>
      <label class="full">Description<textarea name="description"></textarea></label>
            <label>Discount from seller profit (%)<input name="discountPercent" type="number" min="1" max="100" step="1" required /></label>
            <label>Applies to<select name="scope" id="promotionScope"><option value="all">All eligible products</option><option value="selected">Selected products</option></select></label>
            <div id="promotionProductSelection" class="full hidden">
                <strong>Select products</strong>
                ${eligibleProducts.length ? eligibleProducts.map((item) => `<label><input type="checkbox" name="productIds" value="${escapeHtml(item.id)}" /> ${escapeHtml(item.name || 'Product')}</label>`).join('') : '<div class="muted">No eligible master-catalog products with seller profit are available.</div>'}
            </div>
            <label>Starts<input name="validFrom" type="date" /></label>
            <label>Ends<input name="validUntil" type="date" /></label>
            <label>Status<select name="status"><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
    </form>`;
    modalActions.innerHTML = `
    <button class="ghost-btn" id="cancelPromotion">Cancel</button>
    <button class="primary-btn" id="savePromotion">Save</button>`;
    modalBackdrop.classList.remove('hidden');
    document.getElementById('promotionScope').addEventListener('change', (event) => {
        document.getElementById('promotionProductSelection').classList.toggle('hidden', event.target.value !== 'selected');
    });
    document.getElementById('savePromotion').addEventListener('click', async () => {
        const form = document.getElementById('promotionForm');
        const promotionFormData = new FormData(form);
        const formData = Object.fromEntries(promotionFormData);
        const discountPercent = Number(formData.discountPercent);
        const productIds = promotionFormData.getAll('productIds').map(String);
        if (!Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent > 100) {
            createToast('Enter a discount between 1% and 100% of seller profit.', 'warning');
            return;
        }
        if (formData.scope === 'selected' && !productIds.length) {
            createToast('Select at least one product for this promotion.', 'warning');
            return;
        }
        if (formData.validFrom && formData.validUntil && formData.validFrom > formData.validUntil) {
            createToast('The promotion end date must be on or after its start date.', 'warning');
            return;
        }
        await db.collection('sellers').doc(state.sellerId).collection('promotions').add({
            ...formData,
            type: 'discount',
            discountPercent,
            productIds: formData.scope === 'selected' ? productIds : [],
            createdAt: new Date(),
            updatedAt: new Date()
        });
        closeModal();
        await loadPromotions();
        renderPromotions();
        createToast('Promotion created', 'success');
    });
    document.getElementById('cancelPromotion').addEventListener('click', closeModal);
}

function openCouponModal() {
        const eligibleProducts = state.menuItems.filter((item) => item.masterProductId && item.isSellerOwned !== true && Number(item.defaultPrice || 0) > 0 && Number(item.sellerMarkup || 0) > 0);
    modalTitle.textContent = 'Create Coupon';
    modalBody.innerHTML = `
    <form id="couponForm" class="form-grid">
            <label class="full">Code<input name="code" required maxlength="32" /></label>
            <label>Discount type<select name="type"><option value="percentage">Percentage of seller profit</option><option value="fixed">Fixed amount from seller profit (LRD)</option></select></label>
            <label>Value<input name="value" type="number" min="0.01" step="0.01" required /></label>
            <label>Minimum eligible order (LRD)<input name="minimumOrderValue" type="number" min="0" step="0.01" value="0" /></label>
            <label>Applies to<select name="scope" id="couponScope"><option value="all">All eligible products</option><option value="selected">Selected products</option></select></label>
            <div id="couponProductSelection" class="full hidden">
                <strong>Select products</strong>
                ${eligibleProducts.length ? eligibleProducts.map((item) => `<label><input type="checkbox" name="productIds" value="${escapeHtml(item.id)}" /> ${escapeHtml(item.name || 'Product')}</label>`).join('') : '<div class="muted">No eligible master-catalog products with seller profit are available.</div>'}
            </div>
      <label class="full">Expiry<input name="expiryDate" type="date" /></label>
            <label>Status<select name="status"><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
    </form>`;
    modalActions.innerHTML = `
    <button class="ghost-btn" id="cancelCoupon">Cancel</button>
    <button class="primary-btn" id="saveCoupon">Save</button>`;
    modalBackdrop.classList.remove('hidden');
    document.getElementById('couponScope').addEventListener('change', (event) => {
        document.getElementById('couponProductSelection').classList.toggle('hidden', event.target.value !== 'selected');
    });
    document.getElementById('saveCoupon').addEventListener('click', async () => {
        const form = document.getElementById('couponForm');
        const couponFormData = new FormData(form);
        const formData = Object.fromEntries(couponFormData);
        const code = String(formData.code || '').trim().toUpperCase();
        const value = Number(formData.value);
        const minimumOrderValue = Number(formData.minimumOrderValue || 0);
        const productIds = couponFormData.getAll('productIds').map(String);
        if (!code || state.coupons.some((coupon) => String(coupon.code || '').trim().toUpperCase() === code)) {
            createToast(code ? 'That coupon code already exists in your store.' : 'Enter a coupon code.', 'warning');
            return;
        }
        if (!Number.isFinite(value) || value <= 0 || (formData.type === 'percentage' && value > 100)) {
            createToast(formData.type === 'percentage' ? 'Enter a percentage from 0.01 to 100.' : 'Enter a fixed amount greater than zero.', 'warning');
            return;
        }
        if (!Number.isFinite(minimumOrderValue) || minimumOrderValue < 0) {
            createToast('Minimum order value cannot be negative.', 'warning');
            return;
        }
        if (formData.scope === 'selected' && !productIds.length) {
            createToast('Select at least one product for this coupon.', 'warning');
            return;
        }
        await db.collection('sellers').doc(state.sellerId).collection('coupons').add({
            code,
            type: formData.type,
            value,
            minimumOrderValue,
            scope: formData.scope,
            productIds: formData.scope === 'selected' ? productIds : [],
            expiryDate: formData.expiryDate || '',
            status: formData.status,
            createdAt: new Date(),
            updatedAt: new Date()
        });
        closeModal();
        await loadCoupons();
        renderCoupons();
        createToast('Coupon created', 'success');
    });
    document.getElementById('cancelCoupon').addEventListener('click', closeModal);
}

async function createNotification(recipientUid, title, message, type = 'system', recipientRole = '') {
    return createRoleNotification(db, recipientUid, recipientRole, { title, message, type });
}

async function notifyDeliveryPartnersForOrder(sellerId, sellerName, orderId) {
    if (!sellerId) return;
    const sellerDoc = await db.collection('sellers').doc(sellerId).get();
    const sellerData = sellerDoc.data() || {};
    const partnerUids = Array.from(new Set([
        ...(sellerData.deliveryPersons || []),
        ...(state.deliveryUsers || []).filter((user) => (user.approvedSellers || []).includes(sellerId)).map((user) => user.uid || user.id).filter(Boolean)
    ]));
    if (!partnerUids.length) return;
    await Promise.all(partnerUids.map((uid) => createRoleNotification(db, uid, 'delivery_person', {
        title: 'Order ready for pickup',
        message: `${sellerName || 'Your seller'} marked order #${orderId.slice(0, 6)} as ready for pickup. You have 48 hours to complete delivery.`,
        type: 'delivery'
    })));
}

function isSellerProfileComplete() {
    const profile = state.sellerProfile || {};
    return Boolean((profile.businessName || profile.name) && profile.ownerName && profile.phone && profile.address);
}

function ensureSellerProfileComplete() {
    if (isSellerProfileComplete()) return true;
    createToast('Please complete your seller profile before updating order status.', 'warning');
    showSection('profile');
    return false;
}

async function handleOrderAction(action, orderId) {
    const orderRef = db.collection('orders').doc(orderId);
    const orderDoc = await orderRef.get();
    const currentOrder = orderDoc.data() || {};
    if (['ready'].includes(action) && currentOrder.paymentStatus !== 'confirmed') {
        createToast('This order is waiting for admin payment confirmation.', 'warning');
        return;
    }
    if (action === 'ready' && !canFulfillCustomizedOrder(currentOrder)) {
        createToast('This customized order is waiting for the customization fee to be paid and confirmed.', 'warning');
        return;
    }
    if (currentOrder.status === 'received') return;
    const nextStatus = {
        reject: 'cancelled',
        ready: 'ready'
    }[action];
    const requiresProfile = ['ready'];
    if (requiresProfile.includes(action) && !ensureSellerProfileComplete()) {
        return;
    }
    if (!nextStatus) {
        if (action === 'approve-refund') {
            const refundPhone = String(currentOrder.paymentPhone || '').trim();
            const refundMethod = String(currentOrder.paymentMethod || '').trim();
            const refundAmount = Number(currentOrder.refundAmount || currentOrder.total || 0);
            if (!refundPhone || !refundMethod || !refundAmount) {
                createToast('This order is missing the customer payment details needed for repayment.', 'warning');
                return;
            }
            const paymentReference = window.prompt(`Send ${formatCurrency(refundAmount)} to ${refundPhone} using ${refundMethod}, then enter the payment reference:`, '');
            if (!paymentReference || !paymentReference.trim()) {
                createToast('Enter the mobile payment reference after sending the refund.', 'warning');
                return;
            }
            await orderRef.update({
                status: 'refund_approved',
                refundStatus: 'approved',
                refundAmount,
                refundPaymentMethod: refundMethod,
                refundPaymentPhone: refundPhone,
                refundPaymentReference: paymentReference.trim(),
                refundProcessedAt: new Date(),
                refundConfirmedAt: null,
                updatedAt: new Date()
            });
            if (currentOrder.customerUid) {
                await createNotification(currentOrder.customerUid, 'Refund sent for confirmation', `The seller sent ${formatCurrency(refundAmount)} to ${refundPhone} using ${refundMethod}. Check your phone or mobile-money account, then confirm receipt for order #${currentOrder.orderNumber || orderId.slice(0, 6)}. Reference: ${paymentReference.trim()}`, 'refund', 'customer');
            }
            await loadOrders();
            renderOrders();
            createToast('Refund repayment recorded and sent for customer confirmation.', 'success');
            return;
        }
        if (action === 'reject-refund') {
            await orderRef.update({
                refundStatus: 'rejected',
                refundRejectedReason: currentOrder.refundReason || 'No reason provided',
                refundProcessedAt: new Date(),
                updatedAt: new Date()
            });
            if (currentOrder.customerUid) {
                await createNotification(currentOrder.customerUid, 'Refund rejected', `Refund for order #${currentOrder.orderNumber || orderId.slice(0, 6)} was rejected by the seller.`, 'refund', 'customer');
            }
            await loadOrders();
            renderOrders();
            createToast('Refund rejected.', 'success');
            return;
        }
        openOrderDetails(currentOrder);
        return;
    }
    const readyAt = nextStatus === 'ready' && currentOrder.status !== 'ready' ? new Date() : null;
    const orderUpdate = { status: nextStatus, updatedAt: new Date() };
    if (readyAt) {
        orderUpdate.readyAt = readyAt;
        orderUpdate.deliveryDeadlineHours = 48;
        orderUpdate.deliveryDeadlineAt = new Date(readyAt.getTime() + 48 * 60 * 60 * 1000);
    }
    await orderRef.update(orderUpdate);
    if (currentOrder.customerUid) {
        const customerNotifications = {
            reject: { title: 'Order cancelled', message: 'Your order was cancelled by the seller.', type: 'order' },
            ready: { title: 'Order ready', message: 'Your order is ready for pickup.', type: 'order' }
        };
        const notification = customerNotifications[action];
        if (notification) {
            await createNotification(currentOrder.customerUid, notification.title, notification.message, notification.type, 'customer');
        }
    }
    if (nextStatus === 'ready' && currentOrder.sellerId) {
        await notifyDeliveryPartnersForOrder(currentOrder.sellerId, currentOrder.sellerName || state.sellerProfile?.businessName || state.sellerProfile?.name || 'your seller', orderId);
    }
    await loadOrders();
    renderOrders();
    createToast(`Order marked as ${nextStatus}`, 'success');
}

async function openOrderChat(orderId) {
    const orderDoc = await db.collection('orders').doc(orderId).get();
    const order = orderDoc.data() || {};
    state.activeOrderChatId = orderId;
    modalTitle.textContent = `Order chat #${order.orderNumber || orderId.slice(0, 6)}`;
    modalBody.innerHTML = `
    <div id="orderChatMessages" class="chat-log"></div>
    <form id="orderChatForm" class="chat-form">
      <input id="orderChatInput" type="text" placeholder="Send an update about this order" />
      <button type="submit" class="primary-btn">Send</button>
    </form>`;
    modalActions.innerHTML = `<button class="ghost-btn" id="closeOrderChat">Close</button>`;
    modalBackdrop.classList.remove('hidden');
    modalBackdrop.setAttribute('aria-hidden', 'false');
    document.getElementById('closeOrderChat').addEventListener('click', closeModal);
    document.getElementById('orderChatForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        const input = document.getElementById('orderChatInput');
        const text = input?.value.trim();
        if (!text) return;
        await db.collection('orders').doc(orderId).collection('messages').add({
            text,
            senderRole: 'seller',
            senderUid: state.authUser?.uid || '',
            read: false,
            isDeleted: false,
            createdAt: new Date(),
            updatedAt: new Date()
        });
        input.value = '';
    });
    loadOrderChatMessages(orderId);
}

function loadOrderChatMessages(orderId) {
    if (state.orderChatUnsubscribe) {
        state.orderChatUnsubscribe();
        state.orderChatUnsubscribe = null;
    }
    state.orderChatUnsubscribe = db.collection('orders').doc(orderId).collection('messages').orderBy('createdAt', 'asc').onSnapshot((snapshot) => {
        state.orderChatMessages = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).filter((message) => !message.isDeleted);
        const container = document.getElementById('orderChatMessages');
        if (!container) return;
        container.innerHTML = state.orderChatMessages.length ? state.orderChatMessages.map((message) => `
      <div class="chat-bubble ${message.senderRole === 'seller' ? 'self' : ''}">
        <div class="panel-card-header">
          <strong>${message.senderRole === 'seller' ? 'You' : message.senderRole === 'delivery_person' ? 'Delivery' : 'Customer'}</strong>
          <span class="badge">${message.read ? 'Read' : 'Unread'}</span>
        </div>
        <div>${message.text}</div>
        <div class="muted">${formatDate(message.createdAt)}</div>
        <div class="action-row">
          <button class="ghost-btn" type="button" data-delete-order-chat-message="${message.id}">Delete</button>
        </div>
      </div>`).join('') : '<div class="empty-state">No messages yet.</div>';
        document.querySelectorAll('[data-delete-order-chat-message]').forEach((button) => {
            button.addEventListener('click', async () => {
                await deleteOrderChatMessage(orderId, button.dataset.deleteOrderChatMessage);
            });
        });
    });
}

async function deleteOrderChatMessage(orderId, messageId) {
    await db.collection('orders').doc(orderId).collection('messages').doc(messageId).set({ isDeleted: true, updatedAt: new Date() }, { merge: true });
}

function openOrderDetails(order) {
    modalTitle.textContent = `Order ${order.orderNumber || order.id}`;
    modalBody.innerHTML = `
    <div class="list-stack">
      <div><strong>Customer</strong>: ${order.customerName || 'N/A'}</div>
      <div><strong>Phone</strong>: ${order.customerPhone || order.paymentPhone || 'N/A'}</div>
      <div><strong>Address</strong>: ${order.address || 'N/A'}</div>
      <div><strong>Saved location</strong>: ${order.deliveryLocationLabel || 'Not selected'}</div>
      <div><strong>Landmark / notes</strong>: ${order.deliveryLandmark || order.deliveryDetails || 'N/A'}</div>
      <div><strong>Items</strong>:
        ${Array.isArray(order.items) && order.items.length ? order.items.map((item) => `
          <div class="item-card" style="margin-top:8px;padding:10px;border-radius:12px;">
            <div style="display:flex;align-items:center;gap:10px;">
              <img src="./images/placeholder.png" data-mobile-loader data-mobile-src="${escapeHtml(getProductThumbnailUrl(item.imagePath || item.image || item.imageFilename || ''))}" data-full-src="${escapeHtml(getImageUrl(item.imagePath || item.image || item.imageFilename || ''))}" loading="lazy" decoding="async" alt="${escapeHtml(item.name || 'Item')}" style="width:56px;height:56px;object-fit:cover;border-radius:10px;" />
              <div>
                <div><strong>${item.name || 'Item'}</strong> × ${item.quantity || 1}</div>
                <div class="muted">${item.description || item.sellerDescription || 'Freshly prepared item'}</div>
                ${getVariantDisplayEntries(item).length ? `<div class="muted">${getVariantDisplayEntries(item).map((variant) => `${escapeHtml(variant.label)}: ${escapeHtml(variant.value)}`).join(' • ')}</div>` : ''}
              </div>
            </div>
          </div>`).join('') : '<div class="muted">None</div>'}
      </div>
      <div><strong>Payment</strong>: ${order.paymentMethod || 'pending'} • ${order.paymentDetails || 'N/A'}</div>
      <div><strong>Total</strong>: ${formatCurrency(order.total || 0)}</div>
    <div><strong>Placed</strong>: ${formatDate(order.placedAt || order.createdAt)}</div>
    <div><strong>Estimated delivery</strong>: ${order.estimatedDeliveryTime ? formatDate(order.estimatedDeliveryTime) : 'Pending'}</div>
      <div><strong>Refund</strong>: ${order.refundStatus || 'none'}</div>
    </div>`;
    modalActions.innerHTML = `<button class="ghost-btn" id="closeDetails">Close</button>`;
    modalBackdrop.classList.remove('hidden');
    document.getElementById('closeDetails').addEventListener('click', closeModal);
}

async function replyToReview(reviewId) {
    const text = window.prompt('Reply to review');
    if (!text) return;
    await db.collection('reviews').doc(reviewId).update({ reply: text, updatedAt: new Date() });
    await loadReviews();
    renderReviews();
    createToast('Reply saved', 'success');
}

async function reportReview(reviewId) {
    await db.collection('reports').add({ reviewId, sellerId: state.sellerId, createdAt: new Date() });
    createToast('Review reported to admin', 'success');
}

async function markNotificationRead(notificationId) {
    await db.collection('notifications').doc(notificationId).set({ read: true, updatedAt: new Date() }, { merge: true });
    await loadNotifications();
    renderNotifications();
}

async function deleteNotification(notificationId) {
    await db.collection('notifications').doc(notificationId).set({ read: true, isDeleted: true, updatedAt: new Date() }, { merge: true });
    await loadNotifications();
    renderNotifications();
}

async function clearAllNotifications() {
    const visible = state.notifications.filter((item) => !item.isDeleted);
    if (!visible.length) return;
    await Promise.all(visible.map((item) => db.collection('notifications').doc(item.id).set({ read: true, isDeleted: true, updatedAt: new Date() }, { merge: true })));
    await loadNotifications();
    renderNotifications();
    createToast('All notifications cleared.', 'success');
}

async function submitChat(event) {
    event.preventDefault();
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;
    await db.collection('sellers').doc(state.sellerId).collection('chats').add({ text, sender: state.authUser.uid, createdAt: new Date() });
    input.value = '';
    await loadChats();
}

async function submitSupportRequest(event) {
    event.preventDefault();
    const form = document.getElementById('supportForm');
    const data = Object.fromEntries(new FormData(form));
    const payload = {
        sellerId: state.sellerId,
        sellerName: state.sellerProfile?.businessName || state.sellerProfile?.name || '',
        panel: 'seller',
        category: data.category || 'general',
        subject: data.subject || data.category || 'Support request',
        message: data.message || '',
        email: data.email || state.authUser?.email || '',
        status: 'new',
        createdAt: new Date()
    };
    if (!payload.message) return;
    await db.collection('supportRequests').add(payload);
    form.reset();
    createToast('Support request sent. We will follow up soon.', 'success');
}

function sumRevenue(orders) {
    return orders.reduce((total, order) => total + Number(order.total || 0), 0);
}

function isToday(value) {
    if (!value) return false;
    const date = value.toDate ? value.toDate() : new Date(value);
    const now = new Date();
    return date.getDate() === now.getDate() && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
}

document.addEventListener('DOMContentLoaded', init);
