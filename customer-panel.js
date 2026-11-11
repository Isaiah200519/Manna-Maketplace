import { initStorage, clearStoredAuthState, serverTimestamp, geoPoint } from './storage.js';
import { formatCurrency, formatDate, createToast, getImageUrl, getProductThumbnailUrl, getSellerImageUrl, calculateDistance, copyText, dialUSSD, getCommunityOptions, escapeHtml, convertCurrency, normalizeCurrency, getAvatarHtml, getHelpArticlesByContext } from './utils.js';
import { renderExpandableDescription } from './description-utils.js';
import { createRoleNotification } from './notification-utils.js';
import { bindSoundToggle, playSoundEffect, renderSoundToggle } from './sound-effects.js';
import { DEFAULT_CATEGORY_TAXONOMY, getCategoryDisplayName, getCategoryOptions } from './category-taxonomy.js';
import { getCategoryVariantConfig } from './category-variants.js';
import { findConfiguredVariant, normalizeConfiguredVariants } from './product-variant-utils.mjs';
import { getQRCardHTML, initQRCode, bindQRDownloadHandlers } from './qr-utils.js';
import { resolveSellerPaymentDetails } from './checkout-utils.mjs';
import { fetchWithTimeout } from './network-utils.mjs';
import {
    canChangeOrderCustomization,
    canFulfillCustomizedOrder,
    getCustomizationFeeStatus,
    isCustomizedOrder
} from './customization-utils.mjs';
import { isAdminOnlyEmail } from './auth.js';
import { applyCatalogDiscount, getActiveCatalogPriceRule } from './pricing-utils.mjs';
import { getReviewProductReferences } from './review-utils.mjs';
import { applyThemePreference, bindThemePreferenceControl, renderThemePreferenceControl } from './theme-utils.js';
import { watchMaintenanceMode } from './maintenance-mode.js';

function getStoredProductPrice(item) {
    const currency = normalizeCurrency(item.currency);
    return currency === 'USD'
        ? Number(item.priceInUSD ?? item.price ?? 0)
        : Number(item.priceInLRD ?? item.price ?? 0);
}

function applySellerPromotion(item, promotions, today = new Date().toISOString().slice(0, 10)) {
    const promotionBase = item.promotionBase || {
        price: item.price,
        priceInLRD: item.priceInLRD,
        priceInUSD: item.priceInUSD,
        totalPrice: item.totalPrice,
        sellerMarkup: item.sellerMarkup
    };
    const sellerMarkup = Number(promotionBase.sellerMarkup || 0);
    const regularItem = {
        ...item,
        ...promotionBase,
        sellerMarkup,
        promotionBase,
        promotion: null
    };
    const defaultPrice = Number(item.defaultPrice || 0);
    if (!item.masterProductId || item.isSellerOwned === true || item.orderFlow === 'seller_owned' || defaultPrice <= 0 || sellerMarkup <= 0) return regularItem;

    const promotion = promotions
        .filter((candidate) => {
            const discountPercent = Number(candidate.discountPercent || 0);
            const appliesToProduct = candidate.scope === 'all'
                || (candidate.scope === 'selected' && Array.isArray(candidate.productIds) && candidate.productIds.includes(item.id));
            return candidate.status === 'active'
                && discountPercent > 0
                && discountPercent <= 100
                && appliesToProduct
                && (!candidate.validFrom || candidate.validFrom <= today)
                && (!candidate.validUntil || candidate.validUntil >= today);
        })
        .sort((first, second) => Number(second.discountPercent) - Number(first.discountPercent))[0];
    if (!promotion) return regularItem;

    const discountedMarkup = Math.max(0, Math.round(sellerMarkup * (1 - Number(promotion.discountPercent) / 100) * 100) / 100);
    const discountedPrice = Math.max(defaultPrice, defaultPrice + discountedMarkup);
    const regularPrice = normalizeCurrency(item.currency) === 'USD'
        ? Number(promotionBase.priceInUSD ?? item.priceInUSD ?? convertCurrency(defaultPrice + sellerMarkup, 'LRD', 'USD'))
        : Number(promotionBase.priceInLRD ?? item.priceInLRD ?? (defaultPrice + sellerMarkup));
    return {
        ...regularItem,
        price: discountedPrice,
        priceInLRD: discountedPrice,
        priceInUSD: convertCurrency(discountedPrice, 'LRD', 'USD'),
        totalPrice: discountedPrice,
        sellerMarkup: discountedMarkup,
        promotion: {
            id: promotion.id,
            title: promotion.title || 'Promotion',
            regularPrice,
            discountAmount: Math.max(0, regularPrice - discountedPrice)
        }
    };
}

function renderProductPrice(item) {
    const price = formatCurrency(getStoredProductPrice(item), item.currency);
    if (!item.promotion) return `<span class="badge">${price}</span>`;
    return `<span class="muted"><s>${formatCurrency(item.promotion.regularPrice, item.currency)}</s></span> <span class="badge">${price}</span> <span class="priority-badge">${escapeHtml(item.promotion.title)}</span>`;
}

const defaultLocation = { lat: 6.3113, lng: -10.8014 };
const LEGACY_RESTAURANT_SELLER_IDS = new Set(['rest-pizza', 'rest-burger', 'rest-dominos']);

function isLegacyRestaurantSeller(seller) {
    return LEGACY_RESTAURANT_SELLER_IDS.has(String(seller?.id || '').trim());
}

const state = {
    authUser: null,
    customerProfile: null,
    sellers: [],
    menuItems: [],
    orders: [],
    favorites: [],
    addresses: [],
    locations: [],
    activeAddressId: '',
    categories: [],
    profileUnsubscribe: null,
    sellersUnsubscribe: null,
    ordersUnsubscribe: null,
    favoritesUnsubscribe: null,
    addressesUnsubscribe: null,
    locationsUnsubscribe: null,
    cartUnsubscribe: null,
    adminSettingsUnsubscribe: null,
    orderCountdownTimer: null,
    cart: { sellerId: '', sellerName: '', items: [], drink: null, paymentMethod: 'uba_usd', paymentPhone: '', paymentDetails: '', contactPhone: '', notes: '', deliveryFee: 0, selectedLocationId: '', sellerPaymentReceiver: '', sellerAcceptedPaymentMethods: [] },
    sellerPromotions: {},
    promotionUnsubscribes: {},
    couponUnsubscribe: null,
    couponSellerId: '',
    coupons: [],
    couponsLoaded: false,
    couponMessage: '',
    signupRewardClaim: null,
    signupRewardPromptDismissed: false,
    signupRewardRevealShown: false,
    signupRewardClaimPending: false,
    signupRewardBoxOrderClaimId: '',
    signupRewardBoxOrder: [],
    checkoutLocationSelection: null,
    checkoutPaymentNumbers: { sellerId: '', orangeMoneyNumber: '', lonestarMoneyNumber: '', loading: false, loaded: false },
    activeSection: 'home',
    adminCatalogPriceRule: null,
    catalogPriceRuleExpiryTimer: null,
    selectedSeller: null,
    selectedMenuItem: null,
    searchQuery: '',
    filters: { category: 'all', sort: 'rating', community: '' },
    orderFilter: 'all',
    deliveryFee: 60,
    deliveryOptions: { regularFee: 60, expressFee: 120, regularDays: 3, expressHours: 24 },
    platformPaymentNumbers: { orangeMoneyNumber: '', lonestarMoneyNumber: '' },
    adminWhatsAppNumber: '',
    platformPaymentMethods: {},
    notifications: [],
    helpArticles: [],
    walletUnsubscribes: [],
    walletBalance: 0,
    walletBalanceUSD: 0
};

let notificationSnapshotReady = false;
let locationMapLibrariesPromise = null;
let customerFeedRefreshPromise = null;
let customerFeedRefreshPending = false;
let customerHomeFeedDirty = true;

const authScreen = document.getElementById('authScreen');
const appShell = document.getElementById('appShell');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const authMessage = document.getElementById('authMessage');
const showRegisterButton = document.getElementById('showRegisterButton');
const showLoginButton = document.getElementById('showLoginButton');
const forgotPasswordButton = document.getElementById('forgotPasswordButton');
const logoutButton = document.getElementById('logoutButton');
const mobileNavToggle = document.getElementById('mobileNavToggle');
const mobileNavSheet = document.getElementById('mobileNavSheet');
const mobileNavClose = document.getElementById('mobileNavClose');
const mobileMenuButton = document.getElementById('mobileMenuButton');
const notificationsToggle = document.getElementById('notificationsToggle');
const customerNotificationBadge = document.getElementById('customerNotificationBadge');
const customerNotificationBadgeCount = document.getElementById('customerNotificationBadgeCount');
const sidebarToggle = document.getElementById('sidebarToggle');
const sidebar = document.getElementById('sidebar');
const sidebarBackdrop = document.getElementById('sidebarBackdrop');
const sidebarClose = document.getElementById('sidebarClose');
const cartButton = document.getElementById('cartButton');
const cartCount = document.getElementById('cartCount');
const navItems = Array.from(document.querySelectorAll('.nav-item[data-section], .mobile-nav-item[data-section]'));
const mobileNavButtons = Array.from(document.querySelectorAll('.mobile-bottom-nav .mobile-nav-item'));
const sectionPanels = Array.from(document.querySelectorAll('.section-panel'));
const pageTitle = document.getElementById('pageTitle');
const pageSubtitle = document.getElementById('pageSubtitle');
const modalBackdrop = document.getElementById('modalBackdrop');
const modalTitle = document.getElementById('modalTitle');
const modalBody = document.getElementById('modalBody');
const modalActions = document.getElementById('modalActions');
const modalClose = document.getElementById('modalClose');

let storage = null;
let db = null;
let auth = null;
let authBootstrapTimer = null;
let homeSearchTimeout = null;

function clearAuthBootstrapTimer() {
    if (authBootstrapTimer) {
        clearTimeout(authBootstrapTimer);
        authBootstrapTimer = null;
    }
}

function getWhatsAppUrl(phone, message) {
    const normalizedPhone = String(phone || '').replace(/[^\d]/g, '');
    return normalizedPhone ? `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message || '')}` : '';
}

function getWhatsAppIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19l1.4-3.2A7.7 7.7 0 1 1 8 17.7L5 19z"/><path d="M9.2 8.8c.2-.4.4-.4.7-.4h.5c.2 0 .4.1.5.4l.6 1.4c.1.2.1.4-.1.6l-.5.6c.5 1 1.3 1.7 2.3 2.2l.6-.5c.2-.2.4-.2.6-.1l1.4.6c.3.1.4.3.3.6-.2.8-.8 1.3-1.6 1.3-2.1-.1-5.9-3.3-6.3-5.7-.1-.4.2-.8.5-1z"/></svg>';
}

function getVideoIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/></svg>';
}

function getSocialUrl(value) {
    const url = String(value || '').trim();
    return /^https?:\/\//i.test(url) ? url : '';
}

function getSocialIcon(type) {
    const icons = {
        facebook: '<path d="M14 8h3V5h-3c-2.2 0-4 1.8-4 4v2H7v3h3v5h3v-5h3l1-3h-4V9c0-.6.4-1 1-1z"/>',
        instagram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/>',
        youtube: '<rect x="3" y="6" width="18" height="12" rx="3"/><path d="m10 9 5 3-5 3z"/>'
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[type] || ''}</svg>`;
}

function getSellerSocialLinks(seller) {
    return ['facebook', 'instagram', 'youtube'].map((type) => {
        const url = getSocialUrl(seller?.[`${type}Url`]);
        return url ? `<a class="contact-icon-link social-icon-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" aria-label="${type} seller" title="${type} seller">${getSocialIcon(type)}</a>` : '';
    }).join('');
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
let locationMap = null;
let locationMarker = null;
let locationAccuracyCircle = null;
let locationWatchId = null;
let locationMapReady = false;
let isTrackingLocation = false;
let locationReverseGeocodeTimer = null;

function normalizeCartState(cart = {}) {
    return {
        sellerId: cart.sellerId || '',
        sellerName: cart.sellerName || '',
        items: Array.isArray(cart.items) ? cart.items.slice(0, 1) : [],
        drink: cart.drink || null,
        paymentMethod: cart.paymentMethod || 'uba_usd',
        paymentCurrency: normalizeCurrency(cart.paymentCurrency || 'USD'),
        paymentPhone: cart.paymentPhone || '',
        paymentDetails: cart.paymentDetails || '',
        contactPhone: cart.contactPhone || '',
        notes: cart.notes || '',
        deliveryFee: Number(cart.deliveryFee || state.deliveryFee || 60),
        selectedLocationId: cart.selectedLocationId || '',
        deliveryOption: cart.deliveryOption || 'regular',
        isSignupReward: Boolean(cart.isSignupReward),
        rewardClaimId: String(cart.rewardClaimId || ''),
        sellerPaymentReceiver: cart.sellerPaymentReceiver || '',
        sellerAcceptedPaymentMethods: Array.isArray(cart.sellerAcceptedPaymentMethods) ? cart.sellerAcceptedPaymentMethods : [],
        couponCode: String(cart.couponCode || '').trim().toUpperCase()
    };
}

function syncSellerPromotionListeners(sellers) {
    const activeSellerIds = new Set(sellers.map((seller) => seller.id));
    Object.entries(state.promotionUnsubscribes).forEach(([sellerId, unsubscribe]) => {
        if (activeSellerIds.has(sellerId)) return;
        unsubscribe();
        delete state.promotionUnsubscribes[sellerId];
        delete state.sellerPromotions[sellerId];
    });

    sellers.forEach((seller) => {
        if (state.promotionUnsubscribes[seller.id]) return;
        let isInitialSnapshot = true;
        state.promotionUnsubscribes[seller.id] = db.collection('sellers').doc(seller.id).collection('promotions').onSnapshot((snapshot) => {
            const promotions = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
            state.sellerPromotions[seller.id] = promotions;
            if (isInitialSnapshot) {
                isInitialSnapshot = false;
                return;
            }

            state.menuItems = state.menuItems.map((item) => item.sellerId === seller.id ? applySellerPromotion(item, promotions) : item);
            if (state.activeSection === 'home') renderHome();
            else customerHomeFeedDirty = true;
            if (state.activeSection === 'favorites') renderFavorites();
            if (state.activeSection === 'checkout') renderCheckout();
            if (state.activeSection === 'sellerDetail' && state.selectedSeller?.id === seller.id) openSeller(seller.id);
        }, (error) => {
            console.error('[Manna Marketplace] Seller promotions listener failed:', error);
        });
    });
}

function syncSellerCouponListener(sellerId) {
    if (state.couponSellerId === sellerId && (sellerId ? state.couponUnsubscribe : true)) return;
    state.couponUnsubscribe?.();
    state.couponUnsubscribe = null;
    state.couponSellerId = sellerId || '';
    state.coupons = [];
    state.couponsLoaded = false;
    state.couponMessage = '';
    if (!sellerId) return;

    state.couponUnsubscribe = db.collection('sellers').doc(sellerId).collection('coupons').onSnapshot((snapshot) => {
        state.coupons = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        state.couponsLoaded = true;
        if (state.activeSection === 'checkout') renderCheckout();
    }, (error) => {
        state.couponsLoaded = true;
        state.couponMessage = 'Coupons could not be loaded right now.';
        console.error('[Manna Marketplace] Seller coupons listener failed:', error);
        if (state.activeSection === 'checkout') renderCheckout();
    });
}

function isCurrentCustomerAccount() {
    return Boolean(state.authUser?.uid && state.customerProfile?.role === 'customer' && !isAdminOnlyEmail(state.authUser.email));
}

async function subscribeToSignupReward(uid) {
    if (!uid || !isCurrentCustomerAccount()) {
        state.signupRewardClaim = null;
        if (document.querySelector('.signup-reward-modal')) closeModal();
        return;
    }
    try {
        const claimSnapshot = await db.collection('signupRewardClaims').doc(uid).get();
        if (state.authUser?.uid !== uid || !isCurrentCustomerAccount()) return;
        state.signupRewardClaim = claimSnapshot.exists ? { id: claimSnapshot.id, ...claimSnapshot.data() } : null;
        if (state.signupRewardClaim?.status === 'eligible' && !state.signupRewardPromptDismissed) {
            maybeShowSignupReward();
        }
        if (state.activeSection === 'notifications') renderNotifications();
    } catch (error) {
        state.signupRewardClaim = null;
        console.error('[Manna Marketplace] Customer reward claim could not be loaded:', error);
    }
}

function maybeShowSignupReward() {
    if (!isCurrentCustomerAccount() || !state.signupRewardClaim || state.signupRewardClaim.status !== 'eligible') return;
    if (modalBackdrop && !modalBackdrop.classList.contains('hidden')) return;
    openSignupRewardModal();
}

function openSignupRewardModal() {
    const claim = state.signupRewardClaim;
    if (!isCurrentCustomerAccount() || !claim || claim.status !== 'eligible') return;
    const profileReady = Boolean(state.customerProfile?.displayName && state.customerProfile?.phone && (state.customerProfile?.address || getActiveAddress()));
        modalTitle.textContent = 'Your customer reward';
    modalBody.innerHTML = `
      <div class="stack signup-reward-modal">
                <div class="signup-reward-intro">
                    <span class="signup-reward-eyebrow">A THANK-YOU FOR OUR FIRST CUSTOMERS</span>
                    <h2>Congratulations${state.customerProfile?.displayName ? `, ${escapeHtml(state.customerProfile.displayName)}` : ''}!</h2>
                    <p>Choose a mystery box and discover your reward.</p>
                </div>
        ${profileReady ? '<p class="muted">Your reward includes regular delivery at no charge.</p>' : '<p class="muted">Complete your name, phone number, and delivery address before choosing your reward. You can come back to this claim later.</p>'}
        <div id="signupRewardBoxes" class="signup-reward-boxes">${renderSignupRewardBoxes()}</div>
        <div id="signupRewardStatus" class="muted" role="status"></div>
      </div>`;
    modalActions.innerHTML = `
      ${profileReady ? '' : '<button class="secondary-btn" id="completeRewardProfile" type="button">Complete profile</button>'}
      <button class="ghost-btn" id="dismissSignupReward" type="button">Choose later</button>`;
    modalBackdrop.classList.remove('hidden');
    modalBackdrop.setAttribute('aria-hidden', 'false');
    document.getElementById('completeRewardProfile')?.addEventListener('click', () => {
        state.signupRewardPromptDismissed = true;
        closeModal();
        showSection('profile');
    });
    document.getElementById('dismissSignupReward')?.addEventListener('click', () => {
        state.signupRewardPromptDismissed = true;
        closeModal();
    });
    if (profileReady) {
        document.querySelectorAll('[data-signup-reward-box]').forEach((button) => button.addEventListener('click', () => claimSignupReward(button.dataset.signupRewardBox)));
    }
}

function renderSignupRewardBoxes(reveal = null) {
    const products = Array.isArray(reveal?.revealedProducts)
        ? reveal.revealedProducts
        : Array.isArray(state.signupRewardClaim?.boxOptions) ? state.signupRewardClaim.boxOptions : [];
    if (products.length !== 4) return '<div class="muted">Your reward choices are being prepared. This claim will remain available.</div>';
    const claimId = reveal?.claimId || state.signupRewardClaim?.claimId || state.authUser?.uid || 'signup-reward';
    if (state.signupRewardBoxOrderClaimId !== claimId || state.signupRewardBoxOrder.length !== 4) {
        const orderKey = `manna-signup-box-order:${claimId}`;
        const previousOrder = localStorage.getItem(orderKey);
        const shuffledProducts = [...products];
        for (let index = shuffledProducts.length - 1; index > 0; index -= 1) {
            const otherIndex = Math.floor(Math.random() * (index + 1));
            [shuffledProducts[index], shuffledProducts[otherIndex]] = [shuffledProducts[otherIndex], shuffledProducts[index]];
        }
        let orderSignature = shuffledProducts.map((product) => product.boxId).join('|');
        if (orderSignature === previousOrder) {
            const offset = 1 + Math.floor(Math.random() * (shuffledProducts.length - 1));
            shuffledProducts.push(...shuffledProducts.splice(0, offset));
            orderSignature = shuffledProducts.map((product) => product.boxId).join('|');
        }
        state.signupRewardBoxOrderClaimId = claimId;
        state.signupRewardBoxOrder = shuffledProducts.map((product) => product.boxId);
        localStorage.setItem(orderKey, orderSignature);
    }
    const productByBoxId = new Map(products.map((product) => [product.boxId, product]));
    const shuffledProducts = state.signupRewardBoxOrder.map((boxId) => productByBoxId.get(boxId)).filter(Boolean);
    const profileReady = Boolean(state.customerProfile?.displayName && state.customerProfile?.phone && (state.customerProfile?.address || getActiveAddress()));
    return shuffledProducts.map((product, index) => {
        const isSelected = Boolean(reveal && (product.selected || reveal.selectedProductId === product.id));
        const isRevealed = Boolean(reveal?.revealedProducts);
        const label = isSelected ? escapeHtml(product.name || reveal.selectedProductName || 'Your reward') : isRevealed ? escapeHtml(product.name || 'Reward product') : `Blind box ${index + 1}`;
        if (isRevealed && isSelected) return `<article class="signup-reward-prize-card"><div class="signup-reward-prize-image">${product.image || product.imageFilename ? `<img src="./images/placeholder.png" data-mobile-loader data-mobile-src="${escapeHtml(getProductThumbnailUrl(product.image || product.imageFilename))}" data-full-src="${escapeHtml(getImageUrl(product.image || product.imageFilename))}" alt="${label}" decoding="async" />` : '<span aria-hidden="true">🎁</span>'}</div><div class="signup-reward-prize-copy"><span class="signup-reward-eyebrow">REWARD UNLOCKED</span><h3>${label}</h3><span class="signup-reward-free-price">FREE</span><p>Regular delivery included</p></div></article>`;
        if (isRevealed) return `<div class="signup-reward-box revealed"><span class="signup-reward-box-mark" aria-hidden="true">✦</span><strong>${label}</strong></div>`;
        return `<button class="signup-reward-box" type="button" aria-label="Choose blind box ${index + 1}" data-signup-reward-box="${escapeHtml(product.boxId)}" ${state.signupRewardClaimPending || !profileReady ? 'disabled' : ''}><span class="signup-reward-box-icon" aria-hidden="true">🎁</span><strong>Blind box ${index + 1}</strong><span class="signup-reward-box-hint">Tap to reveal</span></button>`;
    }).join('');
}

async function claimSignupReward(boxId) {
    if (!isCurrentCustomerAccount() || state.signupRewardClaimPending || !boxId) return;
    const selectedBox = document.querySelector(`[data-signup-reward-box="${CSS.escape(boxId)}"]`);
    selectedBox?.classList.add('is-opening');
    playSoundEffect('click');
    const status = document.getElementById('signupRewardStatus');
    state.signupRewardClaimPending = true;
    document.querySelectorAll('[data-signup-reward-box]').forEach((button) => { button.disabled = true; });
    if (status) status.textContent = 'Reserving your reward...';
    try {
        if (!isCustomerProfileComplete()) throw new Error('Complete your name, phone number, and delivery address before choosing a reward.');
        const firebaseApp = window.firebase.app('manna-marketplace-data');
        const callable = window.firebase.functions(firebaseApp).httpsCallable('claimSignupBlindBox');
        const result = await callable({ boxId });
        const claim = {
            ...(state.signupRewardClaim || {}),
            status: 'selected',
            selectedProductId: result.data?.productId || '',
            selectedProductName: result.data?.productName || 'Your reward',
            selectedProduct: result.data?.selectedProduct || null,
            revealedProducts: result.data?.revealedProducts || [],
            orderId: ''
        };
        state.signupRewardClaim = claim;
        state.signupRewardPromptDismissed = true;
        state.signupRewardRevealShown = true;
        playSoundEffect('reward');
        showSignupRewardReveal(claim);
        createToast('Your reward has been reserved. Regular delivery is free.', 'success');
    } catch (error) {
        const message = error.message || 'Unable to claim this reward right now.';
        if (status) status.textContent = message;
        createToast(message, 'error');
        state.signupRewardClaimPending = false;
        selectedBox?.classList.remove('is-opening');
        document.querySelectorAll('[data-signup-reward-box]').forEach((button) => { button.disabled = false; });
        return;
    }
    state.signupRewardClaimPending = false;
}

function showSignupRewardReveal(claim) {
    if (!isCurrentCustomerAccount() || !claim || !['selected', 'ordered', 'confirmed', 'delivered', 'received'].includes(claim.status) || !Array.isArray(claim.revealedProducts)) return;
    modalTitle.textContent = 'Your reward is revealed';
    modalBody.innerHTML = `
      <div class="stack signup-reward-modal">
                <div class="signup-reward-intro signup-reward-reveal-intro">
                    <span class="signup-reward-eyebrow">MYSTERY BOX OPENED</span>
                    <h2>It’s yours!</h2>
                    <p>Your selected reward is ready.</p>
                </div>
        <div class="signup-reward-boxes">${renderSignupRewardBoxes(claim)}</div>
                <p class="signup-reward-delivery-note">Regular delivery is included. Express delivery is not included. ${claim.orderId ? `Reward order: ${escapeHtml(claim.orderId)}` : ''}</p>
      </div>`;
    modalActions.innerHTML = claim.status === 'selected'
        ? '<button class="ghost-btn" id="closeSignupRewardReveal" type="button">Later</button><button class="primary-btn" id="continueSignupRewardOrder" type="button">Choose options &amp; checkout</button>'
        : `<button class="primary-btn" id="closeSignupRewardReveal" type="button">${claim.status === 'received' ? 'Close' : 'View reward order'}</button>`;
    modalBackdrop.classList.remove('hidden');
    modalBackdrop.setAttribute('aria-hidden', 'false');
    document.getElementById('closeSignupRewardReveal')?.addEventListener('click', () => {
        closeModal();
        if (claim.status !== 'selected' && claim.status !== 'received') showSection('orders');
    });
    document.getElementById('continueSignupRewardOrder')?.addEventListener('click', beginSignupRewardOrder);
}

function beginSignupRewardOrder() {
    const selectedProduct = state.signupRewardClaim?.selectedProduct;
    if (!isCurrentCustomerAccount() || state.signupRewardClaim?.status !== 'selected' || !selectedProduct?.masterProductId) {
        createToast('Your selected reward is unavailable. Contact support before choosing again.', 'error');
        return;
    }
    const menuItemId = `signup-reward-${state.authUser.uid}`;
    state.menuItems = state.menuItems.filter((item) => item.id !== menuItemId);
    state.menuItems.push({
        ...selectedProduct,
        id: menuItemId,
        sellerId: 'manna_marketplace',
        sellerName: 'Manna Marketplace Rewards',
        price: 0,
        totalPrice: 0,
        defaultPrice: 0,
        sellerMarkup: 0,
        currency: 'LRD',
        isSellerOwned: false,
        isSignupReward: true,
        orderFlow: 'signup_reward',
        availability: true
    });
    closeModal();
    const rewardItem = state.menuItems.find((item) => item.id === menuItemId);
    if (openStorageChooser(rewardItem, null)) return;
    if (openCategoryVariantChooser(rewardItem)) return;
    addToCart(menuItemId);
}

function openCategoryVariantChooser(item, triggerButton = null) {
    const config = getCategoryVariantConfig(item.category || '');
    const variants = normalizeConfiguredVariants(item.variantOptions);
    if (!variants.length) return false;
    const availableVariants = variants.filter((variant) => variant.stockCount > 0);
    if (!availableVariants.length) {
        if (triggerButton) clearButtonBusy(triggerButton);
        createToast('All configured options for this product are out of stock.', 'warning');
        return true;
    }
    const fieldDefinitions = new Map((config.fields || []).map((field) => [field.key, field]));
    const variantKeys = [...new Set(availableVariants.flatMap((variant) => Object.keys(variant.values || {})))];
    const fields = variantKeys.map((key) => fieldDefinitions.get(key) || {
        key,
        label: key.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase())
    });
    if (!fields.length) return false;

    if (triggerButton) clearButtonBusy(triggerButton);
    const firstVariant = availableVariants[0];
    openModal(`Choose options for ${item.name}`, `
      <form id="categoryVariantForm" class="stack">
        <p class="muted">Choose the available product options before adding this item.</p>
        ${fields.map((field) => {
            const values = [...new Set(availableVariants.map((variant) => String(variant.values?.[field.key] || '')).filter(Boolean))];
            return `<label>${escapeHtml(field.label)}<select name="${escapeHtml(field.key)}" required>${values.map((value) => `<option value="${escapeHtml(value)}" ${value === String(firstVariant.values?.[field.key] || '') ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}</select></label>`;
        }).join('')}
        <div id="categoryVariantAvailability" class="muted"></div>
      </form>`);
    modalActions.innerHTML = '<button class="ghost-btn" id="cancelCategoryVariants" type="button">Cancel</button><button class="primary-btn" id="addCategoryVariant" type="button">Add to cart</button>';
    const getSelectedValues = () => Object.fromEntries(
        [...document.querySelectorAll('#categoryVariantForm select')].map((select) => [select.name, select.value])
    );
    const getMatchingVariant = () => findConfiguredVariant(availableVariants, getSelectedValues());
    const updateVariantAvailability = () => {
        const variant = getMatchingVariant();
        const addButton = document.getElementById('addCategoryVariant');
        const status = document.getElementById('categoryVariantAvailability');
        if (addButton) addButton.disabled = !variant;
        if (status) status.textContent = variant
            ? item.isSignupReward
                ? `Available · ${variant.stockCount} in stock · Free reward`
                : `Available · ${variant.stockCount} in stock · ${formatCurrency(getStoredProductPrice(item) + convertCurrency(variant.priceModifier, 'LRD', item.currency), item.currency)}`
            : 'That combination is not available.';
    };
    document.querySelectorAll('#categoryVariantForm select').forEach((select) => select.addEventListener('change', updateVariantAvailability));
    updateVariantAvailability();
    document.getElementById('cancelCategoryVariants')?.addEventListener('click', closeModal);
    document.getElementById('addCategoryVariant')?.addEventListener('click', () => {
        const variant = getMatchingVariant();
        if (!variant) return;
        closeModal();
        addToCart(item.id, '', '', '', variant.values);
    });
    return true;
}

function isSignupRewardCart() {
    return Boolean(state.cart.isSignupReward || getCartItems()[0]?.menuItem?.isSignupReward);
}

async function placeSignupRewardOrder() {
    if (!isCurrentCustomerAccount()) {
        createToast('Only customer accounts can place signup reward orders.', 'error');
        return;
    }
    const entry = getCartItems()[0];
    if (!entry?.menuItem?.isSignupReward || !state.cart.rewardClaimId) {
        createToast('The selected reward is not available in this cart.', 'error');
        return;
    }
    const button = document.getElementById('submitSignupRewardOrderButton');
    setButtonBusy(button, 'Submitting…');
    try {
        if (!isCustomerProfileComplete()) throw new Error('Complete your profile and delivery address before submitting the reward order.');
        if (Number(entry.quantity || 1) !== 1) throw new Error('A signup reward order can contain only one item.');
        const firebaseApp = window.firebase.app('manna-marketplace-data');
        const submitOrder = window.firebase.functions(firebaseApp).httpsCallable('submitSignupRewardOrder');
        const result = await submitOrder({
            customerPhone: state.customerProfile.phone,
            notes: state.cart.notes || '',
            selections: {
                storageSize: entry.storageSize || '',
                color: entry.color || '',
                shoeSize: entry.shoeSize || '',
                variantValues: entry.variantValues || {}
            }
        });
        state.signupRewardClaim = {
            ...(state.signupRewardClaim || {}),
            status: 'ordered',
            orderId: result.data?.orderId || state.signupRewardClaim?.orderId || ''
        };
        state.cart = normalizeCartState({
            sellerId: '',
            sellerName: '',
            items: [],
            paymentMethod: 'balance',
            paymentCurrency: 'LRD',
            deliveryFee: state.deliveryFee,
            selectedLocationId: state.activeAddressId
        });
        syncSellerCouponListener('');
        await saveCartToStorage();
        updateCartSummary();
        closeModal();
        showSection('orders');
        await loadOrders(state.authUser.uid);
        renderOrders();
        createToast('Free reward order submitted. It is awaiting admin confirmation.', 'success');
    } catch (error) {
        createToast(error.message || 'Unable to submit your reward order.', 'error');
    } finally {
        clearButtonBusy(button);
    }
}

function getCouponApplication(items = getCartItems()) {
    const code = String(state.cart.couponCode || '').trim().toUpperCase();
    if (!code) return { coupon: null, discountLrd: 0, itemDiscounts: [], message: '' };
    if (!state.couponsLoaded || state.couponSellerId !== state.cart.sellerId) {
        return { coupon: null, discountLrd: 0, itemDiscounts: [], message: 'Checking this seller’s coupons…', loading: true };
    }

    const coupon = state.coupons.find((entry) => String(entry.code || '').trim().toUpperCase() === code);
    if (!coupon || (coupon.status || 'active') !== 'active') return { coupon: null, discountLrd: 0, itemDiscounts: [], message: 'This coupon is not active or does not exist.' };
    const today = new Date().toISOString().slice(0, 10);
    if (coupon.expiryDate && String(coupon.expiryDate) < today) return { coupon: null, discountLrd: 0, itemDiscounts: [], message: 'This coupon has expired.' };

    const eligible = items.map((entry, index) => ({ entry, index })).filter(({ entry }) => {
        const item = entry.menuItem;
        const isEligibleCatalogItem = item?.masterProductId && item.isSellerOwned !== true && item.orderFlow !== 'seller_owned' && Number(item.defaultPrice || 0) > 0 && Number(item.sellerMarkup || 0) > 0;
        const appliesToProduct = coupon.scope !== 'selected'
            || (Array.isArray(coupon.productIds) && coupon.productIds.includes(item?.id));
        return isEligibleCatalogItem && appliesToProduct;
    });
    if (!eligible.length) return { coupon, discountLrd: 0, itemDiscounts: [], message: 'This coupon does not apply to products in your cart.' };

    const eligibleSubtotalLrd = eligible.reduce((sum, { entry }) => sum + convertCurrency(getCartLineUnitPrice(entry) * Number(entry.quantity || 1), entry.menuItem.currency, 'LRD'), 0);
    if (eligibleSubtotalLrd < Number(coupon.minimumOrderValue || 0)) {
        return { coupon, discountLrd: 0, itemDiscounts: [], message: `Add eligible products worth ${formatCurrency(Number(coupon.minimumOrderValue), 'LRD')} to use this coupon.` };
    }

    const totalMarkup = eligible.reduce((sum, { entry }) => sum + Number(entry.menuItem.sellerMarkup || 0) * Number(entry.quantity || 1), 0);
    if (totalMarkup <= 0) return { coupon, discountLrd: 0, itemDiscounts: [], message: 'No seller profit remains to discount on these products.' };
    const requestedDiscount = coupon.type === 'percentage'
        ? totalMarkup * Math.min(100, Math.max(0, Number(coupon.value || 0))) / 100
        : Math.max(0, Number(coupon.value || 0));
    const discountLrd = Math.round(Math.min(totalMarkup, requestedDiscount) * 100) / 100;
    const itemDiscounts = Array(items.length).fill(0);
    let allocated = 0;
    eligible.forEach(({ entry, index }, eligibleIndex) => {
        const itemMarkup = Number(entry.menuItem.sellerMarkup || 0) * Number(entry.quantity || 1);
        const allocation = eligibleIndex === eligible.length - 1
            ? discountLrd - allocated
            : discountLrd * itemMarkup / totalMarkup;
        itemDiscounts[index] = allocation;
        allocated += allocation;
    });
    return { coupon, discountLrd, itemDiscounts, message: `${coupon.code} applied.`, valid: true };
}

function applyCouponCode(code) {
    state.cart.couponCode = String(code || '').trim().toUpperCase();
    state.couponMessage = '';
    const result = getCouponApplication();
    state.couponMessage = result.message;
    saveCartToStorage();
    renderCheckout();
    if (result.valid) createToast(result.message, 'success');
    else if (state.cart.couponCode && !result.loading) createToast(result.message, 'warning');
}

function getPaymentMethodsForCurrency(currency, paymentNumbers) {
    const normalizedCurrency = normalizeCurrency(currency);
    const methods = [];
    if (normalizedCurrency === 'USD' && paymentNumbers.ubaUsdAccountNumber) methods.push('uba_usd');
    if (normalizedCurrency === 'LRD' && paymentNumbers.ubaLrdAccountNumber) methods.push('uba_lrd');
    if (normalizedCurrency === 'LRD') methods.push('balance');
    if (normalizedCurrency === 'USD' ? paymentNumbers.orangeMoneyUsdNumber : paymentNumbers.orangeMoneyLrdNumber) methods.push('orange_money');
    if (normalizedCurrency === 'USD' ? paymentNumbers.lonestarMoneyUsdNumber : paymentNumbers.lonestarMoneyLrdNumber) methods.push('lonestar_mobile_money');
    return methods;
}

function getAdminPaymentMethodDetails(method, currency) {
    const normalizedCurrency = normalizeCurrency(currency);
    if (method === 'balance') return { label: 'Wallet balance', number: formatLRD(state.walletBalance || 0), image: './images/logo/marketplace-logo.svg', receiverName: 'Your wallet' };
    const number = method === 'orange_money'
        ? (normalizedCurrency === 'USD' ? state.platformPaymentNumbers.orangeMoneyUsdNumber : state.platformPaymentNumbers.orangeMoneyLrdNumber)
        : method === 'lonestar_mobile_money'
            ? (normalizedCurrency === 'USD' ? state.platformPaymentNumbers.lonestarMoneyUsdNumber : state.platformPaymentNumbers.lonestarMoneyLrdNumber)
            : state.platformPaymentMethods[method]?.number || '';
    const image = method === 'orange_money'
        ? (normalizedCurrency === 'USD' ? state.platformPaymentNumbers.orangeMoneyUsdImage : state.platformPaymentNumbers.orangeMoneyLrdImage)
        : method === 'lonestar_mobile_money'
            ? (normalizedCurrency === 'USD' ? state.platformPaymentNumbers.lonestarMoneyUsdImage : state.platformPaymentNumbers.lonestarMoneyLrdImage)
            : state.platformPaymentMethods[method]?.image;
    const receiverName = method === 'orange_money'
        ? (normalizedCurrency === 'USD' ? state.platformPaymentNumbers.orangeMoneyUsdReceiverName : state.platformPaymentNumbers.orangeMoneyLrdReceiverName)
        : method === 'lonestar_mobile_money'
            ? (normalizedCurrency === 'USD' ? state.platformPaymentNumbers.lonestarMoneyUsdReceiverName : state.platformPaymentNumbers.lonestarMoneyLrdReceiverName)
            : state.platformPaymentNumbers[method === 'uba_usd' ? 'ubaUsdReceiverName' : 'ubaLrdReceiverName'];
    return { label: state.platformPaymentMethods[method]?.label || method.replaceAll('_', ' '), number, image: image || './images/logo/marketplace-logo.svg', receiverName: receiverName || 'Receiver' };
}

function isFavoriteMenuItem(menuItemId) {
    return state.favorites.some((entry) => entry.type === 'menuItem' && (entry.menuItemId === menuItemId || entry.id === menuItemId));
}

function getCurrentCheckoutPaymentNumbers() {
    const sellerId = state.cart.sellerId;
    if (!sellerId) {
        return { sellerId: '', orangeMoneyNumber: '', lonestarMoneyNumber: '', loading: false, loaded: false };
    }

    if (state.checkoutPaymentNumbers?.sellerId === sellerId) {
        return state.checkoutPaymentNumbers;
    }

    return { sellerId: '', orangeMoneyNumber: '', lonestarMoneyNumber: '', loading: false, loaded: false };
}

async function ensureCheckoutPaymentNumbers() {
    const sellerId = state.cart.sellerId;
    if (!sellerId || !db) return getCurrentCheckoutPaymentNumbers();

    const currentNumbers = state.checkoutPaymentNumbers;
    if (currentNumbers?.sellerId === sellerId && (currentNumbers.loaded || currentNumbers.loading)) {
        return currentNumbers;
    }

    state.checkoutPaymentNumbers = {
        sellerId,
        orangeMoneyNumber: '',
        lonestarMoneyNumber: '',
        loading: true,
        loaded: false
    };

    try {
        const sellerDoc = await db.collection('sellers').doc(sellerId).get();
        const sellerData = sellerDoc.data() || {};
        const nextNumbers = {
            sellerId,
            orangeMoneyNumber: String(sellerData.orangeMoneyNumber || sellerData.mobileMoneyNumber || '').trim(),
            lonestarMoneyNumber: String(sellerData.lonestarMoneyNumber || '').trim(),
            loading: false,
            loaded: true
        };
        state.checkoutPaymentNumbers = nextNumbers;
        if (document.getElementById('checkoutContent')) {
            renderCheckout();
        }
        return nextNumbers;
    } catch (error) {
        console.error('[Manna Marketplace] Unable to load seller payment numbers:', error);
        state.checkoutPaymentNumbers = {
            sellerId,
            orangeMoneyNumber: '',
            lonestarMoneyNumber: '',
            loading: false,
            loaded: true
        };
        return state.checkoutPaymentNumbers;
    }
}

async function handleCopyUssd(code) {
    const copied = await copyText(code);
    createToast(copied ? 'USSD code copied to clipboard!' : 'Unable to copy automatically. Please copy the code manually.', copied ? 'success' : 'warning');
}

function handleDialUssd(code) {
    const dialed = dialUSSD(code);
    if (!dialed) {
        createToast('Please manually dial the code using your phone’s dialer.', 'warning');
    }
}

function isFavoriteSeller(sellerId) {
    return state.favorites.some((entry) => entry.type === 'seller' && (entry.sellerId === sellerId || entry.id === sellerId));
}

function getFavoriteButtonClass(isActive) {
    return `ghost-btn favorite-btn ${isActive ? 'active' : ''}`;
}

function getFavoriteIcon(isActive) {
    return isActive ? '♥' : '♡';
}

function getProductVideoUrl(item) {
    const candidate = String(item?.videoUrl || item?.videoLink || '').trim();
    if (!candidate) return '';
    try {
        const parsedUrl = new URL(candidate, window.location.href);
        return ['http:', 'https:'].includes(parsedUrl.protocol) ? parsedUrl.href : '';
    } catch (error) {
        return '';
    }
}

function normalizeGeoPoint(value) {
    if (!value) return null;
    if (typeof value.toJSON === 'function' && value.latitude != null && value.longitude != null) {
        return { latitude: Number(value.latitude), longitude: Number(value.longitude) };
    }
    if (value.latitude != null && value.longitude != null) {
        return { latitude: Number(value.latitude), longitude: Number(value.longitude) };
    }
    if (value._lat != null && value._long != null) {
        return { latitude: Number(value._lat), longitude: Number(value._long) };
    }
    if (value.lat != null && value.lng != null) {
        return { latitude: Number(value.lat), longitude: Number(value.lng) };
    }
    return null;
}

function getCustomerLocationCoordinates(profile = state.customerProfile) {
    const geopoint = profile?.geopoint || profile?.deliveryLocation?.geopoint || profile?.deliveryAddress?.geopoint;
    const normalizedGeopoint = normalizeGeoPoint(geopoint);
    if (normalizedGeopoint) {
        return normalizedGeopoint;
    }
    const activeLocation = state.locations.find((entry) => entry.isActive === true) || state.locations[0] || null;
    if (activeLocation?.lat != null && activeLocation?.lng != null) {
        return { latitude: Number(activeLocation.lat), longitude: Number(activeLocation.lng) };
    }
    return null;
}

function hasLocationChanged(previousProfile = null, nextProfile = null) {
    return JSON.stringify(getCustomerLocationCoordinates(previousProfile)) !== JSON.stringify(getCustomerLocationCoordinates(nextProfile));
}

function formatDistanceLabel(distance) {
    if (distance === null || distance === undefined || Number.isNaN(distance)) return '';
    if (distance < 1) return '< 1 km away';
    return `${distance.toFixed(distance >= 10 ? 0 : 1)} km away`;
}

function getProductDeliveryDays(item = {}, seller = null) {
    const configuredDays = Number(item.deliveryDays || seller?.standardDeliveryDays || 0);
    if (Number.isFinite(configuredDays) && configuredDays > 0) return configuredDays;
    const platformDays = Number(state.deliveryOptions.regularDays);
    return Number.isFinite(platformDays) && platformDays > 0 ? platformDays : 3;
}

function getProductPerformanceScore(item = {}) {
    const getMetric = (keys) => keys.reduce((maximum, key) => {
        const value = Number(item[key]);
        return Number.isFinite(value) && value > maximum ? value : maximum;
    }, 0);
    const popularity = getMetric(['popularity']);
    const orders = getMetric(['orderCount', 'orders', 'sales', 'salesCount', 'purchaseCount', 'purchases']);
    const engagement = getMetric(['views', 'viewCount', 'clicks', 'clickCount', 'favorites', 'favoriteCount']);
    const rating = Math.min(5, getMetric(['rating'])) / 5;
    const reviewCount = getMetric(['reviewCount', 'reviewsCount']);

    return Math.log1p(popularity)
        + (2 * Math.log1p(orders))
        + (0.2 * Math.log1p(engagement))
        + (rating * Math.log1p(reviewCount));
}

function sortMenuItemsForCustomer(menuItems) {
    const uniqueItems = new Map();
    const genderPreference = String(state.customerProfile?.genderPreference || '').toLowerCase();
    const preferredClothingCategory = genderPreference === 'woman'
        ? "Women's Clothing"
        : genderPreference === 'man'
            ? "Men's Clothing"
            : '';
    menuItems.forEach((item) => {
        const productId = item.id || item.masterProductId || item.internationalProductId || item.name;
        const key = `${item.sellerId || ''}:${productId}`;
        if (!uniqueItems.has(key)) uniqueItems.set(key, item);
    });

    return [...uniqueItems.values()]
        .map((item) => ({
            item,
            matchesGenderPreference: preferredClothingCategory && getCategoryDisplayName(item.category) === preferredClothingCategory,
            weightedKey: -Math.log(Math.max(Math.random(), Number.EPSILON)) / (1 + getProductPerformanceScore(item))
        }))
        .sort((first, second) => Number(second.matchesGenderPreference) - Number(first.matchesGenderPreference) || first.weightedKey - second.weightedKey)
        .map(({ item }) => item);
}

function resolvePasswordResetEmail(fallbackEmail = '') {
    const profileEmail = state.customerProfile?.email || state.authUser?.email || '';
    if (profileEmail) return profileEmail;
    const loginEmail = document.getElementById('loginEmail')?.value?.trim() || '';
    return loginEmail || fallbackEmail;
}

function getSharedProductRedirectUrl() {
    const params = new URLSearchParams(window.location.search);
    const sellerId = String(params.get('sellerId') || '').trim();
    const productId = String(params.get('productId') || '').trim();
    if (!sellerId || !productId) return '';
    const url = new URL(window.location.href);
    url.searchParams.set('sellerId', sellerId);
    url.searchParams.set('productId', productId);
    return url.href;
}

function init() {
    loadSellerFilterPreferences();
    bindEvents();
    const storageApi = initStorage();
    storage = storageApi;
    auth = storageApi.auth;
    db = storageApi.db;
    watchMaintenanceMode(db);
    if (auth) {
        auth.setPersistence().catch(() => { });
    }
    if (!auth || !db) {
        createToast('local storage is not ready yet. Please refresh.', 'error');
        return;
    }
    if (new URLSearchParams(window.location.search).has('sellerId') && new URLSearchParams(window.location.search).has('productId')) {
        toggleAuthMode(true);
    }
    auth.onAuthStateChanged(handleAuthStateChange);
}

function toggleMobileCategoryDropdown(trigger) {
    if (window.innerWidth > 767) return;
    const dropdown = trigger?.nextElementSibling;
    if (!dropdown || !dropdown.classList.contains('category-dropdown')) return;

    const isOpen = dropdown.classList.contains('open');
    const activeDropdown = document.querySelector('.category-dropdown.open');
    if (activeDropdown && activeDropdown !== dropdown) {
        activeDropdown.classList.remove('open');
        activeDropdown.setAttribute('aria-hidden', 'true');
        const activeTrigger = activeDropdown.previousElementSibling;
        activeTrigger?.classList.remove('active');
        activeTrigger?.setAttribute('aria-expanded', 'false');
    }

    dropdown.classList.toggle('open', !isOpen);
    dropdown.setAttribute('aria-hidden', String(isOpen));
    trigger.classList.toggle('active', !isOpen);
    trigger.setAttribute('aria-expanded', String(!isOpen));
}

function closeMobileCategoryDropdown() {
    const dropdown = document.querySelector('.category-dropdown.open');
    if (!dropdown) return;

    dropdown.classList.remove('open');
    dropdown.setAttribute('aria-hidden', 'true');
    const trigger = dropdown.previousElementSibling;
    trigger?.classList.remove('active');
    trigger?.setAttribute('aria-expanded', 'false');
}

function bindEvents() {
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
        mobileNavClose.addEventListener('click', (event) => {
            event.stopPropagation();
            setMobileNavOpen(false);
        });
    }
    if (sidebarClose) {
        sidebarClose.addEventListener('click', () => setMobileNavOpen(false));
    }
    if (sidebarBackdrop) {
        sidebarBackdrop.addEventListener('click', () => setMobileNavOpen(false));
    }
    if (mobileMenuButton) {
        mobileMenuButton.addEventListener('click', openMobileMenu);
    }
    if (mobileNavSheet) {
        mobileNavSheet.addEventListener('click', (event) => {
            if (event.target === mobileNavSheet) {
                setMobileNavOpen(false);
            }
        });
    }
    document.getElementById('mobileLogoutButton')?.addEventListener('click', handleLogout);
    cartButton?.addEventListener('click', () => showSection('checkout'));
    if (notificationsToggle) {
        notificationsToggle.addEventListener('click', () => {
            showSection('notifications');
        });
    }
    navItems.forEach((button) => button.addEventListener('click', () => showSection(button.dataset.section)));
    mobileNavButtons.forEach((button) => {
        if (!button.dataset.section) return;
        button.addEventListener('click', () => showSection(button.dataset.section));
    });
    document.getElementById('homeSearch')?.addEventListener('input', (event) => {
        const nextValue = event.target.value.trim();
        state.searchQuery = nextValue.toLowerCase();
        window.clearTimeout(homeSearchTimeout);
        homeSearchTimeout = window.setTimeout(() => {
            renderHome();
        }, 300);
    });
    document.getElementById('sellerSearch')?.addEventListener('input', (event) => {
        state.searchQuery = event.target.value.toLowerCase();
        renderSellers();
    });
    document.getElementById('sellerCategoryFilter')?.addEventListener('change', (event) => {
        state.filters.category = event.target.value;
        renderSellers();
    });
    document.getElementById('sellerSort')?.addEventListener('change', (event) => {
        state.filters.sort = event.target.value;
        renderSellers();
    });
    document.getElementById('sellerCommunityFilterButton')?.addEventListener('click', openCommunityFilterModal);
    document.getElementById('orderFilter')?.addEventListener('change', (event) => {
        state.orderFilter = event.target.value;
        renderOrders();
    });
    document.getElementById('saveProfileButton')?.addEventListener('click', saveProfile);
    document.getElementById('placeOrderButton')?.addEventListener('click', openPaymentModal);
    document.getElementById('checkoutButton')?.addEventListener('click', () => showSection('checkout'));
    document.addEventListener('click', (event) => {
        if (event.target.closest('#mobileMenuButton')) {
            event.preventDefault();
            event.stopPropagation();
            setMobileNavOpen(true);
            return;
        }
        const sectionButton = event.target.closest('[data-section]');
        if (sectionButton) {
            showSection(sectionButton.dataset.section);
        }
    });
    document.addEventListener('click', (event) => {
        const trigger = event.target.closest('.filter-trigger');
        if (trigger && window.innerWidth <= 767) {
            event.stopPropagation();
            toggleMobileCategoryDropdown(trigger);
            return;
        }

        const closeButton = event.target.closest('.close-btn');
        if (closeButton && window.innerWidth <= 767) {
            event.stopPropagation();
            closeMobileCategoryDropdown();
            return;
        }

        const dropdown = document.querySelector('.category-dropdown.open');
        if (dropdown && !dropdown.contains(event.target) && !event.target.closest('.filter-trigger')) {
            closeMobileCategoryDropdown();
        }
    });

    document.addEventListener('keydown', (event) => {
        const trigger = event.target.closest('.filter-trigger');
        if (!trigger || window.innerWidth > 767) return;
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggleMobileCategoryDropdown(trigger);
        }
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
            localStorage.setItem('manna-onboarding-seen', 'true');
        });
    }
    if (onboardingOverlay && !localStorage.getItem('manna-onboarding-seen')) {
        onboardingOverlay.classList.remove('hidden');
        onboardingOverlay.setAttribute('aria-hidden', 'false');
    }
}

function setMobileNavOpen(isOpen) {
    const isMobile = window.innerWidth <= 1023;

    if (mobileNavSheet) {
        mobileNavSheet.classList.toggle('open', false);
        mobileNavSheet.setAttribute('aria-hidden', 'true');
    }

    if (sidebar) {
        sidebar.classList.toggle('open', isMobile && isOpen);
    }

    if (sidebarBackdrop) {
        sidebarBackdrop.classList.toggle('open', isMobile && isOpen);
    }

    document.body.style.overflow = isMobile && isOpen ? 'hidden' : '';
}

function setActiveNavigation(section) {
    document.querySelectorAll('.nav-item[data-section], .mobile-nav-item[data-section]').forEach((button) => {
        button.classList.toggle('active', button.getAttribute('data-section') === section);
    });
    // ensure mobile nav contains all main nav items
    (function syncMobileNavItems() {
        const mobileList = document.querySelector('.mobile-nav-list');
        if (!mobileList) return;
        const desktopItems = Array.from(document.querySelectorAll('.nav-item[data-section]')).filter(i => !i.closest('.mobile-nav-list'));
        desktopItems.forEach((item) => {
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
        // dedupe mobile items
        const seen = new Set();
        Array.from(mobileList.querySelectorAll('.mobile-nav-item')).forEach((el) => {
            const s = el.getAttribute('data-section');
            if (!s) return;
            if (seen.has(s)) el.remove(); else seen.add(s);
        });
    })();

    // notification badge helper
    (function updateNotificationBadge() {
        const badge = document.getElementById('notificationBadge') || document.getElementById('notificationCount');
        if (!badge) return;
        const count = (state.notifications || state.data?.notifications || []).filter(n => !n.read).length;
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
}

function toggleAuthMode(showRegister) {
    loginForm.classList.toggle('hidden', showRegister);
    registerForm.classList.toggle('hidden', !showRegister);
    authMessage.textContent = '';
}

async function handleLogin(event) {
    event.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    try {
        await auth.signInWithEmailAndPassword(email, password);
        createToast('Signed in successfully', 'success');
        const redirectUrl = getSharedProductRedirectUrl();
        if (redirectUrl) {
            window.location.href = redirectUrl;
        }
    } catch (error) {
        authMessage.textContent = error.message;
        createToast(error.message, 'error');
    }
}

async function handleRegister(event) {
    event.preventDefault();
    const name = document.getElementById('registerName').value.trim();
    const phone = document.getElementById('registerPhone').value.trim();
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;
    const confirmPassword = document.getElementById('registerConfirmPassword').value;
    if (!name || !phone || !email || !password || password !== confirmPassword) {
        authMessage.textContent = 'Please complete all fields and make sure passwords match.';
        return;
    }
    try {
        const result = await auth.createUserWithEmailAndPassword(email, password);
        const user = result.user;
        await user.updateProfile({ displayName: name });
        await db.collection('users').doc(user.uid).set({
            uid: user.uid,
            displayName: name,
            email,
            phone,
            role: 'customer',
            balance: 0,
            createdAt: new Date(),
            updatedAt: new Date()
        }, { merge: true });
        createToast('Account created. Welcome to Manna Marketplace.', 'success');
        const redirectUrl = getSharedProductRedirectUrl();
        if (redirectUrl) {
            window.location.href = redirectUrl;
            return;
        }
        toggleAuthMode(false);
    } catch (error) {
        authMessage.textContent = error.message;
        createToast(error.message, 'error');
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
        state.customerProfile = null;
        authScreen.classList.remove('hidden');
        appShell.classList.add('hidden');
    }
}

async function ensureCustomerSignupRewardClaim() {
    if (!isCurrentCustomerAccount() || !db) return;
    await subscribeToSignupReward(state.authUser.uid);
}

async function handleAuthStateChange(user) {
    if (!user) {
        if (state.authUser) {
            clearAuthBootstrapTimer();
            cleanupListeners();
            state.authUser = null;
            state.customerProfile = null;
            authScreen.classList.remove('hidden');
            appShell.classList.add('hidden');
            return;
        }
        scheduleAuthFallback();
        return;
    }
    clearAuthBootstrapTimer();
    state.authUser = user;
    try {
        const userDocRef = db.collection('users').doc(user.uid);
        const userDoc = await userDocRef.get();
        if (!userDoc.exists) {
            await userDocRef.set({ uid: user.uid, displayName: user.displayName || user.email, email: user.email, role: 'customer', createdAt: new Date(), updatedAt: new Date() });
        }
        const profile = userDoc.exists ? userDoc.data() : { uid: user.uid, displayName: user.displayName || user.email, email: user.email, role: 'customer' };
        const role = profile?.role;
        if (isAdminOnlyEmail(user.email) || role !== 'customer') {
            authMessage.textContent = 'This account is not authorized for the customer panel.';
            authScreen.classList.remove('hidden');
            appShell.classList.add('hidden');
            createToast('Please use the correct panel for this account.', 'warning');
            return;
        }
        state.customerProfile = profile;
        applyThemePreference(profile);
        authScreen.classList.add('hidden');
        appShell.classList.remove('hidden');
        await ensureCustomerSignupRewardClaim();
        await loadCustomerData();
        await initCustomerWallet();
        if (state.notifications.length) {
            renderNotifications();
        }
    } catch (error) {
        console.error(error);
        createToast(error.message || 'Could not load customer dashboard.', 'error');
    }
}

function cleanupListeners() {
    notificationSnapshotReady = false;
    state.notifications = [];
    state.walletUnsubscribes.forEach((unsubscribe) => unsubscribe());
    state.walletUnsubscribes = [];
    Object.values(state.promotionUnsubscribes).forEach((unsubscribe) => unsubscribe());
    state.promotionUnsubscribes = {};
    state.sellerPromotions = {};
    state.couponUnsubscribe?.();
    state.couponUnsubscribe = null;
    state.couponSellerId = '';
    state.coupons = [];
    state.couponsLoaded = false;
    if (state.catalogPriceRuleExpiryTimer) window.clearTimeout(state.catalogPriceRuleExpiryTimer);
    state.catalogPriceRuleExpiryTimer = null;
    state.signupRewardClaim = null;
    state.signupRewardPromptDismissed = false;
    state.signupRewardRevealShown = false;
    [state.profileUnsubscribe, state.sellersUnsubscribe, state.ordersUnsubscribe, state.favoritesUnsubscribe, state.addressesUnsubscribe, state.locationsUnsubscribe, state.cartUnsubscribe, state.adminSettingsUnsubscribe].forEach((unsubscribe) => {
        if (unsubscribe) unsubscribe();
    });
    if (state.orderCountdownTimer) {
        clearInterval(state.orderCountdownTimer);
        state.orderCountdownTimer = null;
    }
    state.profileUnsubscribe = null;
    state.sellersUnsubscribe = null;
    state.ordersUnsubscribe = null;
    state.favoritesUnsubscribe = null;
    state.addressesUnsubscribe = null;
    state.locationsUnsubscribe = null;
    state.cartUnsubscribe = null;
    state.adminSettingsUnsubscribe = null;
}

function refreshCustomerFeed() {
    customerFeedRefreshPending = true;
    if (customerFeedRefreshPromise) return customerFeedRefreshPromise;

    customerFeedRefreshPromise = (async () => {
        while (customerFeedRefreshPending) {
            customerFeedRefreshPending = false;
            try {
                await loadVisibleProducts();
                if (state.activeSection === 'home') {
                    renderHome();
                } else {
                    customerHomeFeedDirty = true;
                }
                renderSellers();
                if (state.activeSection === 'home' || state.activeSection === 'sellers') {
                    showSection(state.activeSection || 'home');
                }
            } catch (error) {
                console.error('[Manna Marketplace] Visible products load failed:', error);
            }
        }
    })().finally(() => {
        customerFeedRefreshPromise = null;
        if (customerFeedRefreshPending) refreshCustomerFeed();
    });
    return customerFeedRefreshPromise;
}

function setupRealtimeListeners(userId) {
    cleanupListeners();
    state.adminSettingsUnsubscribe = db.collection('adminSettings').doc('config').onSnapshot((doc) => {
        const settings = doc.exists ? doc.data() || {} : {};
        const previousAdminWhatsAppNumber = state.adminWhatsAppNumber;
        state.adminWhatsAppNumber = String(settings.adminWhatsAppNumber || '').trim();
        const nextRule = getActiveCatalogPriceRule(settings);
        const ruleChanged = JSON.stringify(nextRule) !== JSON.stringify(state.adminCatalogPriceRule);
        if (state.catalogPriceRuleExpiryTimer) window.clearTimeout(state.catalogPriceRuleExpiryTimer);
        state.catalogPriceRuleExpiryTimer = null;
        state.adminCatalogPriceRule = nextRule;
        const expiresAt = Date.parse(nextRule?.expiresAt || '');
        if (Number.isFinite(expiresAt) && expiresAt > Date.now()) {
            state.catalogPriceRuleExpiryTimer = window.setTimeout(() => {
                state.adminCatalogPriceRule = getActiveCatalogPriceRule(settings);
                refreshCustomerFeed();
            }, Math.min(expiresAt - Date.now() + 50, 2147483647));
        }
        if (!ruleChanged) {
            if (previousAdminWhatsAppNumber !== state.adminWhatsAppNumber && state.activeSection === 'orders') renderOrders();
            return;
        }
        refreshCustomerFeed().then(() => {
            if (state.activeSection === 'sellerDetail' && state.selectedSeller?.id) openSeller(state.selectedSeller.id);
            if (state.activeSection === 'cart') renderCart();
            if (state.activeSection === 'checkout') renderCheckout();
        });
    }, (error) => {
        console.error('[Manna Marketplace] Admin pricing settings listener failed:', error);
    });
    state.cartUnsubscribe = db.collection('users').doc(userId).collection('cart').doc('current').onSnapshot((snapshot) => {
        if (snapshot.exists) {
            state.cart = normalizeCartState(snapshot.data());
            syncSellerCouponListener(state.cart.sellerId);
            updateCartSummary();
            if (state.activeSection === 'cart') renderCart();
            if (state.activeSection === 'checkout') renderCheckout();
        }
    }, (error) => {
        console.error('[Manna Marketplace] Customer cart listener failed:', error);
    });
    state.profileUnsubscribe = db.collection('users').doc(userId).onSnapshot((doc) => {
        const previousProfile = state.customerProfile || {};
        state.customerProfile = doc.data() || {};
        applyThemePreference(state.customerProfile);
        subscribeToSignupReward(userId);
        renderProfileForm();
        renderSettingsForm();
        if (hasLocationChanged(previousProfile, state.customerProfile)
            || previousProfile.genderPreference !== state.customerProfile.genderPreference) {
            refreshCustomerFeed();
        }
    }, (error) => {
        console.error('[Manna Marketplace] Customer profile listener failed:', error);
    });
    state.sellersUnsubscribe = db.collection('sellers').where('status', '==', 'approved').where('isActive', '==', true).onSnapshot((snapshot) => {
        state.sellers = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).filter((seller) => !isLegacyRestaurantSeller(seller));
        syncSellerPromotionListeners(state.sellers);
        refreshCustomerFeed();
    }, (error) => {
        console.error('[Manna Marketplace] Sellers listener failed:', error);
    });
    state.ordersUnsubscribe = db.collection('orders').where('customerUid', '==', userId).onSnapshot((snapshot) => {
        state.orders = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        renderOrders();
    }, (error) => {
        console.error('[Manna Marketplace] Customer orders listener failed:', error);
    });
    state.favoritesUnsubscribe = db.collection('users').doc(userId).collection('favorites').onSnapshot((snapshot) => {
        state.favorites = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        renderFavorites();
    }, (error) => {
        console.error('[Manna Marketplace] Customer favorites listener failed:', error);
    });
    db.collection('notifications').where('recipientUid', '==', userId).orderBy('createdAt', 'desc').onSnapshot({ includeMetadataChanges: true }, (snapshot) => {
        const notifications = snapshot.docs
            .map((doc) => ({ id: doc.id, ...doc.data() }))
            .filter((item) => !item.recipientRole || item.recipientRole === 'customer');
        if (notificationSnapshotReady && !snapshot.metadata.fromCache) {
            const existingIds = new Set(state.notifications.map((item) => item.id));
            if (notifications.some((item) => !item.read && !item.isDeleted && !existingIds.has(item.id))) {
                playSoundEffect('notification');
            }
        }
        state.notifications = notifications;
        if (!snapshot.metadata.fromCache) notificationSnapshotReady = true;
        renderNotifications();
    }, (error) => {
        console.error('[Manna Marketplace] Customer notifications listener failed:', error);
    });
    db.collection('helpArticles').where('targetRoles', 'array-contains', 'customer').onSnapshot((snapshot) => {
        state.helpArticles = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        if (state.activeSection === 'help') {
            renderHelpArticles();
        }
    }, (error) => {
        console.error('[Manna Marketplace] Customer help articles listener failed:', error);
    });
    state.addressesUnsubscribe = db.collection('users').doc(userId).collection('addresses').onSnapshot((snapshot) => {
        state.addresses = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        const activeAddress = state.addresses.find((entry) => entry.isActive === true) || state.addresses[0] || null;
        state.activeAddressId = activeAddress?.id || '';
        state.cart.selectedLocationId = activeAddress?.id || '';
        saveCartToStorage();
        renderProfileForm();
        if (document.getElementById('checkoutContent')) {
            renderCheckout();
        }
    }, (error) => {
        console.error('[Manna Marketplace] Customer addresses listener failed:', error);
    });
    state.locationsUnsubscribe = db.collection('users').doc(userId).collection('customerLocations').orderBy('createdAt', 'desc').onSnapshot((snapshot) => {
        state.locations = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        renderProfileForm();
        if (document.getElementById('checkoutContent')) {
            renderCheckout();
        }
        refreshCustomerFeed();
    }, (error) => {
        console.error('[Manna Marketplace] Customer locations listener failed:', error);
    });
}

async function loadCustomerData() {
    const userId = state.authUser.uid;
    await loadPlatformSettings();
    setupRealtimeListeners(userId);
    subscribeToSignupReward(userId);
    renderAll();
    await hydrateCartFromStorage();
    showSection('home');
    await resolveSharedProductLink();
}

async function resolveSharedProductLink() {
    const params = new URLSearchParams(window.location.search);
    const sellerId = String(params.get('sellerId') || '').trim();
    const productId = String(params.get('productId') || '').trim();
    if (!sellerId || !productId) return;

    let product = state.menuItems.find((item) => item.id === productId && item.sellerId === sellerId);
    if (!product) {
        const sellerSnapshot = await db.collection('sellers').doc(sellerId).get();
        const productSnapshot = await db.collection('sellers').doc(sellerId).collection('menu').doc(productId).get();
        const sellerData = sellerSnapshot.exists ? sellerSnapshot.data() || {} : {};
        const productData = productSnapshot.exists ? productSnapshot.data() || {} : {};
        const isAvailable = productData.isAvailable ?? productData.availability ?? false;
        if (sellerSnapshot.exists && productSnapshot.exists && sellerData.status === 'approved' && sellerData.isActive !== false && isAvailable) {
            product = applyCatalogDiscount({
                id: productSnapshot.id,
                sellerId,
                ...productData,
                sellerName: sellerData.name || sellerData.businessName || 'Seller',
                isAvailable: true
            }, state.adminCatalogPriceRule);
            state.menuItems.push(product);
            if (!state.sellers.some((seller) => seller.id === sellerId)) {
                state.sellers.push({ id: sellerId, ...sellerData });
            }
        }
    }
    if (!product) {
        createToast('This shared product is unavailable or no longer listed.', 'warning');
        return;
    }

    await addToCart(productId);
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('sellerId');
    cleanUrl.searchParams.delete('productId');
    window.history.replaceState({}, document.title, cleanUrl.href);
    createToast(`${product.name} is ready for checkout.`, 'success');
}

async function loadPlatformSettings() {
    try {
        const platformSnapshot = await db.collection('settings').doc('platform').get();
        const data = platformSnapshot.exists ? platformSnapshot.data() : {};
        state.adminCatalogPriceRule = getActiveCatalogPriceRule(data);
        state.adminWhatsAppNumber = String(data.adminWhatsAppNumber || '').trim();
        const paymentImage = (value, fallback) => getImageUrl(String(value || '').trim(), fallback);
        state.deliveryOptions = {
            regularFee: Number(data.regularDeliveryFee || data.deliveryFee || 60),
            expressFee: Number(data.expressDeliveryFee || 120),
            regularDays: Number(data.regularDeliveryDays || 3),
            expressHours: Number(data.expressDeliveryHours || 24)
        };
        state.deliveryFee = state.deliveryOptions.regularFee;
        state.platformPaymentNumbers = {
            orangeMoneyNumber: String(data.adminOrangeMoneyNumber || data.orangeMoneyNumber || '').trim(),
            lonestarMoneyNumber: String(data.adminLonestarMoneyNumber || data.lonestarMoneyNumber || '').trim(),
            orangeMoneyUsdNumber: String(data.orangeMoneyUsdNumber || data.adminOrangeMoneyNumber || '').trim(),
            orangeMoneyLrdNumber: String(data.orangeMoneyLrdNumber || data.adminOrangeMoneyNumber || '').trim(),
            orangeMoneyUsdImage: paymentImage(data.orangeMoneyUsdImage, './images/payments/orange.png'),
            orangeMoneyLrdImage: paymentImage(data.orangeMoneyLrdImage, './images/payments/orange.png'),
            lonestarMoneyUsdNumber: String(data.lonestarMoneyUsdNumber || data.adminLonestarMoneyNumber || '').trim(),
            lonestarMoneyLrdNumber: String(data.lonestarMoneyLrdNumber || data.adminLonestarMoneyNumber || '').trim(),
            lonestarMoneyUsdImage: paymentImage(data.lonestarMoneyUsdImage, './images/payments/lonestar.png'),
            lonestarMoneyLrdImage: paymentImage(data.lonestarMoneyLrdImage, './images/payments/lonestar.png'),
            ubaUsdAccountNumber: String(data.ubaUsdAccountNumber || '').trim(),
            ubaLrdAccountNumber: String(data.ubaLrdAccountNumber || '').trim(),
            ubaUsdReceiverName: String(data.ubaUsdReceiverName || '').trim(),
            ubaLrdReceiverName: String(data.ubaLrdReceiverName || '').trim(),
            orangeMoneyUsdReceiverName: String(data.orangeMoneyUsdReceiverName || '').trim(),
            orangeMoneyLrdReceiverName: String(data.orangeMoneyLrdReceiverName || '').trim(),
            lonestarMoneyUsdReceiverName: String(data.lonestarMoneyUsdReceiverName || '').trim(),
            lonestarMoneyLrdReceiverName: String(data.lonestarMoneyLrdReceiverName || '').trim()
        };
        state.platformPaymentMethods = {
            uba_usd: { number: String(data.ubaUsdAccountNumber || '').trim(), name: String(data.ubaUsdReceiverName || '').trim(), image: paymentImage(data.ubaUsdPaymentImage, './images/logo/marketplace-logo.svg'), accountType: 'USD', label: 'UBA USD Account' },
            uba_lrd: { number: String(data.ubaLrdAccountNumber || '').trim(), name: String(data.ubaLrdReceiverName || '').trim(), image: paymentImage(data.ubaLrdPaymentImage, './images/logo/marketplace-logo.svg'), accountType: 'LRD', label: 'UBA LRD Account' },
            orange_money: { label: 'Orange Money', image: paymentImage(data.orangeMoneyUsdImage, './images/payments/orange.png'), receiverName: String(data.orangeMoneyUsdReceiverName || '').trim() },
            lonestar_mobile_money: { label: 'Lonestar Cell', image: paymentImage(data.lonestarMoneyUsdImage, './images/payments/lonestar.png'), receiverName: String(data.lonestarMoneyUsdReceiverName || '').trim() }
        };
    } catch (error) {
        console.error(error);
    }
}


async function loadSellers() {
    const snapshot = await db.collection('sellers').where('status', '==', 'approved').where('isActive', '==', true).get();
    state.sellers = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).filter((seller) => !isLegacyRestaurantSeller(seller));
    state.categories = [...new Set(state.sellers.map((seller) => seller.category).filter(Boolean))];
}

async function loadVisibleProducts() {
    const customerLocation = getCustomerLocationCoordinates();
    const approvedSellers = await db.collection('sellers').where('status', '==', 'approved').where('isActive', '==', true).get();
    const allProducts = [];

    const sellerDocuments = approvedSellers.docs;
    const sellerBatchSize = 6;
    for (let batchStart = 0; batchStart < sellerDocuments.length; batchStart += sellerBatchSize) {
        const sellerBatch = sellerDocuments.slice(batchStart, batchStart + sellerBatchSize);
        const sellerResults = await Promise.all(sellerBatch.map(async (sellerDoc) => {
            const sellerData = sellerDoc.data() || {};
            const sellerId = sellerDoc.id;
            const sellerName = sellerData.name || 'Seller';
            const sellerGeopoint = normalizeGeoPoint(sellerData.geopoint || sellerData.location?.geopoint);
            const distance = customerLocation && sellerGeopoint
                ? calculateDistance(customerLocation.latitude, customerLocation.longitude, sellerGeopoint.latitude, sellerGeopoint.longitude)
                : null;

            const [menuSnapshot, promotionSnapshot, inventorySnapshot] = await Promise.all([
                db.collection('sellers').doc(sellerId).collection('menu').get(),
                db.collection('sellers').doc(sellerId).collection('promotions').get(),
                db.collection('sellers').doc(sellerId).collection('internationalInventory').get()
            ]);
            const sellerPromotions = state.sellerPromotions[sellerId] || promotionSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
            const products = [];
            for (const menuDoc of menuSnapshot.docs) {
                const menuItem = menuDoc.data() || {};
                const isAvailable = menuItem.isAvailable ?? menuItem.availability ?? false;
                if (!isAvailable) continue;

                products.push(applySellerPromotion(applyCatalogDiscount({
                    id: menuDoc.id,
                    sellerId,
                    ...menuItem,
                    sellerName,
                    distance,
                    isAvailable: true
                }, state.adminCatalogPriceRule), sellerPromotions));
            }
            for (const inventoryDoc of inventorySnapshot.docs) {
                const inventory = inventoryDoc.data() || {};
                if (Number(inventory.quantity || 0) <= 0) continue;
                products.push({
                    id: inventoryDoc.id,
                    sellerId,
                    name: inventory.name,
                    description: inventory.resaleDescription || inventory.sourceDescription || '',
                    sellerDescription: inventory.resaleDescription || inventory.sourceDescription || '',
                    price: Number(inventory.resalePrice || 0),
                    currency: normalizeCurrency(inventory.resaleCurrency),
                    masterProductId: inventory.masterProductId,
                    internationalProductId: inventory.internationalProductId,
                    image: inventory.image || '',
                    imageFilename: inventory.imageFilename || '',
                    sellerName,
                    distance,
                    isAvailable: true
                });
            }
            return { sellerId, sellerPromotions, products };
        }));

        sellerResults.forEach(({ sellerId, sellerPromotions, products }) => {
            state.sellerPromotions[sellerId] = sellerPromotions;
            allProducts.push(...products);
        });
    }

    state.menuItems = sortMenuItemsForCustomer(allProducts);
    state.sellers = state.sellers.map((seller) => {
        const sellerGeopoint = normalizeGeoPoint(seller.geopoint || seller.location?.geopoint);
        const distance = customerLocation && sellerGeopoint
            ? calculateDistance(customerLocation.latitude, customerLocation.longitude, sellerGeopoint.latitude, sellerGeopoint.longitude)
            : null;
        return { ...seller, distance };
    });
    state.categories = [...new Set(state.menuItems.map((item) => getCategoryDisplayName(item.category)).filter(Boolean))];
}

async function loadOrders(userId) {
    const snapshot = await db.collection('orders').where('customerUid', '==', userId).orderBy('createdAt', 'desc').get();
    state.orders = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function loadFavorites(userId) {
    const snapshot = await db.collection('users').doc(userId).collection('favorites').get();
    state.favorites = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function loadAddresses(userId) {
    const snapshot = await db.collection('users').doc(userId).collection('addresses').get();
    state.addresses = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function loadProfile(userId) {
    const doc = await db.collection('users').doc(userId).get();
    state.customerProfile = doc.data() || {};
    renderProfileForm();
    renderSettingsForm();
}

function renderAll() {
    renderHome();
        renderSellers();
    renderOrders();
    renderFavorites();
    renderNotifications();
    renderProfileForm();
    renderSettingsForm();
    updateCartSummary();
}

function ensureCustomerWalletSection() {
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
    section.innerHTML = `<div class="panel-card"><div class="panel-card-header"><h3>Wallet</h3><span class="badge">Customer balance</span></div><div class="wallet-balance-card"><div class="wbc-label">Available balance</div><div class="wbc-amount" id="customerBalanceAmount">L$0.00</div><div class="wbc-actions"><button class="primary-btn" id="customerDepositButton" type="button">Deposit</button><button class="ghost-btn" id="customerWithdrawButton" type="button">Withdraw</button></div></div><div class="wallet-summary-grid"><div class="summary-item"><div class="summary-label">Total Deposited</div><div class="summary-amount" id="customerTotalDeposited">L$0.00</div></div><div class="summary-item"><div class="summary-label">Total Withdrawn</div><div class="summary-amount" id="customerTotalWithdrawn">L$0.00</div></div><div class="summary-item"><div class="summary-label">Pending Balance</div><div class="summary-amount" id="customerPendingBalance">L$0.00</div></div></div><div class="wallet-info-bar hidden" id="customerDepositInfo"></div><form class="wallet-form-card hidden" id="customerDepositForm"><h4>Submit deposit request</h4><div class="muted">Default payment is USD. Choose the payment method that matches your transfer before submitting.</div><label>Amount (USD default)<input name="amount" type="number" min="1" required /></label><label>Payment method<select name="paymentMethod"><option value="uba_usd" selected>UBA USD Account</option><option value="uba_lrd">UBA LRD Account</option><option value="orange_money">Orange Money</option><option value="lonestar_mobile_money">Lonestar Cell</option></select></label><label>Phone sent from<input name="senderPhone" type="tel" required /></label><label>Payment reference<input name="paymentRef" required /></label><div class="wfc-actions"><button class="primary-btn" type="submit">Submit request</button><button class="ghost-btn" id="cancelCustomerDeposit" type="button">Cancel</button></div></form><form class="wallet-form-card hidden" id="customerWithdrawForm"><h4>Request withdrawal</h4><p class="muted">Your balance will be deducted immediately and held until your request is processed.</p><label>Amount (LRD)<input name="amount" type="number" min="1" required /></label><label>Recipient name<input name="recipientName" required /></label><label>Mobile money number<input name="recipientPhone" type="tel" required /></label><div class="wfc-actions"><button class="primary-btn" type="submit">Request withdrawal</button><button class="ghost-btn" id="cancelCustomerWithdraw" type="button">Cancel</button></div></form><div class="wallet-section-block"><h4>Withdrawal requests</h4><div id="customerWithdrawalsList"></div></div><div class="wallet-section-block"><h4>Transaction history</h4><div id="customerTransactionsList"></div></div></div>`;
    document.querySelector('.main-panel')?.appendChild(section);
    document.getElementById('customerDepositButton')?.addEventListener('click', () => { document.getElementById('customerDepositForm')?.classList.remove('hidden'); document.getElementById('customerWithdrawForm')?.classList.add('hidden'); });
    document.getElementById('customerWithdrawButton')?.addEventListener('click', () => { document.getElementById('customerWithdrawForm')?.classList.remove('hidden'); document.getElementById('customerDepositForm')?.classList.add('hidden'); });
    document.getElementById('cancelCustomerDeposit')?.addEventListener('click', () => document.getElementById('customerDepositForm')?.classList.add('hidden'));
    document.getElementById('cancelCustomerWithdraw')?.addEventListener('click', () => document.getElementById('customerWithdrawForm')?.classList.add('hidden'));
    document.getElementById('customerDepositForm')?.addEventListener('submit', (event) => { event.preventDefault(); const button = event.currentTarget.querySelector('button[type="submit"]'); const data = Object.fromEntries(new FormData(event.currentTarget)); withButtonState(button, async () => { const paymentMethod = data.paymentMethod || ''; const paymentCurrency = data.paymentCurrency || 'USD'; if (!paymentMethod) throw new Error('No payment method is configured for this currency.'); await submitDepositRequest(state.authUser.uid, 'customer', state.customerProfile?.displayName, state.customerProfile?.email || state.authUser.email, data.amount, data.paymentRef, data.senderPhone, paymentMethod, paymentCurrency); event.currentTarget.reset(); event.currentTarget.classList.add('hidden'); }, { loadingText: 'Submitting...', successText: 'Request sent', permanent: false }); });
    document.getElementById('customerWithdrawForm')?.addEventListener('submit', (event) => { event.preventDefault(); const button = event.currentTarget.querySelector('button[type="submit"]'); const data = Object.fromEntries(new FormData(event.currentTarget)); withButtonState(button, async () => { await submitWithdrawalRequest(state.authUser.uid, 'customer', state.customerProfile?.displayName, data.amount, data.recipientName, data.recipientPhone); event.currentTarget.reset(); event.currentTarget.classList.add('hidden'); }, { loadingText: 'Submitting...', successText: 'Request placed', permanent: false }); });
}

async function initCustomerWallet() {
    ensureCustomerWalletSection();
    const userId = state.authUser.uid;
    await autoReceiveOldWithdrawals(userId);
    const config = await loadWalletConfig();
    const depositForm = document.getElementById('customerDepositForm');
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
    const methodSelect = document.getElementById('customerDepositForm')?.querySelector('select[name="paymentMethod"]');
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
    const updateDepositMethods = () => {
        const methods = window.getConfiguredDepositMethods?.(config, currencySelect?.value || 'USD') || [];
        methodCards.innerHTML = methods.length ? methods.map((method, index) => `<label class="payment-method-option compact-payment-method ${index === 0 ? 'selected' : ''}"><input type="radio" name="customerDepositMethodChoice" value="${escapeHtml(method.value)}" ${index === 0 ? 'checked' : ''} /><img src="${escapeHtml(method.image || './images/logo/marketplace-logo.svg')}" alt="${escapeHtml(method.label)}" /><span>${escapeHtml(method.label)}</span><small>${escapeHtml(method.details)}</small></label>`).join('') : '<div class="muted">No payment method configured</div>';
        methodValue.value = methods[0]?.value || '';
        methodCards.querySelectorAll('input').forEach((input) => input.addEventListener('change', () => { methodValue.value = input.value; methodCards.querySelectorAll('.payment-method-option').forEach((card) => card.classList.toggle('selected', card.contains(input))); }));
        const method = methods[0];
        const preview = depositForm?.querySelector('[data-deposit-method-image]');
        if (preview) { preview.src = method?.image || './images/logo/marketplace-logo.svg'; preview.alt = method?.label || 'Payment method'; }
    };
    currencySelect?.addEventListener('change', updateDepositMethods);
    methodCards.addEventListener('change', (event) => {
        const method = (window.getConfiguredDepositMethods?.(config, currencySelect?.value || 'USD') || []).find((entry) => entry.value === event.target.value);
        const preview = depositForm?.querySelector('[data-deposit-method-image]');
        if (preview) { preview.src = method?.image || './images/logo/marketplace-logo.svg'; preview.alt = method?.label || 'Payment method'; }
    });
    const preview = document.createElement('img');
    preview.dataset.depositMethodImage = 'true';
    preview.style.cssText = 'width:48px;height:48px;object-fit:contain;border-radius:10px;margin:8px 0;';
    depositForm?.querySelector('select[name="paymentMethod"]')?.after(preview);
    updateDepositMethods();
    const info = document.getElementById('customerDepositInfo');
    if (config.adminMobileNumber && info) { info.innerHTML = `<strong>Deposit instructions:</strong> Send mobile money to ${escapeHtml(config.adminMobileName || 'Manna Marketplace')} at ${escapeHtml(config.adminMobileNumber)}, then submit your reference.`; info.classList.remove('hidden'); }
    state.walletUnsubscribes?.forEach((unsubscribe) => unsubscribe());
    state.walletUnsubscribes = [db.collection('users').doc(userId).onSnapshot((snapshot) => { const data = snapshot.data() || {}; const balance = Number(data.balance || 0); const balanceUSD = Number(data.balanceUSD || 0); state.walletBalance = balance; state.walletBalanceUSD = balanceUSD; const element = document.getElementById('customerBalanceAmount'); if (element) element.textContent = `L$${balance.toLocaleString('en-LR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} • $${balanceUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; const available = document.getElementById('payBalanceAvailable'); if (available) available.textContent = `Available: ${formatLRD(balance)}`; }), db.collection('withdrawalRequests').where('userId', '==', userId).orderBy('createdAt', 'desc').onSnapshot((snapshot) => renderCustomerWalletRequests(snapshot.docs))];
    
    // Load and display transaction statistics
    const transactions = await loadTransactionHistory(userId);
    const container = document.getElementById('customerTransactionsList');
    if (container) container.innerHTML = transactions.length ? transactions.map((transaction) => `<div class="wallet-tx-row"><span>${escapeHtml(transaction.description || transaction.type)}</span><strong class="${transaction.amount >= 0 ? 'amount-credit' : 'amount-debit'}">${transaction.amount >= 0 ? '+' : '-'}${formatLRD(Math.abs(transaction.amount))}</strong></div>`).join('') : '<div class="empty-state">No transactions yet.</div>';
    
    // Calculate wallet summary statistics
    const depositTransactions = transactions.filter((t) => t.type === 'deposit' && t.amount > 0);
    const withdrawalTransactions = transactions.filter((t) => t.type === 'withdrawal' && t.amount < 0);
    const totalDeposited = depositTransactions.reduce((sum, t) => sum + Number(t.amount || 0), 0);
    const totalWithdrawn = Math.abs(withdrawalTransactions.reduce((sum, t) => sum + Number(t.amount || 0), 0));
    
    // Get pending withdrawals
    const withdrawalsSnapshot = await db.collection('withdrawalRequests').where('userId', '==', userId).orderBy('createdAt', 'desc').get();
    const pendingBalance = withdrawalsSnapshot.docs.filter((doc) => doc.data().status === 'pending').reduce((sum, doc) => sum + Number(doc.data().amount || 0), 0);
    
    // Update summary displays
    const summaryElements = {
        'customerTotalDeposited': totalDeposited,
        'customerTotalWithdrawn': totalWithdrawn,
        'customerPendingBalance': pendingBalance
    };
    
    Object.entries(summaryElements).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = formatLRD(value);
    });
}

function renderCustomerWalletRequests(docs) {
    const container = document.getElementById('customerWithdrawalsList');
    if (!container) return;
    container.innerHTML = docs.length ? docs.map((doc) => { const item = doc.data(); return `<div class="wallet-tx-row"><span>${formatLRD(item.amount)} to ${escapeHtml(item.recipientPhone)}</span><span class="status-badge status-${escapeHtml(item.status)}">${escapeHtml(item.status)}</span>${item.status === 'paid' ? `<button class="ghost-btn wallet-confirm-received" data-id="${doc.id}" type="button">Confirm received</button>` : ''}</div>`; }).join('') : '<div class="empty-state">No withdrawal requests yet.</div>';
    container.querySelectorAll('.wallet-confirm-received').forEach((button) => button.addEventListener('click', () => withButtonState(button, () => db.collection('withdrawalRequests').doc(button.dataset.id).update({ status: 'received', receivedAt: new Date() }), { loadingText: 'Confirming...', successText: 'Received', permanent: true })));
}

function getProductSearchText(item = {}) {
    const keywordText = Array.isArray(item.searchKeywords) ? item.searchKeywords.join(' ') : (item.searchKeywords || '');
    return [
        item.name,
        item.sellerName,
        item.sellerDescription,
        item.description,
        item.category,
        getCategoryDisplayName(item.category),
        keywordText
    ].filter(Boolean).join(' ').toLowerCase();
}

function renderHome() {
    customerHomeFeedDirty = false;
    const categoryOptions = [{ label: 'All', value: 'all' }, ...state.categories.map((category) => ({ label: category, value: category }))];
    const categoryMarkup = categoryOptions.length
        ? categoryOptions.map((category) => `<button class="chip ${state.filters.category === category.value ? 'active' : ''}" data-category="${category.value}">${category.label}</button>`).join('')
        : '<div class="empty-state">No categories yet.</div>';

    const desktopCategories = document.getElementById('homeCategories');
    if (desktopCategories) {
        desktopCategories.innerHTML = categoryMarkup;
    }

    const mobileCategories = document.getElementById('mobileHomeCategories');
    if (mobileCategories) {
        mobileCategories.innerHTML = categoryMarkup;
    }

    document.querySelectorAll('[data-category]').forEach((button) => {
        button.addEventListener('click', () => {
            const nextCategory = button.dataset.category || 'all';
            const isSameCategory = state.filters.category === nextCategory;
            state.filters.category = isSameCategory ? 'all' : nextCategory;
            renderHome();
            if (window.innerWidth <= 767) {
                closeMobileCategoryDropdown();
            }
        });
    });

    const featuredProducts = state.menuItems.filter((item) => item.isAvailable !== false && item.availability !== false);
    const searchQuery = String(state.searchQuery || '').trim().toLowerCase();
    const filteredProducts = featuredProducts.filter((item) => {
        const matchesCategory = state.filters.category === 'all' || getCategoryDisplayName(item.category) === state.filters.category;
        if (!matchesCategory) return false;
        if (!searchQuery) return true;
        const haystack = getProductSearchText(item);
        const searchTerms = searchQuery.split(/\s+/).filter(Boolean);
        return searchTerms.every((term) => haystack.includes(term));
    });
        const renderedProducts = filteredProducts;

    document.getElementById('homeContent').innerHTML = `${renderedProducts.length ? renderedProducts.map((item, index) => {
        const seller = state.sellers.find((entry) => entry.id === item.sellerId);
            const sellerWebsiteUrl = getSocialUrl(seller?.websiteUrl || seller?.website || seller?.storeUrl || seller?.storeWebsite);
        const sellerWhatsAppUrl = getWhatsAppUrl(seller?.whatsappNumber || seller?.phone, `Hello ${seller?.name || item.sellerName || 'seller'}, I would like to ask about ${item.name} before buying.`);
        const productVideoUrl = getProductVideoUrl(item);
        const imageValue = item.imageFilename || item.image || '';
        const fullImageUrl = getImageUrl(imageValue);
        const thumbnailUrl = getProductThumbnailUrl(imageValue);
        const isFavorite = isFavoriteMenuItem(item.id);
        const isNearby = item.distance !== null && item.distance !== undefined && Number.isFinite(item.distance);
        const distanceLabel = formatDistanceLabel(item.distance);
                const estimatedDeliveryDays = getProductDeliveryDays(item, seller);
                const estimatedDeliveryDate = new Date(Date.now() + estimatedDeliveryDays * 24 * 60 * 60 * 1000);
        const estimatedDeliveryLabel = new Intl.DateTimeFormat('en-LR', { month: 'short', day: 'numeric' }).format(estimatedDeliveryDate);
        return `
                    <div class="item-card product-card">
                        <div class="product-card-image">
                                <a class="product-card-image-link" href="${escapeHtml(fullImageUrl)}" target="_blank" rel="noopener noreferrer" title="Open full-size image"><img src="./images/placeholder.png" data-mobile-loader data-mobile-src="${escapeHtml(thumbnailUrl)}" data-full-src="${escapeHtml(fullImageUrl)}" loading="${index < 4 ? 'eager' : 'lazy'}" fetchpriority="${index < 2 ? 'high' : 'auto'}" decoding="async" alt="${escapeHtml(item.name)}" /></a>
                                ${productVideoUrl ? `<a class="product-video-overlay" href="${escapeHtml(productVideoUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Watch product video" title="Watch product video">${getVideoIcon()}</a>` : ''}
                            <button class="product-favorite-overlay ${getFavoriteButtonClass(isFavorite)}" data-favorite-item="${item.id}" type="button" aria-label="${isFavorite ? 'Remove from favorites' : 'Add to favorites'}" aria-pressed="${isFavorite ? 'true' : 'false'}">${getFavoriteIcon(isFavorite)}</button>
                        </div>
                        <div class="product-card-info">
                            <div class="product-card-copy">
                                <strong class="product-card-name">${item.name}</strong>
                                ${renderExpandableDescription(item.sellerDescription || item.description || 'Freshly prepared and ready for your order.')}
                            </div>
                            <div class="product-card-summary-row">
                                <div class="product-card-delivery">Delivery by ${estimatedDeliveryLabel}</div>
                                <div class="product-card-meta">
                                    ${renderProductPrice(item)}
                                    ${isNearby ? '<span class="priority-badge">Nearby</span>' : ''}
                                    ${distanceLabel ? `<span class="distance-badge">📍 ${distanceLabel}</span>` : ''}
                                </div>
                            </div>
                            <div class="product-card-seller-row">
                                <button class="primary-btn buy-action" data-add-order="${item.id}" type="button">Buy</button>
                                <div class="muted product-card-store">
                                    ${sellerWhatsAppUrl ? `<a class="product-store-whatsapp" href="${sellerWhatsAppUrl}" target="_blank" rel="noopener noreferrer" aria-label="WhatsApp seller" title="WhatsApp seller">${getWhatsAppIcon()}</a>` : ''}
                                    ${sellerWebsiteUrl ? `<a class="product-card-store-name" href="${escapeHtml(sellerWebsiteUrl)}" target="_blank" rel="noopener noreferrer">${seller?.name || item.sellerName || 'Seller'}</a>` : `<span class="product-card-store-name">${seller?.name || item.sellerName || 'Seller'}</span>`}
                                </div>
                            </div>
                            <div class="modal-actions contact-actions">
                                ${getSellerSocialLinks(seller)}
                            </div>
            </div>
          </div>`;
    }).join('') : '<div class="empty-state">No products are available right now.</div>'}`;

    if (['eligible', 'selected'].includes(state.signupRewardClaim?.status)) {
        const homeContent = document.getElementById('homeContent');
        const isSelected = state.signupRewardClaim.status === 'selected';
        const reminder = isSelected
            ? '<div class="item-card" style="grid-column: 1 / -1"><strong>Your free reward is selected</strong><div class="muted">Choose product options and submit your free order to continue.</div><button class="secondary-btn" id="openSignupRewardButton" type="button">Continue reward order</button></div>'
            : '<div class="item-card" style="grid-column: 1 / -1"><strong>Your signup reward is waiting</strong><div class="muted">You are eligible to choose one of four blind boxes. Complete your delivery profile, then claim your free regular delivery reward.</div><button class="secondary-btn" id="openSignupRewardButton" type="button">Open reward</button></div>';
        homeContent?.insertAdjacentHTML('afterbegin', reminder);
        document.getElementById('openSignupRewardButton')?.addEventListener('click', () => isSelected ? showSignupRewardReveal(state.signupRewardClaim) : openSignupRewardModal());
    }
    document.querySelectorAll('[data-add-order]').forEach((button) => button.addEventListener('click', () => withButtonState(button, () => addToCart(button.dataset.addOrder), { loadingText: 'Adding...', successText: 'In Cart', permanent: true })));
    document.querySelectorAll('[data-favorite-item]').forEach((button) => button.addEventListener('click', () => toggleFavoriteItem(button.dataset.favoriteItem)));
}

function saveSellerFilterPreferences() {
    sessionStorage.setItem('manna-customer-community-filter', state.filters.community || '');
}

function loadSellerFilterPreferences() {
    const savedCommunity = sessionStorage.getItem('manna-customer-community-filter') || '';
    if (savedCommunity) {
        state.filters.community = savedCommunity;
    }
}

function openCommunityFilterModal() {
    const options = getCommunityOptions().map((community) => `<option value="${escapeHtml(community.toLowerCase())}" ${state.filters.community?.toLowerCase() === community.toLowerCase() ? 'selected' : ''}>${escapeHtml(community)}</option>`).join('');
    modalTitle.textContent = 'Filter by community';
    modalBody.innerHTML = `
      <div class="stack">
        <label>Community<select id="communityFilterSelect">
          <option value="">All communities</option>
          ${options}
        </select></label>
      </div>`;
    modalActions.innerHTML = `
      <button class="ghost-btn" id="clearCommunityFilterButton" type="button">Clear</button>
      <button class="primary-btn" id="applyCommunityFilterButton" type="button">Apply</button>
    `;
    modalBackdrop.classList.remove('hidden');
    modalBackdrop.setAttribute('aria-hidden', 'false');
    document.getElementById('applyCommunityFilterButton')?.addEventListener('click', () => {
        const select = document.getElementById('communityFilterSelect');
        state.filters.community = select?.value || '';
        saveSellerFilterPreferences();
        renderSellers();
        closeModal();
    });
    document.getElementById('clearCommunityFilterButton')?.addEventListener('click', () => {
        state.filters.community = '';
        saveSellerFilterPreferences();
        renderSellers();
        closeModal();
    });
    window.addEventListener('keydown', handleModalEscape);
}

function renderSellers() {
    const filtered = state.sellers.filter((seller) => {
        const search = state.searchQuery || '';
        const matchesSearch = !search || `${seller.name} ${seller.description || ''}`.toLowerCase().includes(search);
        const matchesCategory = state.filters.category === 'all' || getCategoryDisplayName(seller.category) === state.filters.category || state.menuItems.some((item) => item.sellerId === seller.id && getCategoryDisplayName(item.category) === state.filters.category);
        const communityValue = String(state.filters.community || '').trim().toLowerCase();
        const matchesCommunity = !communityValue || String(seller.community || seller.district || seller.county || '').trim().toLowerCase() === communityValue;
        return matchesSearch && matchesCategory && matchesCommunity;
    }).sort((a, b) => {
        if (state.filters.sort === 'distance') return (a.distance || 0) - (b.distance || 0);
        if (state.filters.sort === 'newest') return Number(b.createdAt?.seconds || 0) - Number(a.createdAt?.seconds || 0);
        if (state.filters.sort === 'popularity') return Number(b.orderCount || 0) - Number(a.orderCount || 0);
        return Number(b.rating || 0) - Number(a.rating || 0);
    });
    document.getElementById('sellersGrid').innerHTML = filtered.length ? filtered.map((seller) => `
    <div class="item-card">
      <img src="${getSellerImageUrl(seller)}" alt="${seller.name}" onerror="this.src='./images/placeholder.png'" />
    <div class="panel-card-header"><strong>${seller.name}</strong><span class="badge">${getCategoryDisplayName(seller.category || 'General')}</span></div>
    ${renderExpandableDescription(seller.description || 'Local favorites and quality products.')}
      ${seller.phone ? `<div class="muted">📞 ${escapeHtml(seller.phone)}</div>` : ''}
      ${seller.community || seller.district || seller.county ? `<div class="muted">📍 ${escapeHtml([seller.community, seller.district, seller.county].filter(Boolean).join(' • '))}</div>` : ''}
      <div class="modal-actions">
        <button class="primary-btn" data-open-seller="${seller.id}">View Menu</button>
                ${getWhatsAppUrl(seller.whatsappNumber || seller.phone, `Hello ${seller.name || 'seller'}, I would like to ask about your products before buying.`) ? `<a class="contact-icon-link" href="${getWhatsAppUrl(seller.whatsappNumber || seller.phone, `Hello ${seller.name || 'seller'}, I would like to ask about your products before buying.`)}" target="_blank" rel="noopener noreferrer" aria-label="WhatsApp seller" title="WhatsApp seller">${getWhatsAppIcon()}</a>` : ''}
                ${getSellerSocialLinks(seller)}
        <button class="${getFavoriteButtonClass(isFavoriteSeller(seller.id))}" data-favorite-seller="${seller.id}" aria-pressed="${isFavoriteSeller(seller.id) ? 'true' : 'false'}">${getFavoriteIcon(isFavoriteSeller(seller.id))}</button>
      </div>
    </div>`).join('') : '<div class="empty-state">No sellers match your filters.</div>';
    document.querySelectorAll('[data-open-seller]').forEach((button) => button.addEventListener('click', () => openSeller(button.dataset.openSeller)));
    document.querySelectorAll('[data-favorite-seller]').forEach((button) => button.addEventListener('click', () => toggleFavoriteSeller(button.dataset.favoriteSeller)));
}

async function openSeller(sellerId) {
    const seller = state.sellers.find((entry) => entry.id === sellerId);
    if (!seller) return;
    state.selectedSeller = seller;
    const [menuSnapshot, promotionSnapshot] = await Promise.all([
        db.collection('sellers').doc(sellerId).collection('menu').where('availability', '==', true).get(),
        db.collection('sellers').doc(sellerId).collection('promotions').get()
    ]);
    const sellerPromotions = promotionSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const menuItems = menuSnapshot.docs.map((doc) => applySellerPromotion(
        applyCatalogDiscount({ id: doc.id, ...doc.data() }, state.adminCatalogPriceRule),
        sellerPromotions
    ));
    const internationalSnapshot = await db.collection('sellers').doc(sellerId).collection('internationalInventory').where('status', '==', 'active').get();
    internationalSnapshot.docs.forEach((doc) => {
        const item = doc.data() || {};
        if (Number(item.quantity || 0) > 0) menuItems.push({ id: doc.id, ...item, price: Number(item.resalePrice || 0), currency: normalizeCurrency(item.resaleCurrency), sellerDescription: item.resaleDescription || item.sourceDescription || '' });
    });
    document.getElementById('sellerDetailContent').innerHTML = `
    <div class="panel-card">
      <div class="panel-card-header">
        <div><h3>${seller.name}</h3><p class="muted">${seller.description || ''}</p></div>
        <button class="ghost-btn" data-section="sellers">Back</button>
        ${getWhatsAppUrl(seller.whatsappNumber || seller.phone, `Hello ${seller.name || 'seller'}, I would like to ask about your products before buying.`) ? `<a class="contact-icon-link" href="${getWhatsAppUrl(seller.whatsappNumber || seller.phone, `Hello ${seller.name || 'seller'}, I would like to ask about your products before buying.`)}" target="_blank" rel="noopener noreferrer" aria-label="WhatsApp seller" title="WhatsApp seller">${getWhatsAppIcon()}</a>` : ''}
                ${getSellerSocialLinks(seller)}
      </div>
      <div class="card-grid">
                ${menuItems.length ? menuItems.map((item, index) => {
                        const imageValue = item.imageFilename || item.image || '';
                        const fullImageUrl = getImageUrl(imageValue);
                        return `
          <div class="item-card">
                        <a href="${escapeHtml(fullImageUrl)}" target="_blank" rel="noopener noreferrer" title="Open full-size image"><img src="./images/placeholder.png" data-mobile-loader data-mobile-src="${escapeHtml(getProductThumbnailUrl(imageValue))}" data-full-src="${escapeHtml(fullImageUrl)}" loading="${index < 4 ? 'eager' : 'lazy'}" decoding="async" fetchpriority="${index < 2 ? 'high' : 'auto'}" alt="${escapeHtml(item.name)}" /></a>
            <div class="panel-card-header"><strong>${item.name}</strong>${renderProductPrice(item)}</div>
            ${renderExpandableDescription(item.sellerDescription || 'Freshly prepared and ready to order.')}
                                                <div class="modal-actions product-card-actions">
                              <button class="primary-btn buy-action" data-product-buy="${item.id}" type="button">Buy</button>
                            <button class="ghost-btn" data-favorite-item="${item.id}">♡</button>
                        </div>
                        <div class="modal-actions contact-actions">
                            ${getWhatsAppUrl(seller.whatsappNumber || seller.phone, `Hello ${seller.name || 'seller'}, I would like to ask about ${item.name} before buying.`) ? `<a class="contact-icon-link" href="${getWhatsAppUrl(seller.whatsappNumber || seller.phone, `Hello ${seller.name || 'seller'}, I would like to ask about ${item.name} before buying.`)}" target="_blank" rel="noopener noreferrer" aria-label="WhatsApp seller" title="WhatsApp seller">${getWhatsAppIcon()}</a>` : ''}
                            ${getProductVideoUrl(item) ? `<a class="contact-icon-link watch-video-button" href="${escapeHtml(getProductVideoUrl(item))}" target="_blank" rel="noopener noreferrer" aria-label="Watch video" title="Watch video">${getVideoIcon()}</a>` : ''}
                            ${getSellerSocialLinks(seller)}
            </div>
                    </div>`;
                }).join('') : '<div class="empty-state">No products available yet.</div>'}
      </div>
    </div>`;
    document.querySelectorAll('[data-product-buy]').forEach((button) => button.addEventListener('click', () => openProductDetails(button.dataset.productBuy)));
    document.querySelectorAll('[data-favorite-item]').forEach((button) => button.addEventListener('click', () => toggleFavoriteItem(button.dataset.favoriteItem)));
    showSection('sellerDetail');
}

function renderOrders() {
    const filtered = state.orders.filter((order) => {
        if (order.isDeleted || order.customerDeletedAt) return false;
        if (state.orderFilter === 'active') return ['pending', 'accepted', 'preparing', 'ready', 'picked_up', 'out_for_delivery', 'refund_requested'].includes(order.status);
        if (state.orderFilter === 'past') return ['delivered', 'completed', 'received'].includes(order.status);
        if (state.orderFilter === 'cancelled') return order.status === 'cancelled' || order.refundStatus === 'approved';
        return true;
    });
    document.getElementById('ordersList').innerHTML = filtered.length ? filtered.map((order, index) => {
        const isArchived = Boolean(order.archived);
        const canDelete = order.status === 'received';
        const actionsDisabled = isArchived || ['received', 'refunded'].includes(order.status);
        const isReceived = order.status === 'received';
        const hasRated = Number(order.customerRating || 0) > 0;
        const customizationRequested = isCustomizedOrder(order);
        const customizationFeeStatus = getCustomizationFeeStatus({ ...order, customizationRequested });
        const customizationContactUrl = customizationRequested
            ? getWhatsAppUrl(state.adminWhatsAppNumber, `Hello, I am contacting you about customized order #${order.orderNumber || order.id.slice(0, 6)}. I will send the design image and details here.`)
            : '';
                return `
        <div class="item-card order-session-card ${isArchived ? 'archived-order-card' : ''}">
    ${order.items?.length ? `<img src="./images/placeholder.png" data-mobile-loader data-mobile-src="${escapeHtml(getProductThumbnailUrl(order.items[0]?.imagePath || order.items[0]?.image || order.items[0]?.imageFilename || ''))}" data-full-src="${escapeHtml(getImageUrl(order.items[0]?.imagePath || order.items[0]?.image || order.items[0]?.imageFilename || ''))}" loading="${index < 2 ? 'eager' : 'lazy'}" fetchpriority="${index === 0 ? 'high' : 'auto'}" decoding="async" alt="${escapeHtml(order.items[0]?.name || 'Item')}" />` : ''}
      <div class="panel-card-header"><strong>#${order.orderNumber || order.id.slice(0, 6)}</strong><span class="badge">${order.status}</span></div>
      <div class="muted">${formatCurrency(order.total || 0)} • ${order.sellerName || 'Seller'}</div>
        <div class="muted">Placed: ${formatDate(order.placedAt || order.createdAt)} • Estimated delivery: ${order.estimatedDeliveryTime ? formatDate(order.estimatedDeliveryTime) : 'Pending'} • Refund: ${order.refundStatus || 'none'}</div>
      ${customizationRequested ? `
        <div class="customization-order-panel">
          <div class="panel-card-header"><strong>Customized order</strong><span class="badge">${escapeHtml(customizationFeeStatus.replace(/_/g, ' '))}</span></div>
          ${canChangeOrderCustomization(order) ? `<label><input type="checkbox" data-order-customization="${escapeHtml(order.id)}" checked /> Customize this order</label>` : '<div class="muted">Customization request is locked after payment confirmation.</div>'}
          ${order.customizationDetails ? `<div class="muted"><strong>Design details:</strong> ${escapeHtml(order.customizationDetails)}</div>` : ''}
          ${customizationContactUrl ? `<a class="secondary-btn" href="${escapeHtml(customizationContactUrl)}" target="_blank" rel="noopener noreferrer">Send design image/details on WhatsApp</a>` : '<div class="muted">Admin WhatsApp contact is not configured.</div>'}
          ${Number(order.customizationFee || 0) > 0 ? `
            <div><strong>Customization fee:</strong> ${formatCurrency(order.customizationFee, 'LRD')} <span class="muted">(${escapeHtml(customizationFeeStatus.replace(/_/g, ' '))})</span></div>
            ${customizationFeeStatus === 'unpaid' || customizationFeeStatus === 'rejected' ? `
              <div class="muted">Pay the fee using the payment method and receiver saved with this order, then submit the payment reference below. This fee is separate from the product and delivery total.</div>
              ${order.paymentMethod === 'balance'
                  ? order.customizationFeeWalletPaymentCompleted
                      ? '<div class="muted">Wallet payment was submitted. Wait for admin confirmation.</div>'
                      : Number(state.walletBalance || 0) >= Number(order.customizationFee || 0)
                      ? `<div class="muted">Pay from your LRD wallet balance (${formatCurrency(state.walletBalance || 0, 'LRD')}). Admin confirmation is still required.</div><button class="primary-btn" type="button" data-pay-customization-fee-wallet="${escapeHtml(order.id)}">Pay fee from wallet</button>`
                      : `<div class="muted">Your wallet balance is not enough to pay this fee. Contact the admin on WhatsApp for payment instructions.</div>`
                  : `<div class="muted">Method: ${escapeHtml(order.paymentMethod || 'Not set')} • Receiver: ${escapeHtml(order.paymentReceiverName || '')} ${escapeHtml(order.paymentReceiver || '')} • Amount: ${formatCurrency(convertCurrency(Number(order.customizationFee || 0), 'LRD', order.paymentCurrency || 'LRD'), order.paymentCurrency || 'LRD')}</div>
                    <form class="customization-fee-payment-form" data-customization-fee-form="${escapeHtml(order.id)}">
                      <label>Payment phone<input name="payerPhone" type="tel" value="${escapeHtml(order.paymentPhone || '')}" required /></label>
                      <label>Fee payment reference<input name="paymentReference" required maxlength="160" /></label>
                      <button class="primary-btn" type="submit">Submit fee payment</button>
                    </form>`}
            ` : customizationFeeStatus === 'submitted'
                ? `<div class="muted">Fee payment submitted for admin confirmation. Reference: ${escapeHtml(order.customizationFeePaymentReference || '')}</div>`
                : customizationFeeStatus === 'paid' ? '<div class="muted">Customization fee payment confirmed.</div>' : ''}
          ` : customizationFeeStatus === 'not_quoted'
              ? '<div class="muted">The admin is reviewing your design and will add the customization fee to this order.</div>'
              : customizationFeeStatus === 'waived' ? '<div class="muted">No customization fee is due.</div>' : ''}
          ${canChangeOrderCustomization(order) && customizationRequested ? `<label>Update design details<textarea data-order-customization-details="${escapeHtml(order.id)}" maxlength="1000">${escapeHtml(order.customizationDetails || '')}</textarea></label><button class="ghost-btn" type="button" data-save-customization-details="${escapeHtml(order.id)}">Save design details</button>` : ''}
        </div>
      ` : canChangeOrderCustomization(order) ? `<div class="customization-order-panel"><label><input type="checkbox" data-order-customization="${escapeHtml(order.id)}" /> Add customization to this order</label></div>` : ''}
      ${hasRated ? `<div class="muted">Your rating: ${'★'.repeat(Number(order.customerRating || 0))}${'☆'.repeat(5 - Number(order.customerRating || 0))}</div>` : ''}
        ${renderOrderCountdowns(order)}
    ${order.refundStatus === 'approved' && !order.refundConfirmedAt ? `<div class="refund-confirmation-note">Refund sent: ${formatCurrency(order.refundAmount || 0)} to ${escapeHtml(order.refundPaymentPhone || order.paymentPhone || 'your payment number')} via ${escapeHtml(order.refundPaymentMethod || order.paymentMethod || 'your payment method')}. Reference: ${escapeHtml(order.refundPaymentReference || 'Not provided')}<br />Check your phone or mobile-money account before confirming receipt.</div>` : ''}
      <div class="modal-actions">
                ${!isReceived ? `<button class="ghost-btn" data-track-order="${order.id}" ${actionsDisabled ? 'disabled' : ''}>Track</button><button class="ghost-btn" data-repeat-order="${order.id}" ${actionsDisabled ? 'disabled' : ''}>Repeat</button><button class="ghost-btn" data-request-refund="${order.id}" ${canRequestRefund(order) && !isArchived ? '' : 'disabled'}>${getRefundButtonLabel(order)}</button>` : ''}
                ${order.status === 'delivered' ? (hasRated ? '<button class="ghost-btn" disabled>Rated</button>' : '<button class="primary-btn" data-rate-order="${order.id}">Rate order</button>') : ''}
                ${order.status === 'delivered' ? `<button class="primary-btn" data-order-received="${order.id}">Order received</button>` : ''}
        ${order.refundStatus === 'approved' && !order.refundConfirmedAt && order.refundPaymentReference ? `<button class="primary-btn" data-confirm-refund="${order.id}">Confirm refund received</button>` : ''}
        ${canDelete ? `<button class="danger-btn" data-delete-order="${order.id}">Delete</button>` : ''}
      </div>
    </div>`;
    }).join('') : '<div class="empty-state">No orders yet.</div>';
    document.querySelectorAll('[data-track-order]').forEach((button) => button.addEventListener('click', () => trackOrder(button.dataset.trackOrder)));
    document.querySelectorAll('[data-repeat-order]').forEach((button) => button.addEventListener('click', () => repeatOrder(button.dataset.repeatOrder)));
    document.querySelectorAll('[data-request-refund]').forEach((button) => button.addEventListener('click', () => requestRefund(button.dataset.requestRefund)));
    document.querySelectorAll('[data-rate-order]').forEach((button) => button.addEventListener('click', () => openRateOrderModal(button.dataset.rateOrder)));
    document.querySelectorAll('[data-order-received]').forEach((button) => button.addEventListener('click', () => confirmOrderReceived(button.dataset.orderReceived)));
    document.querySelectorAll('[data-confirm-refund]').forEach((button) => button.addEventListener('click', () => confirmRefundReceipt(button.dataset.confirmRefund)));
    document.querySelectorAll('[data-delete-order]').forEach((button) => button.addEventListener('click', () => deleteOrderFromUI(button.dataset.deleteOrder)));
    document.querySelectorAll('[data-order-customization]').forEach((input) => input.addEventListener('change', () => updateOrderCustomization(input.dataset.orderCustomization, input.checked)));
    document.querySelectorAll('[data-save-customization-details]').forEach((button) => button.addEventListener('click', () => saveOrderCustomizationDetails(button.dataset.saveCustomizationDetails)));
    document.querySelectorAll('[data-customization-fee-form]').forEach((form) => form.addEventListener('submit', (event) => submitCustomizationFeePayment(event, form.dataset.customizationFeeForm)));
    document.querySelectorAll('[data-pay-customization-fee-wallet]').forEach((button) => button.addEventListener('click', () => payCustomizationFeeFromWallet(button.dataset.payCustomizationFeeWallet, button)));
    startOrderCountdownTimer();
}

async function updateOrderCustomization(orderId, customizationRequested) {
    const order = state.orders.find((entry) => entry.id === orderId);
    if (!order || !canChangeOrderCustomization(order)) {
        createToast('Customization can no longer be changed after payment is confirmed.', 'warning');
        renderOrders();
        return;
    }
    const updatedAt = new Date();
    const updates = customizationRequested
        ? {
            customizationRequested: true,
            customizationFee: 0,
            customizationFeeCurrency: 'LRD',
            customizationFeePaymentStatus: 'not_quoted',
            customizationFeePaymentReference: '',
            customizationFeePaymentPhone: '',
            customizationDetails: '',
            items: (order.items || []).map((item, index) => ({
                ...item,
                customizationRequested: index === 0,
                customizationDetails: ''
            })),
            updatedAt
        }
        : {
            customizationRequested: false,
            customizationDetails: '',
            customizationFee: 0,
            customizationFeePaymentStatus: 'not_applicable',
            customizationFeePaymentReference: '',
            customizationFeePaymentPhone: '',
            items: (order.items || []).map((item) => ({ ...item, customizationRequested: false, customizationDetails: '' })),
            updatedAt
        };
    try {
        await db.collection('orders').doc(orderId).update(updates);
        Object.assign(order, updates);
        renderOrders();
        createToast(customizationRequested ? 'Customization added to this order.' : 'Customization removed from this order.', 'success');
    } catch (error) {
        console.error('[Manna Marketplace] Order customization could not be updated:', error);
        createToast(error.message || 'Unable to update order customization.', 'error');
        renderOrders();
    }
}

async function saveOrderCustomizationDetails(orderId) {
    const order = state.orders.find((entry) => entry.id === orderId);
    const detailsInput = [...document.querySelectorAll('[data-order-customization-details]')]
        .find((input) => input.dataset.orderCustomizationDetails === orderId);
    if (!order || !detailsInput || !canChangeOrderCustomization(order)) return;
    const customizationDetails = detailsInput.value.trim();
    try {
        const items = (order.items || []).map((item, index) => index === 0
            ? { ...item, customizationRequested: true, customizationDetails }
            : item);
        await db.collection('orders').doc(orderId).update({ customizationDetails, items, updatedAt: new Date() });
        order.customizationDetails = customizationDetails;
        order.items = items;
        renderOrders();
        createToast('Customization details saved to this order.', 'success');
    } catch (error) {
        console.error('[Manna Marketplace] Order customization details could not be saved:', error);
        createToast(error.message || 'Unable to save customization details.', 'error');
    }
}

async function submitCustomizationFeePayment(event, orderId) {
    event.preventDefault();
    const order = state.orders.find((entry) => entry.id === orderId);
    const form = event.currentTarget;
    if (!order || Number(order.customizationFee || 0) <= 0 || !['unpaid', 'rejected'].includes(getCustomizationFeeStatus(order))) return;
    const formData = new FormData(form);
    const payerPhone = String(formData.get('payerPhone') || '').trim();
    const paymentReference = String(formData.get('paymentReference') || '').trim();
    if (!payerPhone || !paymentReference) {
        createToast('Enter the phone number and payment reference for the customization fee.', 'warning');
        return;
    }

    async function payCustomizationFeeFromWallet(orderId, button) {
        const order = state.orders.find((entry) => entry.id === orderId);
        if (!order || order.paymentMethod !== 'balance' || Number(state.walletBalance || 0) < Number(order.customizationFee || 0)) {
            createToast('Your wallet balance is not enough to pay this customization fee.', 'warning');
            return;
        }
        if (typeof window.processBalanceCustomizationFee !== 'function') {
            createToast('Wallet payment is unavailable. Please contact the admin.', 'error');
            return;
        }
        setButtonBusy(button, 'Paying…');
        try {
            await window.processBalanceCustomizationFee(state.authUser.uid, order.customizationFee, orderId);
            const snapshot = await db.collection('orders').doc(orderId).get();
            if (snapshot.exists) Object.assign(order, snapshot.data());
            state.walletBalance = Number(state.walletBalance || 0) - Number(order.customizationFee || 0);
            renderOrders();
            createToast('Customization fee paid from your wallet and sent for admin confirmation.', 'success');
        } catch (error) {
            console.error('[Manna Marketplace] Wallet customization fee payment failed:', error);
            clearButtonBusy(button);
            createToast(error.message || 'Unable to pay the customization fee from your wallet.', 'error');
        }
    }
    const button = form.querySelector('button[type="submit"]');
    setButtonBusy(button, 'Submitting…');
    const updates = {
        customizationFeePaymentStatus: 'submitted',
        customizationFeePaymentPhone: payerPhone,
        customizationFeePaymentReference: paymentReference,
        customizationFeePaymentMethod: order.paymentMethod || '',
        customizationFeePaymentCurrency: order.paymentCurrency || 'LRD',
        customizationFeePaymentSubmittedAt: new Date(),
        updatedAt: new Date()
    };
    try {
        await db.collection('orders').doc(orderId).update(updates);
        Object.assign(order, updates);
        renderOrders();
        createToast('Customization fee payment submitted for admin confirmation.', 'success');
    } catch (error) {
        console.error('[Manna Marketplace] Customization fee payment could not be submitted:', error);
        clearButtonBusy(button);
        createToast(error.message || 'Unable to submit customization fee payment.', 'error');
    }
}

function toOrderDate(value) {
    if (!value) return null;
    const date = value.toDate ? value.toDate() : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function formatCountdown(milliseconds) {
    const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return days > 0
        ? `${days}d ${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m`
        : `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function getCountdownState(order, now = Date.now()) {
    const placedAt = toOrderDate(order.placedAt || order.createdAt);
    const readyAt = toOrderDate(order.estimatedReadyAt);
    const deliveryAt = toOrderDate(order.estimatedDeliveryTime);
    return {
        preparation: readyAt ? Math.max(0, readyAt.getTime() - now) : null,
        delivery: deliveryAt ? Math.max(0, deliveryAt.getTime() - now) : null,
        preparationTotal: placedAt && readyAt ? Math.max(1, readyAt.getTime() - placedAt.getTime()) : null,
        deliveryTotal: placedAt && deliveryAt ? Math.max(1, deliveryAt.getTime() - placedAt.getTime()) : null
    };
}

function renderOrderCountdowns(order) {
    const countdown = getCountdownState(order);
    if (countdown.preparation === null && countdown.delivery === null) return '';
    const preparationDone = countdown.preparation === null || countdown.preparation === 0;
    const deliveryDone = countdown.delivery === null || countdown.delivery === 0;
    return `<div class="order-countdown-grid">
      <div class="order-countdown-card ${preparationDone ? 'is-complete' : ''}">
        <div class="countdown-label">${preparationDone ? 'Preparation complete' : 'Preparing your order'}</div>
        <strong data-countdown="preparation" data-order-id="${order.id}">${countdown.preparation === null ? '—' : preparationDone ? 'Ready' : formatCountdown(countdown.preparation)}</strong>
        <div class="countdown-track"><span data-countdown-progress="preparation" data-order-id="${order.id}" style="width: ${preparationDone ? 100 : Math.min(100, Math.max(0, (1 - countdown.preparation / countdown.preparationTotal) * 100))}%"></span></div>
      </div>
      <div class="order-countdown-card ${deliveryDone ? 'is-complete' : ''}">
        <div class="countdown-label">${deliveryDone ? 'Delivery window reached' : 'Estimated delivery'}</div>
        <strong data-countdown="delivery" data-order-id="${order.id}">${countdown.delivery === null ? '—' : deliveryDone ? 'Due now' : formatCountdown(countdown.delivery)}</strong>
        <div class="countdown-track"><span data-countdown-progress="delivery" data-order-id="${order.id}" style="width: ${deliveryDone ? 100 : Math.min(100, Math.max(0, (1 - countdown.delivery / countdown.deliveryTotal) * 100))}%"></span></div>
      </div>
    </div>`;
}

function updateOrderCountdowns() {
    const now = Date.now();
    let hasActiveCountdown = false;
    state.orders.forEach((order) => {
        const countdown = getCountdownState(order, now);
        if ((countdown.preparation !== null && countdown.preparation > 0) || (countdown.delivery !== null && countdown.delivery > 0)) {
            hasActiveCountdown = true;
        }
        ['preparation', 'delivery'].forEach((type) => {
            const value = countdown[type];
            const element = document.querySelector(`[data-countdown="${type}"][data-order-id="${order.id}"]`);
            if (element && value !== null) element.textContent = value > 0 ? formatCountdown(value) : type === 'preparation' ? 'Ready' : 'Due now';
            const progress = document.querySelector(`[data-countdown-progress="${type}"][data-order-id="${order.id}"]`);
            const total = countdown[`${type}Total`];
            if (progress && value !== null && total) progress.style.width = `${Math.min(100, Math.max(0, (1 - value / total) * 100))}%`;
        });
    });
    if (!hasActiveCountdown && state.orderCountdownTimer) {
        clearInterval(state.orderCountdownTimer);
        state.orderCountdownTimer = null;
    }
}

function startOrderCountdownTimer() {
    if (!state.orderCountdownTimer) state.orderCountdownTimer = window.setInterval(updateOrderCountdowns, 1000);
    updateOrderCountdowns();
}

function openRateOrderModal(orderId) {
    const order = state.orders.find((entry) => entry.id === orderId);
    if (!order) return;
    const firstItem = order.items?.[0] || {};
    const productName = firstItem.name || 'this product';
    const sellerName = order.sellerName || 'this seller';
    openModal(`Rate ${escapeHtml(productName)}`, `
      <form id="rateOrderForm" class="stack">
        <p class="muted">How would you rate ${escapeHtml(productName)} from ${escapeHtml(sellerName)}?</p>
        <label>Rating
          <select name="rating">
            <option value="5">5 - Excellent</option>
            <option value="4">4 - Good</option>
            <option value="3">3 - Average</option>
            <option value="2">2 - Fair</option>
            <option value="1">1 - Poor</option>
          </select>
        </label>
        <label>Review (optional)
          <textarea name="reviewText" rows="4" placeholder="Tell us about the product quality, delivery, and experience."></textarea>
        </label>
      </form>
    `);
    modalActions.innerHTML = '<button class="ghost-btn" id="cancelRateOrder" type="button">Cancel</button><button class="primary-btn" id="submitRateOrderButton" type="button">Submit rating</button>';
    document.getElementById('cancelRateOrder')?.addEventListener('click', closeModal);
    document.getElementById('submitRateOrderButton')?.addEventListener('click', () => submitOrderRating(orderId));
}

async function refreshReviewAggregatesForOrder(order) {
    if (!order) return;
    const sellerReviews = await db.collection('reviews').where('sellerId', '==', order.sellerId || '').get();
    const sellerValues = sellerReviews.docs.map((doc) => Number(doc.data()?.rating || 0)).filter((value) => value > 0);
    const sellerAverage = sellerValues.length ? sellerValues.reduce((sum, value) => sum + value, 0) / sellerValues.length : 0;
    if (order.sellerId) {
        await db.collection('sellers').doc(order.sellerId).set({
            rating: Number(sellerAverage.toFixed(1)),
            reviewCount: sellerValues.length,
            updatedAt: new Date()
        }, { merge: true });
    }

    for (const item of order.items || []) {
        const menuItemId = String(item.menuItemId || item.productId || '').trim();
        if (!menuItemId || !order.sellerId) continue;

        const menuItemRef = db.collection('sellers').doc(order.sellerId).collection('menu').doc(menuItemId);
        const menuItemSnapshot = await menuItemRef.get();
        const menuItem = menuItemSnapshot.exists ? menuItemSnapshot.data() || {} : {};
        const { masterProductId } = getReviewProductReferences(item, menuItem);
        const reviewQueries = [
            db.collection('reviews').where('menuItemId', '==', menuItemId).get(),
            db.collection('reviews').where('productId', '==', menuItemId).get()
        ];
        if (masterProductId) {
            reviewQueries.push(
                db.collection('reviews').where('masterProductId', '==', masterProductId).get(),
                db.collection('reviews').where('productId', '==', masterProductId).get()
            );
        }
        const reviewSnapshots = await Promise.all(reviewQueries);
        const allReviews = new Map();
        reviewSnapshots.forEach((snapshot) => snapshot.docs.forEach((doc) => allReviews.set(doc.id, doc.data() || {})));
        const menuReviews = [...allReviews.values()].filter((review) => String(review.menuItemId || review.productId || '') === menuItemId);
        const menuValues = menuReviews.map((review) => Number(review.rating || 0)).filter((value) => value > 0);
        const menuAverage = menuValues.length ? menuValues.reduce((sum, value) => sum + value, 0) / menuValues.length : 0;

        if (menuItemSnapshot.exists) {
            await menuItemRef.update({ rating: Number(menuAverage.toFixed(1)), reviewCount: menuValues.length, updatedAt: new Date() }).catch(() => {});
        }

        if (masterProductId) {
            const masterProductRef = db.collection('masterProducts').doc(masterProductId);
            const masterProductSnapshot = await masterProductRef.get();
            if (masterProductSnapshot.exists) {
                const masterReviews = [...allReviews.values()].filter((review) => String(review.masterProductId || '') === masterProductId
                    || String(review.productId || '') === masterProductId
                    || String(review.menuItemId || review.productId || '') === menuItemId);
                const masterValues = masterReviews.map((review) => Number(review.rating || 0)).filter((value) => value > 0);
                const masterAverage = masterValues.length ? masterValues.reduce((sum, value) => sum + value, 0) / masterValues.length : 0;
                await masterProductRef.update({ rating: Number(masterAverage.toFixed(1)), reviewCount: masterValues.length, updatedAt: new Date() }).catch(() => {});
            }
        }
    }
}

async function submitOrderRating(orderId) {
    const order = state.orders.find((entry) => entry.id === orderId);
    if (!order) return;
    const form = document.getElementById('rateOrderForm');
    if (!form) return;
    const rating = Number(form.querySelector('[name="rating"]')?.value || 0);
    const reviewText = String(form.querySelector('[name="reviewText"]')?.value || '').trim();
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
        createToast('Choose a rating from 1 to 5 stars.', 'warning');
        return;
    }
    const firstItem = order.items?.[0] || {};
    try {
        const firstItemReferences = getReviewProductReferences(firstItem);
        const menuItemId = firstItemReferences.menuItemId;
        let masterProductId = firstItemReferences.masterProductId;
        const canResolveMasterProduct = firstItem.isSellerOwned !== true && firstItem.orderFlow !== 'seller_owned' && !firstItem.internationalProductId;
        if (!masterProductId && menuItemId && order.sellerId && canResolveMasterProduct) {
            const menuItemSnapshot = await db.collection('sellers').doc(order.sellerId).collection('menu').doc(menuItemId).get();
            const menuItem = menuItemSnapshot.exists ? menuItemSnapshot.data() || {} : {};
            masterProductId = getReviewProductReferences(firstItem, menuItem).masterProductId;
        }
        const reviewPayload = {
            orderId,
            sellerId: order.sellerId || '',
            sellerName: order.sellerName || '',
            customerUid: state.authUser?.uid || '',
            customerName: state.customerProfile?.displayName || state.authUser?.email || 'Customer',
            customerEmail: state.customerProfile?.email || state.authUser?.email || '',
            productId: menuItemId || masterProductId || firstItem.internationalProductId || '',
            menuItemId,
            masterProductId,
            productName: firstItem.name || 'Product',
            rating,
            reviewText,
            source: 'customer_order',
            createdAt: new Date(),
            updatedAt: new Date()
        };
        await db.collection('reviews').add(reviewPayload);
        await db.collection('orders').doc(orderId).update({
            customerRating: rating,
            customerReviewText: reviewText,
            customerRatedAt: new Date(),
            updatedAt: new Date()
        });
        await refreshReviewAggregatesForOrder(order);
        closeModal();
        await loadOrders(state.authUser.uid);
        renderOrders();
        createToast('Thanks for your feedback.', 'success');
    } catch (error) {
        createToast(error.message || 'Unable to submit your rating.', 'error');
    }
}

async function confirmOrderReceived(orderId) {
    const order = state.orders.find((entry) => entry.id === orderId);
    if (!order || order.status !== 'delivered' || order.refundStatus && order.refundStatus !== 'none') return;
    const confirmed = window.confirm('Confirm that you received this order? After confirmation, active order actions and refunds will no longer be available.');
    if (!confirmed) return;
    try {
        await db.collection('orders').doc(orderId).update({ status: 'received', customerReceivedAt: new Date(), sellerPayoutStatus: 'pending', deliveryPayoutStatus: 'pending', updatedAt: new Date() });
        if (order.sellerId) {
            const seller = state.sellers.find((entry) => entry.id === order.sellerId);
            if (seller?.ownerUid) {
                await createRoleNotification(db, seller.ownerUid, 'seller', {
                    title: 'Order received by customer',
                    message: `The customer confirmed receipt of order #${order.orderNumber || order.id.slice(0, 6)}.`,
                    type: 'order'
                });
            }
        }
        await loadOrders(state.authUser.uid);
        renderOrders();
        createToast('Order receipt confirmed.', 'success');
    } catch (error) {
        createToast(error.message || 'Unable to confirm order receipt.', 'error');
    }
}

function canRequestRefund(order) {
    return !['out_for_delivery', 'delivered', 'received', 'cancelled', 'refund_approved', 'refund_rejected'].includes(order.status) && !['requested', 'approved', 'rejected'].includes(order.refundStatus || 'none');
}

function getRefundButtonLabel(order) {
    if (order.refundStatus === 'requested') return 'Refund pending';
    if (order.refundStatus === 'approved') return 'Refund approved';
    if (order.refundStatus === 'rejected') return 'Refund rejected';
    if (order.refundStatus === 'confirmed') return 'Refund confirmed';
    return 'Request refund';
}

async function requestRefund(orderId) {
    const order = state.orders.find((entry) => entry.id === orderId);
    if (!order || !canRequestRefund(order)) return;
    const reason = window.prompt('Tell us why you want a refund (optional)', 'Order issue');
    try {
        await db.collection('orders').doc(orderId).update({
            refundRequested: true,
            refundStatus: 'requested',
            refundReason: (reason || '').trim(),
            refundAmount: Number(order.refundAmount || order.total || 0),
            refundRequestedAt: new Date(),
            refundProcessedAt: null,
            refundPaymentMethod: null,
            refundPaymentPhone: null,
            refundPaymentReference: null,
            refundConfirmedAt: null,
            status: 'refund_requested',
            updatedAt: new Date()
        });
        const seller = order.sellerId ? await db.collection('sellers').doc(order.sellerId).get() : null;
        const sellerOwnerUid = seller?.data()?.ownerUid;
        await createRoleNotification(db, sellerOwnerUid, 'seller', {
            title: 'Customer requested a refund',
            message: `A refund request for order #${order.orderNumber || order.id.slice(0, 6)} is pending review.`,
            type: 'refund'
        });
        await loadOrders(state.authUser.uid);
        renderOrders();
        createToast('Refund request sent to the seller.', 'success');
    } catch (error) {
        createToast(error.message, 'error');
    }
}

async function confirmRefundReceipt(orderId) {
    const order = state.orders.find((entry) => entry.id === orderId);
    if (!order || order.refundStatus !== 'approved' || !order.refundPaymentReference) return;
    const confirmed = window.confirm(`Have you received ${formatCurrency(order.refundAmount || 0)} via ${order.refundPaymentMethod || order.paymentMethod || 'mobile payment'}?`);
    if (!confirmed) return;
    try {
        await db.collection('orders').doc(orderId).update({
            refundStatus: 'confirmed',
            refundConfirmedAt: new Date(),
            status: 'refunded',
            updatedAt: new Date()
        });
        await loadOrders(state.authUser.uid);
        renderOrders();
        createToast('Refund receipt confirmed.', 'success');
    } catch (error) {
        createToast(error.message || 'Unable to confirm the refund receipt.', 'error');
    }
}

async function deleteOrderFromUI(orderId) {
    const order = state.orders.find((entry) => entry.id === orderId);
    if (!order || order.status !== 'received') return;
    const confirmed = window.confirm('Are you sure you want to permanently delete this order? This action cannot be undone.');
    if (!confirmed) return;
    try {
        await db.collection('orders').doc(orderId).set({ customerDeletedAt: new Date(), updatedAt: new Date() }, { merge: true });
        state.orders = state.orders.filter((entry) => entry.id !== orderId);
        renderOrders();
        createToast('Order deleted.', 'success');
    } catch (error) {
        createToast(error.message || 'Unable to delete the order.', 'error');
    }
}

function renderNotifications() {
    const visible = state.notifications.filter((item) => !item.isDeleted && (
        item.type !== 'signup_reward'
        || (isCurrentCustomerAccount() && state.signupRewardClaim && ['eligible', 'selected', 'ordered', 'confirmed', 'delivered', 'received'].includes(state.signupRewardClaim.status))
    ));
    const unreadCount = visible.filter((item) => !item.read).length;
    const badgeText = unreadCount ? `${unreadCount} unread` : 'All caught up';
    if (customerNotificationBadge) {
        customerNotificationBadge.textContent = badgeText;
    }
    if (customerNotificationBadgeCount) {
        customerNotificationBadgeCount.textContent = unreadCount || '0';
        customerNotificationBadgeCount.classList.toggle('hidden', unreadCount === 0);
    }
    const list = document.getElementById('notificationsList');
    if (!list) return;
    list.innerHTML = `
            <div class="action-row notification-actions" style="margin-bottom: 12px;">
        <button class="ghost-btn" data-clear-all-notifications="true" ${visible.length ? '' : 'disabled'}>Clear all</button>
                ${renderSoundToggle()}
      </div>
      ${visible.length ? visible.map((item) => `
        <div class="item-card notification-card ${item.read ? '' : 'unread'}">
          <div class="panel-card-header">
            <strong>${item.title || 'Update'}</strong>
            <span class="badge">${item.type || 'system'}</span>
          </div>
          <div class="muted">${item.message || 'You have a new update from Manna Marketplace.'}</div>
          <div class="muted">${formatDate(item.createdAt)}</div>
          <div class="modal-actions">
            <button class="ghost-btn" data-mark-notification="${item.id}">${item.read ? 'Read' : 'Mark as Read'}</button>
            ${item.type === 'signup_reward' ? `<button class="primary-btn" data-open-reward-notification="${item.id}">Open reward</button>` : ''}
            <button class="danger-btn" data-delete-notification="${item.id}">Delete</button>
          </div>
        </div>`).join('') : '<div class="empty-state">No notifications yet.</div>'}`;
    list.querySelectorAll('[data-clear-all-notifications]').forEach((button) => {
        button.addEventListener('click', clearAllNotifications);
    });
    list.querySelectorAll('[data-mark-notification]').forEach((button) => {
        button.addEventListener('click', () => markNotificationAsRead(button.dataset.markNotification));
    });
    list.querySelectorAll('[data-open-reward-notification]').forEach((button) => {
        button.addEventListener('click', () => {
            markNotificationAsRead(button.dataset.openRewardNotification);
            if (state.signupRewardClaim?.status === 'eligible') {
                openSignupRewardModal();
            } else {
                maybeShowSignupReward();
            }
        });
    });
    list.querySelectorAll('[data-delete-notification]').forEach((button) => {
        button.addEventListener('click', () => deleteNotification(button.dataset.deleteNotification));
    });
    bindSoundToggle(list);
}

async function markNotificationAsRead(notificationId) {
    try {
        await db.collection('notifications').doc(notificationId).set({ read: true, updatedAt: new Date() }, { merge: true });
        state.notifications = state.notifications.map((item) => (item.id === notificationId ? { ...item, read: true } : item));
        renderNotifications();
        createToast('Notification marked as read.', 'success');
    } catch (error) {
        createToast(error.message || 'Unable to update the notification.', 'error');
    }
}

async function deleteNotification(notificationId) {
    try {
        await db.collection('notifications').doc(notificationId).set({ read: true, isDeleted: true, updatedAt: new Date() }, { merge: true });
        state.notifications = state.notifications.map((item) => (item.id === notificationId ? { ...item, read: true, isDeleted: true } : item));
        renderNotifications();
        createToast('Notification deleted.', 'success');
    } catch (error) {
        createToast(error.message || 'Unable to delete the notification.', 'error');
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
        createToast(error.message || 'Unable to clear the notifications.', 'error');
    }
}

function renderFavorites() {
    document.getElementById('favoritesList').innerHTML = state.favorites.length ? state.favorites.map((favorite, index) => {
        if (favorite.type === 'menuItem' && favorite.menuItem) {
            const item = state.menuItems.find((menuItem) => menuItem.id === favorite.menuItemId && menuItem.sellerId === (favorite.sellerId || favorite.menuItem.sellerId)) || favorite.menuItem;
            const seller = state.sellers.find((entry) => entry.id === item.sellerId || entry.id === favorite.sellerId);
            const isFavorite = true;
            return `
                        <div class="item-card">
                            <a href="${escapeHtml(getImageUrl(item.imageFilename || item.image || ''))}" target="_blank" rel="noopener noreferrer" title="Open full-size image"><img src="./images/placeholder.png" data-mobile-loader data-mobile-src="${escapeHtml(getProductThumbnailUrl(item.imageFilename || item.image || ''))}" data-full-src="${escapeHtml(getImageUrl(item.imageFilename || item.image || ''))}" loading="${index < 4 ? 'eager' : 'lazy'}" fetchpriority="${index < 2 ? 'high' : 'auto'}" decoding="async" alt="${escapeHtml(item.name)}" /></a>
              <div class="panel-card-header"><strong>${item.name}</strong>${renderProductPrice(item)}</div>
              ${renderExpandableDescription(item.sellerDescription || item.description || 'Freshly prepared and ready to order.')}
              <div class="muted">${seller?.name || 'Seller'}</div>
                            <div class="modal-actions product-card-actions">
                <button class="primary-btn buy-action" data-product-buy="${item.id}" type="button">Buy</button>
                <button class="${getFavoriteButtonClass(isFavorite)}" data-favorite-item="${item.id}" aria-pressed="true">${getFavoriteIcon(isFavorite)}</button>
              </div>
                            <div class="modal-actions contact-actions">
                                ${getWhatsAppUrl(seller?.whatsappNumber || seller?.phone, `Hello ${seller?.name || 'seller'}, I would like to ask about ${item.name} before buying.`) ? `<a class="contact-icon-link" href="${getWhatsAppUrl(seller.whatsappNumber || seller.phone, `Hello ${seller.name || 'seller'}, I would like to ask about ${item.name} before buying.`)}" target="_blank" rel="noopener noreferrer" aria-label="WhatsApp seller" title="WhatsApp seller">${getWhatsAppIcon()}</a>` : ''}
                                ${getProductVideoUrl(item) ? `<a class="contact-icon-link watch-video-button" href="${escapeHtml(getProductVideoUrl(item))}" target="_blank" rel="noopener noreferrer" aria-label="Watch video" title="Watch video">${getVideoIcon()}</a>` : ''}
                                ${getSellerSocialLinks(seller)}
                            </div>
            </div>`;
        }
        if (favorite.type === 'seller' && favorite.seller) {
            const seller = favorite.seller;
            return `
            <div class="item-card">
              <img src="${getSellerImageUrl(seller)}" alt="${seller.name}" onerror="this.src='./images/placeholder.png'" />
              <div class="panel-card-header"><strong>${seller.name}</strong><span class="badge">${getCategoryDisplayName(seller.category || 'General')}</span></div>
              ${renderExpandableDescription(seller.description || 'A trusted place to shop from.')}
              <div class="modal-actions">
                <button class="primary-btn" data-open-seller="${seller.id}">View Menu</button>
                <button class="${getFavoriteButtonClass(true)}" data-favorite-seller="${seller.id}" aria-pressed="true">${getFavoriteIcon(true)}</button>
              </div>
            </div>`;
        }
        return `
        <div class="item-card">
          <strong>${favorite.name || 'Favorite'}</strong>
          <div class="muted">${favorite.type || 'favorite'}</div>
        </div>`;
    }).join('') : '<div class="empty-state">No saved favorites yet.</div>';
    document.querySelectorAll('[data-product-buy]').forEach((button) => button.addEventListener('click', () => openProductDetails(button.dataset.productBuy)));
    document.querySelectorAll('[data-favorite-item]').forEach((button) => button.addEventListener('click', () => toggleFavoriteItem(button.dataset.favoriteItem)));
    document.querySelectorAll('[data-open-seller]').forEach((button) => button.addEventListener('click', () => openSeller(button.dataset.openSeller)));
    document.querySelectorAll('[data-favorite-seller]').forEach((button) => button.addEventListener('click', () => toggleFavoriteSeller(button.dataset.favoriteSeller)));
}

// Keep the checkout flow tied to the single active delivery address saved for the customer.
function getActiveAddress() {
    return state.addresses.find((entry) => entry.isActive === true) || state.addresses[0] || null;
}

function getAddressSummary(address) {
    if (!address) return '';
    return [address.label || 'Address', address.street || '', address.city || '', address.deliveryDetails || address.details || ''].filter(Boolean).join(' • ');
}

async function setActiveAddress(addressId) {
    if (!state.authUser?.uid || !addressId) return;
    try {
        const batch = db.batch();
        state.addresses.forEach((address) => {
            const ref = db.collection('users').doc(state.authUser.uid).collection('addresses').doc(address.id);
            batch.update(ref, { isActive: address.id === addressId, updatedAt: new Date() });
        });
        await batch.commit();
        createToast('Active delivery address updated.', 'success');
    } catch (error) {
        createToast(error.message || 'Unable to update your address.', 'error');
    }
}

// Present a lightweight location form so new addresses can be stored and activated immediately.
function openAddAddressModal() {
    openModal('Add New Location', `
      <form id="addAddressForm" class="stack">
        <label>Label<input name="label" value="Home" required /></label>
        <label>Street<input name="street" required /></label>
        <label>City<input name="city" required /></label>
        <label>Delivery details<textarea name="deliveryDetails"></textarea></label>
        <label>Latitude (optional)<input name="latitude" type="number" step="any" /></label>
        <label>Longitude (optional)<input name="longitude" type="number" step="any" /></label>
      </form>
    `);
    const actions = document.getElementById('modalActions');
    actions.innerHTML = '<button class="ghost-btn" id="cancelAddressModal">Cancel</button><button class="primary-btn" id="saveAddressModal">Save address</button>';
    document.getElementById('cancelAddressModal')?.addEventListener('click', closeModal);
    document.getElementById('saveAddressModal')?.addEventListener('click', async () => {
        const form = document.getElementById('addAddressForm');
        const formData = new FormData(form);
        const label = String(formData.get('label') || '').trim();
        const street = String(formData.get('street') || '').trim();
        const city = String(formData.get('city') || '').trim();
        const deliveryDetails = String(formData.get('deliveryDetails') || '').trim();
        const latitude = formData.get('latitude') ? Number(formData.get('latitude')) : null;
        const longitude = formData.get('longitude') ? Number(formData.get('longitude')) : null;
        if (!label || !street || !city) {
            createToast('Please provide a label, street, and city.', 'warning');
            return;
        }
        try {
            const batch = db.batch();
            const newDocRef = db.collection('users').doc(state.authUser.uid).collection('addresses').doc();
            batch.set(newDocRef, {
                ownerId: state.authUser.uid,
                label,
                street,
                city,
                deliveryDetails,
                coordinates: Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null,
                isActive: true,
                createdAt: new Date(),
                updatedAt: new Date()
            });
            state.addresses.forEach((address) => {
                if (address.id) {
                    const ref = db.collection('users').doc(state.authUser.uid).collection('addresses').doc(address.id);
                    batch.update(ref, { isActive: false, updatedAt: new Date() });
                }
            });
            await batch.commit();
            closeModal();
            createToast('New delivery address saved and activated.', 'success');
        } catch (error) {
            createToast(error.message || 'Unable to save the new address.', 'error');
        }
    });
}

function renderProfileForm() {
    const form = document.getElementById('profileForm');
    const profile = state.customerProfile || {};
    const displayName = profile.displayName || state.authUser?.email || 'Customer';
    form.innerHTML = `
    <div style="display: flex; gap: 20px; margin-bottom: 20px; align-items: flex-start;">
      <div style="flex-shrink: 0;">
        ${getAvatarHtml(displayName, '80px')}
      </div>
      <div style="flex: 1;">
        <p class="muted" style="margin: 0 0 8px 0;">Your profile avatar</p>
        <p style="font-size: 12px; color: var(--muted); margin: 0;">Shown as ${displayName}'s initials until an image is added</p>
      </div>
    </div>
    <label>Full Name<input name="displayName" value="${profile.displayName || ''}" /></label>
    <label>Phone<input name="phone" value="${profile.phone || ''}" /></label>
    <label>WhatsApp Number<input name="whatsappNumber" type="tel" value="${profile.whatsappNumber || profile.phone || ''}" placeholder="e.g. +231770000000" /></label>
    <label>Email<input name="email" value="${profile.email || ''}" /></label>
        <label>Gender (optional)<select name="genderPreference">
            <option value="" ${!profile.genderPreference ? 'selected' : ''}>No preference</option>
            <option value="woman" ${profile.genderPreference === 'woman' ? 'selected' : ''}>Woman</option>
            <option value="man" ${profile.genderPreference === 'man' ? 'selected' : ''}>Man</option>
            <option value="non_binary" ${profile.genderPreference === 'non_binary' ? 'selected' : ''}>Non-binary</option>
            <option value="prefer_not_to_say" ${profile.genderPreference === 'prefer_not_to_say' ? 'selected' : ''}>Prefer not to say</option>
        </select></label>
        <p class="muted full">Used only to show matching clothing categories earlier. Other products remain available, and you can change or clear this preference anytime.</p>
    <label>Address<input name="address" value="${profile.address || ''}" /></label>
    ${getQRCardHTML('customerQrContainer', 'customerQrCard')}
  `;
    initQRCode('customerQrContainer');
    bindQRDownloadHandlers();
    renderLocationPicker();
    document.getElementById('addressList').innerHTML = `
      <div class="action-row" style="margin-bottom: 8px;">
        <button class="primary-btn" id="addAddressButton" type="button">Add New Location</button>
      </div>
      ${state.addresses.length ? state.addresses.map((address) => `
        <div class="item-card ${address.isActive ? 'checkout-address-card active' : ''}">
          <div class="panel-card-header">
            <strong>${escapeHtml(address.label || 'Address')}</strong>
            <span class="badge">${address.isActive ? 'Active' : 'Saved'}</span>
          </div>
          <div class="muted">${escapeHtml(getAddressSummary(address))}</div>
          <div class="modal-actions">
            <button class="ghost-btn" type="button" data-set-active-address="${address.id}" ${address.isActive ? 'disabled' : ''}>${address.isActive ? 'Active' : 'Set as active'}</button>
          </div>
        </div>`).join('') : '<div class="empty-state">No saved addresses yet.</div>'}
    `;
    document.getElementById('addAddressButton')?.addEventListener('click', openAddAddressModal);
    document.querySelectorAll('[data-set-active-address]').forEach((button) => {
        button.addEventListener('click', () => setActiveAddress(button.dataset.setActiveAddress));
    });
}

function renderLocationPicker() {
    const card = document.getElementById('locationPickerCard');
    if (!card) return;
    card.innerHTML = `
    <div class="item-card">
      <div class="panel-card-header">
        <div><strong>Pick a delivery spot</strong><div class="muted">Use your current position or drag the pin.</div></div>
      </div>
      <div class="map-toolbar">
        <button class="primary-btn" id="useMyLocationButton" type="button">Auto location</button>
        <button class="ghost-btn" id="stopTrackingButton" type="button">Stop tracking</button>
      </div>
      <div id="locationMap" class="location-map"></div>
      <div id="locationStatus" class="map-status">Tap Auto location to follow your device in real time.</div>
      <div class="form-grid" style="margin-top: 12px;">
        <label>Label<input id="locationLabel" value="Home" /></label>
        <label>Landmark / nearby reference<input id="locationLandmark" /></label>
        <label>Neighborhood / area<input id="locationNeighborhood" /></label>
        <label>Delivery instructions<textarea id="locationDetails"></textarea></label>
        <button class="primary-btn" id="saveLocationButton" type="button">Save location</button>
      </div>
      <div class="location-chip-row" style="margin-top: 12px;">
        ${state.locations.length ? state.locations.map((location) => `<button class="location-chip" type="button" data-select-location="${location.id}">${escapeHtml(location.label || 'Location')}</button>`).join('') : '<div class="empty-state">No saved locations yet.</div>'}
      </div>
    </div>`;
    document.getElementById('saveLocationButton')?.addEventListener('click', saveCustomerLocation);
    document.getElementById('useMyLocationButton')?.addEventListener('click', handleAutoLocate);
    document.getElementById('stopTrackingButton')?.addEventListener('click', stopLiveLocationTracking);
    document.querySelectorAll('[data-select-location]').forEach((button) => button.addEventListener('click', () => selectSavedLocation(button.dataset.selectLocation)));
    const mapButtons = ['useMyLocationButton', 'stopTrackingButton']
        .map((id) => document.getElementById(id))
        .filter(Boolean);
    mapButtons.forEach((button) => { button.disabled = true; });
    const status = document.getElementById('locationStatus');
    if (status) status.textContent = 'Loading map controls...';
    loadLocationMapLibraries()
        .then(() => {
            initLocationPickerMap('locationMap', 'locationStatus');
            mapButtons.forEach((button) => { button.disabled = false; });
        })
        .catch((error) => {
            console.error('[Manna Marketplace] Location map failed to load:', error);
            updateLocationStatus('Map unavailable right now. You can still enter your delivery details.', 'locationStatus');
        });
}

function loadLocationMapLibraries() {
    if (window.L) return Promise.resolve(window.L);
    if (locationMapLibrariesPromise) return locationMapLibrariesPromise;

    locationMapLibrariesPromise = new Promise((resolve, reject) => {
        const stylesheet = document.createElement('link');
        stylesheet.rel = 'stylesheet';
        stylesheet.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        stylesheet.crossOrigin = 'anonymous';

        const script = document.createElement('script');
        script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        script.crossOrigin = 'anonymous';

        let stylesheetLoaded = false;
        let scriptLoaded = false;
        const resolveWhenReady = () => {
            if (!stylesheetLoaded || !scriptLoaded) return;
            if (window.L) resolve(window.L);
            else reject(new Error('Map controls did not initialize.'));
        };

        stylesheet.onload = () => {
            stylesheetLoaded = true;
            resolveWhenReady();
        };
        stylesheet.onerror = () => reject(new Error('Map styles failed to load.'));
        script.onload = () => {
            scriptLoaded = true;
            resolveWhenReady();
        };
        script.onerror = () => reject(new Error('Map controls failed to load.'));

        document.head.append(stylesheet, script);
    }).catch((error) => {
        locationMapLibrariesPromise = null;
        throw error;
    });

    return locationMapLibrariesPromise;
}

function initLocationPickerMap(containerId = 'locationMap', statusElementId = 'locationStatus') {
    const mapContainer = document.getElementById(containerId);
    if (!mapContainer || typeof window.L === 'undefined') return;

    if (locationMap) {
        locationMap.remove();
        locationMap = null;
        locationMarker = null;
        locationAccuracyCircle = null;
    }

    const fallbackLat = defaultLocation.lat;
    const fallbackLng = defaultLocation.lng;

    const streetLayer = window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
    });
    const satelliteLayer = window.L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics'
    });
    const terrainLayer = window.L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        maxZoom: 17,
        attribution: 'Map data: &copy; OpenTopoMap contributors'
    });

    locationMap = window.L.map(containerId, {
        zoomControl: false,
        worldCopyJump: true,
        layers: [satelliteLayer]
    }).setView([fallbackLat, fallbackLng], 13);

    window.L.control.zoom({ position: 'bottomright' }).addTo(locationMap);
    window.L.control.layers({
        'Satellite': satelliteLayer,
        'Street': streetLayer,
        'Terrain': terrainLayer
    }, null, { position: 'topright' }).addTo(locationMap);
    window.L.control.scale({ position: 'bottomleft' }).addTo(locationMap);

    const markerIcon = window.L.divIcon({
        html: '<div class="location-pin"></div>',
        className: 'location-pin-wrapper',
        iconSize: [26, 26],
        iconAnchor: [13, 13]
    });

    const initialPosition = { lat: fallbackLat, lng: fallbackLng };
    locationMarker = window.L.marker([initialPosition.lat, initialPosition.lng], { draggable: true, icon: markerIcon }).addTo(locationMap);
    locationAccuracyCircle = window.L.circle([initialPosition.lat, initialPosition.lng], { radius: 0, color: '#f97316', fillColor: '#fb923c', fillOpacity: 0.18 }).addTo(locationMap);

    locationMarker.on('dragend', async () => {
        stopLiveLocationTracking(false);
        const latLng = locationMarker.getLatLng();
        locationMap.panTo([latLng.lat, latLng.lng]);
        locationAccuracyCircle.setLatLng([latLng.lat, latLng.lng]);
        locationAccuracyCircle.setRadius(40);
        updateLocationStatus('Pin moved manually. Refining the address…', statusElementId);
        await maybeReverseGeocode(latLng.lat, latLng.lng, statusElementId, 'manual');
        state.cart.selectedLocationId = '';
    });

    locationMap.on('click', async (event) => {
        stopLiveLocationTracking(false);
        const latLng = event.latlng;
        locationMarker.setLatLng(latLng);
        locationAccuracyCircle.setLatLng(latLng);
        locationAccuracyCircle.setRadius(40);
        locationMap.panTo(latLng);
        updateLocationStatus('Pin placed manually. Refining the address…', statusElementId);
        await maybeReverseGeocode(latLng.lat, latLng.lng, statusElementId, 'manual');
    });

    if (navigator.geolocation && window.isSecureContext) {
        navigator.geolocation.getCurrentPosition((position) => {
            const latLng = { lat: position.coords.latitude, lng: position.coords.longitude };
            applyLocationToMap(latLng.lat, latLng.lng, position.coords.accuracy || 40, `Ready • Accuracy ±${Math.round(position.coords.accuracy || 0)}m`, { zoom: 16, pan: false }, statusElementId);
            locationMapReady = true;
        }, () => {
            locationMap.setView([fallbackLat, fallbackLng], 13);
            locationMarker.setLatLng([fallbackLat, fallbackLng]);
            locationAccuracyCircle.setLatLng([fallbackLat, fallbackLng]);
            locationAccuracyCircle.setRadius(40);
            locationMapReady = true;
            updateLocationStatus('Using Monrovia as the default starting point.', statusElementId);
        }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    } else {
        locationMap.setView([fallbackLat, fallbackLng], 13);
        locationMarker.setLatLng([fallbackLat, fallbackLng]);
        locationAccuracyCircle.setLatLng([fallbackLat, fallbackLng]);
        locationAccuracyCircle.setRadius(40);
        locationMapReady = true;
        updateLocationStatus(window.isSecureContext ? 'Using Monrovia as the default starting point.' : 'Open this page over HTTPS or localhost to use live device location.', statusElementId);
    }

    setTimeout(() => locationMap.invalidateSize(), 220);
}

function applyLocationToMap(lat, lng, accuracy, message, options = {}, statusElementId = 'locationStatus') {
    if (!locationMap || !locationMarker) return;
    const nextLat = Number(lat);
    const nextLng = Number(lng);
    if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) return;
    locationMap.setView([nextLat, nextLng], options.zoom || 16);
    if (options.pan !== false) {
        locationMap.panTo([nextLat, nextLng]);
    }
    locationMarker.setLatLng([nextLat, nextLng]);
    if (locationAccuracyCircle) {
        locationAccuracyCircle.setLatLng([nextLat, nextLng]);
        locationAccuracyCircle.setRadius(Math.max(25, Number(accuracy) || 40));
    }
    updateLocationStatus(message, statusElementId);
}

function updateLocationStatus(message, statusElementId = 'locationStatus') {
    const status = document.getElementById(statusElementId);
    if (status) {
        status.textContent = message;
    }
}

async function reverseGeocodeLatLng(lat, lng) {
    try {
        const response = await fetchWithTimeout(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`, {}, 8000);
        if (!response.ok) throw new Error('Geocoding unavailable');
        const payload = await response.json();
        const address = payload.address || {};
        const fullAddress = [
            address.house_number,
            address.road,
            address.suburb || address.neighbourhood || address.village || address.town || address.city || address.county,
            address.city || address.town || address.village || address.state || address.county,
            address.postcode,
            address.country
        ].filter(Boolean).join(', ');
        return {
            latitude: Number(lat),
            longitude: Number(lng),
            address: fullAddress,
            country: address.country || '',
            state: address.state || address.region || '',
            county: address.county || '',
            city: address.city || address.town || address.village || '',
            district: address.suburb || address.neighbourhood || address.village || '',
            street: address.road || '',
            houseNumber: address.house_number || '',
            postalCode: address.postcode || '',
            fullAddress,
            landmark: payload.name || ''
        };
    } catch (error) {
        console.warn('Reverse geocoding failed', error);
        return null;
    }
}

function maybeReverseGeocode(lat, lng, statusElementId = 'locationStatus', source = 'manual') {
    if (locationReverseGeocodeTimer) {
        window.clearTimeout(locationReverseGeocodeTimer);
    }
    locationReverseGeocodeTimer = window.setTimeout(async () => {
        const result = await reverseGeocodeLatLng(lat, lng);
        if (!result) {
            updateLocationStatus('Address lookup is temporarily unavailable. You can still save the coordinates.', statusElementId);
            return;
        }
        state.checkoutLocationSelection = {
            ...state.checkoutLocationSelection,
            latitude: result.latitude,
            longitude: result.longitude,
            address: result.fullAddress,
            country: result.country,
            state: result.state,
            city: result.city,
            district: result.district,
            street: result.street,
            houseNumber: result.houseNumber,
            postalCode: result.postalCode,
            fullAddress: result.fullAddress,
            landmark: result.landmark,
            accuracy: 20,
            timestamp: new Date().toISOString(),
            source
        };
        const addressInput = document.getElementById('deliveryAddressInput');
        if (addressInput && result.fullAddress) {
            addressInput.value = result.fullAddress;
        }
        const preview = document.getElementById('checkoutLocationPreview');
        if (preview) {
            preview.innerHTML = `<div class="muted">${escapeHtml(result.fullAddress || 'Delivery location set')}</div>`;
        }
        updateLocationStatus(`Location ready • ${result.fullAddress}`, statusElementId);
        createToast('Location refined. Review it and confirm before placing your order.', 'success');
    }, 280);
}

async function tryApproximateNetworkLocation() {
    try {
        const response = await fetchWithTimeout('https://ipapi.co/json/', {}, 6000);
        if (!response.ok) throw new Error('Network lookup failed');
        const data = await response.json();
        if (Number.isFinite(Number(data.latitude)) && Number.isFinite(Number(data.longitude))) {
            return { lat: Number(data.latitude), lng: Number(data.longitude), accuracy: 1200 };
        }
    } catch (error) {
        console.warn('Approximate location lookup failed', error);
    }
    return null;
}

function stopLiveLocationTracking(showToast = true) {
    if (locationWatchId !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(locationWatchId);
    }
    locationWatchId = null;
    isTrackingLocation = false;
    if (showToast) createToast('Live tracking stopped.', 'info');
}

async function handleAutoLocate() {
    if (!navigator.geolocation) {
        createToast('Geolocation is not supported on this device.', 'error');
        return;
    }

    if (!window.isSecureContext) {
        updateLocationStatus('Open this page over HTTPS or localhost to use live device location.');
        createToast('Please use HTTPS or localhost for device-location access.', 'info');
        return;
    }

    updateLocationStatus('Finding your location…');
    stopLiveLocationTracking(false);

    navigator.geolocation.getCurrentPosition((position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const accuracy = position.coords.accuracy || 40;
        applyLocationToMap(lat, lng, accuracy, `Tracking live • Accuracy ±${Math.round(accuracy)}m`, { zoom: 16, pan: true });
        isTrackingLocation = true;

        locationWatchId = navigator.geolocation.watchPosition((nextPosition) => {
            const nextLat = nextPosition.coords.latitude;
            const nextLng = nextPosition.coords.longitude;
            const nextAccuracy = nextPosition.coords.accuracy || 40;
            applyLocationToMap(nextLat, nextLng, nextAccuracy, `Tracking live • Accuracy ±${Math.round(nextAccuracy)}m`, { zoom: 16, pan: true });
        }, () => {
            updateLocationStatus('Live tracking paused. Try again if needed.');
        }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 });
    }, async () => {
        const approx = await tryApproximateNetworkLocation();
        if (approx) {
            applyLocationToMap(approx.lat, approx.lng, approx.accuracy, 'Using approximate network location. You can place the pin manually if needed.', { zoom: 13, pan: true });
            createToast('Precise device location was not available; using an approximate network position.', 'info');
        } else {
            applyLocationToMap(defaultLocation.lat, defaultLocation.lng, 40, 'Unable to access your device location. You can place the pin manually.', { zoom: 13, pan: true });
        }
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
}

function selectSavedLocation(locationId) {
    const location = state.locations.find((entry) => entry.id === locationId);
    if (!location || !locationMap || !locationMarker) return;
    const lat = Number(location.lat || 6.3113);
    const lng = Number(location.lng || -10.8014);
    locationMap.setView([lat, lng], 15);
    locationMarker.setLatLng([lat, lng]);
    if (document.getElementById('locationLabel')) document.getElementById('locationLabel').value = location.label || 'Home';
    if (document.getElementById('locationLandmark')) document.getElementById('locationLandmark').value = location.landmark || '';
    if (document.getElementById('locationNeighborhood')) document.getElementById('locationNeighborhood').value = location.neighborhood || '';
    if (document.getElementById('locationDetails')) document.getElementById('locationDetails').value = location.details || '';
}

function setButtonBusy(button, label) {
    if (!button) return;
    button.dataset.originalLabel = button.dataset.originalLabel || button.textContent;
    button.disabled = true;
    button.textContent = label;
    button.classList.add('is-busy');
}

function clearButtonBusy(button) {
    if (!button) return;
    button.disabled = false;
    button.textContent = button.dataset.originalLabel || button.textContent;
    button.classList.remove('is-busy');
}

function buildDeliveryLocationPayload(selectedLocation = null) {
    const lat = Number(selectedLocation?.lat || state.checkoutLocationSelection?.latitude || null);
    const lng = Number(selectedLocation?.lng || state.checkoutLocationSelection?.longitude || null);
    const address = selectedLocation?.details || state.checkoutLocationSelection?.fullAddress || state.checkoutLocationSelection?.address || '';
    const accuracy = Number(state.checkoutLocationSelection?.accuracy || selectedLocation?.accuracy || 0);
    return {
        address,
        latitude: Number.isFinite(lat) ? lat : null,
        longitude: Number.isFinite(lng) ? lng : null,
        accuracy: Number.isFinite(accuracy) ? accuracy : null,
        source: state.checkoutLocationSelection?.source || (selectedLocation ? 'saved' : 'manual')
    };
}

async function syncActiveOrderLocation(address, locationPayload = null) {
    if (!state.authUser?.uid || !state.orders.length) return;
    const activeStatuses = ['pending', 'accepted', 'preparing', 'ready', 'picked_up', 'out_for_delivery', 'refund_requested'];
    const targetOrders = state.orders.filter((order) => order.customerUid === state.authUser.uid && activeStatuses.includes(order.status));
    if (!targetOrders.length) return;
    const updates = {
        address: address || '',
        deliveryLocation: locationPayload || null,
        updatedAt: new Date()
    };
    await Promise.all(targetOrders.map((order) => db.collection('orders').doc(order.id).set(updates, { merge: true })));
}

async function saveCustomerLocation() {
    if (!state.authUser) return;
    const button = document.getElementById('saveLocationButton');
    setButtonBusy(button, 'Saving…');
    const label = document.getElementById('locationLabel')?.value.trim() || 'Home';
    const landmark = document.getElementById('locationLandmark')?.value.trim() || '';
    const neighborhood = document.getElementById('locationNeighborhood')?.value.trim() || '';
    const details = document.getElementById('locationDetails')?.value.trim() || '';
    const position = locationMarker?.getLatLng?.();
    if (!position) return;

    try {
        const timestamp = serverTimestamp();
        const savedRef = await db.collection('users').doc(state.authUser.uid).collection('customerLocations').add({
            ownerId: state.authUser.uid,
            label,
            landmark,
            neighborhood,
            details,
            lat: Number(position.lat),
            lng: Number(position.lng),
            createdAt: timestamp
        });
        {
            await db.collection('users').doc(state.authUser.uid).set({
                geopoint: geoPoint(Number(position.lat), Number(position.lng)),
                deliveryAddress: {
                    label,
                    landmark,
                    neighborhood,
                    details,
                    latitude: Number(position.lat),
                    longitude: Number(position.lng)
                },
                updatedAt: timestamp
            }, { merge: true });
        }
        state.cart.selectedLocationId = savedRef.id;
        saveCartToStorage();
        createToast('Location saved successfully.', 'success');
        renderProfileForm();
    } catch (error) {
        createToast(error.message || 'Could not save this location.', 'error');
    } finally {
        clearButtonBusy(button);
    }
}

function renderSettingsForm() {
    const form = document.getElementById('settingsForm');
    form.innerHTML = `
    <label><input type="checkbox" checked /> Enable notifications</label>
    ${renderThemePreferenceControl()}
    <button class="primary-btn" id="changePasswordButton" type="button">Change Password</button>
  `;
    bindThemePreferenceControl(form, {
        db,
        userId: state.authUser?.uid,
        onError: () => createToast('Theme changed on this device, but could not sync to your account.', 'warning')
    });
    document.getElementById('changePasswordButton').addEventListener('click', () => createToast('Password reset is available through local storage Auth.', 'info'));
}

function renderHelpSession() {
    const formContainer = document.getElementById('helpSessionContent');
    const articlesContainer = document.getElementById('helpArticlesList');
    if (!formContainer || !articlesContainer) return;
    formContainer.innerHTML = `
      <div class="panel-card">
        <div class="panel-card-header">
          <h4>Need help?</h4>
          <span class="badge">Send a suggestion to Manna Marketplace</span>
        </div>
        <form id="helpRequestForm" class="form-grid">
          <label>Topic<select name="category"><option value="orders">Orders</option><option value="account">Account</option><option value="payments">Payments</option><option value="technical">Technical</option><option value="other">Other</option></select></label>
          <label class="full">Message<textarea name="message" required placeholder="Tell us what you need help with."></textarea></label>
          <label>Email<input name="email" value="${state.authUser?.email || ''}" /></label>
          <div class="modal-actions"><button class="primary-btn" type="submit">Send suggestion</button></div>
        </form>
      </div>`;
    if (!document.getElementById('helpArticleCategoryFilter')) {
        articlesContainer.insertAdjacentHTML('beforebegin', `
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
    document.getElementById('helpRequestForm')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = Object.fromEntries(new FormData(form));
        const payload = {
            panel: 'customer',
            category: String(data.category || 'other'),
            subject: String(data.category || 'Support request'),
            message: String(data.message || '').trim(),
            email: String(data.email || state.authUser?.email || '').trim(),
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
            form.reset();
            createToast('Support request sent. The admin team will review it.', 'success');
        } catch (error) {
            createToast(error.message || 'Unable to send support request.', 'error');
        }
    });
    renderHelpArticles();
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

function showSection(section) {
    if (section === 'cart') {
        section = 'checkout';
    }
    state.activeSection = section;
    document.body.classList.toggle('customer-home-active', section === 'home');
    setActiveNavigation(section);
    setMobileNavOpen(false);
    sectionPanels.forEach((panel) => panel.classList.toggle('active', panel.id === `${section}Section`));
    document.getElementById('walletSection')?.classList.toggle('active', section === 'wallet');
    if (section === 'checkout') {
        renderCheckout();
    } else if (section === 'orders') {
        renderOrders();
    } else if (section === 'favorites') {
        renderFavorites();
    } else if (section === 'notifications') {
        renderNotifications();
    } else if (section === 'sellers') {
        renderSellers();
    } else if (section === 'home' && customerHomeFeedDirty) {
        renderHome();
    } else if (section === 'help') {
        renderHelpSession();
    }
    const titleMap = {
        home: ['Home', 'Find products, place orders, and track deliveries.'],
        sellers: ['Sellers', 'Browse approved sellers and their products.'],
        sellerDetail: ['Seller', 'View products and add them to your cart.'],
        orders: ['Orders', 'Track active and completed orders.'],
        favorites: ['Favorites', 'Your saved sellers and products.'],
        profile: ['Profile', 'Manage your address and personal details.'],
        settings: ['Settings', 'Adjust your experience and preferences.'],
        checkout: ['Checkout', 'Complete your order with mobile money.'],
        help: ['Help Center', 'Find quick guides and support material for customers.']
        ,wallet: ['Wallet', 'Manage your balance, deposits, and withdrawals.']
    };
    const [title, subtitle] = titleMap[section] || titleMap.home;
    pageTitle.textContent = title;
    pageSubtitle.textContent = subtitle;
}

async function hydrateCartFromStorage() {
    try {
        if (!state.authUser?.uid || !db) {
            state.cart = normalizeCartState(state.cart);
            updateCartSummary();
            return;
        }
        const snapshot = await db.collection('users').doc(state.authUser.uid).collection('cart').doc('current').get();
        state.cart = normalizeCartState(snapshot.exists ? snapshot.data() : state.cart);
        updateCartSummary();
    } catch (error) {
        console.error('[Manna Marketplace] Cart could not be loaded from Firestore:', error);
        state.cart = normalizeCartState(state.cart);
        updateCartSummary();
    }
}

async function saveCartToStorage() {
    if (!state.authUser?.uid || !db) return;
    try {
        await db.collection('users').doc(state.authUser.uid).collection('cart').doc('current').set({
            ...state.cart,
            updatedAt: serverTimestamp()
        });
    } catch (error) {
        console.error('[Manna Marketplace] Cart could not be saved to Firestore:', error);
    }
}

function updateCartSummary() {
    const count = state.cart.items?.reduce((sum, item) => sum + Number(item.quantity || 0), 0) || 0;
    cartCount.textContent = count;
}

function getCartItems() {
    return state.cart.items.map((entry) => {
        const menuItem = state.menuItems.find((menuItem) => menuItem.id === entry.menuItemId) || entry.menuItemSnapshot || null;
        const variantValues = entry.variantValues || entry.selectedVariants || {};
        const selectedVariant = findConfiguredVariant(menuItem?.variantOptions, variantValues);
        return {
            ...entry,
            variantValues,
            variantPriceModifier: Number(entry.variantPriceModifier ?? selectedVariant?.priceModifier ?? 0),
            menuItem
        };
    }).filter((entry) => entry.menuItem);
}

function getVariantSelectionEntries(item, selectedValues = {}) {
    const fieldLabels = new Map((getCategoryVariantConfig(item?.category || '').fields || [])
        .map((field) => [field.key, field.label]));
    return Object.entries(selectedValues || {}).filter(([, value]) => String(value || '').trim()).map(([key, value]) => ({
        label: fieldLabels.get(key) || key.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase()),
        value: String(value)
    }));
}

function renderVariantSelections(item, selectedValues = {}) {
    return getVariantSelectionEntries(item, selectedValues)
        .map(({ label, value }) => `<div class="muted"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</div>`)
        .join('');
}

function normalizeImagePath(value, folder = 'products') {
    if (!value) return '';
    const normalized = String(value).trim();
    if (!normalized) return '';
    if (/^https?:\/\//i.test(normalized)) return normalized;
    if (normalized.startsWith('./') || normalized.startsWith('../') || normalized.startsWith('/')) return normalized.replace(/^\.\//, '').replace(/^\//, '');
    if (normalized.startsWith('images/')) return normalized;
    return `images/${folder}/${normalized}`;
}

function getStorageOptions(item) {
    return getStorageVariants(item).map((variant) => variant.label);
}

function getStorageVariants(item) {
    if (!Array.isArray(item?.storageOptions)) return [];
    return item.storageOptions.map((value) => typeof value === 'string'
        ? { label: value.trim(), priceModifier: 0, stockCount: 1 }
        : { label: String(value?.label || '').trim(), priceModifier: Number(value?.priceModifier || 0), stockCount: Math.max(0, Number(value?.stockCount || 0)) })
        .filter((variant) => variant.label);
}

function getProductColors(item) {
    return isPhoneOrTablet(item) && Array.isArray(item?.colorOptions) ? item.colorOptions.map((color) => String(color).trim()).filter(Boolean) : [];
}

function getColorHex(color) {
    const colors = { black: '#111827', white: '#f8fafc', gold: '#d4a72c', silver: '#94a3b8', 'rose gold': '#e7a9a9', blue: '#2563eb', navy: '#172554', red: '#dc2626', purple: '#7c3aed', green: '#16a34a', pink: '#ec4899', yellow: '#eab308', orange: '#f97316', brown: '#78350f', gray: '#6b7280', graphite: '#4b5563', teal: '#0f766e', titanium: '#a8a29e', natural: '#d6b98c' };
    return colors[String(color || '').toLowerCase()] || '#64748b';
}

function getCartLineUnitPrice(entry) {
    if (entry.isSignupReward) return 0;
    const basePrice = Number(entry.menuItem?.price || 0);
    const variantModifier = convertCurrency(Number(entry.variantPriceModifier || 0), 'LRD', normalizeCurrency(entry.menuItem?.currency));
    const priceModifier = Number(entry.shoePriceModifier || entry.storagePriceModifier || variantModifier || 0);
    return Math.round((basePrice + priceModifier) * 100) / 100;
}

function isPhoneOrTablet(item) {
        return getCategoryDisplayName(item?.category || '') === 'Phones & Tablets';
}

function isShoesOrFootwear(item) {
    return getCategoryDisplayName(item?.category || '') === 'Shoes & Footwear';
}

function getShoeVariants(item) {
    if (!isShoesOrFootwear(item) || !Array.isArray(item?.shoeVariants)) return [];
    return item.shoeVariants.map((variant) => ({
        size: String(variant?.size || '').trim(),
        color: String(variant?.color || '').trim(),
        colorHex: String(variant?.colorHex || '').trim(),
        priceModifier: Number(variant?.priceModifier || 0),
        stockCount: Math.max(0, Number(variant?.stockCount || 0))
    })).filter((variant) => variant.size && variant.color);
}

function openProductDetails(menuItemId) {
        const item = state.menuItems.find((entry) => entry.id === menuItemId);
        if (!item) return;
        const seller = state.sellers.find((entry) => entry.id === item.sellerId);
        const storageOptions = getStorageOptions(item);
        openModal(item.name || 'Product details', `
            <div class="stack">
                <img src="./images/placeholder.png" data-mobile-loader data-mobile-src="${escapeHtml(getProductThumbnailUrl(item.imageFilename || item.image || ''))}" data-full-src="${escapeHtml(getImageUrl(item.imageFilename || item.image || ''))}" alt="${escapeHtml(item.name || 'Product')}" decoding="async" style="width:100%; max-height:240px; object-fit:cover; border-radius:12px;" />
                <p>${escapeHtml(item.sellerDescription || item.description || 'No product description provided.')}</p>
                <div class="muted"><strong>Price:</strong> ${renderProductPrice(item)}</div>
                <div class="muted"><strong>Category:</strong> ${escapeHtml(getCategoryDisplayName(item.category || 'General'))}</div>
                ${storageOptions.length ? `<div class="muted"><strong>Storage options:</strong> ${escapeHtml(storageOptions.join(', '))}</div>` : ''}
                ${item.sellerName || seller?.name ? `<div class="muted"><strong>Seller:</strong> ${escapeHtml(item.sellerName || seller.name)}</div>` : ''}
                ${item.stockStatus ? `<div class="muted"><strong>Availability:</strong> ${escapeHtml(item.stockStatus)}</div>` : ''}
                ${item.preparationTime ? `<div class="muted"><strong>Preparation time:</strong> ${escapeHtml(String(item.preparationTime))} hours</div>` : ''}
                ${item.notes ? `<div class="muted"><strong>Seller notes:</strong> ${escapeHtml(item.notes)}</div>` : ''}
            </div>`);
        modalActions.insertAdjacentHTML('afterbegin', '<button class="primary-btn" id="productDetailsAddToCart" type="button">Add to cart</button>');
        document.getElementById('productDetailsAddToCart')?.addEventListener('click', () => withButtonState(
            document.getElementById('productDetailsAddToCart'),
            async () => {
                closeModal();
                await addToCart(menuItemId);
            },
            { loadingText: 'Adding...', successText: 'In Cart', permanent: false }
        ));
}

function openStorageChooser(item, button) {
    if (isShoesOrFootwear(item)) return openShoeChooser(item, button);
        const variants = getStorageVariants(item);
    const colors = getProductColors(item);
    if (!isPhoneOrTablet(item) || (!variants.length && !colors.length)) return false;
        const firstAvailable = variants.find((variant) => variant.stockCount > 0);
        if (button) clearButtonBusy(button);
        openModal(`Choose options for ${item.name}`, `
            <form id="storageChoiceForm" class="stack">
                <p class="muted">Select the storage size you want before adding this product to your cart.</p>
                ${variants.length ? `<label>Storage size<select name="storageSize" required>
                    ${variants.map((variant) => `<option value="${escapeHtml(variant.label)}" ${variant.label === firstAvailable?.label ? 'selected' : ''} data-price-modifier="${variant.priceModifier}" data-stock-count="${variant.stockCount}" ${variant.stockCount <= 0 ? 'disabled' : ''}>${escapeHtml(variant.label)}${variant.stockCount <= 0 ? ' (Out of stock)' : ''}</option>`).join('')}
                </select></label>` : ''}
                ${colors.length ? `<div class="product-color-picker"><strong>Color</strong><div class="customer-color-grid">${colors.map((color, index) => `<label class="customer-color-option"><input type="radio" name="productColor" value="${escapeHtml(color)}" ${index === 0 ? 'checked' : ''} /><span class="customer-color-swatch" style="--swatch:${getColorHex(color)}" title="${escapeHtml(color)}"></span><span>${escapeHtml(color)}</span></label>`).join('')}</div></div>` : ''}
                <div id="storageVariantPrice" class="muted"></div>
                <div id="storageVariantStock" class="muted"></div>
            </form>`);
        modalActions.innerHTML = '<button class="ghost-btn" id="cancelStorageChoice" type="button">Cancel</button><button class="primary-btn" id="confirmStorageChoice" type="button">Add to cart</button>';
        const select = document.querySelector('#storageChoiceForm select[name="storageSize"]');
        const priceDisplay = document.getElementById('storageVariantPrice');
        const stockDisplay = document.getElementById('storageVariantStock');
        const confirmButton = document.getElementById('confirmStorageChoice');
        const updateVariantState = () => {
                const variant = variants.find((entry) => entry.label === select?.value);
                const basePrice = getStoredProductPrice(item);
                const price = basePrice + Number(variant?.priceModifier || 0);
                const stockCount = variants.length ? Number(variant?.stockCount || 0) : 1;
                if (priceDisplay) priceDisplay.textContent = `Price: ${formatCurrency(price, item.currency)}`;
                if (stockDisplay) stockDisplay.textContent = stockCount > 0 ? `In stock: ${stockCount}` : 'Out of stock';
                if (confirmButton) confirmButton.disabled = variants.length ? !variant || stockCount <= 0 : false;
        };
        select?.addEventListener('change', updateVariantState);
        updateVariantState();
        document.getElementById('cancelStorageChoice')?.addEventListener('click', closeModal);
        document.getElementById('confirmStorageChoice')?.addEventListener('click', async () => {
                const selectedVariant = variants.find((entry) => entry.label === select?.value);
                if (variants.length && (!selectedVariant || selectedVariant.stockCount <= 0)) {
                        createToast('Please choose a storage size.', 'warning');
                        return;
                }
                closeModal();
                const selectedColor = document.querySelector('input[name="productColor"]:checked')?.value || '';
                await addToCart(item.id, selectedVariant?.label || '', selectedColor);
        });
        return true;
}

function openShoeChooser(item, button) {
        const variants = getShoeVariants(item);
        if (!variants.length) return false;
        if (button) clearButtonBusy(button);
        const colors = [...new Map(variants.map((variant) => [variant.color, variant])).values()];
        const firstAvailable = variants.find((variant) => variant.stockCount > 0);
        let selectedColor = firstAvailable?.color || colors[0]?.color || '';
        let selectedSize = firstAvailable?.size || '';
        const renderChooser = () => {
                const colorVariants = variants.filter((variant) => variant.color === selectedColor);
                const availableSizes = colorVariants.filter((variant) => variant.stockCount > 0);
                if (!availableSizes.some((variant) => variant.size === selectedSize)) selectedSize = availableSizes[0]?.size || colorVariants[0]?.size || '';
                const selectedVariant = colorVariants.find((variant) => variant.size === selectedSize);
                openModal(`Choose options for ${item.name}`, `
                    <form id="shoeChoiceForm" class="stack">
                        <p class="muted">Choose a color and size before adding these shoes to your order.</p>
                        <div><strong>Color</strong><div class="customer-color-grid">${colors.map((variant) => `<label class="customer-color-option"><input type="radio" name="shoeColor" value="${escapeHtml(variant.color)}" ${variant.color === selectedColor ? 'checked' : ''} /><span class="customer-color-swatch" style="--swatch:${escapeHtml(variant.colorHex || getColorHex(variant.color))}" title="${escapeHtml(variant.color)}"></span><span>${escapeHtml(variant.color)}</span></label>`).join('')}</div></div>
                        <label>Size<select name="shoeSize">${colorVariants.map((variant) => `<option value="${escapeHtml(variant.size)}" ${variant.size === selectedSize ? 'selected' : ''} ${variant.stockCount <= 0 ? 'disabled' : ''}>${escapeHtml(variant.size)}${variant.stockCount <= 0 ? ' (Out of stock)' : ''}</option>`).join('')}</select></label>
                        <div class="muted">Price: ${formatCurrency(getStoredProductPrice(item) + Number(selectedVariant?.priceModifier || 0), item.currency)}</div>
                        <div class="muted">${selectedVariant?.stockCount > 0 ? `In stock: ${selectedVariant.stockCount}` : 'Out of stock'}</div>
                    </form>`);
                modalActions.innerHTML = '<button class="ghost-btn" id="cancelShoeChoice" type="button">Cancel</button><button class="primary-btn" id="confirmShoeChoice" type="button">Add to cart</button>';
                const confirmButton = document.getElementById('confirmShoeChoice');
                if (confirmButton) confirmButton.disabled = !selectedVariant || selectedVariant.stockCount <= 0;
                document.querySelectorAll('input[name="shoeColor"]').forEach((input) => input.addEventListener('change', () => { selectedColor = input.value; renderChooser(); }));
                document.querySelector('select[name="shoeSize"]')?.addEventListener('change', (event) => { selectedSize = event.target.value; renderChooser(); });
                document.getElementById('cancelShoeChoice')?.addEventListener('click', closeModal);
                document.getElementById('confirmShoeChoice')?.addEventListener('click', async () => {
                        if (!selectedVariant || selectedVariant.stockCount <= 0) return;
                        closeModal();
                        await addToCart(item.id, '', selectedColor, selectedSize);
                });
        };
        renderChooser();
        return true;
}

async function addToCart(menuItemId, storageSize = '', color = '', shoeSize = '', variantValues = {}) {
    const selectedItem = state.menuItems.find((item) => item.id === menuItemId);
    if (!selectedItem) return;
    const button = document.querySelector(`[data-add-order="${menuItemId}"]`);
        if (!storageSize && !shoeSize && !color && openStorageChooser(selectedItem, button)) return;
        if (!Object.keys(variantValues).length && openCategoryVariantChooser(selectedItem, button)) return;
    const sellerId = selectedItem.sellerId || state.selectedSeller?.id || state.cart.sellerId;
    if (button) setButtonBusy(button, 'Preparing…');
    const seller = state.sellers.find((entry) => entry.id === sellerId);
    const paymentDetails = resolveSellerPaymentDetails(seller, state.cart);
    const selectedVariant = getStorageVariants(selectedItem).find((variant) => variant.label === storageSize);
    const storagePriceModifier = Number(selectedVariant?.priceModifier || 0);
    const storagePrice = selectedItem.isSignupReward ? 0 : storageSize ? getStoredProductPrice(selectedItem) + storagePriceModifier : Number(selectedItem.price || 0);
    const shoeVariant = getShoeVariants(selectedItem).find((variant) => variant.size === shoeSize && variant.color === color);
    const shoePriceModifier = Number(shoeVariant?.priceModifier || 0);
    const shoePrice = selectedItem.isSignupReward ? 0 : shoeSize ? getStoredProductPrice(selectedItem) + shoePriceModifier : Number(selectedItem.price || 0);
    const categoryVariant = findConfiguredVariant(selectedItem.variantOptions, variantValues);
    if (Object.keys(variantValues).length && Array.isArray(selectedItem.variantOptions) && selectedItem.variantOptions.length && !categoryVariant) {
        createToast('That product option combination is no longer available. Please choose again.', 'warning');
        return;
    }
    const variantPriceModifier = Number(categoryVariant?.priceModifier || 0);
    const nextItem = { menuItemId, menuItemSnapshot: selectedItem, quantity: 1, variations: [], storageSize, color, shoeSize, variantValues, variantPriceModifier, isSignupReward: Boolean(selectedItem.isSignupReward), storagePriceModifier, storagePrice, shoePriceModifier, shoePrice, notes: '' };
    state.cart = normalizeCartState({
        ...state.cart,
        paymentMethod: selectedItem.isSignupReward ? 'balance' : state.customerProfile?.savedPaymentPreference?.method || state.cart.paymentMethod,
        paymentCurrency: selectedItem.isSignupReward ? 'LRD' : state.customerProfile?.savedPaymentPreference?.currency || state.cart.paymentCurrency,
        paymentPhone: state.customerProfile?.savedPaymentPreference?.phone || state.cart.paymentPhone,
        sellerId,
        couponCode: selectedItem.isSignupReward ? '' : state.cart.sellerId === sellerId ? state.cart.couponCode : '',
        isSignupReward: Boolean(selectedItem.isSignupReward),
        rewardClaimId: selectedItem.isSignupReward ? state.authUser.uid : '',
        sellerName: selectedItem.isSignupReward ? 'Manna Marketplace Rewards' : seller?.name || state.cart.sellerName || 'Seller',
        sellerPaymentReceiver: paymentDetails.sellerPaymentReceiver,
        sellerAcceptedPaymentMethods: paymentDetails.acceptedPaymentMethods,
        items: [nextItem]
    });
    if (selectedItem.isSignupReward) syncSellerCouponListener('');
    else syncSellerCouponListener(sellerId);
    saveCartToStorage();
    updateCartSummary();
    createToast(`${selectedItem.name} is ready for checkout.`, 'success');
    if (selectedItem.promotion && !selectedItem.isSignupReward) playSoundEffect('promotion');
    showSection('checkout');
    renderCheckout();
}

function renderCart() {
    const items = getCartItems();
    document.getElementById('cartContent').innerHTML = items.length ? items.map((entry) => `
    <div class="item-card cart-item-card">
    <img src="./images/placeholder.png" data-mobile-loader data-mobile-src="${escapeHtml(getProductThumbnailUrl(entry.menuItem?.imageFilename || entry.menuItem?.image || ''))}" data-full-src="${escapeHtml(getImageUrl(entry.menuItem?.imageFilename || entry.menuItem?.image || ''))}" alt="${entry.menuItem?.name || 'Item'}" decoding="async" />
    <div class="panel-card-header"><strong>${entry.menuItem?.name || 'Item'}</strong><span>${formatCurrency(getCartLineUnitPrice(entry) * entry.quantity, entry.menuItem?.currency)}</span></div>
    <div class="muted">${entry.menuItem?.sellerDescription || 'Ready for your order.'}</div>
    ${entry.storageSize ? `<div class="muted"><strong>Storage:</strong> ${escapeHtml(entry.storageSize)}</div>` : ''}
    ${entry.shoeSize ? `<div class="muted"><strong>Size:</strong> ${escapeHtml(entry.shoeSize)}</div>` : ''}
    ${entry.color ? `<div class="muted"><strong>Color:</strong> <span class="inline-color-dot" style="--swatch:${getColorHex(entry.color)}"></span> ${escapeHtml(entry.color)}</div>` : ''}
    ${renderVariantSelections(entry.menuItem, entry.variantValues)}
      <div class="cart-actions-row">
        <div class="cart-quantity-control">
          <button class="cart-qty-btn" data-cart-decrease="${entry.menuItemId}" type="button" aria-label="Decrease quantity">−</button>
          <input class="cart-qty-input" type="number" min="1" value="${entry.quantity}" data-cart-quantity-input="${entry.menuItemId}" aria-label="Quantity" />
          <button class="cart-qty-btn" data-cart-increase="${entry.menuItemId}" type="button" aria-label="Increase quantity">+</button>
        </div>
        <button class="ghost-btn cart-remove-btn" data-cart-remove="${entry.menuItemId}" type="button">Remove</button>
      </div>
    </div>`).join('') : '<div class="empty-state">Your cart is empty.</div>';
    document.querySelectorAll('[data-cart-decrease]').forEach((button) => button.addEventListener('click', () => adjustCartQuantity(button.dataset.cartDecrease, -1)));
    document.querySelectorAll('[data-cart-increase]').forEach((button) => button.addEventListener('click', () => adjustCartQuantity(button.dataset.cartIncrease, 1)));
    document.querySelectorAll('[data-cart-quantity-input]').forEach((input) => input.addEventListener('change', (event) => {
        const menuItemId = event.target.dataset.cartQuantityInput;
        const nextQuantity = Number.parseInt(event.target.value, 10);
        if (!menuItemId) return;
        setCartQuantity(menuItemId, Number.isNaN(nextQuantity) ? 1 : nextQuantity);
    }));
    document.querySelectorAll('[data-cart-remove]').forEach((button) => button.addEventListener('click', () => removeCartItem(button.dataset.cartRemove)));
}

function openPaymentModal() {
        if (!ensureCustomerProfileComplete()) return;
        const items = getCartItems();
        if (!items.length) {
                createToast('Your checkout is empty.', 'warning');
                return;
        }
                if (isSignupRewardCart()) {
                        const entry = items[0];
                        modalTitle.textContent = 'Place free reward order';
                        modalBody.innerHTML = `
                            <div class="stack">
                                <div class="checkout-summary-row"><strong>${escapeHtml(entry.menuItem.name)}</strong><strong>${formatCurrency(0, 'LRD')}</strong></div>
                                ${entry.storageSize ? `<div class="muted">Storage: ${escapeHtml(entry.storageSize)}</div>` : ''}
                                ${entry.shoeSize ? `<div class="muted">Size: ${escapeHtml(entry.shoeSize)}</div>` : ''}
                                ${entry.color ? `<div class="muted">Color: ${escapeHtml(entry.color)}</div>` : ''}
                                ${renderVariantSelections(entry.menuItem, entry.variantValues)}
                                <div class="muted">Customer total: 0 LRD. Nothing will be deducted from your balance. Admin confirmation is required before delivery.</div>
                                <div class="muted">Delivery: regular, free to you. Express delivery is not included.</div>
                            </div>`;
                        modalActions.innerHTML = '<button class="ghost-btn" id="cancelRewardOrder" type="button">Back to checkout</button><button class="primary-btn" id="submitSignupRewardOrderButton" type="button">Submit free order</button>';
                        modalBackdrop.classList.remove('hidden');
                        modalBackdrop.setAttribute('aria-hidden', 'false');
                        document.getElementById('cancelRewardOrder')?.addEventListener('click', closeModal);
                        document.getElementById('submitSignupRewardOrderButton')?.addEventListener('click', placeSignupRewardOrder);
                        return;
                }
        const selectedCurrency = normalizeCurrency(state.cart.paymentCurrency || 'USD');
        const methods = getPaymentMethodsForCurrency(selectedCurrency, state.platformPaymentNumbers);
        if (!methods.length) {
            createToast(`No ${selectedCurrency} payment method has been configured yet.`, 'warning');
            return;
        }
        const selectedMethod = methods.includes(state.cart.paymentMethod) ? state.cart.paymentMethod : methods[0];
        const methodDetails = { ...(state.platformPaymentMethods[selectedMethod] || {}) };
        if (selectedMethod === 'orange_money') methodDetails.receiverName = selectedCurrency === 'USD' ? state.platformPaymentNumbers.orangeMoneyUsdReceiverName : state.platformPaymentNumbers.orangeMoneyLrdReceiverName;
        if (selectedMethod === 'lonestar_mobile_money') methodDetails.receiverName = selectedCurrency === 'USD' ? state.platformPaymentNumbers.lonestarMoneyUsdReceiverName : state.platformPaymentNumbers.lonestarMoneyLrdReceiverName;
        if (selectedMethod === 'orange_money') methodDetails.image = selectedCurrency === 'USD' ? state.platformPaymentNumbers.orangeMoneyUsdImage : state.platformPaymentNumbers.orangeMoneyLrdImage;
        if (selectedMethod === 'lonestar_mobile_money') methodDetails.image = selectedCurrency === 'USD' ? state.platformPaymentNumbers.lonestarMoneyUsdImage : state.platformPaymentNumbers.lonestarMoneyLrdImage;
        const mobileNumber = selectedMethod === 'orange_money'
            ? (selectedCurrency === 'USD' ? state.platformPaymentNumbers.orangeMoneyUsdNumber : state.platformPaymentNumbers.orangeMoneyLrdNumber)
            : selectedMethod === 'lonestar_mobile_money'
                ? (selectedCurrency === 'USD' ? state.platformPaymentNumbers.lonestarMoneyUsdNumber : state.platformPaymentNumbers.lonestarMoneyLrdNumber)
                : methodDetails.number;
        const couponApplication = getCouponApplication(items);
        const couponDiscount = couponApplication.valid ? convertCurrency(couponApplication.discountLrd, 'LRD', selectedCurrency) : 0;
        const total = Math.max(0, items.reduce((sum, entry) => sum + convertCurrency(getCartLineUnitPrice(entry) * entry.quantity, entry.menuItem?.currency, selectedCurrency), 0) - couponDiscount) + convertCurrency(state.cart.deliveryFee || state.deliveryOptions.regularFee, 'LRD', selectedCurrency);
        modalTitle.textContent = 'Complete payment';
        modalBody.innerHTML = `
            <form id="paymentModalForm" class="stack">
                <div class="checkout-summary-row"><strong>Total to pay</strong><strong>${formatCurrency(total, selectedCurrency)}</strong></div>
                <label>Payment currency<select name="paymentCurrency" id="modalPaymentCurrency"><option value="USD" ${selectedCurrency === 'USD' ? 'selected' : ''}>US Dollar (USD)</option><option value="LRD" ${selectedCurrency === 'LRD' ? 'selected' : ''}>Liberian Dollar (LRD)</option></select></label>
                <div class="payment-method-selector compact-payment-methods" role="radiogroup" aria-label="Payment method">${methods.map((method) => { const details = getAdminPaymentMethodDetails(method, selectedCurrency); return `<label class="payment-method-option compact-payment-method ${method === selectedMethod ? 'selected' : ''}"><input type="radio" name="paymentMethod" value="${escapeHtml(method)}" ${method === selectedMethod ? 'checked' : ''} /><img src="${escapeHtml(details.image)}" alt="${escapeHtml(details.label)}" /><span>${escapeHtml(details.label)}</span><small>${escapeHtml(details.receiverName)} • ${escapeHtml(details.number || 'Not configured')}</small></label>`; }).join('')}</div>
                <div class="ussd-payment-card payment-method-preview"><img src="${escapeHtml(methodDetails.image || './images/logo/marketplace-logo.svg')}" alt="${escapeHtml(methodDetails.label || 'Payment method')}" /><strong>Payment details</strong><div class="muted">Receiver: ${escapeHtml(methodDetails.receiverName || methodDetails.name || 'Not configured')}</div><div class="muted">Account/number: ${escapeHtml(mobileNumber || 'Not configured')}</div><div class="muted">Currency: ${escapeHtml(selectedCurrency)}</div></div>
                <label>Payment phone number<input name="paymentPhone" type="tel" value="${escapeHtml(state.cart.paymentPhone || state.customerProfile?.phone || '')}" required /></label>
                <label>Payment reference or ID<input name="paymentDetails" value="${escapeHtml(state.cart.paymentDetails || '')}" required /></label>
                <label><input type="checkbox" name="savePaymentProcedure" ${state.customerProfile?.savedPaymentPreference?.method === selectedMethod && state.customerProfile?.savedPaymentPreference?.currency === selectedCurrency ? 'checked' : ''} /> Save this payment procedure for next time</label>
            </form>`;
        modalActions.innerHTML = '<button class="ghost-btn" id="cancelPaymentModal" type="button">Back to checkout</button><button class="primary-btn" id="confirmPaymentButton" type="button">Place order</button>';
        modalBackdrop.classList.remove('hidden');
        modalBackdrop.setAttribute('aria-hidden', 'false');
        document.getElementById('cancelPaymentModal')?.addEventListener('click', closeModal);
        document.getElementById('modalPaymentCurrency')?.addEventListener('change', (event) => {
                state.cart.paymentCurrency = normalizeCurrency(event.target.value);
                saveCartToStorage();
                openPaymentModal();
        });
            document.querySelectorAll('#paymentModalForm input[name="paymentMethod"]').forEach((input) => input.addEventListener('change', (event) => {
                state.cart.paymentMethod = event.target.value;
                saveCartToStorage();
                openPaymentModal();
            }));
        document.getElementById('confirmPaymentButton')?.addEventListener('click', placeOrder);
}

function renderCheckout() {
    state.cart = normalizeCartState(state.cart);
    const isSignupReward = isSignupRewardCart();
    const placeOrderButton = document.getElementById('placeOrderButton');
    if (placeOrderButton) placeOrderButton.textContent = isSignupReward ? 'Review free reward order' : 'Continue to payment';
    if (isSignupReward) {
        state.cart.paymentMethod = 'balance';
        state.cart.paymentCurrency = 'LRD';
        state.cart.deliveryOption = 'regular';
        state.cart.deliveryFee = 0;
        state.cart.couponCode = '';
    }
    if (isSignupReward) syncSellerCouponListener('');
    else syncSellerCouponListener(state.cart.sellerId);
    const items = getCartItems();
    const checkoutItem = items[0] || null;
    const selectedPaymentCurrency = isSignupReward ? 'LRD' : normalizeCurrency(state.cart.paymentCurrency || state.customerProfile?.savedPaymentPreference?.currency || 'USD');
    const couponApplication = isSignupReward ? { coupon: null, discountLrd: 0, itemDiscounts: [], message: '' } : getCouponApplication(items);
    const couponDiscount = couponApplication.valid ? convertCurrency(couponApplication.discountLrd, 'LRD', selectedPaymentCurrency) : 0;
    const subtotal = isSignupReward ? 0 : Math.max(0, items.reduce((sum, entry) => sum + convertCurrency(getCartLineUnitPrice(entry) * entry.quantity, entry.menuItem?.currency, selectedPaymentCurrency), 0) - couponDiscount);
    const selectedDeliveryOption = isSignupReward ? 'regular' : state.cart.deliveryOption || state.customerProfile?.defaultDeliveryOption || 'regular';
    const deliveryFee = isSignupReward ? 0 : selectedDeliveryOption === 'express' ? state.deliveryOptions.expressFee : state.deliveryOptions.regularFee;
    const total = subtotal + convertCurrency(deliveryFee, 'LRD', selectedPaymentCurrency);
    const seller = state.sellers.find((entry) => entry.id === state.cart.sellerId);
    const activeAddress = getActiveAddress();
    const activeAddressLine = getAddressSummary(activeAddress) || state.customerProfile?.address || 'No active address';
    const coordinates = activeAddress?.coordinates?.latitude != null && activeAddress?.coordinates?.longitude != null ? `${activeAddress.coordinates.latitude}, ${activeAddress.coordinates.longitude}` : '';

    const paymentNumbers = { ...state.platformPaymentNumbers, loaded: true };

    const availablePaymentMethods = isSignupReward ? ['balance'] : getPaymentMethodsForCurrency(selectedPaymentCurrency, paymentNumbers);

    if (availablePaymentMethods.length && !availablePaymentMethods.includes(state.cart.paymentMethod)) {
        state.cart.paymentMethod = state.customerProfile?.savedPaymentPreference?.method;
        if (!availablePaymentMethods.includes(state.cart.paymentMethod)) state.cart.paymentMethod = availablePaymentMethods[0];
        saveCartToStorage();
    }

    const selectedPaymentMethod = state.cart.paymentMethod || 'uba_usd';
    const isBalancePayment = selectedPaymentMethod === 'balance';
    const checkoutHelpArticles = getHelpArticlesByContext(state.helpArticles || [], 'checkout-payment', 'customer');
    const getSelectedPaymentNumber = () => {
        if (isBalancePayment) return '';
        if (selectedPaymentMethod === 'orange_money') return selectedPaymentCurrency === 'USD' ? paymentNumbers.orangeMoneyUsdNumber : paymentNumbers.orangeMoneyLrdNumber;
        if (selectedPaymentMethod === 'lonestar_mobile_money') return selectedPaymentCurrency === 'USD' ? paymentNumbers.lonestarMoneyUsdNumber : paymentNumbers.lonestarMoneyLrdNumber;
        if (selectedPaymentMethod === 'uba_usd' || selectedPaymentMethod === 'uba_lrd') {
            return state.platformPaymentMethods[selectedPaymentMethod]?.number || '';
        }
        return '';
    };
    const selectedPaymentNumber = getSelectedPaymentNumber();
    const paymentMethodMeta = {
        uba_usd: {
            label: 'UBA USD Account',
            image: './images/logo/marketplace-logo.svg',
            alt: 'UBA USD Account',
            template: () => ''
        },
        uba_lrd: {
            label: 'UBA LRD Account',
            image: './images/logo/marketplace-logo.svg',
            alt: 'UBA LRD Account',
            template: () => ''
        },
        orange_money: {
            label: 'Orange Money',
            image: './images/payments/orange.png',
            alt: 'Orange Money',
            template: (number, amount) => `*126*1*${number}*${amount}#`
        },
        lonestar_mobile_money: {
            label: 'Lonestar Cell',
            image: './images/payments/lonestar.png',
            alt: 'Lonestar Cell',
            template: (number, amount) => `*182*1*${number}*${amount}#`
        }
    };
    const activePaymentMeta = { ...(paymentMethodMeta[selectedPaymentMethod] || paymentMethodMeta.uba_usd), ...(state.platformPaymentMethods[selectedPaymentMethod] || {}) };
    if (selectedPaymentMethod === 'uba_usd') activePaymentMeta.receiverName = state.platformPaymentNumbers.ubaUsdReceiverName;
    if (selectedPaymentMethod === 'uba_lrd') activePaymentMeta.receiverName = state.platformPaymentNumbers.ubaLrdReceiverName;
    if (selectedPaymentMethod === 'orange_money') activePaymentMeta.receiverName = selectedPaymentCurrency === 'USD' ? paymentNumbers.orangeMoneyUsdReceiverName : paymentNumbers.orangeMoneyLrdReceiverName;
    if (selectedPaymentMethod === 'lonestar_mobile_money') activePaymentMeta.receiverName = selectedPaymentCurrency === 'USD' ? paymentNumbers.lonestarMoneyUsdReceiverName : paymentNumbers.lonestarMoneyLrdReceiverName;
    if (selectedPaymentMethod === 'orange_money') activePaymentMeta.image = selectedPaymentCurrency === 'USD' ? paymentNumbers.orangeMoneyUsdImage : paymentNumbers.orangeMoneyLrdImage;
    if (selectedPaymentMethod === 'lonestar_mobile_money') activePaymentMeta.image = selectedPaymentCurrency === 'USD' ? paymentNumbers.lonestarMoneyUsdImage : paymentNumbers.lonestarMoneyLrdImage;
    const payableAmount = isSignupReward ? 0 : Math.max(1, Math.round(total * 100) / 100);
    const ussdCode = !isBalancePayment && selectedPaymentMethod !== 'uba_usd' && selectedPaymentMethod !== 'uba_lrd' && selectedPaymentNumber ? activePaymentMeta.template(selectedPaymentNumber, payableAmount) : '';
    const isUnavailable = !isBalancePayment && !['uba_usd', 'uba_lrd'].includes(selectedPaymentMethod) && Boolean(selectedPaymentMethod && selectedPaymentNumber === '' && state.cart.sellerId);
    const unavailableMessage = isUnavailable ? `This seller does not accept ${activePaymentMeta.label}. Please choose another method.` : '';

    document.getElementById('checkoutContent').innerHTML = `
    <div class="stack">
      <div class="item-card">
        <div class="panel-card-header"><h4>Order summary</h4></div>
                ${items.length ? items.map((entry) => `
                    <div class="checkout-summary-row">
                        <img src="./images/placeholder.png" data-mobile-loader data-mobile-src="${escapeHtml(getProductThumbnailUrl(entry.menuItem?.imageFilename || entry.menuItem?.image || ''))}" data-full-src="${escapeHtml(getImageUrl(entry.menuItem?.imageFilename || entry.menuItem?.image || ''))}" alt="${entry.menuItem?.name || 'Item'}" decoding="async" />
                        <div>
                            <strong>${escapeHtml(entry.menuItem?.name || 'Item')} × ${entry.quantity}</strong>
                            ${entry.storageSize ? `<div class="muted"><strong>Storage:</strong> ${escapeHtml(entry.storageSize)}${entry.storagePriceModifier ? ` (+${formatCurrency(entry.storagePriceModifier, entry.menuItem?.currency)})` : ''}</div>` : ''}
                            ${entry.shoeSize ? `<div class="muted"><strong>Size:</strong> ${escapeHtml(entry.shoeSize)}${entry.shoePriceModifier ? ` (+${formatCurrency(entry.shoePriceModifier, entry.menuItem?.currency)})` : ''}</div>` : ''}
                            ${entry.color ? `<div class="muted"><strong>Color:</strong> <span class="inline-color-dot" style="--swatch:${getColorHex(entry.color)}"></span> ${escapeHtml(entry.color)}</div>` : ''}
                            ${renderVariantSelections(entry.menuItem, entry.variantValues)}
                            <div class="muted">${formatCurrency(getCartLineUnitPrice(entry) * entry.quantity, entry.menuItem?.currency)}</div>
                        </div>
                    </div>
                `).join('') : '<div class="empty-state">No item selected. Choose a product from the home page to begin checkout.</div>'}
        ${checkoutItem && !isSignupReward ? `
          <div class="customization-order-panel">
            <label><input type="checkbox" data-checkout-customization ${checkoutItem.customizationRequested ? 'checked' : ''} /> Customize this item</label>
            ${checkoutItem.customizationRequested ? `
              <p class="muted">After placing your order, send your design image and customization details to the admin on WhatsApp. The admin will add the customization fee to this order for your approval and payment.</p>
              <label>Customization details<textarea data-checkout-customization-details maxlength="1000" placeholder="Describe the changes you want (optional)">${escapeHtml(checkoutItem.customizationDetails || '')}</textarea></label>
              ${getWhatsAppUrl(state.adminWhatsAppNumber, `Hello, I am ordering ${checkoutItem.menuItem?.name || 'a product'} and would like to customize it. I will send the design image and details.`) ? `<a class="secondary-btn" href="${escapeHtml(getWhatsAppUrl(state.adminWhatsAppNumber, `Hello, I am ordering ${checkoutItem.menuItem?.name || 'a product'} and would like to customize it. I will send the design image and details.`))}" target="_blank" rel="noopener noreferrer">Contact admin on WhatsApp</a>` : '<div class="muted">Admin WhatsApp contact is not configured. You can still place the order and share design details later.</div>'}
            ` : ''}
          </div>
        ` : ''}
        <p><strong>Subtotal:</strong> ${formatCurrency(subtotal, selectedPaymentCurrency)}</p>
                ${isSignupReward ? '' : `<div class="checkout-coupon-section">
                    <strong>Seller coupons</strong>
                    <div class="action-row">
                        <input id="couponCodeInput" type="text" value="${escapeHtml(state.cart.couponCode)}" maxlength="32" placeholder="Enter coupon code" aria-label="Coupon code" />
                        <button class="secondary-btn" id="applyCouponButton" type="button">Apply</button>
                    </div>
                    <div class="muted" role="status">${escapeHtml(couponApplication.message || state.couponMessage || (state.couponsLoaded ? 'Choose an available code or enter one.' : 'Loading available coupons…'))}</div>
                    ${state.couponsLoaded ? state.coupons.filter((coupon) => (coupon.status || 'active') === 'active' && (!coupon.expiryDate || String(coupon.expiryDate) >= new Date().toISOString().slice(0, 10))).map((coupon) => `<div class="checkout-summary-row"><span><strong>${escapeHtml(coupon.code)}</strong> · ${coupon.type === 'percentage' ? `${Number(coupon.value)}% of seller profit` : `${formatCurrency(Number(coupon.value || 0), 'LRD')} from seller profit`}</span><button class="ghost-btn" type="button" data-use-coupon="${escapeHtml(String(coupon.code || '').toUpperCase())}">Use</button></div>`).join('') : ''}
                    ${couponApplication.valid ? `<div class="muted">Coupon savings: ${formatCurrency(couponDiscount, selectedPaymentCurrency)}</div>` : ''}
                </div>`}
            ${isSignupReward ? '<div class="muted">Delivery option: regular only</div>' : `<label>Delivery option<select id="deliveryOptionSelect"><option value="regular" ${selectedDeliveryOption === 'regular' ? 'selected' : ''}>Regular delivery (${state.deliveryOptions.regularDays} days) - ${formatCurrency(state.deliveryOptions.regularFee)}</option><option value="express" ${selectedDeliveryOption === 'express' ? 'selected' : ''}>Express delivery (${state.deliveryOptions.expressHours} hours) - ${formatCurrency(state.deliveryOptions.expressFee)}</option></select></label>
            <label><input type="checkbox" name="saveDeliveryDefault" ${state.customerProfile?.defaultDeliveryOption === selectedDeliveryOption ? 'checked' : ''} /> Save as my default delivery option</label>`}
        <p><strong>Delivery fee:</strong> ${formatCurrency(convertCurrency(deliveryFee, 'LRD', selectedPaymentCurrency), selectedPaymentCurrency)}</p>
        <p><strong>Total to pay:</strong> ${formatCurrency(total, selectedPaymentCurrency)}</p>
        ${seller?.name ? `<div class="muted"><strong>Seller:</strong> ${escapeHtml(seller.name)}</div>` : ''}
        ${seller?.phone ? `<div class="muted">Seller phone: ${escapeHtml(seller.phone)}</div>` : ''}
      </div>
      <div class="item-card">
        <div class="panel-card-header">
          <h4>Delivery address</h4>
          <button class="ghost-btn" data-section="profile" type="button">Manage in Profile</button>
        </div>
        <div class="checkout-address-card">
          <div class="muted">Only your active saved address is displayed here.</div>
          <input class="premium-input" type="text" value="${escapeHtml(activeAddressLine)}" readonly />
          ${coordinates ? `<input class="premium-input" type="text" value="${escapeHtml(coordinates)}" readonly />` : ''}
        </div>
      </div>
      <form id="checkoutForm" class="stack">
        <div class="item-card">
          <h4>Quantity</h4>
          <div class="checkout-quantity-row">
            ${isSignupReward ? '<span>1 reward item</span>' : `<button class="ghost-btn" type="button" data-checkout-decrease>−</button><input class="premium-input" type="number" min="1" value="${Number(checkoutItem?.quantity || 1)}" data-checkout-quantity /><button class="ghost-btn" type="button" data-checkout-increase>+</button>`}
            <button class="danger-btn" type="button" id="removeCheckoutItemButton">Remove</button>
          </div>
          <label>Phone<input name="customerPhone" value="${state.customerProfile?.phone || ''}" required /></label>
          <label>Notes<textarea name="notes">${state.cart.notes || ''}</textarea></label>
        </div>
                <div class="item-card hidden">
                    <h4>Payment</h4>
          ${checkoutHelpArticles.length ? `<div class="help-section-checkout" style="margin-bottom: 16px; padding: 12px; background: var(--accent-light); border-radius: 12px; border-left: 4px solid var(--accent);">
            <p style="margin: 0 0 12px 0; font-weight: 600; font-size: 14px;">💡 Learn how to pay</p>
            ${checkoutHelpArticles.map((article) => `
              <div style="margin-bottom: 8px; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">
                <div style="display: flex; align-items: flex-start; gap: 12px;">
                  <div style="flex: 1;">
                    <p style="margin: 0 0 4px 0; font-weight: 500;">${escapeHtml(article.title || 'Help article')}</p>
                    <p style="margin: 0 0 8px 0; font-size: 13px; color: var(--muted);">${escapeHtml(article.description || '')}</p>
                    ${article.videoUrl ? `<a href="${escapeHtml(article.videoUrl)}" target="_blank" rel="noopener noreferrer" class="primary-btn" style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; font-size: 13px; text-decoration: none;">📺 Watch video</a>` : ''}
                  </div>
                </div>
              </div>
            `).join('')}
          </div>` : ''}
                    ${!isBalancePayment ? `<label>1. Choose payment currency<select id="paymentCurrencySelect" name="paymentCurrency"><option value="USD" ${selectedPaymentCurrency === 'USD' ? 'selected' : ''}>US Dollar (USD)</option><option value="LRD" ${selectedPaymentCurrency === 'LRD' ? 'selected' : ''}>Liberian Dollar (LRD)</option></select></label>` : '<div class="muted">Wallet payments use your LRD balance.</div>'}
                    <div class="muted">2. Choose how you want to pay</div>
          <div class="payment-method-selector">
                        ${availablePaymentMethods.includes('uba_usd') ? `<label class="payment-method-option ${selectedPaymentMethod === 'uba_usd' ? 'selected' : ''}">
                                                        <input type="radio" name="paymentMethod" value="uba_usd" ${selectedPaymentMethod === 'uba_usd' ? 'checked' : ''} />
                                                        <img src="${escapeHtml(state.platformPaymentMethods.uba_usd?.image || './images/logo/marketplace-logo.svg')}" alt="UBA USD Account" />
                                                        <span>UBA USD Account</span>
                                                </label>` : ''}
                        ${availablePaymentMethods.includes('uba_lrd') ? `<label class="payment-method-option ${selectedPaymentMethod === 'uba_lrd' ? 'selected' : ''}">
                                                        <input type="radio" name="paymentMethod" value="uba_lrd" ${selectedPaymentMethod === 'uba_lrd' ? 'checked' : ''} />
                                                        <img src="${escapeHtml(state.platformPaymentMethods.uba_lrd?.image || './images/logo/marketplace-logo.svg')}" alt="UBA LRD Account" />
                                                        <span>UBA LRD Account</span>
                                                </label>` : ''}
                        ${availablePaymentMethods.includes('balance') ? `<label class="payment-method-option ${isBalancePayment ? 'selected' : ''}">
                            <input type="radio" name="paymentMethod" value="balance" ${isBalancePayment ? 'checked' : ''} />
                            <span>${isSignupReward ? 'Pay with balance · 0 LRD charged' : `Pay with wallet balance (${formatLRD(state.walletBalance || 0)})`}</span>
                                                </label>` : ''}
            ${availablePaymentMethods.includes('orange_money') ? `<label class="payment-method-option ${selectedPaymentMethod === 'orange_money' ? 'selected' : ''}">
              <input type="radio" name="paymentMethod" value="orange_money" ${selectedPaymentMethod === 'orange_money' ? 'checked' : ''} />
              <img src="${escapeHtml((selectedPaymentCurrency === 'USD' ? paymentNumbers.orangeMoneyUsdImage : paymentNumbers.orangeMoneyLrdImage) || './images/payments/orange.png')}" alt="Orange Money" />
              <span>Orange Money</span>
            </label>` : ''}
            ${availablePaymentMethods.includes('lonestar_mobile_money') ? `<label class="payment-method-option ${selectedPaymentMethod === 'lonestar_mobile_money' ? 'selected' : ''}">
              <input type="radio" name="paymentMethod" value="lonestar_mobile_money" ${selectedPaymentMethod === 'lonestar_mobile_money' ? 'checked' : ''} />
              <img src="${escapeHtml((selectedPaymentCurrency === 'USD' ? paymentNumbers.lonestarMoneyUsdImage : paymentNumbers.lonestarMoneyLrdImage) || './images/payments/lonestar.png')}" alt="Lonestar Cell" />
              <span>Lonestar Cell</span>
            </label>` : ''}
          </div>
          ${!isBalancePayment ? '<div class="muted">Your selected currency controls the compatible payment methods shown above.</div>' : isSignupReward ? '<div class="muted">Balance is recorded as the payment method; this free reward does not deduct funds.</div>' : '<div class="muted">Wallet funds are charged now. Order preparation starts after admin confirmation.</div>'}
          <div class="muted">Payment amount: ${formatCurrency(payableAmount, selectedPaymentCurrency)}</div>
          <div class="muted">Chosen payment method: ${escapeHtml(activePaymentMeta.label)} • Receiver: ${escapeHtml(activePaymentMeta.receiverName || activePaymentMeta.name || 'Not set')} • ${escapeHtml(selectedPaymentNumber || 'Not set')}</div>
                    ${['uba_usd', 'uba_lrd'].includes(selectedPaymentMethod) ? `<div class="ussd-payment-card">
                        <div class="ussd-code-label">Bank transfer instructions (${escapeHtml(activePaymentMeta.accountType || selectedPaymentCurrency)})</div>
                        <div class="muted">Account name: ${escapeHtml(activePaymentMeta.name || 'Not configured')}</div>
                        <div class="muted">Account number: ${escapeHtml(activePaymentMeta.number || 'Not configured')}</div>
                        <div class="muted">Account type: ${escapeHtml(activePaymentMeta.accountType || selectedPaymentCurrency)}</div>
          </div>` : isUnavailable ? `<div class="payment-unavailable-message">${escapeHtml(unavailableMessage)}</div>` : ussdCode ? `<div class="ussd-payment-card">
            <div class="ussd-code-label">USSD payment code (${escapeHtml(selectedPaymentCurrency)})</div>
            <div class="ussd-code" id="displayedUssdCode">${escapeHtml(ussdCode)}</div>
            <div class="ussd-actions">
              <button class="primary-btn" type="button" id="copyUssdButton">Copy Code</button>
              <button class="ghost-btn dial-button" type="button" id="dialUssdButton">Call</button>
            </div>
          </div>` : '<div class="empty-state">Select a payment method to view the payment details.</div>'}
          ${isBalancePayment ? '' : `<div class="premium-payment-fields">
            <label class="premium-field">
              <span class="premium-field-title">Payment phone number</span>
              <input class="premium-input" type="tel" name="paymentPhone" value="${state.cart.paymentPhone || ''}" placeholder="Enter your wallet number" required />
            </label>
            <label class="premium-field">
              <span class="premium-field-title">Payment ID number</span>
              <input class="premium-input" name="paymentDetails" value="${state.cart.paymentDetails || ''}" placeholder="Enter the payment reference or ID" required />
            </label>
          </div>`}
                      ${!isBalancePayment ? `<label class="payment-save-option"><input type="checkbox" id="savePaymentProcedure" ${state.customerProfile?.savedPaymentPreference?.currency === selectedPaymentCurrency && state.customerProfile?.savedPaymentPreference?.method === selectedPaymentMethod ? 'checked' : ''} /> Save this payment procedure for next time</label>` : ''}
        </div>
      </form>
    </div>`;
    document.querySelector('[data-checkout-decrease]')?.addEventListener('click', () => updateCheckoutQuantity(-1));
    document.querySelector('[data-checkout-increase]')?.addEventListener('click', () => updateCheckoutQuantity(1));
    document.querySelector('[data-checkout-quantity]')?.addEventListener('change', (event) => {
        const nextQuantity = Number.parseInt(event.target.value, 10);
        updateCheckoutQuantity(Number.isNaN(nextQuantity) ? 1 : nextQuantity, false);
    });
    document.getElementById('removeCheckoutItemButton')?.addEventListener('click', removeCheckoutItem);
    document.getElementById('applyCouponButton')?.addEventListener('click', () => {
        applyCouponCode(document.getElementById('couponCodeInput')?.value);
    });
    document.getElementById('couponCodeInput')?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        applyCouponCode(event.currentTarget.value);
    });
    document.querySelectorAll('[data-use-coupon]').forEach((button) => {
        button.addEventListener('click', () => applyCouponCode(button.dataset.useCoupon));
    });
    document.getElementById('deliveryOptionSelect')?.addEventListener('change', (event) => {
        state.cart.deliveryOption = event.target.value;
        state.cart.deliveryFee = event.target.value === 'express' ? state.deliveryOptions.expressFee : state.deliveryOptions.regularFee;
        saveCartToStorage();
        renderCheckout();
    });
    document.getElementById('removeCheckoutHeaderButton')?.addEventListener('click', removeCheckoutItem);
    document.querySelector('[data-checkout-customization]')?.addEventListener('change', (event) => {
        const item = state.cart.items[0];
        if (!item || isSignupRewardCart()) return;
        item.customizationRequested = event.currentTarget.checked;
        if (!item.customizationRequested) item.customizationDetails = '';
        saveCartToStorage();
        renderCheckout();
    });
    document.querySelector('[data-checkout-customization-details]')?.addEventListener('input', (event) => {
        const item = state.cart.items[0];
        if (item) item.customizationDetails = event.currentTarget.value;
    });
    document.querySelector('[data-checkout-customization-details]')?.addEventListener('change', () => saveCartToStorage());
    document.querySelectorAll('.payment-method-option input[name="paymentMethod"]').forEach((radio) => {
        radio.addEventListener('change', () => {
            state.cart.paymentMethod = radio.value;
            saveCartToStorage();
            renderCheckout();
        });
    });
    document.getElementById('paymentCurrencySelect')?.addEventListener('change', (event) => {
        state.cart.paymentCurrency = normalizeCurrency(event.target.value);
        const compatibleMethods = getPaymentMethodsForCurrency(state.cart.paymentCurrency, paymentNumbers);
        if (!compatibleMethods.includes(state.cart.paymentMethod)) state.cart.paymentMethod = compatibleMethods[0];
        saveCartToStorage();
        renderCheckout();
    });
    document.getElementById('copyUssdButton')?.addEventListener('click', () => {
        const code = document.getElementById('displayedUssdCode')?.textContent?.trim();
        if (!code) return;
        handleCopyUssd(code);
    });
    document.getElementById('dialUssdButton')?.addEventListener('click', () => {
        const code = document.getElementById('displayedUssdCode')?.textContent?.trim();
        if (!code) return;
        handleDialUssd(code);
    });
}

function setCartQuantity(menuItemId, quantity) {
    const item = state.cart.items.find((entry) => entry.menuItemId === menuItemId);
    if (!item) return;
    const nextQuantity = Math.max(0, Number(quantity) || 0);
    if (nextQuantity <= 0) {
        state.cart.items = state.cart.items.filter((entry) => entry.menuItemId !== menuItemId);
    } else {
        item.quantity = nextQuantity;
    }
    saveCartToStorage();
    updateCartSummary();
    renderCart();
}

function updateCheckoutQuantity(delta, relative = true) {
    if (!state.cart.items.length) {
        return;
    }
    const item = state.cart.items[0];
    const resolvedQuantity = relative
        ? Math.max(1, (item.quantity || 1) + delta)
        : Math.max(1, Number(delta || 1));
    item.quantity = resolvedQuantity;
    saveCartToStorage();
    updateCartSummary();
    renderCheckout();
}

function adjustCartQuantity(menuItemId, delta) {
    const item = state.cart.items.find((entry) => entry.menuItemId === menuItemId);
    if (!item) return;
    setCartQuantity(menuItemId, (item.quantity || 0) + delta);
}

function setCheckoutLocationBusy(button, label) {
    if (!button) return;
    button.dataset.originalLabel = button.dataset.originalLabel || button.textContent;
    button.disabled = true;
    button.textContent = label;
    button.classList.add('is-busy');
}

function clearCheckoutLocationBusy(button) {
    if (!button) return;
    button.disabled = false;
    button.textContent = button.dataset.originalLabel || button.textContent;
    button.classList.remove('is-busy');
}

async function handleCheckoutLocationSelection() {
    const button = document.getElementById('autoChooseLocationButton');
    const confirmButton = document.getElementById('confirmCheckoutLocationButton');
    const status = document.getElementById('checkoutLocationStatus');
    setCheckoutLocationBusy(button, 'Finding your location…');
    if (confirmButton) {
        confirmButton.disabled = true;
        confirmButton.textContent = '✔ Confirm Delivery Location';
    }
    if (status) {
        status.textContent = 'Finding your location…';
    }
    if (!navigator.geolocation) {
        createToast('Geolocation is not supported on this device.', 'error');
        clearCheckoutLocationBusy(button);
        return;
    }
    if (!window.isSecureContext) {
        createToast('Please use HTTPS or localhost for live location access.', 'info');
        clearCheckoutLocationBusy(button);
        return;
    }
    navigator.geolocation.getCurrentPosition(async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const accuracy = position.coords.accuracy || 40;
        const locationResult = await reverseGeocodeLatLng(lat, lng);
        state.checkoutLocationSelection = {
            latitude: lat,
            longitude: lng,
            accuracy,
            address: locationResult?.fullAddress || '',
            country: locationResult?.country || '',
            state: locationResult?.state || '',
            city: locationResult?.city || '',
            district: locationResult?.district || '',
            street: locationResult?.street || '',
            houseNumber: locationResult?.houseNumber || '',
            postalCode: locationResult?.postalCode || '',
            fullAddress: locationResult?.fullAddress || '',
            landmark: locationResult?.landmark || '',
            timestamp: new Date().toISOString(),
            source: 'gps',
            locationConfirmed: false
        };
        const addressInput = document.getElementById('deliveryAddressInput');
        if (addressInput) {
            addressInput.value = state.checkoutLocationSelection.fullAddress || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        }
        const preview = document.getElementById('checkoutLocationPreview');
        if (preview) {
            preview.innerHTML = `<div class="muted">${escapeHtml(state.checkoutLocationSelection.fullAddress || 'Delivery location set')}</div>`;
        }
        if (status) {
            status.textContent = `Location ready • ${state.checkoutLocationSelection.fullAddress || 'GPS coordinates captured'}`;
        }
        if (confirmButton) {
            confirmButton.disabled = false;
            confirmButton.textContent = '✔ Confirm Delivery Location';
        }
        applyLocationToMap(lat, lng, accuracy, `Location ready • ${state.checkoutLocationSelection.fullAddress || 'GPS coordinates captured'}`, { zoom: 16, pan: true }, 'checkoutLocationStatus');
        clearCheckoutLocationBusy(button);
        createToast('Live delivery location captured successfully.', 'success');
    }, async (error) => {
        let message = 'We could not access your location. Please try again.';
        if (error.code === 1) {
            message = 'Location permission was denied. Please allow access and try again.';
        } else if (error.code === 2) {
            message = 'Location is currently unavailable. Please try again or place the pin manually.';
        } else if (error.code === 3) {
            message = 'Location request timed out. Please try again.';
        }
        if (status) {
            status.textContent = message;
        }
        clearCheckoutLocationBusy(button);
        createToast(message, 'error');
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
}

function confirmCheckoutLocationSelection() {
    const button = document.getElementById('confirmCheckoutLocationButton');
    if (!state.checkoutLocationSelection) {
        createToast('Please choose a delivery location first.', 'info');
        return;
    }
    if (button) {
        setCheckoutLocationBusy(button, 'Confirmed');
    }
    state.checkoutLocationSelection.locationConfirmed = true;
    const addressInput = document.getElementById('deliveryAddressInput');
    if (addressInput) {
        addressInput.value = state.checkoutLocationSelection.fullAddress || addressInput.value;
    }
    createToast('Delivery location confirmed.', 'success');
}

function removeCartItem(menuItemId) {
    state.cart.items = state.cart.items.filter((entry) => entry.menuItemId !== menuItemId);
    if (!state.cart.items.length) {
        state.cart.isSignupReward = false;
        state.cart.rewardClaimId = '';
    }
    saveCartToStorage();
    updateCartSummary();
    renderCart();
}

function removeCheckoutItem() {
    state.cart.items = [];
    state.cart.isSignupReward = false;
    state.cart.rewardClaimId = '';
    saveCartToStorage();
    updateCartSummary();
    createToast('Item removed. Choose another product to continue.', 'info');
    showSection('home');
}

function isCustomerProfileComplete() {
    const hasAddress = Boolean(state.customerProfile?.address || getActiveAddress());
    return Boolean(state.customerProfile && state.customerProfile.displayName && state.customerProfile.phone && hasAddress);
}

function ensureCustomerProfileComplete() {
    if (isCustomerProfileComplete()) return true;
    createToast('Please complete your profile before placing an order.', 'warning');
    showSection('profile');
    return false;
}

async function placeOrder() {
    if (!ensureCustomerProfileComplete()) return;
    const isSignupReward = isSignupRewardCart();
    const checkoutForm = document.getElementById('checkoutForm');
    const paymentForm = document.getElementById('paymentModalForm');
    const button = document.getElementById('confirmPaymentButton') || document.getElementById('placeOrderButton');
    setButtonBusy(button, 'Placing…');
    const formData = new FormData(checkoutForm);
    const paymentData = paymentForm ? new FormData(paymentForm) : formData;
    const customerPhone = formData.get('customerPhone')?.toString().trim();
    const paymentMethod = paymentData.get('paymentMethod')?.toString() || 'orange_money';
    const paymentPhone = paymentData.get('paymentPhone')?.toString().trim();
    const paymentDetails = paymentData.get('paymentDetails')?.toString().trim();
    const savePaymentProcedure = paymentData.get('savePaymentProcedure') === 'on';
    const saveDeliveryDefault = formData.get('saveDeliveryDefault') === 'on';
    const notes = formData.get('notes')?.toString().trim();
    const selectedLocationId = state.cart.selectedLocationId || state.activeAddressId || '';
    const selectedLocation = state.addresses.find((address) => address.id === selectedLocationId) || getActiveAddress() || null;
    const activeAddressLine = getAddressSummary(selectedLocation) || state.customerProfile?.address || '';
    if (!activeAddressLine || !customerPhone || (paymentMethod !== 'balance' && (!paymentPhone || !paymentDetails))) {
        createToast('Please complete your delivery and payment details.', 'error');
        clearButtonBusy(button);
        return;
    }
    if (!state.cart.items.length) {
        createToast('Your checkout is empty.', 'error');
        clearButtonBusy(button);
        return;
    }
    const items = getCartItems();
    const couponApplication = getCouponApplication(items);
    if (state.cart.couponCode && !couponApplication.valid) {
        createToast(couponApplication.message || 'Remove or reapply the coupon before placing this order.', 'warning');
        clearButtonBusy(button);
        return;
    }
    const couponDiscountLrd = couponApplication.valid ? couponApplication.discountLrd : 0;
    const subtotal = Math.max(0, items.reduce((sum, entry) => sum + convertCurrency(getCartLineUnitPrice(entry) * entry.quantity, entry.menuItem?.currency, 'LRD'), 0) - couponDiscountLrd);
    const productPricing = items.reduce((pricing, entry) => {
        const quantity = Number(entry.quantity || 1);
        pricing.defaultPrice += Number(entry.menuItem?.defaultPrice || 0) * quantity;
        pricing.sellerMarkup += Number(entry.menuItem?.sellerMarkup || 0) * quantity;
        pricing.isSellerOwned = pricing.isSellerOwned || Boolean(entry.menuItem?.isSellerOwned);
        return pricing;
    }, { defaultPrice: 0, sellerMarkup: 0, isSellerOwned: false });
    productPricing.sellerMarkup = Math.max(0, productPricing.sellerMarkup - couponDiscountLrd);
    const deliveryOption = formData.get('deliveryOption')?.toString() || state.cart.deliveryOption || 'regular';
    const deliveryFee = deliveryOption === 'express' ? state.deliveryOptions.expressFee : state.deliveryOptions.regularFee;
    const total = subtotal + deliveryFee;
    const paymentCurrency = paymentMethod === 'balance' ? 'LRD' : normalizeCurrency(paymentData.get('paymentCurrency') || state.cart.paymentCurrency || 'LRD');
    const paymentAmount = paymentMethod === 'balance' ? total : convertCurrency(subtotal, 'LRD', paymentCurrency) + convertCurrency(deliveryFee, 'LRD', paymentCurrency);
    const seller = state.sellers.find((entry) => entry.id === state.cart.sellerId);
    const regularDeliveryDays = Math.max(0.25, ...items.map((entry) => {
        const itemSeller = state.sellers.find((sellerEntry) => sellerEntry.id === entry.menuItem?.sellerId) || seller;
        return getProductDeliveryDays(entry.menuItem, itemSeller);
    }));
    const placedAt = new Date();
    const preparationHours = Math.max(0.25, ...items.map((entry) => Number(entry.menuItem?.preparationTime || 24)));
    const estimatedReadyAt = new Date(placedAt.getTime() + preparationHours * 60 * 60 * 1000);
    const estimatedDeliveryTime = deliveryOption === 'express'
        ? new Date(placedAt.getTime() + (state.deliveryOptions.expressHours * 60 * 60 * 1000))
        : new Date(placedAt.getTime() + (regularDeliveryDays * 24 * 60 * 60 * 1000));
    const deliveryLocationPayload = buildDeliveryLocationPayload(selectedLocation);
    const orderPayload = {
        customerUid: state.authUser.uid,
        customerName: state.customerProfile?.displayName || state.customerProfile?.email || 'Customer',
        customerPhone,
        sellerId: state.cart.sellerId,
        sellerName: state.cart.sellerName || seller?.name || 'Seller',
        sellerMobileMoney: '',
        sellerPaymentReceiver: '',
        sellerAcceptedPaymentMethods: [],
        paymentReceiverName: paymentMethod === 'balance' ? '' : paymentMethod === 'uba_usd'
            ? state.platformPaymentNumbers.ubaUsdReceiverName
            : paymentMethod === 'uba_lrd'
                ? state.platformPaymentNumbers.ubaLrdReceiverName
                : paymentMethod === 'orange_money'
                ? (paymentCurrency === 'USD' ? state.platformPaymentNumbers.orangeMoneyUsdReceiverName : state.platformPaymentNumbers.orangeMoneyLrdReceiverName)
            : paymentMethod === 'lonestar_mobile_money'
                ? (paymentCurrency === 'USD' ? state.platformPaymentNumbers.lonestarMoneyUsdReceiverName : state.platformPaymentNumbers.lonestarMoneyLrdReceiverName)
                : '',
        paymentReceiver: paymentMethod === 'balance' ? '' : paymentMethod === 'orange_money'
            ? (paymentCurrency === 'USD' ? state.platformPaymentNumbers.orangeMoneyUsdNumber : state.platformPaymentNumbers.orangeMoneyLrdNumber)
            : paymentMethod === 'lonestar_mobile_money'
                ? (paymentCurrency === 'USD' ? state.platformPaymentNumbers.lonestarMoneyUsdNumber : state.platformPaymentNumbers.lonestarMoneyLrdNumber)
                : state.platformPaymentMethods[paymentMethod]?.number || '',
        address: activeAddressLine,
        deliveryLocationId: selectedLocation?.id || '',
        deliveryLocationLabel: selectedLocation?.label || '',
        deliveryLat: selectedLocation?.coordinates?.latitude || selectedLocation?.lat || null,
        deliveryLng: selectedLocation?.coordinates?.longitude || selectedLocation?.lng || null,
        deliveryLandmark: selectedLocation?.landmark || selectedLocation?.deliveryDetails || '',
        deliveryDetails: selectedLocation?.deliveryDetails || selectedLocation?.details || '',
        deliveryLocationConfirmed: Boolean(selectedLocation),
        deliveryCoordinates: selectedLocation?.coordinates ? {
            latitude: selectedLocation.coordinates.latitude,
            longitude: selectedLocation.coordinates.longitude,
            accuracy: selectedLocation.accuracy || null,
            address: activeAddressLine,
            source: 'saved'
        } : null,
        deliveryLocation: deliveryLocationPayload.address || deliveryLocationPayload.latitude || deliveryLocationPayload.longitude ? {
            address: deliveryLocationPayload.address || activeAddressLine,
            latitude: deliveryLocationPayload.latitude,
            longitude: deliveryLocationPayload.longitude,
            accuracy: deliveryLocationPayload.accuracy,
            source: deliveryLocationPayload.source || 'manual'
        } : null,
        coordinates: deliveryLocationPayload.latitude !== null && deliveryLocationPayload.longitude !== null ? {
            latitude: deliveryLocationPayload.latitude,
            longitude: deliveryLocationPayload.longitude,
            accuracy: deliveryLocationPayload.accuracy,
            address: deliveryLocationPayload.address || activeAddressLine,
            source: deliveryLocationPayload.source || 'manual'
        } : null,
        status: 'pending',
        total,
        subtotal,
        totalPrice: subtotal,
        couponCode: couponApplication.valid ? couponApplication.coupon.code : '',
        couponDiscount: couponDiscountLrd,
        couponDiscountCurrency: 'LRD',
        defaultPrice: productPricing.defaultPrice,
        sellerMarkup: productPricing.sellerMarkup,
        isSellerOwned: productPricing.isSellerOwned,
        orderFlow: productPricing.isSellerOwned ? 'seller_owned' : 'catalog',
        deliveryFee,
        deliveryOption,
        deliveryDays: deliveryOption === 'regular' ? regularDeliveryDays : null,
        preparationHours,
        estimatedReadyAt,
        paymentMethod,
        paymentPhone,
        paymentDetails,
        paymentCurrency,
        paymentAmount,
        paymentStatus: 'pending',
        sellerPayoutStatus: 'pending',
        deliveryPayoutStatus: 'pending',
        amount: paymentAmount,
        amountCurrency: paymentCurrency,
        items: items.map((entry, index) => {
            const imageValue = entry.menuItem?.imageFilename || entry.menuItem?.image || '';
            const imagePath = normalizeImagePath(imageValue, 'products');
            const quantity = Math.max(1, Number(entry.quantity || 1));
            const itemDiscountLrd = couponApplication.itemDiscounts[index] || 0;
            const itemCurrency = normalizeCurrency(entry.menuItem?.currency);
            const unitDiscount = convertCurrency(itemDiscountLrd / quantity, 'LRD', itemCurrency);
            const optionPriceModifier = Number(entry.storagePriceModifier || entry.shoePriceModifier || 0) + Number(entry.variantPriceModifier || 0);
            const minimumUnitPrice = convertCurrency(Number(entry.menuItem?.defaultPrice || 0) + optionPriceModifier, 'LRD', itemCurrency);
            const unitPrice = itemDiscountLrd > 0
                ? Math.max(minimumUnitPrice, getCartLineUnitPrice(entry) - unitDiscount)
                : getCartLineUnitPrice(entry);
            const configuredVariant = findConfiguredVariant(entry.menuItem?.variantOptions, entry.variantValues);
            return {
                menuItemId: entry.menuItemId,
                masterProductId: getReviewProductReferences(entry.menuItem || {}).masterProductId,
                internationalProductId: String(entry.menuItem?.internationalProductId || ''),
                quantity: entry.quantity,
                name: entry.menuItem?.name || 'Item',
                description: entry.menuItem?.sellerDescription || entry.menuItem?.description || '',
                category: entry.menuItem?.category || '',
                storageSize: entry.storageSize || '',
                color: entry.color || '',
                shoeSize: entry.shoeSize || '',
                selectedVariants: entry.variantValues || {},
                variantOptions: configuredVariant ? [{
                    values: configuredVariant.values,
                    priceModifier: configuredVariant.priceModifier,
                    stockCount: configuredVariant.stockCount
                }] : [],
                variantPriceModifier: Number(entry.variantPriceModifier || 0),
                shoePriceModifier: Number(entry.shoePriceModifier || 0),
                shoePrice: unitPrice,
                storagePriceModifier: Number(entry.storagePriceModifier || 0),
                storagePrice: unitPrice,
                image: imagePath,
                imageFilename: imageValue,
                imagePath,
                price: unitPrice,
                currency: itemCurrency,
                isSellerOwned: Boolean(entry.menuItem?.isSellerOwned),
                defaultPrice: Number(entry.menuItem?.defaultPrice || 0) + Number(entry.variantPriceModifier || 0),
                sellerMarkup: Math.max(0, Number(entry.menuItem?.sellerMarkup || 0) - itemDiscountLrd / quantity),
                couponDiscount: itemDiscountLrd,
                totalPrice: unitPrice,
                customizationRequested: entry.customizationRequested === true,
                customizationDetails: entry.customizationRequested === true ? String(entry.customizationDetails || '').trim() : '',
                orderFlow: entry.menuItem?.internationalProductId ? 'international_inventory' : entry.menuItem?.isSellerOwned ? 'seller_owned' : 'catalog'
            };
        }),
        notes,
        estimatedDeliveryTime,
        placedAt,
        createdAt: placedAt,
        updatedAt: new Date(),
        isDeleted: false,
        refundStatus: 'none',
        customizationRequested: !isSignupReward && items.some((entry) => entry.customizationRequested === true),
        customizationDetails: !isSignupReward
            ? items.filter((entry) => entry.customizationRequested === true)
                .map((entry) => `${entry.menuItem?.name || 'Item'}: ${String(entry.customizationDetails || '').trim()}`)
                .filter((entry) => !entry.endsWith(': '))
                .join('\n')
            : '',
        customizationFee: 0,
        customizationFeeCurrency: 'LRD',
        customizationFeePaymentStatus: !isSignupReward && items.some((entry) => entry.customizationRequested === true)
            ? 'not_quoted'
            : 'not_applicable',
        customizationFeePaymentReference: '',
        customizationFeePaymentPhone: '',
        customizationFeePaymentMethod: '',
        customizationFeePaymentCurrency: '',
        refundRequested: false,
        refundRequestedAt: null,
        refundProcessedAt: null,
        refundConfirmedAt: null,
        refundAmount: 0,
        refundReason: '',
        refundRejectedReason: '',
        refundPaymentMethod: null,
        refundPaymentPhone: null,
        refundPaymentReference: null
    };
    let createdOrderId = '';
    try {
        const orderRef = db.collection('orders').doc();
        createdOrderId = orderRef.id;
        await orderRef.set(orderPayload, { merge: true });
        if (savePaymentProcedure && paymentMethod !== 'balance') {
            const savedPaymentPreference = { currency: paymentCurrency, method: paymentMethod, phone: paymentPhone, updatedAt: new Date() };
            await db.collection('users').doc(state.authUser.uid).set({ savedPaymentPreference }, { merge: true });
            state.customerProfile = { ...state.customerProfile, savedPaymentPreference };
        }
        if (paymentMethod === 'balance') {
            await processBalanceOrderPayment(state.authUser.uid, state.cart.sellerId, total, orderRef.id);
        }
        if (saveDeliveryDefault) {
            await db.collection('users').doc(state.authUser.uid).set({ defaultDeliveryOption: deliveryOption, updatedAt: new Date() }, { merge: true });
        }
        await syncActiveOrderLocation(activeAddressLine, orderPayload.deliveryLocation);
        state.cart = normalizeCartState({ sellerId: '', sellerName: '', items: [], drink: null, paymentMethod: state.customerProfile?.savedPaymentPreference?.method || 'uba_usd', paymentCurrency: state.customerProfile?.savedPaymentPreference?.currency || 'USD', paymentPhone: state.customerProfile?.savedPaymentPreference?.phone || '', paymentDetails: '', contactPhone: '', notes: '', deliveryFee: state.deliveryFee, selectedLocationId: '', sellerPaymentReceiver: '', sellerAcceptedPaymentMethods: [] });
        saveCartToStorage();
        updateCartSummary();
        showSection('orders');
        await loadOrders(state.authUser.uid);
        renderOrders();
        createToast(paymentMethod === 'balance' ? 'Wallet payment recorded. Your order is awaiting admin confirmation.' : 'Order placed. Payment is awaiting admin confirmation.', 'success');
        closeModal();
    } catch (error) {
        if (createdOrderId && paymentMethod === 'balance') {
            await db.collection('orders').doc(createdOrderId).set({ status: 'cancelled', paymentStatus: 'failed', paymentFailureReason: error.message || 'Insufficient balance', updatedAt: new Date() }, { merge: true });
        }
        createToast(error.message || 'Could not place order.', 'error');
    } finally {
        clearButtonBusy(button);
    }
}

function trackOrder(orderId) {
    const order = state.orders.find((entry) => entry.id === orderId);
    if (!order) return;
    openModal(`Order ${order.orderNumber || order.id.slice(0, 6)}`, `<div class="stack"><p>Status: ${order.status}</p><p>Seller: ${order.sellerName || ''}</p><p>Total: ${formatCurrency(order.total || 0)}</p>${renderOrderCountdowns(order)}<p>Placed: ${formatDate(order.placedAt || order.createdAt)}</p><p>Estimated delivery: ${order.estimatedDeliveryTime ? formatDate(order.estimatedDeliveryTime) : 'Pending'}</p><p>Refund: ${order.refundStatus || 'none'}</p></div>`);
    startOrderCountdownTimer();
}

function repeatOrder(orderId) {
    const order = state.orders.find((entry) => entry.id === orderId);
    if (!order) return;
    state.cart = normalizeCartState({ sellerId: order.sellerId, sellerName: order.sellerName, items: order.items.map((item) => ({ ...item, customizationRequested: false, customizationDetails: '', quantity: item.quantity || 1 })), drink: null, paymentMethod: 'orange_money', paymentPhone: '', paymentDetails: '', contactPhone: '', notes: '', deliveryFee: state.deliveryFee, selectedLocationId: order.deliveryLocationId || '', sellerPaymentReceiver: order.sellerPaymentReceiver || order.sellerMobileMoney || '', sellerAcceptedPaymentMethods: Array.isArray(order.sellerAcceptedPaymentMethods) ? order.sellerAcceptedPaymentMethods : [] });
    saveCartToStorage();
    updateCartSummary();
    createToast('Items prepared for checkout.', 'success');
    showSection('checkout');
    renderCheckout();
}

async function toggleFavoriteSeller(sellerId) {
    const seller = state.sellers.find((entry) => entry.id === sellerId);
    if (!seller) return;
    const ref = db.collection('users').doc(state.authUser.uid).collection('favorites').doc(sellerId);
    const snap = await ref.get();
    if (snap.exists) {
        await ref.delete();
    } else {
        await ref.set({ type: 'seller', name: seller.name, sellerId, seller: { ...seller }, createdAt: new Date() });
    }
    await loadFavorites(state.authUser.uid);
    renderFavorites();
    renderHome();
    renderSellers();
}

async function toggleFavoriteItem(menuItemId) {
    const item = state.menuItems.find((entry) => entry.id === menuItemId);
    if (!item) return;
    const seller = state.sellers.find((entry) => entry.id === item.sellerId);
    const ref = db.collection('users').doc(state.authUser.uid).collection('favorites').doc(menuItemId);
    const snap = await ref.get();
    if (snap.exists) {
        await ref.delete();
    } else {
        await ref.set({ type: 'menuItem', name: item.name, menuItemId, menuItem: { ...item, sellerName: seller?.name || '' }, sellerId: item.sellerId || '', createdAt: new Date() });
    }
    await loadFavorites(state.authUser.uid);
    renderFavorites();
    renderHome();
    renderSellers();
}

async function updateUserProfile(uid, updates) {
    if (!uid) {
        throw new Error('A user id is required to save the profile.');
    }
    const button = document.getElementById('saveProfileButton');
    if (button) {
        setButtonBusy(button, 'Saving…');
    }
    try {
        const payload = {
            ...updates,
            updatedAt: new Date()
        };
        await db.collection('users').doc(uid).set(payload, { merge: true });
        state.customerProfile = { ...state.customerProfile, ...payload };
        createToast('Profile saved to local database.', 'success');
        return payload;
    } catch (error) {
        createToast(error.message || 'Unable to save your profile.', 'error');
        throw error;
    } finally {
        if (button) {
            clearButtonBusy(button);
        }
    }
}

async function saveProfile(event) {
    event.preventDefault();
    const form = document.getElementById('profileForm');
    const formData = Object.fromEntries(new FormData(form));
    const whatsappNumber = String(formData.whatsappNumber || '').trim();
    const updates = {
        displayName: String(formData.displayName || '').trim(),
        phone: String(formData.phone || '').trim(),
        whatsappNumber: whatsappNumber || String(formData.phone || '').trim(),
        email: String(formData.email || '').trim(),
        genderPreference: String(formData.genderPreference || '').trim(),
        address: String(formData.address || '').trim()
    };
    if (!updates.displayName || !updates.phone || !updates.address) {
        createToast('Please fill in your name, phone, and address before saving.', 'warning');
        return;
    }
    const previousGenderPreference = state.customerProfile?.genderPreference || '';
    const payload = await updateUserProfile(state.authUser.uid, updates);
    if (previousGenderPreference !== updates.genderPreference) {
        state.menuItems = sortMenuItemsForCustomer(state.menuItems);
        renderHome();
    }
    await syncActiveOrderLocation(payload.address, {
        address: payload.address,
        latitude: state.checkoutLocationSelection?.latitude || null,
        longitude: state.checkoutLocationSelection?.longitude || null,
        accuracy: state.checkoutLocationSelection?.accuracy || null,
        source: state.checkoutLocationSelection?.source || 'manual'
    });
}

function handleModalEscape(event) {
    if (event.key === 'Escape') {
        closeModal();
    }
}

function openModal(title, body) {
    modalTitle.textContent = title;
    modalBody.innerHTML = body;
    modalActions.innerHTML = '<button class="ghost-btn" id="closeModalBtn">Close</button>';
    modalBackdrop.classList.remove('hidden');
    modalBackdrop.setAttribute('aria-hidden', 'false');
    document.getElementById('closeModalBtn').addEventListener('click', closeModal);
    window.addEventListener('keydown', handleModalEscape);
}

function closeModal() {
    modalBackdrop.classList.add('hidden');
    modalBody.innerHTML = '';
    modalActions.innerHTML = '';
    modalBackdrop.setAttribute('aria-hidden', 'true');
    window.removeEventListener('keydown', handleModalEscape);
}

document.addEventListener('DOMContentLoaded', init);
