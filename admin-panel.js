import { initStorage, isStorageReady, subscribeCollection, addDocument, updateDocument, deleteDocument, saveDocument, clearStoredAuthState } from './storage.js';
import { formatCurrency, formatDate, escapeHtml, getInitials, createToast, confirmDialog, getImageUrl, getProductThumbnailUrl, getSellerImageUrl, slugify, convertCurrency, normalizeCurrency } from './utils.js';
import { isAdminOnlyEmail } from './auth.js';
import { DEFAULT_CATEGORY_TAXONOMY, ensureCategoriesSeeded, getCategoryDisplayName, getCategoryOptions, isMarketplaceCategory, normalizeCategoryValue } from './category-taxonomy.js';
import { getCategoryVariantConfig } from './category-variants.js';
import { getQRCardHTML, initQRCode, bindQRDownloadHandlers } from './qr-utils.js';
import { renderExpandableDescription } from './description-utils.js';
import { createRoleNotification } from './notification-utils.js';
import { bindSoundToggle, playSoundEffect, renderSoundToggle } from './sound-effects.js';
import { applyTheme, applyThemePreference, bindThemePreferenceControl, getCurrentTheme, renderThemePreferenceControl, saveThemePreference } from './theme-utils.js';
import { getMaintenanceExpiryMs, isMaintenanceActive } from './maintenance-utils.mjs';
import { getActiveCatalogPriceRule } from './pricing-utils.mjs';
import { normalizeCatalogStockCount, setCatalogProductStock } from './catalog-stock-utils.mjs';
import {
  canFulfillCustomizedOrder,
  getCustomizationFeeStatus,
  isCustomizedOrder,
  normalizeCustomizationFee
} from './customization-utils.mjs';

let adminNotificationSnapshotReady = false;
let adminNotificationRecipientUid = '';

const state = {
  currentSection: 'dashboard',
  theme: getCurrentTheme(),
  user: { uid: '', displayName: 'Guest', role: 'guest' },
  data: {
    products: [],
    internationalProducts: [],
  signupBlindBoxCampaign: null,
    sellers: [],
    customers: [],
    delivery: [],
    orders: [],
    reports: [],
    coupons: [],
    announcements: [],
    notifications: [],
    supportRequests: [],
    financialPayouts: [],
    platformFeePayments: [],
    settings: {},
    logs: []
  },
  filters: {
    products: { q: '', category: 'all', status: 'all', sort: 'date' },
    sellers: { q: '', status: 'all' },
    customers: { q: '', status: 'all' },
    delivery: { q: '', status: 'all' },
    analytics: { range: 'month', sellerId: 'all' }
  },
  adminMetrics: {},
  ui: {
    selectedProducts: new Set(),
    modal: null,
    unsubscribe: [],
    chartPoints: [],
    adminSessionUnsubscribe: null,
    adminSessionMessages: [],
    adminSessionId: null
    ,walletUnsubscribes: []
  }
};

const content = document.getElementById('content');
const pageTitle = document.getElementById('pageTitle');
const breadcrumb = document.getElementById('breadcrumb');
const globalSearch = document.getElementById('globalSearch');
const searchResults = document.getElementById('searchResults');
const notificationBadge = document.getElementById('notificationBadge');
const modalRoot = document.getElementById('modalRoot');
const adminAvatar = document.getElementById('adminAvatar');
const appShell = document.getElementById('appShell');
const loginView = document.getElementById('loginView');
const loginForm = document.getElementById('loginForm');
const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
const mobileMenuButton = document.getElementById('mobileMenuButton');
const mobileBottomNav = document.getElementById('mobileBottomNav');
const sidebarToggle = document.getElementById('sidebarToggle');
const sidebar = document.getElementById('sidebar');
const sidebarBackdrop = document.getElementById('sidebarBackdrop');
const sidebarClose = document.getElementById('sidebarClose');
let initialInternationalProductBackfillStarted = false;
let adminDataSyncInitialized = false;

function seedData() {
  return state.data;
}

function persistData() {
  return state.data;
}

function loadData() {
  if (!state.data.settings) state.data.settings = {};
  if (!state.data.logs) state.data.logs = [];
  if (!state.data.supportRequests) state.data.supportRequests = [];
}

function renderPageLayout(title, subtitle, actions = '', body = '') {
  return `
      <section class="page-shell">
        <div class="section-hero">
          <div>
            <h3 class="heading-3">${escapeHtml(title)}</h3>
            <p class="body-medium">${escapeHtml(subtitle)}</p>
          </div>
          ${actions ? `<div class="section-actions">${actions}</div>` : ''}
        </div>
        <div class="page-content-stack">${body}</div>
      </section>
    `;
}

function setMobileNavOpen(isOpen) {
  const isSmallScreen = window.innerWidth <= 1023;

  if (sidebar) {
    sidebar.classList.toggle('open', isSmallScreen && isOpen);
  }

  if (sidebarBackdrop) {
    sidebarBackdrop.classList.toggle('open', isSmallScreen && isOpen);
  }

  document.body.style.overflow = isSmallScreen && isOpen ? 'hidden' : '';
}

function updateNotificationBadge() {
  const badge = document.getElementById('notificationBadge');
  if (!badge) return;
  const count = (state.data.notifications || []).filter(n => !n.read).length;
  badge.textContent = count || '';
  badge.style.display = count ? 'inline-flex' : 'none';
}

function setActiveNavigation(section) {
  document.querySelectorAll('.nav-item[data-section], .mobile-nav-item[data-section]').forEach((button) => {
    button.classList.toggle('active', button.getAttribute('data-section') === section);
  });
}

function attachEvents() {
  const internationalButton = document.createElement('button');
  internationalButton.className = 'nav-item';
  internationalButton.dataset.section = 'international-products';
  internationalButton.innerHTML = '<span class="nav-icon">$</span><span>International Products</span>';
  internationalButton.addEventListener('click', () => openSection('international-products'));
  document.querySelector('.nav-links')?.appendChild(internationalButton);
  const signupRewardsButton = document.createElement('button');
  signupRewardsButton.className = 'nav-item';
  signupRewardsButton.dataset.section = 'signup-rewards';
  signupRewardsButton.innerHTML = '<span class="nav-icon">★</span><span>Signup Rewards</span>';
  signupRewardsButton.addEventListener('click', () => openSection('signup-rewards'));
  document.querySelector('.nav-links')?.appendChild(signupRewardsButton);
  const walletButton = document.createElement('button');
  walletButton.className = 'nav-item';
  walletButton.dataset.section = 'wallet';
  walletButton.innerHTML = '<span class="nav-icon">$</span><span>Wallet</span>';
  walletButton.addEventListener('click', () => openSection('wallet'));
  document.querySelector('.nav-links')?.appendChild(walletButton);
  document.querySelectorAll('.nav-item[data-section], .mobile-nav-item[data-section]').forEach((button) => {
    button.addEventListener('click', () => {
      const section = button.getAttribute('data-section');
      if (section) openSection(section);
      if (window.innerWidth <= 1023) {
        setMobileNavOpen(false);
      }
    });
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 1023) {
      sidebar?.classList.remove('open');
      sidebarBackdrop?.classList.remove('open');
      document.body.style.overflow = '';
    }

    if (state.currentSection === 'dashboard') {
      requestAnimationFrame(drawRevenueChart);
    }
  });

  if (sidebarClose) {
    sidebarClose.addEventListener('click', () => setMobileNavOpen(false));
  }
  if (sidebarBackdrop) {
    sidebarBackdrop.addEventListener('click', () => setMobileNavOpen(false));
  }
  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', () => setMobileNavOpen(true));
  }
  if (mobileMenuButton) {
    mobileMenuButton.addEventListener('click', () => setMobileNavOpen(true));
  }
  // initial badge update
  updateNotificationBadge();

  document.getElementById('themeToggle')?.addEventListener('click', async () => {
    state.theme = applyTheme(state.theme === 'dark' ? 'light' : 'dark');
    try {
      await saveThemePreference(initStorage().db, state.user.uid, state.theme);
    } catch (error) {
      createToast('Theme changed on this device, but could not sync to your account.', 'warning');
    }
  });

  document.getElementById('supportButton')?.addEventListener('click', () => {
    openSection('help');
  });
  document.getElementById('notificationsToggle').addEventListener('click', () => {
    // mark all notifications read and open the notifications section
    (state.data.notifications || []).forEach(n => { n.read = true; });
    updateNotificationBadge();
    openSection && openSection('notifications');
  });
  document.getElementById('messagesButton').addEventListener('click', () => openAdminMessageSession());
  const adminLogout = async () => {
    const { auth } = initStorage();
    try {
      if (auth) {
        await auth.signOut();
      }
    } catch (error) {
      console.warn('[Manna Marketplace] Admin logout warning:', error);
    } finally {
      clearStoredAuthState();
      createToast('You have been logged out.', 'warning');
      window.location.assign(window.location.pathname);
    }
  };
  document.getElementById('logoutButton').addEventListener('click', adminLogout);

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeModal();
    }
  });

  const onboardingOverlay = document.getElementById('onboardingOverlay');
  const closeOnboarding = document.getElementById('closeOnboarding');
  if (closeOnboarding) {
    closeOnboarding.addEventListener('click', () => {
      if (onboardingOverlay) {
        onboardingOverlay.classList.add('hidden');
        onboardingOverlay.setAttribute('aria-hidden', 'true');
      }
      localStorage.setItem('manna-onboarding-seen-admin', 'true');
    });
  }
  if (onboardingOverlay && !localStorage.getItem('manna-onboarding-seen-admin')) {
    onboardingOverlay.classList.remove('hidden');
    onboardingOverlay.setAttribute('aria-hidden', 'false');
  }

  globalSearch.addEventListener('input', (event) => {
    const query = event.target.value.trim().toLowerCase();
    if (!query) {
      searchResults.innerHTML = '';
      searchResults.classList.remove('open');
      return;
    }
    const matches = [];
    matches.push(...state.data.products.filter((item) => [item.name, item.category, ...(item.searchKeywords || [])].join(' ').toLowerCase().includes(query)).map((item) => ({ label: `${item.name} • Product`, href: '#', type: 'product' })));
    matches.push(...state.data.sellers.filter((item) => `${item.name} ${item.location}`.toLowerCase().includes(query)).map((item) => ({ label: `${item.name} • Seller`, href: '#', type: 'seller' })));
    matches.push(...state.data.customers.filter((item) => `${item.name} ${item.email}`.toLowerCase().includes(query)).map((item) => ({ label: `${item.name} • Customer`, href: '#', type: 'customer' })));
    matches.push(...state.data.orders.filter((item) => `${item.orderNumber} ${item.customerName}`.toLowerCase().includes(query)).map((item) => ({ label: `${item.orderNumber} • Order`, href: '#', type: 'order' })));
    searchResults.innerHTML = matches.slice(0, 6).map((item) => `<a class="search-result" href="#">${escapeHtml(item.label)}</a>`).join('');
    searchResults.classList.toggle('open', matches.length > 0);
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.search-wrap')) {
      searchResults.classList.remove('open');
    }
  });
}

function clearAdminMessageSession() {
  if (state.ui.adminSessionUnsubscribe) {
    state.ui.adminSessionUnsubscribe();
    state.ui.adminSessionUnsubscribe = null;
  }
  state.ui.adminSessionMessages = [];
  state.ui.adminSessionId = null;
}

function renderAdminMessageSession() {
  const container = document.getElementById('adminSessionMessages');
  if (!container) return;

  if (!state.ui.adminSessionMessages.length) {
    container.innerHTML = '<div class="empty-state">No messages yet. Start the conversation.</div>';
    return;
  }

  container.innerHTML = state.ui.adminSessionMessages.map((message) => {
    const isMine = message.senderUid === state.user.uid;
    const timeLabel = message.createdAt ? new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    return `
      <div style="display:flex; justify-content:${isMine ? 'flex-end' : 'flex-start'};">
        <div style="max-width: 78%; padding: 10px 12px; border-radius: 12px; background: ${isMine ? 'rgba(249, 115, 22, 0.16)' : 'rgba(255, 255, 255, 0.06)'}; border: 1px solid ${isMine ? 'rgba(249, 115, 22, 0.28)' : 'rgba(255,255,255,0.1)'}; color: var(--text-main);">
          <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 4px;">${escapeHtml(message.senderName || (isMine ? 'You' : 'Admin session'))}${timeLabel ? ` • ${escapeHtml(timeLabel)}` : ''}</div>
          <div>${escapeHtml(message.text || '')}</div>
        </div>
      </div>
    `;
  }).join('');

  container.scrollTop = container.scrollHeight;
}

async function openAdminMessageSession() {
  const { db, ready } = initStorage();
  if (!ready || !db) {
    createToast('local storage is unavailable right now. The live admin session could not be opened.', 'error');
    return;
  }

  clearAdminMessageSession();
  const sessionId = `admin-${state.user.uid || 'admin'}`;
  state.ui.adminSessionId = sessionId;

  await db.collection('adminSessions').doc(sessionId).set({
    sessionId,
    panel: 'admin',
    title: 'Admin message session',
    participantUid: state.user.uid || 'admin',
    participantName: state.user.displayName || 'Admin',
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date()
  }, { merge: true });

  openModal('Admin Message Session', `
    <div style="display: flex; flex-direction: column; gap: 12px; min-height: 380px;">
      <div style="padding: 10px 12px; border: 1px solid var(--border-color); border-radius: 12px; background: rgba(255,255,255,0.03); color: var(--text-muted);">
        Live session for <strong>${escapeHtml(state.user.displayName || 'Admin')}</strong>. Messages sync instantly.
      </div>
      <div id="adminSessionMessages" style="max-height: 280px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding-right: 4px;"></div>
      <form id="adminSessionForm" style="display: flex; gap: 8px;">
        <input id="adminSessionInput" type="text" maxlength="500" placeholder="Type a message..." style="flex: 1; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--border-color); background: rgba(255,255,255,0.04); color: var(--text-main);" />
        <button class="primary-btn" type="submit">Send</button>
      </form>
    </div>
  `);

  const sessionRef = db.collection('adminSessions').doc(sessionId).collection('messages');
  state.ui.adminSessionUnsubscribe = sessionRef.orderBy('createdAt', 'asc').onSnapshot((snapshot) => {
    state.ui.adminSessionMessages = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt
      };
    });
    renderAdminMessageSession();
  }, (error) => {
    console.error('[Manna Marketplace] Admin message session listener failed:', error);
    createToast('The live session is temporarily unavailable.', 'warning');
  });

  document.getElementById('adminSessionForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = document.getElementById('adminSessionInput');
    const text = input.value.trim();
    if (!text) return;

    try {
      await sessionRef.add({
        sessionId,
        text,
        senderUid: state.user.uid || 'admin',
        senderName: state.user.displayName || 'Admin',
        senderRole: 'admin',
        createdAt: new Date(),
        updatedAt: new Date(),
        read: false,
        isDeleted: false
      });
      input.value = '';
    } catch (error) {
      createToast(error.message || 'Unable to send the message.', 'error');
    }
  });
}

function openSupportModal() {
  openModal('Need help?', `
    <form id="supportForm" class="form-grid" style="padding: 8px 0;">
      <label>Topic<select name="category">
        <option value="account">Account</option>
        <option value="orders">Orders</option>
        <option value="payments">Payments</option>
        <option value="bug">Bug</option>
        <option value="other">Other</option>
      </select></label>
      <label>Message<textarea name="message" required placeholder="Tell us what you need help with."></textarea></label>
      <label>Email<input name="email" value="${escapeHtml(state.user.email || '')}" /></label>
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
      panel: 'admin',
      category: String(data.get('category') || 'other'),
      subject: String(data.get('category') || 'Support request'),
      message: String(data.get('message') || '').trim(),
      email: String(data.get('email') || state.user.email || '').trim(),
      userId: state.user.uid || '',
      status: 'new',
      createdAt: new Date().toISOString()
    };

    if (!payload.message) {
      createToast('Please describe your issue before sending.', 'warning');
      return;
    }

    try {
      await addDocument('supportRequests', payload);
      createToast('Support request sent. Our team will follow up shortly.', 'success');
      closeModal();
    } catch (error) {
      createToast(error.message || 'Unable to send support request.', 'error');
    }
  });
  document.getElementById('cancelSupport').addEventListener('click', closeModal);
}

function openSection(section) {
  state.currentSection = section;
  setActiveNavigation(section);
  setMobileNavOpen(false);
  const titles = {
    dashboard: 'Dashboard',
    products: 'Master Products',
    sellers: 'Sellers',
    customers: 'Customers',
    delivery: 'Delivery Persons',
    orders: 'Orders',
    analytics: 'Analytics',
    reports: 'Reports',
    coupons: 'Coupons',
    announcements: 'Announcements',
    notifications: 'Notifications',
    settings: 'Settings',
    logs: 'System Logs',
    financials: 'Financial Settlements',
    'international-products': 'International Products',
    'signup-rewards': 'Signup Rewards',
    'admin-wallet': '👑 Admin Wallet - Premium',
    wallet: 'Wallet Management',
    help: 'Help Center'
  };
  pageTitle.textContent = titles[section] || 'Overview';
  breadcrumb.textContent = `Home / ${pageTitle.textContent}`;
  renderSection(section);
}

function renderSection(section) {
  switch (section) {
    case 'dashboard':
      renderDashboard();
      break;
    case 'products':
      renderProducts();
      break;
    case 'sellers':
      renderSellers();
      break;
    case 'customers':
      renderCustomers();
      break;
    case 'delivery':
      renderDelivery();
      break;
    case 'orders':
      renderOrders();
      break;
    case 'analytics':
      renderAnalytics();
      break;
    case 'reports':
      renderReports();
      break;
    case 'coupons':
      renderCoupons();
      break;
    case 'announcements':
      renderAnnouncements();
      break;
    case 'notifications':
      renderNotifications();
      break;
    case 'settings':
      renderSettings();
      break;
    case 'logs':
      renderLogs();
      break;
    case 'financials':
      renderFinancials();
      break;
    case 'international-products':
      renderInternationalProducts();
      break;
    case 'signup-rewards':
      renderSignupBlindBoxCampaign();
      break;
    case 'admin-wallet':
      renderAdminWallet();
      break;
    case 'wallet':
      renderWalletManagement();
      break;
    case 'help':
      renderHelpCenter();
      break;
    default:
      renderDashboard();
  }
}

function getDashboardMetrics() {
  const activeProducts = state.data.products.filter((item) => item.status === 'active' && !item.isDeleted).length;
  const activeSellers = state.data.sellers.filter((item) => item.status === 'approved' && !item.isDeleted).length;
  const activeCustomers = state.data.customers.filter((item) => item.status === 'active' && !item.isDeleted).length;
  const activeDelivery = state.data.delivery.filter((item) => item.status === 'approved' && !item.isDeleted).length;
  const pendingSellers = state.data.sellers.filter((item) => item.status === 'pending' && !item.isDeleted).length;
  const pendingReports = state.data.reports.filter((item) => item.status === 'pending').length;
  const unreadNotifications = state.data.notifications.filter((item) => !item.read).length;
  const revenue = state.data.orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const completedOrders = state.data.orders.filter((item) => item.status === 'completed').length;
  const cancelledOrders = state.data.orders.filter((item) => item.status === 'cancelled').length;

  return {
    sellers: { key: 'sellers', title: 'Active Sellers', value: activeSellers, meta: 'approved', badge: 'Live', accent: false, icon: 'store' },
    customers: { key: 'customers', title: 'Active Customers', value: activeCustomers, meta: 'retained', badge: 'Stable', accent: false, icon: 'users' },
    delivery: { key: 'delivery', title: 'Active Riders', value: activeDelivery, meta: 'on route', badge: 'Busy', accent: false, icon: 'delivery' },
    orders: { key: 'orders', title: 'Orders', value: state.data.orders.length, meta: 'all time', badge: 'Flow', accent: false, icon: 'orders' },
    revenue: { key: 'revenue', title: 'Revenue', value: formatCurrency(revenue), meta: 'this week', badge: 'Growth', accent: true, icon: 'revenue' },
    reports: { key: 'reports', title: 'Pending Reports', value: pendingReports, meta: 'unresolved', badge: 'Priority', accent: false, icon: 'reports' },
    products: { key: 'products', title: 'Active Products', value: activeProducts, meta: 'catalog', badge: 'Fresh', accent: false, icon: 'products' },
    notifications: { key: 'notifications', title: 'Unread Alerts', value: unreadNotifications, meta: 'new activity', badge: 'Updates', accent: false, icon: 'alerts' },
    completed: { key: 'completed', title: 'Completed Orders', value: completedOrders, meta: 'fulfilled', badge: 'On time', accent: false, icon: 'check' },
    cancelled: { key: 'cancelled', title: 'Cancelled Orders', value: cancelledOrders, meta: 'rework', badge: 'Risk', accent: false, icon: 'alert' },
    pendingSellers: { key: 'pendingSellers', title: 'Pending Sellers', value: pendingSellers, meta: 'review', badge: 'Needs review', accent: false, icon: 'review' }
  };
}

function renderMetricIcon(iconName) {
  const icons = {
    store: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 10.5L12 3l9 7.5"/><path d="M5 10.5V20h14v-9.5"/><path d="M9 20v-6h6v6"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M16 19v-1a3 3 0 00-3-3H7a3 3 0 00-3 3v1"/><circle cx="10" cy="7" r="3"/><path d="M17 8a2 2 0 100 4 2 2 0 000-4zm4 10v-1a2 2 0 00-2-2"/></svg>',
    delivery: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="6" width="10" height="8" rx="2"/><path d="M13 10h4l3 3v3h-2"/><circle cx="8" cy="17" r="2"/><circle cx="18" cy="17" r="2"/></svg>',
    orders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
    revenue: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 19V9"/><path d="M12 19V5"/><path d="M19 19v-7"/></svg>',
    reports: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 4h10l2 2v13l-2 2H7l-2-2V6l2-2z"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>',
    products: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7l8-3 8 3v10l-8 3-8-3z"/><path d="M4 7l8 3 8-3"/><path d="M12 10v11"/></svg>',
    alerts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 4a5 5 0 00-5 5v3l-1 2h12l-1-2V9a5 5 0 00-5-5z"/><path d="M10 18a2 2 0 104 0"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 12l4 4 10-10"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 4l8 14H4L12 4z"/><path d="M12 9v4"/><path d="M12 15h.01"/></svg>',
    review: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 7h8M8 12h8M8 17h5"/><path d="M4 4h16v16H4z"/></svg>'
  };
  return icons[iconName] || icons.store;
}

function renderMetricCard(metric) {
  return `
      <article class="metric-card ${metric.accent ? 'accent-card' : ''}" data-metric-key="${metric.key}">
        <div class="metric-top">
          <div class="metric-icon">${renderMetricIcon(metric.icon)}</div>
          <span class="metric-badge">${escapeHtml(metric.badge)}</span>
        </div>
        <div class="metric-number">${escapeHtml(metric.value)}</div>
        <div class="metric-title">${escapeHtml(metric.title)}</div>
        <div class="metric-meta">${escapeHtml(metric.meta)}</div>
      </article>
    `;
}

function renderEmptyState(title, description) {
  return `
      <div class="empty-state fade-in">
        <img src="./images/placeholders/empty-state.svg" alt="" class="empty-icon" />
        <h3 class="empty-title">${escapeHtml(title)}</h3>
        <p class="empty-description">${escapeHtml(description)}</p>
      </div>
    `;
}

function getOrderTimestamp(order) {
  if (!order?.createdAt) return null;
  const createdAt = order.createdAt;
  if (typeof createdAt?.toDate === 'function') return createdAt.toDate();
  const parsed = createdAt?.seconds ? new Date(createdAt.seconds * 1000) : new Date(createdAt);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getDateKey(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function getRevenueSeries() {
  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const values = labels.map((label, index) => {
    const day = new Date();
    day.setDate(day.getDate() - (labels.length - 1 - index));
    const key = day.toISOString().slice(0, 10);
    const total = state.data.orders
      .filter((order) => getDateKey(order.createdAt) === key)
      .reduce((sum, order) => sum + Number(order.total || 0), 0);
    return { label, value: total };
  });
  return values;
}

function drawRevenueChart() {
  const canvas = document.getElementById('revenueChart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const width = canvas.clientWidth || 420;
  const height = canvas.clientHeight || 220;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, width, height);
  const padding = { top: 24, right: 16, bottom: 36, left: 16 };
  const values = getRevenueSeries();
  const maxValue = Math.max(...values.map((value) => value.value), 1);
  const stepX = (width - padding.left - padding.right) / Math.max(values.length - 1, 1);

  state.ui.chartPoints = values.map((point, index) => {
    const x = padding.left + index * stepX;
    const y = height - padding.bottom - (point.value / maxValue) * (height - padding.top - padding.bottom);
    return { ...point, x, y };
  });

  ctx.beginPath();
  state.ui.chartPoints.forEach((point, index) => {
    if (index === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  });
  ctx.lineTo(width - padding.right, height - padding.bottom);
  ctx.lineTo(padding.left, height - padding.bottom);
  ctx.closePath();

  const fill = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
  fill.addColorStop(0, 'rgba(249, 115, 22, 0.28)');
  fill.addColorStop(1, 'rgba(249, 115, 22, 0.02)');
  ctx.fillStyle = fill;
  ctx.fill();

  ctx.beginPath();
  state.ui.chartPoints.forEach((point, index) => {
    if (index === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  });
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#f97316';
  ctx.lineWidth = 2.2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();

  state.ui.chartPoints.forEach((point) => {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(point.x, point.y, 6.5, 0, Math.PI * 2);
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#f97316';
    ctx.stroke();
  });

  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i += 1) {
    const y = padding.top + ((height - padding.top - padding.bottom) / 3) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
  }
}

function buildAnalyticsSnapshot() {
  const windowOrders = state.data.orders.filter((order) => {
    const createdAt = getOrderTimestamp(order);
    if (!createdAt) return false;
    const range = state.filters.analytics.range || 'month';
    if (range === 'day') {
      const windowStart = Date.now() - 24 * 60 * 60 * 1000;
      return createdAt.getTime() >= windowStart;
    }
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    return createdAt >= startOfMonth;
  }).filter((order) => {
    if (state.filters.analytics.sellerId === 'all') return true;
    return String(order.sellerId || order.sellerName || '') === state.filters.analytics.sellerId;
  });

  const completed = windowOrders.filter((order) => ['completed', 'delivered', 'received'].includes(order.status));
  const refunded = windowOrders.filter((order) => {
    const refundStatus = String(order.refundStatus || '').toLowerCase();
    return ['requested', 'approved', 'rejected', 'confirmed', 'processed'].includes(refundStatus) || order.refundRequested || ['refund_approved', 'refunded'].includes(order.status);
  });
  const revenue = completed.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const refunds = refunded.reduce((sum, order) => sum + Number(order.refundAmount || order.total || 0), 0);
  const netCashflow = revenue - refunds;
  const purchaseCount = completed.length;
  const refundRate = purchaseCount ? (refunded.length / purchaseCount) * 100 : 0;
  const averageOrder = purchaseCount ? revenue / purchaseCount : 0;

  const series = state.filters.analytics.range === 'day'
    ? Array.from({ length: 24 }, (_, index) => {
      const bucketDate = new Date(Date.now() - (23 - index) * 60 * 60 * 1000);
      const bucketOrders = windowOrders.filter((order) => {
        const createdAt = getOrderTimestamp(order);
        return createdAt && createdAt.getHours() === bucketDate.getHours() && createdAt.getDate() === bucketDate.getDate();
      });
      const bucketRevenue = bucketOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
      return { label: `${String(bucketDate.getHours()).padStart(2, '0')}:00`, value: bucketRevenue };
    })
    : Array.from({ length: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate() }, (_, index) => {
      const day = index + 1;
      const bucketOrders = windowOrders.filter((order) => {
        const createdAt = getOrderTimestamp(order);
        return createdAt && createdAt.getDate() === day;
      });
      const bucketRevenue = bucketOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
      return { label: `${day}`, value: bucketRevenue };
    });

  return {
    orders: windowOrders,
    completed,
    refunded,
    revenue,
    refunds,
    netCashflow,
    purchaseCount,
    refundRate,
    averageOrder,
    series
  };
}

function renderDashboard() {
  state.adminMetrics = getDashboardMetrics();
  const metrics = Object.values(state.adminMetrics);
  const pendingReports = state.data.reports.filter((item) => item.status === 'pending');
  const supportRequests = state.data.supportRequests.slice(0, 5);

  content.innerHTML = `
      <section class="dashboard-shell">
        <div class="dashboard-hero">
          <div>
            <p class="eyebrow">Operations Overview</p>
            <h3 class="heading-3">Premium command center for sellers, orders, and growth.</h3>
            <p class="body-medium">Monitor performance in real time with live local database updates and executive-friendly analytics.</p>
          </div>
          <div class="hero-badge">Live • ${state.data.orders.length} orders tracked</div>
        </div>

        <div class="metric-grid">
          ${metrics.slice(0, 8).map((metric) => renderMetricCard(metric)).join('')}
        </div>

        <div class="dashboard-grid">
          <section class="chart-card">
            <div class="panel-card-header">
              <div>
                <h3 class="heading-4">Revenue Trend</h3>
                <p class="body-small">Weekly revenue overview</p>
              </div>
              <span class="metric-badge">Live</span>
            </div>
            <div class="chart-container">
              <canvas id="revenueChart" width="100%" height="220"></canvas>
              <div id="chartTooltip" class="chart-tooltip hidden"></div>
            </div>
          </section>

          <section class="panel-card">
            <div class="panel-card-header">
              <div>
                <h3 class="heading-4">Top Sellers</h3>
                <p class="body-small">Highest volume</p>
              </div>
            </div>
            <div class="stack">
              ${state.data.sellers.slice(0, 4).map((seller) => `
                <div class="list-row">
                  <span>${escapeHtml(seller.name)}</span>
                  <span class="metric-badge">${escapeHtml(seller.status || 'approved')}</span>
                </div>
              `).join('')}
            </div>
          </section>
        </div>

        <div class="dashboard-grid">
          <section class="panel-card">
            <div class="panel-card-header">
              <div>
                <h3 class="heading-4">Recent Activity</h3>
                <p class="body-small">Latest orders and fulfilment events</p>
              </div>
            </div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Total</th></tr></thead>
                <tbody>
                  ${state.data.orders.slice(0, 6).map((order) => `
                    <tr>
                      <td>${escapeHtml(order.orderNumber || order.id)}</td>
                      <td>${escapeHtml(order.customerName || 'Customer')}</td>
                      <td><span class="metric-badge">${escapeHtml(order.status || 'pending')}</span></td>
                      <td>${formatCurrency(order.total || 0)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </section>

          <section class="panel-card">
            <div class="panel-card-header">
              <div>
                <h3 class="heading-4">Recent Reports</h3>
                <p class="body-small">Needs attention</p>
              </div>
            </div>
            ${pendingReports.length ? pendingReports.slice(0, 4).map((report) => `
              <div class="list-row report-row">
                <div>
                  <strong>${escapeHtml(report.reason || 'Report')}</strong>
                  <div class="body-small">${escapeHtml(report.customerName || 'Customer')} • ${escapeHtml(report.sellerName || 'Seller')}</div>
                </div>
                <span class="metric-badge">${escapeHtml(report.priority || 'high')}</span>
              </div>
            `).join('') : renderEmptyState('No unresolved reports', 'All reports have been resolved. Stay tuned.')}
          </section>
        </div>

        <div class="dashboard-grid">
          <section class="panel-card">
            <div class="panel-card-header">
              <div>
                <h3 class="heading-4">Support Queue</h3>
                <p class="body-small">Help requests from customers, sellers, and riders.</p>
              </div>
            </div>
            ${supportRequests.length ? supportRequests.map((request) => `
              <div class="list-row">
                <div>
                  <strong>${escapeHtml(request.subject || request.message || 'Support request')}</strong>
                  <div class="body-small">${escapeHtml(request.panel || 'panel')} • ${escapeHtml(request.email || request.userEmail || 'Unknown')}</div>
                </div>
                <span class="metric-badge">${escapeHtml(request.status || 'new')}</span>
              </div>
            `).join('') : renderEmptyState('No support requests yet', 'New help requests will appear here instantly.')}
          </section>
        </div>
      </section>
    `;

  requestAnimationFrame(() => {
    drawRevenueChart();
    content.querySelectorAll('.metric-card').forEach((card, index) => {
      card.style.animationDelay = `${index * 60}ms`;
      card.classList.add('fade-in');
    });

    const chartCanvas = document.getElementById('revenueChart');
    const tooltip = document.getElementById('chartTooltip');
    if (chartCanvas && tooltip) {
      chartCanvas.addEventListener('mousemove', (event) => {
        const rect = chartCanvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const points = state.ui.chartPoints;
        const closest = points.reduce((previous, point) => {
          const previousDistance = Math.abs(previous.x - x);
          const currentDistance = Math.abs(point.x - x);
          return currentDistance < previousDistance ? point : previous;
        }, points[0] || { x: 0, y: 0 });

        const tooltipContent = `${escapeHtml(closest.label || '')}: ${formatCurrency(closest.value || 0)}`;
        tooltip.innerHTML = tooltipContent;
        tooltip.classList.remove('hidden');
        tooltip.style.left = `${closest.x}px`;
        tooltip.style.top = `${closest.y - 8}px`;
      });
      chartCanvas.addEventListener('mouseleave', () => tooltip.classList.add('hidden'));
    }
  });

  updateNotificationBadge();
}

function formatCampaignDateInput(value, fallback) {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : fallback;
}

function renderSignupBlindBoxCampaign() {
  const campaign = state.data.signupBlindBoxCampaign || {};
  const claims = [...(Array.isArray(campaign.claims) ? campaign.claims : [])].sort((first, second) => Number(first.slotNumber || 0) - Number(second.slotNumber || 0));
  const internationalProducts = state.data.internationalProducts.filter((item) => !item.isDeleted && item.status === 'active');
  const configuredProducts = Array.isArray(campaign.products) ? campaign.products : [];
  const awardedCount = Number(campaign.awardedCount || 0);
  const today = new Date().toISOString().slice(0, 10);
  const startsAt = formatCampaignDateInput(campaign.startsAt, today);
  const endsAt = formatCampaignDateInput(campaign.endsAt, today);
  const customerLimit = Number(campaign.customerLimit || campaign.winnerLimit || 25);
  const activeSessionInWindow = campaign.status === 'active' && endsAt >= today;
  const isLocked = activeSessionInWindow;
  const productChoices = Array.from({ length: 4 }, (_, index) => {
    const configured = configuredProducts[index] || {};
    const productOptions = internationalProducts.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === (configured.internationalProductId || configured.id) ? 'selected' : ''}>${escapeHtml(item.name)} (${formatCurrency(item.wholesalePrice || 0, item.currency || 'USD')})</option>`).join('');
    return `<div class="form-grid"><label>Blind box ${index + 1}<select name="rewardProduct${index}" ${isLocked ? 'disabled' : ''} required><option value="">Choose an active international product</option>${productOptions}</select></label><label>Reward quantity<input name="rewardQuantity${index}" type="number" min="1" step="1" value="${Number(configured.quantity || 1)}" ${isLocked ? 'disabled' : ''} required /></label></div>`;
  }).join('');
  const totalStock = configuredProducts.reduce((sum, item) => sum + Number(item.remainingQuantity ?? item.quantity ?? 0), 0);
  const rewardDeliveryFee = Number(campaign.deliveryFee || state.data.settings.regularDeliveryFee || state.data.settings.deliveryFee || 60);
  content.innerHTML = `
    <section class="card">
      <div class="card-header"><div><h3 class="card-title">Customer Reward Sessions</h3><p class="card-subtitle">Set a date window and customer limit for each session. A customer can claim only once across all sessions.</p></div><span class="badge">${awardedCount} / ${customerLimit} assigned</span></div>
      <div class="stack">
        <div class="panel-card"><strong>Current session: ${escapeHtml(campaign.status || 'not configured')}</strong><div class="muted">${escapeHtml(startsAt)} through ${escapeHtml(endsAt)} · Reward stock remaining: ${totalStock}</div><div class="muted">Delivery credits paid: ${formatCurrency(Number(campaign.deliveryFeesPaid || 0), 'LRD')} · Customers who claimed in any earlier session are permanently excluded.</div></div>
        ${internationalProducts.length < 4 ? '<div class="empty-state">Create at least four active International Products before configuring the blind boxes.</div>' : `
        <form id="signupBlindBoxCampaignForm" class="stack">
          <div class="form-grid"><label>Session starts<input name="startsAt" type="date" value="${escapeHtml(startsAt)}" ${isLocked ? 'disabled' : ''} required /></label><label>Session ends<input name="endsAt" type="date" value="${escapeHtml(endsAt)}" ${isLocked ? 'disabled' : ''} required /></label><label>New customer limit<input name="customerLimit" type="number" min="1" max="1000" step="1" value="${customerLimit}" ${isLocked ? 'disabled' : ''} required /></label></div>
          ${productChoices}
          <div class="action-row">
            <button class="secondary-btn" type="submit" ${isLocked ? 'disabled' : ''}>Save product choices</button>
            <button class="primary-btn" type="button" id="activateSignupBlindBox" ${activeSessionInWindow || !configuredProducts.length ? 'disabled' : ''}>Start session for ${customerLimit} new customers</button>
            ${campaign.status === 'active' ? '<button class="ghost-btn" type="button" id="pauseSignupBlindBox">Pause session</button>' : ''}
          </div>
          <div class="muted">Choose four different products. Combined reward quantity must cover the customer limit. Sessions can only be activated during their date window.</div>
        </form>`}
      </div>
    </section>
    <section class="card">
      <div class="card-header"><div><h3 class="card-title">Customer Claims</h3><p class="card-subtitle">Live claim and delivery status.</p></div></div>
      ${claims.length ? `<div class="table-wrap"><table><thead><tr><th>Slot</th><th>Customer</th><th>Reward</th><th>Status</th><th>Order</th></tr></thead><tbody>${claims.map((claim) => `<tr><td>${Number(claim.slotNumber || 0)}</td><td>${escapeHtml(claim.customerName || claim.customerEmail || claim.customerUid || '')}</td><td>${escapeHtml(claim.selectedProductName || 'Not selected')}</td><td>${escapeHtml(claim.status || 'eligible')}</td><td>${escapeHtml(claim.orderId || '')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">No customer claims yet.</div>'}
    </section>`;

  document.getElementById('signupBlindBoxCampaignForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (isLocked) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const customerLimit = Number(data.get('customerLimit') || 0);
    const startsAt = String(data.get('startsAt') || '');
    const endsAt = String(data.get('endsAt') || '');
    const chosenIds = Array.from({ length: 4 }, (_, index) => String(data.get(`rewardProduct${index}`) || ''));
    const quantities = Array.from({ length: 4 }, (_, index) => Number(data.get(`rewardQuantity${index}`) || 0));
    if (!startsAt || !endsAt || startsAt > endsAt || !Number.isInteger(customerLimit) || customerLimit < 1 || customerLimit > 1000) {
      createToast('Choose a valid date range and a customer limit from 1 to 1,000.', 'warning');
      return;
    }
    if (chosenIds.some((id) => !id) || new Set(chosenIds).size !== 4) {
      createToast('Choose four different active international products.', 'warning');
      return;
    }
    if (quantities.some((quantity) => !Number.isInteger(quantity) || quantity < 1) || quantities.reduce((sum, quantity) => sum + quantity, 0) < customerLimit) {
      createToast('Set whole-number quantities that cover the customer limit.', 'warning');
      return;
    }
    const products = chosenIds.map((id, index) => {
      const offer = internationalProducts.find((item) => item.id === id);
      const master = state.data.products.find((item) => item.id === offer?.masterProductId);
      const image = master?.imageFilename || master?.image || master?.imageUrl || '';
      return {
        id,
        internationalProductId: id,
        masterProductId: offer?.masterProductId || '',
        name: offer?.name || 'Reward product',
        image,
        imageFilename: image,
        quantity: quantities[index],
        remainingQuantity: quantities[index],
        claimedQuantity: 0
      };
    });
    try {
      const app = window.firebase.app('manna-marketplace-data');
      const manageCampaign = window.firebase.functions(app).httpsCallable('manageSignupBlindBoxCampaign');
      await manageCampaign({ action: 'save', products, startsAt, endsAt, customerLimit });
      createToast('Reward session settings saved.', 'success');
    } catch (error) {
      createToast(error.message || 'Unable to save blind-box choices.', 'error');
    }
  });
  document.getElementById('activateSignupBlindBox')?.addEventListener('click', async () => {
    const currentCampaign = state.data.signupBlindBoxCampaign || {};
    if (!Array.isArray(currentCampaign.products) || currentCampaign.products.length !== 4
      || currentCampaign.products.reduce((sum, item) => sum + Number(item.remainingQuantity ?? item.quantity ?? 0), 0) < Number(currentCampaign.customerLimit || currentCampaign.winnerLimit || 25)) {
      createToast('Reward stock must cover the configured customer limit.', 'warning');
      return;
    }
    try {
      const app = window.firebase.app('manna-marketplace-data');
      const manageCampaign = window.firebase.functions(app).httpsCallable('manageSignupBlindBoxCampaign');
      await manageCampaign({ action: 'activate' });
      createToast('New reward session is active.', 'success');
    } catch (error) {
      createToast(error.message || 'Unable to activate the campaign.', 'error');
    }
  });
  document.getElementById('pauseSignupBlindBox')?.addEventListener('click', async () => {
    try {
      const app = window.firebase.app('manna-marketplace-data');
      const manageCampaign = window.firebase.functions(app).httpsCallable('manageSignupBlindBoxCampaign');
      await manageCampaign({ action: 'pause' });
      createToast('New signup awards are paused. Existing claims remain valid.', 'success');
    } catch (error) {
      createToast(error.message || 'Unable to pause the campaign.', 'error');
    }
  });
}

function renderInternationalProducts() {
  const products = state.data.internationalProducts.filter((item) => !item.isDeleted);
  const masterProductsById = new Map(state.data.products.map((product) => [product.id, product]));
  content.innerHTML = `
    <section class="card">
      <div class="card-header"><div><h3 class="card-title">International Products</h3><p class="card-subtitle">Create seller-only wholesale offers from the master catalog.</p></div><button class="primary-btn" id="addInternationalProduct">Add International Product</button></div>
      ${products.length ? `<div class="product-grid">${products.map((item, index) => {
        const masterProduct = masterProductsById.get(item.masterProductId);
        const imageValue = item.imageFilename || item.image || masterProduct?.imageFilename || masterProduct?.image || '';
        const imageUrl = getImageUrl(imageValue);
        return `<article class="product-card"><img src="./images/placeholder.png" data-mobile-loader data-mobile-src="${escapeHtml(getProductThumbnailUrl(imageValue))}" data-full-src="${escapeHtml(imageUrl)}" loading="${index < 4 ? 'eager' : 'lazy'}" fetchpriority="${index < 2 ? 'high' : 'auto'}" decoding="async" alt="${escapeHtml(item.name)}" /><h4>${escapeHtml(item.name)}</h4>${renderExpandableDescription(item.description || '')}<p>Source master product: ${escapeHtml(item.masterProductId)}</p><p>Wholesale: ${formatCurrency(item.wholesalePrice || 0, item.currency || 'USD')}</p><p>Minimum quantity: ${Number(item.minimumQuantity || 1)}</p><div class="product-actions"><button class="secondary-btn edit-international-product" data-id="${escapeHtml(item.id)}">Edit</button><button class="ghost-btn delete-international-product" data-id="${escapeHtml(item.id)}">Disable</button></div></article>`;
      }).join('')}</div>` : '<div class="empty-state">No international products yet.</div>'}
    </section>`;
  document.getElementById('addInternationalProduct')?.addEventListener('click', () => openInternationalProductModal());
  document.querySelectorAll('.edit-international-product').forEach((button) => button.addEventListener('click', () => openInternationalProductModal(button.dataset.id)));
  document.querySelectorAll('.delete-international-product').forEach((button) => button.addEventListener('click', async () => {
    await updateDocument('internationalProducts', button.dataset.id, { isDeleted: true, status: 'inactive', updatedAt: new Date().toISOString() });
  }));
}

function walletDate(value) {
  const date = value?.toDate ? value.toDate() : new Date(value || 0);
  return Number.isNaN(date.getTime()) ? 'Pending' : formatDate(date);
}

function renderWalletManagement() {
  content.innerHTML = `<section class="card"><div class="card-header"><div><h3 class="card-title">Wallet Management</h3><p class="card-subtitle">Review deposits, process withdrawals, and configure wallet deposits.</p></div></div><form id="walletConfigForm" class="form-grid"><label>Admin mobile money name<input name="adminMobileName" value="" /></label><label>Admin mobile money number<input name="adminMobileNumber" value="" /></label><label class="full">Deposit instructions<textarea name="depositNote"></textarea></label><button class="primary-btn" type="submit">Save wallet settings</button></form><div class="wallet-admin-tabs"><button class="filter-tab active" data-wallet-tab="deposits" type="button">Deposit Requests</button><button class="filter-tab" data-wallet-tab="withdrawals" type="button">Withdrawal Requests</button></div><div id="adminDepositRequests"></div><div id="adminWithdrawalRequests" class="hidden"></div></section>`;
  loadAdminWalletConfig();
  renderAdminDepositRequests();
  renderAdminWithdrawalRequests();
  document.querySelectorAll('[data-wallet-tab]').forEach((button) => button.addEventListener('click', () => {
    document.querySelectorAll('[data-wallet-tab]').forEach((tab) => tab.classList.toggle('active', tab === button));
    document.getElementById('adminDepositRequests')?.classList.toggle('hidden', button.dataset.walletTab !== 'deposits');
    document.getElementById('adminWithdrawalRequests')?.classList.toggle('hidden', button.dataset.walletTab !== 'withdrawals');
  }));
  document.getElementById('walletConfigForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    const data = Object.fromEntries(new FormData(event.currentTarget));
    withButtonState(button, async () => { await initStorage().db.collection('appConfig').doc('wallet').set({ adminMobileName: String(data.adminMobileName || '').trim(), adminMobileNumber: String(data.adminMobileNumber || '').trim(), depositNote: String(data.depositNote || '').trim(), currency: 'LRD', updatedAt: new Date() }, { merge: true }); }, { loadingText: 'Saving...', successText: 'Saved', permanent: false });
  });
}

async function loadAdminWalletConfig() {
  const config = await loadWalletConfig();
  const form = document.getElementById('walletConfigForm');
  if (!form) return;
  form.elements.adminMobileName.value = config.adminMobileName || '';
  form.elements.adminMobileNumber.value = config.adminMobileNumber || '';
  form.elements.depositNote.value = config.depositNote || '';
}

function renderAdminDepositRequests() {
  const container = document.getElementById('adminDepositRequests');
  if (!container) return;
  const db = initStorage().db;
  state.ui.walletDepositUnsubscribe?.();
  state.ui.walletDepositUnsubscribe = db.collection('depositRequests').onSnapshot((snapshot) => {
    const docs = snapshot.docs.sort((a, b) => (b.data().createdAt?.seconds || 0) - (a.data().createdAt?.seconds || 0));
    container.innerHTML = docs.length ? docs.map((doc) => { const item = doc.data(); return `<div class="wallet-admin-row"><div class="war-info"><strong>${escapeHtml(item.userName || item.userId)}</strong><div>${escapeHtml(item.userType)} • ${formatCurrency(item.amount || 0)}</div><div class="muted">From ${escapeHtml(item.senderPhone || '')} • Ref ${escapeHtml(item.paymentRef || '')}</div></div><span class="status-badge status-${escapeHtml(item.status)}">${escapeHtml(item.status)}</span>${item.status === 'pending' ? `<div class="war-actions"><button class="primary-btn wallet-confirm-deposit" data-id="${doc.id}" type="button">Confirm & credit</button><button class="ghost-btn wallet-reject-deposit" data-id="${doc.id}" type="button">Reject</button></div>` : ''}</div>`; }).join('') : '<div class="empty-state">No deposit requests.</div>';
    container.querySelectorAll('.wallet-confirm-deposit').forEach((button) => button.addEventListener('click', () => withButtonState(button, async () => {
      const item = snapshot.docs.find((doc) => doc.id === button.dataset.id)?.data();
      if (!item || item.status !== 'pending') return;
      await creditBalance(item.userId, item.userType, item.amount, { type: 'deposit', currency: item.currency || 'LRD', reference: button.dataset.id, idempotencyKey: `deposit_${button.dataset.id}`, description: `Deposit confirmed by admin (${item.currency || 'LRD'})` });
      await db.collection('depositRequests').doc(button.dataset.id).update({ status: 'confirmed', confirmedAt: new Date(), confirmedBy: state.user.uid });
    }, { loadingText: 'Confirming...', successText: 'Credited', permanent: true })));
    container.querySelectorAll('.wallet-reject-deposit').forEach((button) => button.addEventListener('click', () => withButtonState(button, () => db.collection('depositRequests').doc(button.dataset.id).update({ status: 'rejected', updatedAt: new Date() }), { loadingText: 'Rejecting...', successText: 'Rejected', permanent: true })));
  });
}

function renderAdminWithdrawalRequests() {
  const container = document.getElementById('adminWithdrawalRequests');
  if (!container) return;
  const db = initStorage().db;
  state.ui.walletWithdrawalUnsubscribe?.();
  state.ui.walletWithdrawalUnsubscribe = db.collection('withdrawalRequests').onSnapshot((snapshot) => {
    const docs = snapshot.docs.sort((a, b) => (b.data().createdAt?.seconds || 0) - (a.data().createdAt?.seconds || 0));
    container.innerHTML = docs.length ? docs.map((doc) => { const item = doc.data(); return `<div class="wallet-admin-row"><div class="war-info"><strong>${escapeHtml(item.userName || item.userId)}</strong><div>${escapeHtml(item.userType)} • ${formatCurrency(item.amount || 0)}</div><div class="muted">To ${escapeHtml(item.recipientName || '')} • ${escapeHtml(item.recipientPhone || '')}</div></div><span class="status-badge status-${escapeHtml(item.status)}">${escapeHtml(item.status)}</span>${item.status === 'pending' ? `<button class="primary-btn wallet-mark-paid" data-id="${doc.id}" data-amount="${Number(item.amount || 0)}" type="button">Mark paid</button>` : ''}</div>`; }).join('') : '<div class="empty-state">No withdrawal requests.</div>';
    container.querySelectorAll('.wallet-mark-paid').forEach((button) => button.addEventListener('click', () => withButtonState(button, async () => {
      const payout = Number(button.dataset.amount || 0);
      await db.collection('withdrawalRequests').doc(button.dataset.id).update({ status: 'paid', paidAt: new Date(), paidBy: state.user.uid });
      const summaryRef = db.collection('adminWallet').doc('summary');
      await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(summaryRef);
        const current = snapshot.data() || {};
        transaction.set(summaryRef, { balance: Number(current.balance || 0) - payout, totalPaidOut: Number(current.totalPaidOut || 0) + payout, updatedAt: new Date() }, { merge: true });
      });
    }, { loadingText: 'Saving...', successText: 'Marked paid', permanent: true })));
  });
}

function openInternationalProductModal(productId = null) {
  const existing = state.data.internationalProducts.find((item) => item.id === productId) || {};
  const activeMasterProducts = state.data.products.filter((item) => item.status === 'active' && !item.isDeleted);
  openModal(productId ? 'Edit International Product' : 'Add International Product', `
    <form id="internationalProductForm" class="form-grid">
      <label>Master Product<select name="masterProductId" ${productId ? 'disabled' : ''}>${activeMasterProducts.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === existing.masterProductId ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select></label>
      <label>Wholesale Price<input name="wholesalePrice" type="number" min="0" step="0.01" value="${existing.wholesalePrice || 0}" required /></label>
      <label>Currency<select name="currency"><option value="USD" ${existing.currency !== 'LRD' ? 'selected' : ''}>USD</option><option value="LRD" ${existing.currency === 'LRD' ? 'selected' : ''}>LRD</option></select></label>
      <label>Minimum Quantity<input name="minimumQuantity" type="number" min="1" value="${existing.minimumQuantity || 1}" /></label>
      <label>Status<select name="status"><option value="active" ${existing.status !== 'inactive' ? 'selected' : ''}>Active</option><option value="inactive" ${existing.status === 'inactive' ? 'selected' : ''}>Inactive</option></select></label>
      <label class="full">Seller Details<textarea name="description">${escapeHtml(existing.description || '')}</textarea></label>
      <button class="primary-btn" type="submit">Save</button><button class="ghost-btn" type="button" id="cancelModal">Cancel</button>
    </form>`);
  document.getElementById('internationalProductForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const master = state.data.products.find((item) => item.id === (existing.masterProductId || data.masterProductId));
    const payload = { masterProductId: existing.masterProductId || data.masterProductId, name: master?.name || existing.name || 'International Product', description: data.description || master?.description || '', wholesalePrice: Number(data.wholesalePrice || 0), currency: data.currency, minimumQuantity: Number(data.minimumQuantity || 1), status: data.status || 'active', isDeleted: false, updatedAt: new Date().toISOString(), createdAt: existing.createdAt || new Date().toISOString() };
    const duplicate = state.data.internationalProducts.some((item) => item.id !== productId && item.masterProductId === payload.masterProductId && !item.isDeleted);
    if (duplicate) {
      createToast('This master product already has an international offer.', 'warning');
      return;
    }
    if (productId) await updateDocument('internationalProducts', productId, payload); else await addDocument('internationalProducts', payload);
    closeModal();
    renderInternationalProducts();
  });
}

function renderProducts() {
  const filtered = state.data.products.filter((item) => !item.isDeleted).filter((item) => {
    const query = state.filters.products.q.toLowerCase();
    const matchesQuery = !query || [item.name, item.category, ...(item.searchKeywords || [])].join(' ').toLowerCase().includes(query);
    const matchesCategory = state.filters.products.category === 'all' || item.category === state.filters.products.category;
    const matchesStatus = state.filters.products.status === 'all' || item.status === state.filters.products.status;
    return matchesQuery && matchesCategory && matchesStatus;
  }).sort((a, b) => {
    if (state.filters.products.sort === 'name') return a.name.localeCompare(b.name);
    if (state.filters.products.sort === 'date') return new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt);
    return (b.searchKeywords?.length || 0) - (a.searchKeywords?.length || 0);
  });

  const categories = [...new Set(['General', ...state.data.products.map((item) => getCategoryDisplayName(item.category)).filter(Boolean)])];

  content.innerHTML = `
    <section class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">Master Product Catalog</h3>
          <p class="card-subtitle">Create, edit, and manage global offerings</p>
        </div>
        <div class="row-actions">
          <button class="primary-btn" id="openProductModal">Add Product</button>
          <button class="secondary-btn" id="bulkActivateProducts">Activate Selected</button>
          <button class="ghost-btn" id="bulkDeleteProducts">Delete Selected</button>
        </div>
      </div>
      <div class="form-grid" style="grid-template-columns: 2fr 1fr 1fr 1fr; margin-bottom: 14px;">
        <label>Search<input id="productSearch" value="${escapeHtml(state.filters.products.q)}" /></label>
        <label>Category<select id="productCategory">
          <option value="all">All</option>
          ${categories.map((category) => `<option value="${escapeHtml(category)}" ${state.filters.products.category === category ? 'selected' : ''}>${escapeHtml(category)}</option>`).join('')}
        </select></label>
        <label>Status<select id="productStatus">
          <option value="all">All</option>
          <option value="active" ${state.filters.products.status === 'active' ? 'selected' : ''}>Active</option>
          <option value="inactive" ${state.filters.products.status === 'inactive' ? 'selected' : ''}>Inactive</option>
        </select></label>
        <label>Sort<select id="productSort">
          <option value="date" ${state.filters.products.sort === 'date' ? 'selected' : ''}>Date</option>
          <option value="name" ${state.filters.products.sort === 'name' ? 'selected' : ''}>Name</option>
          <option value="popularity" ${state.filters.products.sort === 'popularity' ? 'selected' : ''}>Popularity</option>
        </select></label>
      </div>
      ${filtered.length ? `<div class="product-grid">${filtered.map((product, index) => renderProductCard(product, index)).join('')}</div>` : `<div class="empty-state">${state.data.products.length ? 'No master products match your filters.' : 'No products yet. Create one using the form above.'}</div>`}
    </section>
  `;

  document.getElementById('openProductModal').addEventListener('click', () => openProductModal());
  document.getElementById('bulkActivateProducts').addEventListener('click', () => bulkUpdateProducts('active'));
  document.getElementById('bulkDeleteProducts').addEventListener('click', () => bulkUpdateProducts('delete'));
  document.getElementById('productSearch').addEventListener('input', (event) => {
    state.filters.products.q = event.target.value;
    rerenderWithInputFocus(event.target, renderProducts);
  });
  document.getElementById('productCategory').addEventListener('change', (event) => {
    state.filters.products.category = event.target.value;
    renderProducts();
  });
  document.getElementById('productStatus').addEventListener('change', (event) => {
    state.filters.products.status = event.target.value;
    renderProducts();
  });
  document.getElementById('productSort').addEventListener('change', (event) => {
    state.filters.products.sort = event.target.value;
    renderProducts();
  });
  bindProductActions();
}

function renderProductCard(product, index) {
  const imageValue = product.imageFilename || product.image || '';
  const imageUrl = getImageUrl(imageValue);
  const storageOptions = normalizeStorageOptions(product.storageOptions);
  return `
    <article class="product-card">
      <img src="./images/placeholder.png" data-mobile-loader data-mobile-src="${escapeHtml(getProductThumbnailUrl(imageValue))}" data-full-src="${escapeHtml(imageUrl)}" loading="${index < 2 ? 'eager' : 'lazy'}" fetchpriority="${index < 2 ? 'high' : 'auto'}" decoding="async" alt="${escapeHtml(product.name)}" />
      <div class="row-actions">
        <input type="checkbox" class="product-select" value="${escapeHtml(product.id)}" ${state.ui.selectedProducts.has(product.id) ? 'checked' : ''} />
        <span class="badge-status ${product.status === 'active' ? 'active' : 'pending'}">${escapeHtml(product.status)}</span>
      </div>
      <h4>${escapeHtml(product.name)}</h4>
      ${renderExpandableDescription(product.description)}
      <p style="color: var(--accent-2)">${escapeHtml(getCategoryDisplayName(product.category))}</p>
      ${storageOptions.length ? `<p class="muted">Storage: ${escapeHtml(storageOptions.map((option) => option.label).join(', '))}</p>` : ''}
      <div class="product-actions">
        <button class="secondary-btn edit-product" data-id="${escapeHtml(product.id)}">Edit</button>
        <button class="ghost-btn toggle-product" data-id="${escapeHtml(product.id)}">${product.status === 'active' ? 'Deactivate' : 'Activate'}</button>
        <button class="ghost-btn delete-product" data-id="${escapeHtml(product.id)}">Delete</button>
      </div>
    </article>
  `;
}

function rerenderWithInputFocus(input, render) {
  const selectionStart = input.selectionStart;
  const selectionEnd = input.selectionEnd;
  const inputId = input.id;
  render();
  const nextInput = document.getElementById(inputId);
  if (!nextInput) return;
  nextInput.focus({ preventScroll: true });
  if (selectionStart !== null && selectionEnd !== null) nextInput.setSelectionRange(selectionStart, selectionEnd);
}

function normalizeStorageOptions(value) {
  const entries = Array.isArray(value) ? value : String(value || '').split(/,|\r?\n/);
  return entries.map((entry) => {
    if (typeof entry === 'string') {
      const [label, priceModifier = '0', stockCount = '0'] = entry.split('|').map((part) => part.trim());
      return { label, priceModifier: Number(priceModifier || 0), stockCount: Math.max(0, Number(stockCount || 0)) };
    }
    return {
      label: String(entry?.label || '').trim(),
      priceModifier: Number(entry?.priceModifier || 0),
      stockCount: Math.max(0, Number(entry?.stockCount || 0))
    };
  }).filter((entry) => entry.label);
}

const PHONE_STORAGE_PRESETS = ['32GB', '64GB', '128GB', '256GB', '512GB', '1TB', '2TB'];
const PHONE_COLOR_PRESETS = [
  ['Black', '#111827'], ['White', '#f8fafc'], ['Silver', '#94a3b8'], ['Gold', '#d4a72c'],
  ['Rose Gold', '#e7a9a9'], ['Red', '#dc2626'], ['Blue', '#2563eb'], ['Navy', '#172554'],
  ['Green', '#16a34a'], ['Purple', '#7c3aed'], ['Pink', '#ec4899'], ['Yellow', '#eab308'],
  ['Orange', '#f97316'], ['Brown', '#78350f'], ['Gray', '#6b7280'], ['Graphite', '#4b5563'],
  ['Titanium', '#a8a29e'], ['Natural', '#d6b98c']
];
const SHOE_SIZE_PRESETS = ['US 6', 'US 7', 'US 8', 'US 9', 'US 10', 'US 11', 'US 12', 'EU 39', 'EU 40', 'EU 41', 'EU 42', 'EU 43', 'EU 44', 'EU 45'];
const SHOE_COLOR_PRESETS = PHONE_COLOR_PRESETS;

function normalizeProductColors(value) {
  return (Array.isArray(value) ? value : String(value || '').split(',')).map((color) => String(color || '').trim()).filter(Boolean);
}

function normalizeShoeVariants(value) {
  if (!Array.isArray(value)) return [];
  return value.map((variant) => ({
    size: String(variant?.size || '').trim(),
    color: String(variant?.color || '').trim(),
    colorHex: String(variant?.colorHex || '').trim(),
    priceModifier: Number(variant?.priceModifier || 0),
    stockCount: Math.max(0, Number(variant?.stockCount || 0))
  })).filter((variant) => variant.size && variant.color);
}

function collectStorageOptionsFromForm(productForm) {
  return Array.from(productForm.querySelectorAll('[data-storage-preset]:checked')).map((checkbox) => {
    const label = checkbox.dataset.storagePreset;
    const priceModifier = Number(productForm.querySelector(`[data-storage-price="${label}"]`)?.value || 0);
    const stockCount = Math.max(0, Number(productForm.querySelector(`[data-storage-stock="${label}"]`)?.value || 0));
    return { label, priceModifier, stockCount };
  });
}

function collectShoeVariantsFromForm(productForm) {
  return Array.from(productForm.querySelectorAll('[data-shoe-variant-row]')).map((row) => ({
    size: row.dataset.size,
    color: row.dataset.color,
    colorHex: row.dataset.colorHex,
    priceModifier: Number(row.querySelector('[data-shoe-price]')?.value || 0),
    stockCount: Math.max(0, Number(row.querySelector('[data-shoe-stock]')?.value || 0))
  }));
}

function bindProductActions() {
  document.querySelectorAll('.edit-product').forEach((button) => button.addEventListener('click', () => openProductModal(button.getAttribute('data-id'))));
  document.querySelectorAll('.toggle-product').forEach((button) => button.addEventListener('click', () => withButtonState(button, () => toggleProduct(button.getAttribute('data-id')), { loadingText: 'Updating...', successText: 'Updated', permanent: false })));
  document.querySelectorAll('.delete-product').forEach((button) => button.addEventListener('click', () => withButtonState(button, () => deleteProduct(button.getAttribute('data-id')), { loadingText: 'Deleting...', successText: 'Deleted', permanent: false })));
  document.querySelectorAll('.product-select').forEach((checkbox) => checkbox.addEventListener('change', (event) => {
    if (event.target.checked) state.ui.selectedProducts.add(event.target.value); else state.ui.selectedProducts.delete(event.target.value);
  }));
}

async function syncProductOptionsToSellerMenus(productId, storageOptions, colorOptions, shoeVariants) {
  const db = initStorage().db;
  if (!db || !productId) return;
  const sellersSnapshot = await db.collection('sellers').get();
  await Promise.all(sellersSnapshot.docs.map(async (sellerDoc) => {
    const menuSnapshot = await db.collection('sellers').doc(sellerDoc.id).collection('menu').where('masterProductId', '==', productId).get();
    await Promise.all(menuSnapshot.docs.map((menuDoc) => menuDoc.ref.update({ storageOptions, colorOptions, shoeVariants, updatedAt: new Date() })));
  }));
}

function openProductModal(productId = null) {
  const product = state.data.products.find((item) => item.id === productId) || {};
  const imageValue = product.imageFilename || product.image || '';
  const selectedStorageLabels = normalizeStorageOptions(product.storageOptions).map((option) => option.label);
  const selectedColors = normalizeProductColors(product.colorOptions);
  const shoeVariants = normalizeShoeVariants(product.shoeVariants);
  const isPhoneTablet = getCategoryDisplayName(product.category || '') === 'Phones & Tablets';
  const isShoesProduct = getCategoryDisplayName(product.category || '') === 'Shoes & Footwear';
  const existingShoeVariants = normalizeShoeVariants(product.shoeVariants);
  const variantOptionsDraft = Array.isArray(product.variantOptions) ? product.variantOptions.map((variant) => ({
    values: { ...(variant.values || {}) },
    priceModifier: Number(variant.priceModifier || 0),
    stockCount: Math.max(0, Number(variant.stockCount || 0))
  })) : [];
  const form = `
    <form id="productForm" class="form-grid">
      <label>Name<input name="name" required value="${escapeHtml(product.name || '')}" /></label>
      <label>Description<textarea name="description" required>${escapeHtml(product.description || '')}</textarea></label>
      <label>Category<select name="category">
        <option value="">General</option>
        ${getCategoryOptions().map((category) => `<option value="${escapeHtml(category.name)}" ${String(product.category || '').toLowerCase() === category.name.toLowerCase() ? 'selected' : ''}>${escapeHtml(category.name)}</option>`).join('')}
      </select></label>
      <label class="full"><input type="checkbox" name="addStorageOptions" ${selectedStorageLabels.length ? 'checked' : ''} /> Add storage options to this product</label>
      <div id="storageOptionsEditor" class="variant-editor full ${selectedStorageLabels.length ? '' : 'hidden'}">
        <p class="muted">Select each size, then set its price modifier and stock count. Price modifier is added to the admin base price.</p>
        <div class="variant-option-section">
          <div class="variant-option-header"><strong>Storage options</strong><button type="button" class="variant-select-all" data-select-all="storage" data-select-all-label="storage options">Select all</button></div>
          <div class="storage-variant-grid" data-variant-option-group="storage">${PHONE_STORAGE_PRESETS.map((label) => { const option = normalizeStorageOptions(product.storageOptions).find((entry) => entry.label === label) || {}; return `<div class="storage-variant-row"><label><input type="checkbox" data-storage-preset="${label}" ${selectedStorageLabels.includes(label) ? 'checked' : ''} /><span class="storage-preset-label">${label}</span></label><input type="number" min="0" step="0.01" data-storage-price="${label}" value="${option.priceModifier || 0}" placeholder="Price +" /><input type="number" min="0" step="1" data-storage-stock="${label}" value="${option.stockCount || 0}" placeholder="Stock" /></div>`; }).join('')}</div>
        </div>
        <div class="bulk-stock-row"><label>Apply stock to all selected storage capacities<input type="number" min="0" step="1" id="storageBulkStock" placeholder="Stock count" /></label><button type="button" class="secondary-btn" id="applyStorageBulkStock">Apply stock</button></div>
      </div>
      <label class="full"><input type="checkbox" name="addColors" ${selectedColors.length ? 'checked' : ''} /> Add colors to this product</label>
      <div id="colorOptionsEditor" class="variant-editor full ${selectedColors.length ? '' : 'hidden'}">
        <p class="muted">Select available colors. Colors do not change the price.</p>
        <div class="variant-option-section">
          <div class="variant-option-header"><strong>Color options</strong><button type="button" class="variant-select-all" data-select-all="phone-colors" data-select-all-label="color options">Select all</button></div>
          <div class="color-choice-grid" data-variant-option-group="phone-colors">${PHONE_COLOR_PRESETS.map(([label, hex]) => `<label class="color-choice"><input type="checkbox" name="presetColors" value="${label}" ${selectedColors.includes(label) ? 'checked' : ''} /><span class="color-swatch" style="--swatch:${hex}" title="${label}"></span><span>${label}</span></label>`).join('')}</div>
        </div>
        <label>Custom colors<input name="customColors" value="${escapeHtml(selectedColors.filter((color) => !PHONE_COLOR_PRESETS.some(([label]) => label === color)).join(', '))}" placeholder="Teal, Titanium" /></label>
      </div>
      <div id="shoeVariantsEditor" class="variant-editor full ${isShoesProduct ? '' : 'hidden'}">
        <p class="muted">Shoes use one variant for each selected size and color. Set price modifiers and stock per combination.</p>
        <div class="variant-option-section">
          <div class="variant-option-header"><strong>Sizes</strong><button type="button" class="variant-select-all" data-select-all="shoe-sizes" data-select-all-label="sizes">Select all</button></div>
          <div class="variant-check-grid" data-variant-option-group="shoe-sizes">${SHOE_SIZE_PRESETS.map((size) => `<label><input type="checkbox" data-shoe-size="${size}" ${existingShoeVariants.some((variant) => variant.size === size) ? 'checked' : ''} /> ${size}</label>`).join('')}</div>
        </div>
        <div class="variant-option-section">
          <div class="variant-option-header"><strong>Colors</strong><button type="button" class="variant-select-all" data-select-all="shoe-colors" data-select-all-label="colors">Select all</button></div>
          <div class="color-choice-grid" data-variant-option-group="shoe-colors">${SHOE_COLOR_PRESETS.map(([label, hex]) => `<label class="color-choice"><input type="checkbox" data-shoe-color="${label}" data-color-hex="${hex}" ${existingShoeVariants.some((variant) => variant.color === label) ? 'checked' : ''} /><span class="color-swatch" style="--swatch:${hex}" title="${label}"></span><span>${label}</span></label>`).join('')}</div>
        </div>
        <div class="bulk-stock-row"><label>Apply stock to all selected combinations<input type="number" min="0" step="1" id="shoeBulkStock" placeholder="Stock count" /></label><button type="button" class="secondary-btn" id="applyShoeBulkStock">Apply stock</button></div>
        <div id="shoeVariantRows" class="storage-variant-grid"></div>
      </div>
      <div id="genericVariantEditor" class="variant-editor full ${(!isPhoneTablet && !isShoesProduct && getCategoryVariantConfig(product.category || '').fields.length) ? '' : 'hidden'}">
        <div class="variant-editor-header">
          <strong>Category variants</strong>
          <span class="muted">Set price modifiers and stock for each selected combination.</span>
        </div>
        <div id="genericVariantFields" class="full"></div>
        <div class="bulk-stock-row generic-bulk-stock-row">
          <label for="genericBulkStock">Apply stock to all selected combinations<input type="number" min="0" step="1" id="genericBulkStock" placeholder="Stock count" /></label>
          <button type="button" class="secondary-btn" id="applyGenericBulkStock">Apply stock</button>
        </div>
        <div id="genericVariantRows" class="storage-variant-grid"></div>
      </div>
      <label>Image Path<input name="imageFilename" value="${escapeHtml(imageValue)}" /></label>
      <label class="full">Product Video Link<input name="videoUrl" type="url" value="${escapeHtml(product.videoUrl || product.videoLink || '')}" placeholder="https://example.com/product-video" /></label>
      <label>Search Keywords<input name="searchKeywords" value="${escapeHtml((product.searchKeywords || []).join(', '))}" /></label>
      <label>Preparation Category<input name="preparationCategory" value="${escapeHtml(product.preparationCategory || '')}" /></label>
      <label>Standard Price<input name="standardPrice" type="number" min="0" step="0.01" value="${product.standardPrice ?? product.price ?? 0}" /></label>
      <label>Price Currency<select name="standardCurrency"><option value="USD" ${normalizeCurrency(product.standardCurrency || product.currency || 'USD') === 'USD' ? 'selected' : ''}>USD</option><option value="LRD" ${normalizeCurrency(product.standardCurrency || product.currency || 'USD') === 'LRD' ? 'selected' : ''}>LRD</option></select></label>
      <div id="standardPriceConversion" class="muted">Equivalent in LRD: ${formatCurrency(convertCurrency(product.standardPrice ?? product.price ?? 0, product.standardCurrency || product.currency || 'USD', 'LRD'), 'LRD')}</div>
      <label>Status<select name="status"><option value="active" ${product.status === 'active' ? 'selected' : ''}>Active</option><option value="inactive" ${product.status === 'inactive' ? 'selected' : ''}>Inactive</option></select></label>
      <div class="card" style="padding: 12px;">
        <strong>Image Preview</strong>
        <img id="productImagePreview" src="${getImageUrl(imageValue)}" alt="Preview" style="width: 100%; height: 160px; object-fit: cover; border-radius: 12px; margin-top: 8px;" onerror="this.src='./images/placeholder.png'" />
      </div>
      <div class="row-actions">
        <button class="primary-btn" id="saveProduct" type="submit">Save Product</button>
        <button class="ghost-btn" id="cancelModal" type="button">Cancel</button>
      </div>
    </form>
  `;
  openModal(productId ? 'Edit Product' : 'Create Product', form);

  const productForm = document.getElementById('productForm');
  const categoryInput = productForm.querySelector('select[name="category"]');
  const storageToggle = productForm.querySelector('input[name="addStorageOptions"]');
  const colorToggle = productForm.querySelector('input[name="addColors"]');
  const shoeVariantEditor = document.getElementById('shoeVariantsEditor');
  const shoeVariantRows = document.getElementById('shoeVariantRows');
  const genericVariantEditor = document.getElementById('genericVariantEditor');
  const genericVariantFields = document.getElementById('genericVariantFields');
  const genericVariantRows = document.getElementById('genericVariantRows');
  const updateSelectAllButton = (button, group) => {
    const inputs = Array.from(group?.querySelectorAll('input[type="checkbox"]') || []);
    const allSelected = inputs.length > 0 && inputs.every((input) => input.checked);
    const action = allSelected ? 'Clear all' : 'Select all';
    button.textContent = action;
    button.classList.toggle('is-selected', allSelected);
    button.setAttribute('aria-pressed', String(allSelected));
    button.setAttribute('aria-label', `${action} ${button.dataset.selectAllLabel || 'options'}`);
  };
  const renderShoeVariantRows = () => {
    if (!shoeVariantRows) return;
    const sizes = Array.from(productForm.querySelectorAll('[data-shoe-size]:checked')).map((input) => input.dataset.shoeSize);
    const colors = Array.from(productForm.querySelectorAll('[data-shoe-color]:checked')).map((input) => ({ label: input.dataset.shoeColor, hex: input.dataset.colorHex }));
    shoeVariantRows.innerHTML = sizes.flatMap((size) => colors.map((color) => {
      const existing = existingShoeVariants.find((variant) => variant.size === size && variant.color === color.label) || {};
      return `<div class="storage-variant-row" data-shoe-variant-row data-size="${escapeHtml(size)}" data-color="${escapeHtml(color.label)}" data-color-hex="${escapeHtml(color.hex)}"><label><span class="color-swatch" style="--swatch:${color.hex}"></span>${escapeHtml(color.label)} / ${escapeHtml(size)}</label><input type="number" min="0" step="0.01" data-shoe-price value="${existing.priceModifier || 0}" placeholder="Price +" /><input type="number" min="0" step="1" data-shoe-stock value="${existing.stockCount || 0}" placeholder="Stock" /></div>`;
    })).join('');
  };
  const renderGenericVariantEditor = () => {
    if (!genericVariantEditor || !genericVariantFields || !genericVariantRows) return;
    const categoryName = getCategoryDisplayName(categoryInput?.value || product.category || '');
    const config = getCategoryVariantConfig(categoryName);
    if (isPhoneTablet || isShoesProduct || !config.fields.length) {
      genericVariantEditor.classList.add('hidden');
      genericVariantFields.innerHTML = '';
      genericVariantRows.innerHTML = '';
      return;
    }

    genericVariantEditor.classList.remove('hidden');
    const optionsMarkup = config.fields.map((variantField) => {
      const selectedValues = new Set(variantOptionsDraft.map((variant) => String(variant.values?.[variantField.key] || '')));
      return `<div class="generic-variant-field-group variant-option-section"><div class="variant-option-header"><strong>${escapeHtml(variantField.label)}</strong><button type="button" class="variant-select-all" data-select-all-generic="${escapeHtml(variantField.key)}" data-select-all-label="${escapeHtml(variantField.label.toLowerCase())}">Select all</button></div><div class="variant-check-grid">${variantField.allowedOptions.map((option) => {
        const value = escapeHtml(option.value);
        const label = escapeHtml(option.label);
        const hex = escapeHtml(option.hex || '#64748b');
        const swatch = variantField.inputType === 'color' && option.hex ? `<span class="color-swatch" style="--swatch:${hex};"></span>` : '';
        return `<label class="color-choice-pill">${swatch}<input type="checkbox" data-generic-field="${escapeHtml(variantField.key)}" value="${value}" ${selectedValues.has(option.value) ? 'checked' : ''} /> <span>${label}</span></label>`;
      }).join('')}</div></div>`;
    }).join('');
    genericVariantFields.innerHTML = optionsMarkup;

    const renderRows = () => {
      const selectedOptions = config.fields.map((variantField) => Array.from(genericVariantFields.querySelectorAll(`[data-generic-field="${variantField.key}"]:checked`)).map((input) => input.value));
      if (selectedOptions.some((values) => !values.length)) {
        genericVariantRows.innerHTML = '<p class="muted">Select at least one value for each field to configure stock and price.</p>';
        return;
      }

      const combinations = selectedOptions.reduce((rows, values, fieldIndex) => rows.flatMap((row) => values.map((value) => ({ ...row, [config.fields[fieldIndex].key]: value }))), [{}]);
      genericVariantRows.innerHTML = combinations.map((values) => {
        const matchingVariant = variantOptionsDraft.find((variant) => config.fields.every((variantField) => String(variant.values?.[variantField.key] || '') === values[variantField.key])) || {};
        const label = config.fields.map((variantField) => `${variantField.label}: ${values[variantField.key]}`).join(' / ');
        return `<div class="storage-variant-row" data-generic-row data-generic-values="${escapeHtml(JSON.stringify(values))}"><label>${escapeHtml(label)}</label><input type="number" min="0" step="0.01" data-generic-price value="${Number(matchingVariant.priceModifier || 0)}" placeholder="Price +" aria-label="Price modifier for ${escapeHtml(label)}" /><input type="number" min="0" step="1" data-generic-stock value="${Math.max(0, Number(matchingVariant.stockCount || 0))}" placeholder="Stock" aria-label="Stock for ${escapeHtml(label)}" /></div>`;
      }).join('');
    };

    genericVariantFields.querySelectorAll('[data-generic-field]').forEach((input) => input.addEventListener('change', renderRows));
    genericVariantFields.querySelectorAll('[data-select-all-generic]').forEach((button) => button.addEventListener('click', () => {
      const fieldKey = button.dataset.selectAllGeneric;
      const inputs = Array.from(genericVariantFields.querySelectorAll(`[data-generic-field="${fieldKey}"]`));
      const allSelected = inputs.length > 0 && inputs.every((input) => input.checked);
      inputs.forEach((input) => { input.checked = !allSelected; });
      updateSelectAllButton(button, button.closest('.variant-option-section'));
      renderRows();
    }));
    genericVariantFields.querySelectorAll('[data-generic-field]').forEach((input) => input.addEventListener('change', () => {
      const group = input.closest('.variant-option-section');
      const button = group?.querySelector('[data-select-all-generic]');
      if (button) updateSelectAllButton(button, group);
    }));
    genericVariantFields.querySelectorAll('[data-select-all-generic]').forEach((button) => updateSelectAllButton(button, button.closest('.variant-option-section')));
    renderRows();
  };
  productForm.querySelectorAll('[data-shoe-size], [data-shoe-color]').forEach((input) => input.addEventListener('change', renderShoeVariantRows));
  productForm.querySelectorAll('[data-select-all]').forEach((button) => button.addEventListener('click', () => {
    const group = productForm.querySelector(`[data-variant-option-group="${button.dataset.selectAll}"]`);
    const inputs = Array.from(group?.querySelectorAll('input[type="checkbox"]') || []);
    const allSelected = inputs.length > 0 && inputs.every((input) => input.checked);
    inputs.forEach((input) => { input.checked = !allSelected; });
    updateSelectAllButton(button, group);
    if (button.dataset.selectAll === 'shoe-sizes' || button.dataset.selectAll === 'shoe-colors') renderShoeVariantRows();
  }));
  productForm.querySelectorAll('[data-variant-option-group]').forEach((group) => group.addEventListener('change', () => {
    const button = productForm.querySelector(`[data-select-all="${group.dataset.variantOptionGroup}"]`);
    if (button) updateSelectAllButton(button, group);
  }));
  productForm.querySelectorAll('[data-select-all]').forEach((button) => {
    updateSelectAllButton(button, productForm.querySelector(`[data-variant-option-group="${button.dataset.selectAll}"]`));
  });
  renderShoeVariantRows();
  renderGenericVariantEditor();
  document.getElementById('applyShoeBulkStock')?.addEventListener('click', () => {
    const stock = Math.max(0, Number(document.getElementById('shoeBulkStock')?.value || 0));
    shoeVariantRows?.querySelectorAll('[data-shoe-stock]').forEach((input) => { input.value = stock; });
  });
  document.getElementById('applyGenericBulkStock')?.addEventListener('click', () => {
    const stock = Math.max(0, Number(document.getElementById('genericBulkStock')?.value || 0));
    genericVariantRows?.querySelectorAll('[data-generic-stock]').forEach((input) => { input.value = stock; });
  });
  document.getElementById('applyStorageBulkStock')?.addEventListener('click', () => {
    const stock = Math.max(0, Number(document.getElementById('storageBulkStock')?.value || 0));
    productForm.querySelectorAll('[data-storage-preset]:checked').forEach((checkbox) => {
      const stockInput = productForm.querySelector(`[data-storage-stock="${checkbox.dataset.storagePreset}"]`);
      if (stockInput) stockInput.value = stock;
    });
  });
  storageToggle?.addEventListener('change', () => document.getElementById('storageOptionsEditor')?.classList.toggle('hidden', !storageToggle.checked));
  colorToggle?.addEventListener('change', () => document.getElementById('colorOptionsEditor')?.classList.toggle('hidden', !colorToggle.checked));
  categoryInput?.addEventListener('change', () => {
    const categoryName = getCategoryDisplayName(categoryInput.value);
    const phoneOnly = categoryName === 'Phones & Tablets';
    const shoes = categoryName === 'Shoes & Footwear';
    [storageToggle, colorToggle].forEach((toggle) => { if (toggle) toggle.closest('label').classList.toggle('hidden', !phoneOnly); });
    if (!phoneOnly) {
      document.getElementById('storageOptionsEditor')?.classList.add('hidden');
      document.getElementById('colorOptionsEditor')?.classList.add('hidden');
    }
    if (phoneOnly) {
      shoeVariantEditor?.classList.add('hidden');
    } else {
      shoeVariantEditor?.classList.toggle('hidden', !shoes);
      if (shoes) shoeVariantEditor?.classList.remove('hidden');
    }
    renderGenericVariantEditor();
  });
  if (!isPhoneTablet) categoryInput?.dispatchEvent(new Event('change'));
  productForm.querySelector('input[name="imageFilename"]').addEventListener('change', (event) => {
    const preview = document.getElementById('productImagePreview');
    const nextPath = String(event.target.value || '').trim();
    preview.src = getImageUrl(nextPath);
  });
  const standardPriceInput = productForm.querySelector('input[name="standardPrice"]');
  const standardCurrencyInput = productForm.querySelector('select[name="standardCurrency"]');
  const standardPriceConversion = document.getElementById('standardPriceConversion');
  const updateStandardPriceConversion = () => {
    const value = convertCurrency(standardPriceInput.value, standardCurrencyInput.value, 'LRD');
    standardPriceConversion.textContent = `Equivalent in LRD: ${formatCurrency(value, 'LRD')}`;
  };
  standardPriceInput.addEventListener('input', updateStandardPriceConversion);
  standardCurrencyInput.addEventListener('change', updateStandardPriceConversion);

  productForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(productForm);
    const imageValue = String(formData.get('imageFilename') || '').trim();
    const videoUrl = String(formData.get('videoUrl') || '').trim();
    const payload = {
      name: String(formData.get('name') || '').trim(),
      description: String(formData.get('description') || '').trim(),
      category: String(formData.get('category') || '').trim(),
      imageFilename: imageValue,
      image: imageValue,
      videoUrl,
      searchKeywords: String(formData.get('searchKeywords') || '').split(',').map((item) => item.trim()).filter(Boolean),
      storageOptions: getCategoryDisplayName(String(formData.get('category') || '')) === 'Phones & Tablets' && formData.get('addStorageOptions') ? collectStorageOptionsFromForm(productForm) : [],
      colorOptions: getCategoryDisplayName(String(formData.get('category') || '')) === 'Phones & Tablets' && formData.get('addColors')
        ? normalizeProductColors([...formData.getAll('presetColors'), ...String(formData.get('customColors') || '').split(',')])
        : [],
      shoeVariants: getCategoryDisplayName(String(formData.get('category') || '')) === 'Shoes & Footwear'
        ? collectShoeVariantsFromForm(productForm)
        : normalizeShoeVariants(shoeVariants),
      variantOptions: (() => {
        const categoryName = getCategoryDisplayName(String(formData.get('category') || ''));
        const config = getCategoryVariantConfig(categoryName);
        if (categoryName === 'Phones & Tablets' || categoryName === 'Shoes & Footwear' || !config.fields.length) return [];
        return Array.from(productForm.querySelectorAll('[data-generic-row]')).map((row) => ({
          values: JSON.parse(row.dataset.genericValues || '{}'),
          priceModifier: Number(row.querySelector('[data-generic-price]')?.value || 0),
          stockCount: Math.max(0, Number(row.querySelector('[data-generic-stock]')?.value || 0))
        }));
      })(),
      preparationCategory: String(formData.get('preparationCategory') || '').trim(),
      standardPrice: Number(formData.get('standardPrice') || 0),
      standardCurrency: normalizeCurrency(formData.get('standardCurrency')),
      price: Number(formData.get('standardPrice') || 0),
      currency: normalizeCurrency(formData.get('standardCurrency')),
      defaultPrice: convertCurrency(Number(formData.get('standardPrice') || 0), formData.get('standardCurrency'), 'LRD'),
      sellerMarkup: Number(product.sellerMarkup || 0),
      totalPrice: convertCurrency(Number(formData.get('standardPrice') || 0), formData.get('standardCurrency'), 'LRD') + Number(product.sellerMarkup || 0),
      status: String(formData.get('status') || 'active'),
      updatedAt: new Date().toISOString(),
      createdAt: product.createdAt || new Date().toISOString(),
      suggestedTags: product.suggestedTags || []
    };

    if (!payload.name || !payload.description) {
      createToast('Please provide a name and description.', 'warning');
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

    const duplicate = state.data.products.some((item) => item.id !== productId && item.name.toLowerCase() === payload.name.toLowerCase() && !item.isDeleted);
    if (duplicate) {
      createToast('A product with that name already exists.', 'warning');
      return;
    }

    const saveButton = document.getElementById('saveProduct');
    saveButton.disabled = true;
    saveButton.textContent = 'Saving...';

    try {
      let sellerMenuSync = null;
      let internationalProductSync = null;
      if (productId) {
        await updateDocument('masterProducts', productId, payload);
        sellerMenuSync = syncProductOptionsToSellerMenus(productId, payload.storageOptions, payload.colorOptions, payload.shoeVariants);
        const index = state.data.products.findIndex((item) => item.id === productId);
        if (index >= 0) {
          state.data.products[index] = { ...state.data.products[index], ...payload, id: productId };
        }
        createToast('Product updated successfully.', 'success');
        state.data.logs.unshift({ id: Date.now().toString(), user: state.user.displayName, action: 'Update product', details: payload.name, createdAt: new Date().toISOString() });
      } else {
        const result = await addDocument('masterProducts', payload);
        const newId = result.id;
        state.data.products.unshift({ id: newId, ...payload, createdAt: new Date().toISOString() });
        internationalProductSync = ensureInternationalProductExists(initStorage().db, { id: newId, ...payload });
        createToast('Product created successfully.', 'success');
        state.data.logs.unshift({ id: Date.now().toString(), user: state.user.displayName, action: 'Create product', details: payload.name, createdAt: new Date().toISOString() });
      }

      persistData();
      closeModal();
      renderProducts();
      renderDashboard();
      sellerMenuSync?.catch((syncError) => {
        console.error('[Manna Marketplace] Existing seller menu storage options could not be synchronized:', syncError);
        createToast('Product saved, but existing seller listings may need a refresh.', 'warning');
      });
      internationalProductSync?.catch((error) => {
        console.error('[Manna Marketplace] Could not create the international product for the new master product:', error);
        createToast('Product created, but its international offer could not be added.', 'warning');
      });
    } catch (error) {
      console.error(error);
      saveButton.disabled = false;
      saveButton.textContent = 'Save Product';
      createToast(error.message || 'Unable to save the product right now.', 'error');
    }
  });

  document.getElementById('cancelModal').addEventListener('click', closeModal);
}

async function toggleProduct(productId) {
  const product = state.data.products.find((item) => item.id === productId);
  if (!product) return;
  const nextStatus = product.status === 'active' ? 'inactive' : 'active';
  try {
    await updateDocument('masterProducts', productId, { status: nextStatus, updatedAt: new Date().toISOString() });
    product.status = nextStatus;
    product.updatedAt = new Date().toISOString();
    persistData();
    createToast('Product status updated.', 'success');
    renderProducts();
  } catch (error) {
    console.error(error);
    createToast('Unable to update the product status.', 'error');
  }
}

async function deleteProduct(productId) {
  if (!confirmDialog('Soft delete this product? It can be restored later.')) return;
  const product = state.data.products.find((item) => item.id === productId);
  if (!product) return;
  try {
    await updateDocument('masterProducts', productId, { isDeleted: true, status: 'deleted', updatedAt: new Date().toISOString() });
    product.isDeleted = true;
    product.status = 'deleted';
    product.updatedAt = new Date().toISOString();
    persistData();
    createToast('Product soft deleted.', 'warning');
    renderProducts();
  } catch (error) {
    console.error(error);
    createToast('Unable to delete the product.', 'error');
  }
}

async function bulkUpdateProducts(action) {
  if (!state.ui.selectedProducts.size) {
    createToast('Select at least one product first.', 'warning');
    return;
  }
  if (action === 'delete' && !confirmDialog('Delete selected products?')) return;
  try {
    const selectedIds = Array.from(state.ui.selectedProducts);
    await Promise.all(selectedIds.map((id) => {
      const product = state.data.products.find((item) => item.id === id);
      if (!product) return Promise.resolve();
      if (action === 'delete') {
        product.isDeleted = true;
        product.status = 'deleted';
        return updateDocument('masterProducts', id, { isDeleted: true, status: 'deleted', updatedAt: new Date().toISOString() });
      }
      product.status = 'active';
      return updateDocument('masterProducts', id, { status: 'active', updatedAt: new Date().toISOString() });
    }));
    state.ui.selectedProducts.clear();
    persistData();
    createToast('Bulk action completed.', 'success');
    renderProducts();
  } catch (error) {
    console.error(error);
    createToast('Unable to apply the bulk update.', 'error');
  }
}

function renderSellers() {
  const filtered = state.data.sellers.filter((item) => !item.isDeleted).filter((item) => {
    const query = state.filters.sellers.q.toLowerCase();
    const matches = !query || `${item.name} ${item.ownerName} ${item.location}`.toLowerCase().includes(query);
    const matchesStatus = state.filters.sellers.status === 'all' || item.status === state.filters.sellers.status;
    return matches && matchesStatus;
  });

  content.innerHTML = `
    <section class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">Seller Management</h3>
          <p class="card-subtitle">Approve, review, and manage seller partners</p>
        </div>
      </div>
      <div class="form-grid" style="grid-template-columns: 2fr 1fr; margin-bottom: 14px;">
        <label>Search<input id="sellerSearch" value="${escapeHtml(state.filters.sellers.q)}" /></label>
        <label>Status<select id="sellerStatus">
          <option value="all">All</option>
          <option value="approved" ${state.filters.sellers.status === 'approved' ? 'selected' : ''}>Approved</option>
          <option value="pending" ${state.filters.sellers.status === 'pending' ? 'selected' : ''}>Pending</option>
          <option value="rejected" ${state.filters.sellers.status === 'rejected' ? 'selected' : ''}>Rejected</option>
          <option value="suspended" ${state.filters.sellers.status === 'suspended' ? 'selected' : ''}>Suspended</option>
        </select></label>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Seller</th><th>Owner</th><th>Location</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${filtered.map((seller) => `
              <tr>
                <td><div style="display:flex;align-items:center;gap:10px"><img src="${getSellerImageUrl(seller)}" style="width:42px;height:42px;border-radius:10px" alt="${escapeHtml(seller.name)}" /><div><strong>${escapeHtml(seller.name)}</strong><div style="color:var(--muted);font-size:0.84rem">${escapeHtml(seller.phone)}</div></div></div></td>
                <td>${escapeHtml(seller.ownerName)}</td>
                <td>${escapeHtml(seller.location)}</td>
                <td><span class="badge-status ${seller.status === 'approved' ? 'active' : seller.status === 'suspended' ? 'suspended' : 'pending'}">${escapeHtml(seller.status)}</span></td>
                <td><div class="row-actions"><button class="secondary-btn" onclick="window.reviewSeller('${seller.id}')">Review</button><button class="secondary-btn" onclick="window.editSellerImage('${seller.id}')">Edit Image</button><button class="ghost-btn" onclick="window.updateSeller('${seller.id}','approved')">Approve</button><button class="ghost-btn" onclick="window.updateSeller('${seller.id}','suspended')">Suspend</button></div></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;

  document.getElementById('sellerSearch').addEventListener('input', (event) => {
    state.filters.sellers.q = event.target.value;
    rerenderWithInputFocus(event.target, renderSellers);
  });
  document.getElementById('sellerStatus').addEventListener('change', (event) => {
    state.filters.sellers.status = event.target.value;
    renderSellers();
  });
}

window.reviewSeller = (sellerId) => {
  const seller = state.data.sellers.find((item) => item.id === sellerId);
  if (!seller) return;

  openModal(`Review ${escapeHtml(seller.name || 'seller')}`, `
      <div class="form-grid" style="padding: 10px 0;">
        <label>Business Name<input value="${escapeHtml(seller.name || '')}" readonly /></label>
        <label>Owner Name<input value="${escapeHtml(seller.ownerName || '')}" readonly /></label>
        <label>Email<input value="${escapeHtml(seller.email || '')}" readonly /></label>
        <label>Phone<input value="${escapeHtml(seller.phone || '')}" readonly /></label>
        <label>Address<input value="${escapeHtml(seller.location || seller.address || '')}" readonly /></label>
        <label>Status<input value="${escapeHtml(seller.status || 'pending')}" readonly /></label>
        <label class="full">Seller image path<input id="sellerImagePath" value="${escapeHtml(seller.logo || seller.image || seller.imagePath || '')}" /></label>
        <label class="full">Admin Notes<textarea id="sellerReviewNotes">${escapeHtml(seller.reviewNotes || '')}</textarea></label>
        <div class="row-actions full">
          <button class="secondary-btn" id="approveSellerBtn">Approve</button>
          <button class="ghost-btn" id="rejectSellerBtn">Reject</button>
          <button class="ghost-btn" id="suspendSellerBtn">Suspend</button>
        </div>
      </div>
    `);

  document.getElementById('approveSellerBtn').addEventListener('click', async () => {
    const notes = document.getElementById('sellerReviewNotes').value;
    await window.updateSeller(sellerId, 'approved', notes);
    closeModal();
  });

  document.getElementById('rejectSellerBtn').addEventListener('click', async () => {
    const notes = document.getElementById('sellerReviewNotes').value;
    await window.updateSeller(sellerId, 'rejected', notes);
    closeModal();
  });

  document.getElementById('suspendSellerBtn').addEventListener('click', async () => {
    const notes = document.getElementById('sellerReviewNotes').value;
    await window.updateSeller(sellerId, 'suspended', notes);
    closeModal();
  });
};

function normalizeSellerImageFilename(filename) {
  if (!filename) return '';
  let normalized = String(filename).trim().replace(/\\/g, '/');
  if (!normalized) return '';
  if (/^https?:\/\//i.test(normalized)) return normalized;
  if (normalized.startsWith('./')) normalized = normalized.slice(2);
  if (normalized.startsWith('/')) normalized = normalized.slice(1);
  if (normalized.startsWith('images/')) return normalized;
  return `images/sellers/${normalized}`;
}

function sellerImageFileExists(filename) {
  const normalized = normalizeSellerImageFilename(filename);
  if (!normalized) return Promise.resolve(false);
  const url = `./${normalized}`;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

window.editSellerImage = (sellerId) => {
  const seller = state.data.sellers.find((item) => item.id === sellerId);
  if (!seller) return;

  const currentImage = seller.logo || seller.image || seller.imagePath || '';
  const currentPath = currentImage ? getSellerImageUrl(currentImage) : '';
  openModal(`Edit image for ${escapeHtml(seller.name || 'seller')}`, `
      <div class="form-grid" style="padding: 10px 0;">
        <label class="full">Seller image filename<input id="sellerImagePath" value="${escapeHtml(currentImage)}" placeholder="example.png" /></label>
        <div class="card" style="padding: 12px; max-width: 360px; width: 100%;">
          <strong>Image preview</strong>
          <img id="sellerImagePreview" src="${currentPath}" alt="Preview" style="width: 100%; max-width: 336px; height: 160px; object-fit: cover; border-radius: 12px; margin-top: 8px;" onerror="this.src='./images/placeholder.png'" />
          <div class="muted" style="margin-top: 8px; word-break: break-all;">Resolved path: <code id="sellerImageResolvedPath">${escapeHtml(currentPath)}</code></div>
        </div>
        <div class="row-actions full">
          <button class="primary-btn" id="saveSellerImageBtn">Save Image</button>
          <button class="ghost-btn" id="cancelSellerImageBtn">Cancel</button>
        </div>
      </div>
    `);

  const imageInput = document.getElementById('sellerImagePath');
  const preview = document.getElementById('sellerImagePreview');
  const resolvedPath = document.getElementById('sellerImageResolvedPath');

  imageInput.addEventListener('input', (event) => {
    const nextPath = String(event.target.value || '').trim();
    preview.src = getSellerImageUrl(nextPath);
    resolvedPath.textContent = nextPath ? getSellerImageUrl(nextPath) : '';
  });

  document.getElementById('saveSellerImageBtn').addEventListener('click', async () => {
    const imagePath = imageInput?.value?.trim() || '';
    if (!imagePath) {
      createToast('Please enter an image filename before saving.', 'warning');
      return;
    }

    const exists = await sellerImageFileExists(imagePath);
    if (!exists) {
      createToast('Image not found in images/sellers/. Please verify the filename.', 'error');
      return;
    }

    await window.updateSeller(sellerId, seller.status || seller.sellerStatus || 'pending', seller.reviewNotes || '', imagePath);
    closeModal();
  });

  document.getElementById('cancelSellerImageBtn').addEventListener('click', closeModal);
};

window.updateSeller = async (sellerId, status, reviewNotes = '', imagePath = '') => {
  const seller = state.data.sellers.find((item) => item.id === sellerId);
  if (!seller) return;
  const currentStatus = seller.status || seller.sellerStatus || 'pending';
  const inputImagePath = imagePath || document.getElementById('sellerImagePath')?.value?.trim() || '';
  if (currentStatus === status && !reviewNotes && inputImagePath === (seller.logo || seller.image || seller.imagePath || '')) {
    createToast(`No changes made to seller ${seller.name}.`, 'info');
    return;
  }
  try {
    const inputImagePath = imagePath || document.getElementById('sellerImagePath')?.value?.trim() || '';
    const normalizedImage = inputImagePath || seller.logo || seller.image || seller.imagePath || '';
    const updates = {
      status,
      sellerStatus: status,
      isActive: status === 'approved',
      reviewNotes,
      logo: normalizedImage,
      image: normalizedImage,
      imagePath: normalizedImage,
      sellerImage: normalizedImage,
      coverImage: normalizedImage,
      reviewedAt: new Date(),
      updatedAt: new Date()
    };

    const storage = initStorage();
    const db = storage?.db;
    const ownerUid = seller.ownerUid || seller.id;
    const userUpdates = {
      role: 'seller',
      sellerId,
      sellerStatus: status,
      isApproved: status === 'approved',
      sellerName: seller.name || seller.businessName || '',
      ownerName: seller.ownerName || '',
      email: seller.email || '',
      phone: seller.phone || '',
      logo: normalizedImage,
      image: normalizedImage,
      imagePath: normalizedImage,
      sellerImage: normalizedImage,
      coverImage: normalizedImage,
      updatedAt: new Date()
    };

    const writeOperations = [updateDocument('sellers', sellerId, updates)];

    if (db) {
      const userUpdatePromises = [];
      const ownerDocRef = db.collection('users').doc(ownerUid);
      const ownerDoc = await ownerDocRef.get();
      if (ownerDoc.exists || ownerUid) {
        userUpdatePromises.push(ownerDocRef.set(userUpdates, { merge: true }));
      }

      const sellerUserQuery = await db.collection('users').where('sellerId', '==', sellerId).limit(5).get();
      sellerUserQuery.forEach((doc) => {
        if (doc.id !== ownerUid) {
          userUpdatePromises.push(db.collection('users').doc(doc.id).set(userUpdates, { merge: true }));
        }
      });

      if (seller.email) {
        const emailQuery = await db.collection('users').where('email', '==', seller.email).limit(5).get();
        emailQuery.forEach((doc) => {
          if (doc.id !== ownerUid) {
            userUpdatePromises.push(db.collection('users').doc(doc.id).set(userUpdates, { merge: true }));
          }
        });
      }

      if (!userUpdatePromises.length) {
        userUpdatePromises.push(saveDocument('users', userUpdates, ownerUid));
      }

      writeOperations.push(...userUpdatePromises);
    } else {
      writeOperations.push(saveDocument('users', userUpdates, ownerUid));
    }

    await Promise.all(writeOperations);
    seller.status = status;
    seller.sellerStatus = status;
    seller.isActive = status === 'approved';
    seller.reviewNotes = reviewNotes;
    seller.logo = imagePath || seller.logo || '';
    seller.image = imagePath || seller.image || '';
    seller.imagePath = imagePath;
    seller.reviewedAt = new Date().toISOString();
    seller.updatedAt = new Date().toISOString();
    persistData();
    createToast(`Seller ${status}.`, 'success');
    renderSellers();
  } catch (error) {
    console.error(error);
    createToast('Unable to update seller approval status.', 'error');
  }
};

function renderCustomers() {
  const filtered = state.data.customers.filter((item) => !item.isDeleted).filter((item) => {
    const query = state.filters.customers.q.toLowerCase();
    const matches = !query || `${item.name} ${item.email} ${item.phone}`.toLowerCase().includes(query);
    const matchesStatus = state.filters.customers.status === 'all' || item.status === state.filters.customers.status;
    return matches && matchesStatus;
  });

  content.innerHTML = `
    <section class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">Customer Management</h3>
          <p class="card-subtitle">Suspend accounts and review customer activity</p>
        </div>
      </div>
      <div class="form-grid" style="grid-template-columns: 2fr 1fr; margin-bottom: 14px;">
        <label>Search<input id="customerSearch" value="${escapeHtml(state.filters.customers.q)}" /></label>
        <label>Status<select id="customerStatus">
          <option value="all">All</option>
          <option value="active" ${state.filters.customers.status === 'active' ? 'selected' : ''}>Active</option>
          <option value="suspended" ${state.filters.customers.status === 'suspended' ? 'selected' : ''}>Suspended</option>
        </select></label>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${filtered.map((customer) => `
              <tr>
                <td>${escapeHtml(customer.name)}</td>
                <td>${escapeHtml(customer.email)}</td>
                <td>${escapeHtml(customer.phone)}</td>
                <td><span class="badge-status ${customer.status === 'active' ? 'active' : 'suspended'}">${escapeHtml(customer.status)}</span></td>
                <td><div class="row-actions"><button class="secondary-btn" onclick="window.updateCustomer('${customer.id}','${customer.status === 'active' ? 'suspended' : 'active'}')">${customer.status === 'active' ? 'Suspend' : 'Activate'}</button><button class="ghost-btn" onclick="window.resetPassword('${customer.id}')">Reset Password</button></div></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;

  document.getElementById('customerSearch').addEventListener('input', (event) => {
    state.filters.customers.q = event.target.value;
    rerenderWithInputFocus(event.target, renderCustomers);
  });
  document.getElementById('customerStatus').addEventListener('change', (event) => {
    state.filters.customers.status = event.target.value;
    renderCustomers();
  });
}

window.updateCustomer = async (customerId, status) => {
  const customer = state.data.customers.find((item) => item.id === customerId);
  if (!customer) return;
  try {
    await updateDocument('users', customerId, {
      status,
      updatedAt: new Date()
    });
    customer.status = status;
    persistData();
    createToast(`Customer ${status}.`, 'success');
    renderCustomers();
  } catch (error) {
    console.error(error);
    createToast('Unable to update customer status.', 'error');
  }
};

window.resetPassword = async (customerId) => {
  const customer = state.data.customers.find((item) => item.id === customerId);
  if (!customer) return;

  const { auth } = initStorage();
  if (!auth || !customer.email) {
    createToast('Password reset is unavailable right now.', 'warning');
    return;
  }

  try {
    await auth.sendPasswordResetEmail(customer.email);
    createToast(`Password reset sent to ${customer.email}.`, 'success');
    state.data.logs.unshift({ id: Date.now().toString(), user: state.user.displayName, action: 'Reset password', details: customer.email, createdAt: new Date().toISOString() });
    persistData();
  } catch (error) {
    console.error(error);
    createToast(error?.message || 'Unable to send password reset email.', 'error');
  }
};

function renderDelivery() {
  const filtered = state.data.delivery.filter((item) => !item.isDeleted).filter((item) => {
    const query = state.filters.delivery.q.toLowerCase();
    const matches = !query || `${item.name} ${item.email} ${item.phone}`.toLowerCase().includes(query);
    const matchesStatus = state.filters.delivery.status === 'all' || item.status === state.filters.delivery.status;
    return matches && matchesStatus;
  });

  content.innerHTML = `
    <section class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">Delivery Person Management</h3>
          <p class="card-subtitle">Approvals, ratings, and performance</p>
        </div>
      </div>
      <div class="form-grid" style="grid-template-columns: 2fr 1fr; margin-bottom: 14px;">
        <label>Search<input id="deliverySearch" value="${escapeHtml(state.filters.delivery.q)}" /></label>
        <label>Status<select id="deliveryStatus">
          <option value="all">All</option>
          <option value="approved" ${state.filters.delivery.status === 'approved' ? 'selected' : ''}>Approved</option>
          <option value="pending" ${state.filters.delivery.status === 'pending' ? 'selected' : ''}>Pending</option>
          <option value="suspended" ${state.filters.delivery.status === 'suspended' ? 'selected' : ''}>Suspended</option>
        </select></label>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Rating</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${filtered.map((person) => `
              <tr>
                <td>${escapeHtml(person.name)}</td>
                <td>${escapeHtml(person.email)}</td>
                <td>${Number(person.rating || 0).toFixed(1)} ★</td>
                <td><span class="badge-status ${person.status === 'approved' ? 'active' : person.status === 'suspended' ? 'suspended' : 'pending'}">${escapeHtml(person.status)}</span></td>
                <td><div class="row-actions"><button class="secondary-btn" onclick="window.updateDelivery('${person.id}','approved')">Approve</button><button class="ghost-btn" onclick="window.updateDelivery('${person.id}','suspended')">Suspend</button></div></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;

  document.getElementById('deliverySearch').addEventListener('input', (event) => {
    state.filters.delivery.q = event.target.value;
    rerenderWithInputFocus(event.target, renderDelivery);
  });
  document.getElementById('deliveryStatus').addEventListener('change', (event) => {
    state.filters.delivery.status = event.target.value;
    renderDelivery();
  });
}

window.updateDelivery = async (deliveryId, status) => {
  const person = state.data.delivery.find((item) => item.id === deliveryId);
  if (!person) return;
  try {
    await updateDocument('users', deliveryId, {
      status,
      isActive: status === 'approved',
      updatedAt: new Date()
    });
    person.status = status;
    person.isActive = status === 'approved';
    persistData();
    createToast(`Delivery person ${status}.`, 'success');
    renderDelivery();
  } catch (error) {
    console.error(error);
    createToast('Unable to update delivery status.', 'error');
  }
};

function renderOrders() {
  content.innerHTML = `
    <section class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">Order Center</h3>
          <p class="card-subtitle">Monitor live orders and fulfillment</p>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Order</th><th>Customer</th><th>Seller</th><th>Variant</th><th>Customization</th><th>Status</th><th>Delivery</th><th>Payment</th><th>Refund</th><th>Total</th><th>Date</th></tr></thead>
          <tbody>
            ${state.data.orders.map((order) => {
              const isCustomized = isCustomizedOrder(order);
              const feeStatus = getCustomizationFeeStatus({ ...order, customizationRequested: isCustomized });
              const customizationFee = Number(order.customizationFee || 0);
              const feeOptions = [0, 25, 50, 100, 150, 250, 500, 1000];
              const selectedFeeOption = feeStatus === 'not_quoted'
                ? ''
                : feeOptions.includes(customizationFee) ? String(customizationFee) : 'custom';
              const customizationCell = isCustomized ? `
                <span class="badge">Customized Order</span>
                <div class="body-small">${escapeHtml(order.customizationDetails || order.items?.filter((item) => item.customizationRequested).map((item) => `${item.name}: ${item.customizationDetails || ''}`).join(' • ') || 'No design details provided')}</div>
                <div class="body-small">Fee: ${customizationFee ? formatCurrency(customizationFee, 'LRD') : 'Not set'} • ${escapeHtml(feeStatus.replace(/_/g, ' '))}</div>
                ${order.customizationFeePaymentStatus === 'submitted' ? `<div class="body-small">Payment: ${escapeHtml(order.customizationFeePaymentMethod || '')} • ${escapeHtml(order.customizationFeePaymentPhone || '')} • Ref: ${escapeHtml(order.customizationFeePaymentReference || '')}</div><div class="row-actions"><button class="primary-btn" type="button" data-confirm-customization-fee="${escapeHtml(order.id)}">Confirm fee paid</button>${order.customizationFeePaymentMethod !== 'balance' ? `<button class="ghost-btn" type="button" data-reject-customization-fee="${escapeHtml(order.id)}">Reject payment</button>` : ''}</div>` : ''}
                ${feeStatus !== 'paid' ? `
                  <label>Set fee<select data-customization-fee-select="${escapeHtml(order.id)}">
                    <option value="">Choose fee</option>
                    <option value="0" ${selectedFeeOption === '0' ? 'selected' : ''}>Waive fee</option>
                    ${feeOptions.filter((amount) => amount > 0).map((amount) => `<option value="${amount}" ${selectedFeeOption === String(amount) ? 'selected' : ''}>${formatCurrency(amount, 'LRD')}</option>`).join('')}
                    <option value="custom" ${selectedFeeOption === 'custom' ? 'selected' : ''}>Custom amount</option>
                  </select></label>
                  <input type="number" min="0" max="1000000" step="0.01" data-customization-fee-custom="${escapeHtml(order.id)}" value="${selectedFeeOption === 'custom' && customizationFee ? customizationFee : ''}" placeholder="Custom fee (LRD)" aria-label="Custom fee in LRD" ${selectedFeeOption === 'custom' ? '' : 'hidden'} />
                  <button class="secondary-btn" type="button" data-save-customization-fee="${escapeHtml(order.id)}">Save fee</button>
                ` : '<div class="body-small">Fee payment confirmed.</div>'}
              ` : '<span class="body-small">—</span>';
              return `
              <tr>
                <td>${escapeHtml(order.orderNumber || order.id)}${isCustomized ? '<div><span class="badge">Customized</span></div>' : ''}</td>
                <td>${escapeHtml(order.customerName || 'Customer')}</td>
                <td>${escapeHtml(order.sellerName || 'Seller')}</td>
                <td><div class="body-small">${[
                  order.items?.[0]?.storageSize ? `Storage ${escapeHtml(order.items[0].storageSize)}` : '',
                  order.items?.[0]?.shoeSize ? `Size ${escapeHtml(order.items[0].shoeSize)}` : '',
                  order.items?.[0]?.color ? `Color ${escapeHtml(order.items[0].color)}` : '',
                  ...Object.entries(order.items?.[0]?.selectedVariants || {}).map(([key, value]) => `${escapeHtml(key)}: ${escapeHtml(value)}`)
                ].filter(Boolean).join(' • ')}</div></td>
                <td>${customizationCell}</td>
                <td><span class="badge-status ${order.status === 'completed' || order.status === 'delivered' ? 'active' : 'pending'}">${escapeHtml(order.status || 'pending')}</span></td>
                <td>${escapeHtml(order.deliveryLocationLabel || 'Standard')}<div class="body-small">${escapeHtml(order.deliveryLandmark || order.deliveryDetails || 'No notes')}</div></td>
                <td>${escapeHtml(order.paymentMethod || 'pending')}<div class="body-small">${escapeHtml(order.paymentDetails || (order.orderType === 'signup_blind_box' ? 'Free signup reward · 0 LRD' : ''))}</div><div class="body-small">${escapeHtml(order.paymentStatus || 'pending')}</div>${order.paymentStatus === 'pending' ? order.orderType === 'signup_blind_box' ? `<button class="primary-btn" onclick="window.confirmSignupRewardOrder('${escapeHtml(order.id)}')">Confirm free reward</button>` : `<button class="primary-btn" onclick="window.confirmOrderPayment('${escapeHtml(order.id)}')">Confirm payment</button>` : ''}</td>
                <td>${escapeHtml(order.refundStatus || 'none')}<div class="body-small">${escapeHtml(order.refundReason || '')}</div></td>
                <td>${formatCurrency(order.total)}${isCustomized && customizationFee > 0 ? `<div class="body-small">Customization due: ${formatCurrency(customizationFee, 'LRD')}</div>` : ''}<div class="body-small">Seller payout: ${escapeHtml(order.sellerPayoutStatus || 'pending')}</div><div class="body-small">Delivery payout: ${escapeHtml(order.deliveryPayoutStatus || 'pending')}</div></td>
                <td>Placed: ${formatDate(order.placedAt || order.createdAt)}<div class="body-small">Estimated delivery</div><input type="datetime-local" data-order-estimate value="${toDateTimeLocalInput(order.estimatedDeliveryTime)}" aria-label="Estimated delivery for order ${escapeHtml(order.orderNumber || order.id)}" /><button class="secondary-btn" type="button" data-save-order-estimate="${escapeHtml(order.id)}">Save date</button></td>
              </tr>
            `}).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;

  content.querySelectorAll('[data-save-order-estimate]').forEach((button) => {
    button.addEventListener('click', async () => {
      const orderId = button.dataset.saveOrderEstimate;
      const order = state.data.orders.find((item) => item.id === orderId);
      const input = button.closest('tr')?.querySelector('[data-order-estimate]');
      const estimatedDeliveryTime = input?.value ? new Date(input.value) : null;
      if (!order || !estimatedDeliveryTime || !Number.isFinite(estimatedDeliveryTime.getTime())) {
        createToast('Choose a valid estimated delivery date and time.', 'warning');
        return;
      }
      button.disabled = true;
      try {
        await updateDocument('orders', orderId, { estimatedDeliveryTime, updatedAt: new Date() });
        order.estimatedDeliveryTime = estimatedDeliveryTime;
        createToast('Estimated delivery updated.', 'success');
        renderOrders();
      } catch (error) {
        button.disabled = false;
        createToast(error.message || 'Unable to update estimated delivery.', 'error');
      }
    });
  });
  content.querySelectorAll('[data-customization-fee-select]').forEach((select) => {
    select.addEventListener('change', () => {
      const input = [...content.querySelectorAll('[data-customization-fee-custom]')]
        .find((entry) => entry.dataset.customizationFeeCustom === select.dataset.customizationFeeSelect);
      if (input) input.hidden = select.value !== 'custom';
    });
  });
  content.querySelectorAll('[data-save-customization-fee]').forEach((button) => {
    button.addEventListener('click', () => saveOrderCustomizationFee(button.dataset.saveCustomizationFee, button));
  });
  content.querySelectorAll('[data-confirm-customization-fee]').forEach((button) => {
    button.addEventListener('click', () => confirmOrderCustomizationFee(button.dataset.confirmCustomizationFee));
  });
  content.querySelectorAll('[data-reject-customization-fee]').forEach((button) => {
    button.addEventListener('click', () => rejectOrderCustomizationFee(button.dataset.rejectCustomizationFee));
  });
}

function toDateTimeLocalInput(value) {
  if (!value) return '';
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

async function saveOrderCustomizationFee(orderId, button) {
  const order = state.data.orders.find((item) => item.id === orderId);
  const row = button.closest('tr');
  const selection = [...(row?.querySelectorAll('[data-customization-fee-select]') || [])]
    .find((input) => input.dataset.customizationFeeSelect === orderId);
  const customInput = [...(row?.querySelectorAll('[data-customization-fee-custom]') || [])]
    .find((input) => input.dataset.customizationFeeCustom === orderId);
  if (!order || !isCustomizedOrder(order)) return;
  if (order.customizationFeePaymentStatus === 'paid') {
    createToast('A confirmed customization fee cannot be changed.', 'warning');
    return;
  }
  if (order.customizationFeePaymentStatus === 'submitted') {
    createToast('Review the submitted fee payment before changing the quoted amount.', 'warning');
    return;
  }
  if (!selection?.value) {
    createToast('Choose a fee amount or select a custom amount.', 'warning');
    return;
  }
  let fee;
  try {
    fee = normalizeCustomizationFee(selection.value === 'custom' ? customInput?.value : selection.value);
    if (selection.value === 'custom' && !String(customInput?.value || '').trim()) throw new RangeError('Enter the custom fee amount in LRD.');
  } catch (error) {
    createToast(error.message, 'warning');
    return;
  }
  button.disabled = true;
  try {
    const feeStatus = fee === 0 ? 'waived' : 'unpaid';
    const updates = {
      customizationRequested: true,
      customizationFee: fee,
      customizationFeeCurrency: 'LRD',
      customizationFeePaymentStatus: feeStatus,
      customizationFeeQuotedAt: new Date(),
      customizationFeeQuotedBy: state.user?.uid || state.user?.email || 'admin',
      customizationFeePaymentReference: '',
      customizationFeePaymentPhone: '',
      customizationFeePaymentSubmittedAt: null,
      customizationFeePaymentConfirmedAt: null,
      customizationFeeWalletPaymentCompleted: false,
      ...(fee === 0 && order.paymentStatus === 'confirmed' ? { status: 'preparing' } : {}),
      updatedAt: new Date()
    };
    await updateDocument('orders', orderId, updates);
    Object.assign(order, updates);
    await createRoleNotification(initStorage().db, order.customerUid, 'customer', {
      title: fee === 0 ? 'Customization fee waived' : 'Customization fee added',
      message: fee === 0
        ? `The customization fee for order #${order.orderNumber || orderId.slice(0, 6)} was waived.`
        : `A customization fee of ${formatCurrency(fee, 'LRD')} was added to order #${order.orderNumber || orderId.slice(0, 6)}. Open the order to view payment instructions.`,
      type: 'payment'
    });
    createToast(fee === 0 ? 'Customization fee waived.' : 'Customization fee saved on the order.', 'success');
    renderOrders();
  } catch (error) {
    console.error('[Manna Marketplace] Customization fee could not be saved:', error);
    button.disabled = false;
    createToast(error.message || 'Unable to save the customization fee.', 'error');
  }
}

async function confirmOrderCustomizationFee(orderId) {
  const order = state.data.orders.find((item) => item.id === orderId);
  if (!order || order.customizationFeePaymentStatus !== 'submitted') return;
  const reference = window.prompt('Confirm the customization fee payment reference', order.customizationFeePaymentReference || '');
  if (!reference?.trim()) return;
  try {
    const updates = {
      customizationFeePaymentStatus: 'paid',
      customizationFeePaymentConfirmationReference: reference.trim(),
      customizationFeePaymentConfirmedAt: new Date(),
      customizationFeePaymentConfirmedBy: state.user?.uid || state.user?.email || 'admin',
      ...(order.paymentStatus === 'confirmed' ? { status: 'preparing' } : {}),
      updatedAt: new Date()
    };
    await updateDocument('orders', orderId, updates);
    Object.assign(order, updates);
    await createRoleNotification(initStorage().db, order.customerUid, 'customer', {
      title: 'Customization fee confirmed',
      message: `Your customization fee for order #${order.orderNumber || orderId.slice(0, 6)} was confirmed.`,
      type: 'payment'
    });
    createToast('Customization fee payment confirmed.', 'success');
    renderOrders();
  } catch (error) {
    console.error('[Manna Marketplace] Customization fee payment confirmation failed:', error);
    createToast(error.message || 'Unable to confirm the customization fee payment.', 'error');
  }
}

async function rejectOrderCustomizationFee(orderId) {
  const order = state.data.orders.find((item) => item.id === orderId);
  if (!order || order.customizationFeePaymentStatus !== 'submitted') return;
  if (order.customizationFeePaymentMethod === 'balance') {
    createToast('Wallet fee payments are already deducted. Verify the wallet transaction before confirming; do not reject it here.', 'warning');
    return;
  }
  const reason = window.prompt('Why is the customization fee payment not confirmed?', 'Payment could not be verified');
  if (!reason?.trim()) return;
  try {
    const updates = {
      customizationFeePaymentStatus: 'rejected',
      customizationFeePaymentRejectedReason: reason.trim(),
      customizationFeePaymentRejectedAt: new Date(),
      customizationFeePaymentRejectedBy: state.user?.uid || state.user?.email || 'admin',
      updatedAt: new Date()
    };
    await updateDocument('orders', orderId, updates);
    Object.assign(order, updates);
    await createRoleNotification(initStorage().db, order.customerUid, 'customer', {
      title: 'Customization fee payment needs review',
      message: `The payment for the customization fee on order #${order.orderNumber || orderId.slice(0, 6)} could not be confirmed. Please review the order and resubmit payment details.`,
      type: 'payment'
    });
    createToast('Customization fee payment marked for resubmission.', 'warning');
    renderOrders();
  } catch (error) {
    console.error('[Manna Marketplace] Customization fee payment rejection failed:', error);
    createToast(error.message || 'Unable to update customization fee payment.', 'error');
  }
}

window.confirmOrderPayment = async (orderId) => {
  const order = state.data.orders.find((item) => item.id === orderId);
  if (!order || order.paymentStatus === 'confirmed') return;
  const isWalletPaid = order.paymentMethod === 'balance' && order.walletPaymentCompleted;
  const reference = isWalletPaid ? 'Customer balance payment' : window.prompt('Confirm payment reference', order.paymentDetails || '');
  if (!reference || !reference.trim()) return;
  try {
    if (order.sellerId && Number(order.totalPrice ?? order.subtotal ?? order.total ?? 0) > 0) {
      await distributeOrderRevenue({ id: orderId, ...order });
    }
    const canBeginFulfillment = canFulfillCustomizedOrder(order);
    await updateDocument('orders', orderId, {
      paymentStatus: 'confirmed',
      status: canBeginFulfillment ? 'preparing' : 'pending',
      paymentConfirmedAt: new Date(),
      paymentConfirmedBy: state.user?.uid || state.user?.email || 'admin',
      paymentConfirmationReference: reference.trim(),
      updatedAt: new Date()
    });
    await createRoleNotification(initStorage().db, order.customerUid, 'customer', {
      title: 'Payment confirmed',
      message: canBeginFulfillment
        ? `Payment for order #${order.orderNumber || order.id.slice(0, 6)} was confirmed.`
        : `Product payment for order #${order.orderNumber || order.id.slice(0, 6)} was confirmed. This customized order will proceed after the customization fee is quoted and confirmed.`,
      type: 'payment'
    });
    createToast(canBeginFulfillment
      ? isWalletPaid ? 'Wallet payment confirmed and seller revenue credited.' : 'Order payment confirmed and seller revenue credited.'
      : 'Product payment confirmed. The customized order is waiting for its fee to be paid and confirmed.', 'success');
  } catch (error) {
    createToast(error.message || 'Unable to confirm order payment.', 'error');
  }
};

window.confirmSignupRewardOrder = async (orderId) => {
  const order = state.data.orders.find((item) => item.id === orderId);
  if (!order || order.orderType !== 'signup_blind_box' || order.paymentStatus === 'confirmed') return;
  if (!window.confirm(`Confirm this free reward order for ${order.customerName || 'the customer'}?`)) return;
  try {
    const app = window.firebase.app('manna-marketplace-data');
    const confirmReward = window.firebase.functions(app).httpsCallable('confirmSignupRewardOrder');
    await confirmReward({ orderId });
    createToast('Reward order confirmed and sent to regular delivery.', 'success');
  } catch (error) {
    createToast(error.message || 'Unable to confirm reward order.', 'error');
  }
};

function renderAnalytics() {
  const analytics = buildAnalyticsSnapshot();
  const sellers = state.data.sellers.filter((item) => !item.isDeleted);
  const sellerOptions = sellers.map((seller) => `<option value="${escapeHtml(seller.id)}" ${state.filters.analytics.sellerId === seller.id ? 'selected' : ''}>${escapeHtml(seller.name || seller.businessName || seller.id)}</option>`).join('');

  content.innerHTML = `
    <section class="card analytics-shell">
      <div class="card-header">
        <div>
          <h3 class="card-title">Analytics</h3>
          <p class="card-subtitle">Live purchase, refund, and cash-flow intelligence across the platform.</p>
        </div>
      </div>
      <div class="form-grid" style="grid-template-columns: 2fr 1fr 1fr; margin-bottom: 14px;">
        <label>Seller<select id="analyticsSellerFilter"><option value="all">All sellers</option>${sellerOptions}</select></label>
        <label>Range<select id="analyticsRangeFilter"><option value="day" ${state.filters.analytics.range === 'day' ? 'selected' : ''}>Last 24h</option><option value="month" ${state.filters.analytics.range === 'month' ? 'selected' : ''}>This month</option></select></label>
        <div class="metric-badge" style="display:flex;align-items:center;justify-content:center;min-height:42px;">Live updates</div>
      </div>
      <div class="grid-3">
        <div class="card" style="padding: 14px">
          <h4>Purchases</h4>
          <p style="font-size: 1.45rem; margin: 6px 0">${analytics.purchaseCount}</p>
          <div class="body-small">Completed orders in the selected window</div>
        </div>
        <div class="card" style="padding: 14px">
          <h4>Refunds</h4>
          <p style="font-size: 1.45rem; margin: 6px 0">${analytics.refunded.length}</p>
          <div class="body-small">${formatCurrency(analytics.refunds)} refunded</div>
        </div>
        <div class="card" style="padding: 14px">
          <h4>Net Cash Flow</h4>
          <p style="font-size: 1.45rem; margin: 6px 0">${formatCurrency(analytics.netCashflow)}</p>
          <div class="body-small">${analytics.refundRate.toFixed(1)}% refund rate</div>
        </div>
      </div>
      <div class="dashboard-grid" style="margin-top: 14px;">
        <section class="panel-card">
          <div class="panel-card-header">
            <h4>Cash-flow trend</h4>
            <span class="metric-badge">${state.filters.analytics.range === 'day' ? 'Hourly' : 'Daily'}</span>
          </div>
          <div class="stack">
            ${analytics.series.map((point) => `
              <div class="list-row">
                <span>${escapeHtml(point.label)}</span>
                <span><strong>${formatCurrency(point.value)}</strong></span>
              </div>
            `).join('')}
          </div>
        </section>
        <section class="panel-card">
          <div class="panel-card-header">
            <h4>Top sellers</h4>
            <span class="metric-badge">Revenue</span>
          </div>
          <div class="stack">
            ${sellers.length ? sellers.slice(0, 5).map((seller) => {
    const sellerRevenue = state.data.orders.filter((order) => (order.sellerId || order.sellerName || '') === seller.id || (order.sellerName || '') === seller.name).reduce((sum, order) => sum + Number(order.total || 0), 0);
    return `<div class="list-row"><span>${escapeHtml(seller.name || seller.businessName || seller.id)}</span><span>${formatCurrency(sellerRevenue)}</span></div>`;
  }).join('') : '<div class="empty-state">No seller data yet.</div>'}
          </div>
        </section>
      </div>
    </section>
  `;

  document.getElementById('analyticsSellerFilter')?.addEventListener('change', (event) => {
    state.filters.analytics.sellerId = event.target.value;
    renderAnalytics();
  });
  document.getElementById('analyticsRangeFilter')?.addEventListener('change', (event) => {
    state.filters.analytics.range = event.target.value;
    renderAnalytics();
  });
}

async function sendPaymentReminders() {
  const now = Date.now();
  const reminderWindow = 30 * 60 * 1000;
  const maxAge = 24 * 60 * 60 * 1000;
  const pendingOrders = state.data.orders.filter((order) => {
    const createdAt = order.createdAt?.toDate ? order.createdAt.toDate().getTime() : new Date(order.createdAt || order.placedAt || 0).getTime();
    const lastReminder = order.lastPaymentReminderAt?.toDate ? order.lastPaymentReminderAt.toDate().getTime() : new Date(order.lastPaymentReminderAt || 0).getTime();
    return order.paymentStatus === 'pending' && createdAt && now - createdAt <= maxAge && (!lastReminder || now - lastReminder >= reminderWindow);
  });
  await Promise.all(pendingOrders.map(async (order) => {
    await updateDocument('orders', order.id, { lastPaymentReminderAt: new Date(), paymentReminderCount: Number(order.paymentReminderCount || 0) + 1, updatedAt: new Date() });
    if (order.customerUid) {
      await createRoleNotification(initStorage().db, order.customerUid, 'customer', { title: 'Payment confirmation pending', message: `Payment for order #${order.orderNumber || order.id.slice(0, 6)} is awaiting admin confirmation.`, type: 'payment' });
    }
  }));
}

function renderReports() {
  content.innerHTML = `
    <section class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">Reports</h3>
          <p class="card-subtitle">Resolve complaints and assign priorities</p>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Order</th><th>Customer</th><th>Seller</th><th>Reason</th><th>Status</th><th>Priority</th><th>Actions</th></tr></thead>
          <tbody>
            ${state.data.reports.map((report) => `
              <tr>
                <td>${escapeHtml(report.orderId)}</td>
                <td>${escapeHtml(report.customerName)}</td>
                <td>${escapeHtml(report.sellerName)}</td>
                <td>${escapeHtml(report.reason)}</td>
                <td><span class="badge-status ${report.status === 'resolved' ? 'active' : 'pending'}">${escapeHtml(report.status)}</span></td>
                <td>${escapeHtml(report.priority)}</td>
                <td><div class="row-actions"><button class="secondary-btn" onclick="window.resolveReport('${report.id}')">Resolve</button><button class="ghost-btn" onclick="window.dismissReport('${report.id}')">Dismiss</button></div></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

window.resolveReport = (reportId) => {
  const report = state.data.reports.find((item) => item.id === reportId);
  if (!report) return;
  report.status = 'resolved';
  persistData();
  createToast('Report resolved.', 'success');
  renderReports();
};

window.dismissReport = (reportId) => {
  const report = state.data.reports.find((item) => item.id === reportId);
  if (!report) return;
  report.status = 'dismissed';
  persistData();
  createToast('Report dismissed.', 'warning');
  renderReports();
};

function renderCoupons() {
  content.innerHTML = `
    <section class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">Coupons</h3>
          <p class="card-subtitle">Promotions and platform offers</p>
        </div>
        <button class="primary-btn" id="createCoupon">Create Coupon</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Code</th><th>Type</th><th>Value</th><th>Applicable</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${state.data.coupons.map((coupon) => `
              <tr>
                <td>${escapeHtml(coupon.code)}</td>
                <td>${escapeHtml(coupon.type)}</td>
                <td>${coupon.type === 'percentage' ? `${coupon.value}%` : formatCurrency(coupon.value)}</td>
                <td>${escapeHtml(coupon.applicableTo)}</td>
                <td><span class="badge-status ${coupon.status === 'active' ? 'active' : 'pending'}">${escapeHtml(coupon.status)}</span></td>
                <td><div class="row-actions"><button class="secondary-btn" onclick="window.toggleCoupon('${coupon.id}')">Toggle</button><button class="ghost-btn" onclick="window.deleteCoupon('${coupon.id}')">Delete</button></div></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;
  document.getElementById('createCoupon').addEventListener('click', () => {
    const code = window.prompt('Coupon code');
    if (!code) return;
    const type = window.prompt('Type (percentage/fixed)', 'percentage') || 'percentage';
    const value = Number(window.prompt('Value', '10') || 0);
    const coupon = { id: `cp-${Date.now()}`, code, type, value, applicableTo: 'platform', minOrderValue: 300, expiryDate: '2026-12-31', usageLimit: 100, status: 'active' };
    state.data.coupons.unshift(coupon);
    persistData();
    createToast('Coupon created.', 'success');
    renderCoupons();
  });
}

window.toggleCoupon = (couponId) => {
  const coupon = state.data.coupons.find((item) => item.id === couponId);
  if (!coupon) return;
  coupon.status = coupon.status === 'active' ? 'inactive' : 'active';
  persistData();
  createToast('Coupon updated.', 'success');
  renderCoupons();
};

window.deleteCoupon = (couponId) => {
  state.data.coupons = state.data.coupons.filter((item) => item.id !== couponId);
  persistData();
  createToast('Coupon deleted.', 'warning');
  renderCoupons();
};

function renderAnnouncements() {
  content.innerHTML = `
    <section class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">Announcements</h3>
          <p class="card-subtitle">Broadcast updates to selected audiences</p>
        </div>
        <button class="primary-btn" id="createAnnouncement">Create Announcement</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Title</th><th>Audience</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${state.data.announcements.map((announcement) => `
              <tr>
                <td>${escapeHtml(announcement.title)}</td>
                <td>${escapeHtml(announcement.target)}</td>
                <td>${escapeHtml(announcement.status)}</td>
                <td><button class="ghost-btn" onclick="window.deleteAnnouncement('${announcement.id}')">Delete</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;
  document.getElementById('createAnnouncement').addEventListener('click', () => {
    const title = window.prompt('Announcement title');
    const message = window.prompt('Message');
    const target = window.prompt('Target (all/customers/sellers/delivery)', 'all') || 'all';
    if (!title || !message) return;
    const announcement = { id: `a-${Date.now()}`, title, message, target, status: 'published', scheduledAt: '' };
    state.data.announcements.unshift(announcement);
    state.data.notifications.unshift({ id: `n-${Date.now()}`, title, message, type: 'announcement', createdAt: new Date().toISOString(), read: false });
    persistData();
    createToast('Announcement published.', 'success');
    renderAnnouncements();
  });
}

window.deleteAnnouncement = (announcementId) => {
  state.data.announcements = state.data.announcements.filter((item) => item.id !== announcementId);
  persistData();
  createToast('Announcement removed.', 'warning');
  renderAnnouncements();
};

function renderNotifications() {
  const visible = state.data.notifications.filter((item) => !item.isDeleted);
  content.innerHTML = `
    <section class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">Notifications</h3>
          <p class="card-subtitle">Unread and recent platform events</p>
        </div>
        <div class="row-actions">
          ${renderSoundToggle()}
          <button class="ghost-btn" onclick="window.clearAllNotifications()">Clear all</button>
        </div>
      </div>
      <div class="form-grid">
        ${visible.length ? visible.map((notification) => `
          <div class="card" style="padding: 12px;">
            <div class="card-header" style="margin-bottom: 8px">
              <strong>${escapeHtml(notification.title)}</strong>
              <span class="badge-status ${notification.read ? 'active' : 'pending'}">${notification.read ? 'Read' : 'Unread'}</span>
            </div>
            <p style="margin: 0 0 8px; color: var(--muted)">${escapeHtml(notification.message)}</p>
            <div class="row-actions">
              <button class="secondary-btn" onclick="window.markNotificationRead('${notification.id}')">Mark Read</button>
              <button class="ghost-btn" onclick="window.deleteNotification('${notification.id}')">Delete</button>
            </div>
          </div>
        `).join('') : '<div class="empty-state">No notifications yet.</div>'}
      </div>
    </section>
  `;
  bindSoundToggle(content);
}

window.markNotificationRead = (notificationId) => {
  const notification = state.data.notifications.find((item) => item.id === notificationId);
  if (!notification) return;
  notification.read = true;
  persistData();
  createToast('Notification marked as read.', 'success');
  renderNotifications();
  updateNotificationBadge();
};

window.deleteNotification = (notificationId) => {
  const notification = state.data.notifications.find((item) => item.id === notificationId);
  if (!notification) return;
  notification.read = true;
  notification.isDeleted = true;
  persistData();
  createToast('Notification removed.', 'warning');
  renderNotifications();
  updateNotificationBadge();
};

window.clearAllNotifications = () => {
  state.data.notifications = state.data.notifications.map((item) => (item.isDeleted ? item : { ...item, read: true, isDeleted: true }));
  persistData();
  createToast('All notifications cleared.', 'success');
  renderNotifications();
  updateNotificationBadge();
};

async function resetAppToFactoryState() {
  if (!confirmDialog('This will permanently wipe orders, notifications, reports, support requests, help content, announcements, coupons, and other local database-backed app data, then restart the app as a fresh state. Continue?')) {
    return;
  }

  try {
    const { db } = initStorage();
    if (!db) {
      createToast('local storage is unavailable right now. The reset could not be completed.', 'error');
      return;
    }

    createToast('Resetting app data and restarting…', 'info');

    const collectionsToReset = ['orders', 'notifications', 'reports', 'supportRequests', 'helpArticles', 'announcements', 'coupons', 'masterProducts', 'sellers', 'adminSessions'];
    const preserveUserIds = [state.user?.uid].filter(Boolean);

    for (const collectionName of collectionsToReset) {
      const snapshot = await db.collection(collectionName).get();
      await Promise.all(snapshot.docs.map((doc) => db.collection(collectionName).doc(doc.id).delete().catch(() => null)));
    }

    const usersSnapshot = await db.collection('users').get();
    await Promise.all(usersSnapshot.docs
      .filter((doc) => !preserveUserIds.includes(doc.id))
      .map((doc) => db.collection('users').doc(doc.id).delete().catch(() => null)));

    const localStorageKeys = [...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter((key, index, array) => array.indexOf(key) === index);
    localStorageKeys.filter((key) => key.startsWith('manna-') || key.startsWith('storage:') || key === 'cart').forEach((key) => {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    });

    state.data = {
      products: [],
      sellers: [],
      customers: [],
      delivery: [],
      orders: [],
      reports: [],
      coupons: [],
      announcements: [],
      notifications: [],
      supportRequests: [],
      settings: {},
      logs: []
    };
    state.filters = {
      products: { q: '', category: 'all', status: 'all', sort: 'date' },
      sellers: { q: '', status: 'all' },
      customers: { q: '', status: 'all' },
      delivery: { q: '', status: 'all' },
      analytics: { range: 'month', sellerId: 'all' }
    };
    state.ui.selectedProducts = new Set();

    clearStoredAuthState();
    window.setTimeout(() => {
      window.location.assign(window.location.pathname);
    }, 600);
  } catch (error) {
    console.error('[Manna Marketplace] App reset failed:', error);
    createToast(error.message || 'The app reset could not be completed.', 'error');
  }
}

window.resetAppToFactoryState = resetAppToFactoryState;

function renderSettings() {
  const settings = state.data.settings || {};
  const catalogPriceRule = getActiveCatalogPriceRule(settings);
  const catalogCategoryOptions = getCategoryOptions().map((category) => `
    <option value="${escapeHtml(category.id)}" ${catalogPriceRule?.categoryIds?.includes(category.id) ? 'selected' : ''}>${escapeHtml(category.name)}</option>
  `).join('');
  const catalogRuleExpiry = catalogPriceRule?.expiresAt
    ? new Date(catalogPriceRule.expiresAt).toLocaleString()
    : '';
  const maintenanceExpiry = getMaintenanceExpiryMs(settings.maintenanceUntil);
  const maintenanceDurationMinutes = maintenanceExpiry && maintenanceExpiry > Date.now()
    ? Math.max(1, Math.ceil((maintenanceExpiry - Date.now()) / 60000))
    : Number(settings.maintenanceDurationMinutes) || 60;
  const maintenanceActive = isMaintenanceActive(settings);
  content.innerHTML = `
    <section class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">Temporary Catalog Price Adjustment</h3>
          <p class="card-subtitle">Temporarily increase or decrease the master price across the catalog or selected categories. Seller markups stay unchanged, and product/category prices are not rewritten.</p>
        </div>
      </div>
      <div class="form-grid">
        <label>Apply to<select id="catalogPriceScope"><option value="all" ${catalogPriceRule?.scope !== 'categories' ? 'selected' : ''}>All catalog products</option><option value="categories" ${catalogPriceRule?.scope === 'categories' ? 'selected' : ''}>Selected categories</option></select></label>
        <label>Adjustment<select id="catalogPriceDirection"><option value="decrease" ${catalogPriceRule?.direction !== 'increase' ? 'selected' : ''}>Decrease</option><option value="increase" ${catalogPriceRule?.direction === 'increase' ? 'selected' : ''}>Increase</option></select></label>
        <label>Adjustment type<select id="catalogPriceType"><option value="percent" ${catalogPriceRule?.adjustmentType !== 'fixed' ? 'selected' : ''}>Percentage (%)</option><option value="fixed" ${catalogPriceRule?.adjustmentType === 'fixed' ? 'selected' : ''}>Fixed amount (LRD)</option></select></label>
        <label>Amount<input id="catalogPriceValue" type="number" min="0.01" max="1000000" step="0.01" value="${escapeHtml(catalogPriceRule?.value ?? '')}" /></label>
        <label>Duration (minutes)<input id="catalogPriceDuration" type="number" min="1" max="10080" step="1" value="${escapeHtml(catalogPriceRule?.durationMinutes || 60)}" /></label>
        <label class="full">Categories (choose one or more)<select id="catalogPriceCategories" multiple size="5">${catalogCategoryOptions}</select></label>
        <p class="card-subtitle full">${catalogPriceRule ? `Active until ${escapeHtml(catalogRuleExpiry)}.` : 'No temporary catalog price adjustment is active.'}</p>
        <div class="modal-actions full">
          <button class="primary-btn" id="saveCatalogPriceRule" type="button">Apply Temporary Price Change</button>
          <button class="ghost-btn" id="stopCatalogPriceRule" type="button">Stop Price Change</button>
        </div>
      </div>
    </section>
    <section class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">Catalog Stock Count</h3>
          <p class="card-subtitle">Set the available count for master catalog products and their linked seller copies. Seller-created products are not changed.</p>
        </div>
      </div>
      <div class="form-grid">
        <label>Apply to<select id="catalogStockScope"><option value="all">All catalog products</option><option value="categories">Selected categories</option></select></label>
        <label>Set stock count<input id="catalogStockCount" type="number" min="0" max="1000000" step="1" placeholder="Enter a whole number" value="" /></label>
        <label class="full">Categories (choose one or more)<select id="catalogStockCategories" multiple size="5">${getCategoryOptions().map((category) => `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`).join('')}</select></label>
        <div class="modal-actions full"><button class="primary-btn" id="applyCatalogStock" type="button">Set Catalog Stock Count</button></div>
      </div>
    </section>
    <section class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">Platform Settings</h3>
          <p class="card-subtitle">Core platform configuration</p>
        </div>
      </div>
      <div class="form-grid">
        <label>Platform Name<input id="platformName" value="${escapeHtml(settings.platformName || 'Manna Marketplace')}" /></label>
        <label>Commission (%)<input id="commission" type="number" value="${escapeHtml(settings.commission || 8)}" /></label>
        <label>Currency<input id="currency" value="${escapeHtml(settings.currency || 'LRD')}" /></label>
        <label>Default Delivery Fee<input id="deliveryFee" type="number" value="${escapeHtml(settings.deliveryFee || 60)}" /></label>
        <label>Regular Delivery Fee<input id="regularDeliveryFee" type="number" value="${escapeHtml(settings.regularDeliveryFee || settings.deliveryFee || 60)}" /></label>
        <label>Express Delivery Fee<input id="expressDeliveryFee" type="number" value="${escapeHtml(settings.expressDeliveryFee || 120)}" /></label>
        <label>Regular Delivery Days<input id="regularDeliveryDays" type="number" value="${escapeHtml(settings.regularDeliveryDays || 3)}" /></label>
        <label>Express Delivery Hours<input id="expressDeliveryHours" type="number" value="${escapeHtml(settings.expressDeliveryHours || 24)}" /></label>
        <label>Admin Orange Money Number<input id="adminOrangeMoneyNumber" value="${escapeHtml(settings.adminOrangeMoneyNumber || '')}" /></label>
        <label>Admin Lonestar Number<input id="adminLonestarMoneyNumber" value="${escapeHtml(settings.adminLonestarMoneyNumber || '')}" /></label>
        <div class="card full" style="padding: 14px;">
          <h4>Customer payment methods</h4>
          <p class="card-subtitle">Enter the payment details customers should see at checkout for each currency.</p>
          <div class="form-grid">
            <label>UBA USD receiver name<input id="ubaUsdReceiverName" value="${escapeHtml(settings.ubaUsdReceiverName || settings.ubaUsdAccountName || '')}" placeholder="Name receiving the payment" /></label>
            <label>UBA USD account number<input id="ubaUsdAccountNumber" value="${escapeHtml(settings.ubaUsdAccountNumber || '')}" /></label>
            <label>UBA USD logo/image path<input id="ubaUsdPaymentImage" value="${escapeHtml(settings.ubaUsdPaymentImage || '')}" placeholder="images/payment-logos/uba-usd.png" /></label>
            <label>UBA LRD receiver name<input id="ubaLrdReceiverName" value="${escapeHtml(settings.ubaLrdReceiverName || settings.ubaLrdAccountName || '')}" placeholder="Name receiving the payment" /></label>
            <label>UBA LRD account number<input id="ubaLrdAccountNumber" value="${escapeHtml(settings.ubaLrdAccountNumber || '')}" /></label>
            <label>UBA LRD logo/image path<input id="ubaLrdPaymentImage" value="${escapeHtml(settings.ubaLrdPaymentImage || '')}" placeholder="images/payment-logos/uba-lrd.png" /></label>
            <label>Orange Money USD number<input id="orangeMoneyUsdNumber" value="${escapeHtml(settings.orangeMoneyUsdNumber || '')}" /></label>
            <label>Orange Money USD receiver name<input id="orangeMoneyUsdReceiverName" value="${escapeHtml(settings.orangeMoneyUsdReceiverName || '')}" placeholder="Name receiving the payment" /></label>
            <label>Orange Money USD logo/image path<input id="orangeMoneyUsdImage" value="${escapeHtml(settings.orangeMoneyUsdImage || '')}" placeholder="images/payments/orange.png" /></label>
            <label>Orange Money LRD number<input id="orangeMoneyLrdNumber" value="${escapeHtml(settings.orangeMoneyLrdNumber || '')}" /></label>
            <label>Orange Money LRD receiver name<input id="orangeMoneyLrdReceiverName" value="${escapeHtml(settings.orangeMoneyLrdReceiverName || '')}" placeholder="Name receiving the payment" /></label>
            <label>Orange Money LRD logo/image path<input id="orangeMoneyLrdImage" value="${escapeHtml(settings.orangeMoneyLrdImage || '')}" placeholder="images/payments/orange.png" /></label>
            <label>Lonestar Cell USD number<input id="lonestarMoneyUsdNumber" value="${escapeHtml(settings.lonestarMoneyUsdNumber || '')}" /></label>
            <label>Lonestar USD receiver name<input id="lonestarMoneyUsdReceiverName" value="${escapeHtml(settings.lonestarMoneyUsdReceiverName || '')}" placeholder="Name receiving the payment" /></label>
            <label>Lonestar USD logo/image path<input id="lonestarMoneyUsdImage" value="${escapeHtml(settings.lonestarMoneyUsdImage || '')}" placeholder="images/payments/lonestar.png" /></label>
            <label>Lonestar Cell LRD number<input id="lonestarMoneyLrdNumber" value="${escapeHtml(settings.lonestarMoneyLrdNumber || '')}" /></label>
            <label>Lonestar LRD receiver name<input id="lonestarMoneyLrdReceiverName" value="${escapeHtml(settings.lonestarMoneyLrdReceiverName || '')}" placeholder="Name receiving the payment" /></label>
            <label>Lonestar LRD logo/image path<input id="lonestarMoneyLrdImage" value="${escapeHtml(settings.lonestarMoneyLrdImage || '')}" placeholder="images/payments/lonestar.png" /></label>
          </div>
        </div>
        <label>Admin WhatsApp Number<input id="adminWhatsAppNumber" type="tel" value="${escapeHtml(settings.adminWhatsAppNumber || '')}" placeholder="e.g. +231770000000" /></label>
        <label>Tax (%)<input id="tax" type="number" value="${escapeHtml(settings.tax || 2)}" /></label>
        <label>Support Email<input id="supportEmail" value="${escapeHtml(settings.supportEmail || '')}" /></label>
        <label>Support Phone<input id="supportPhone" value="${escapeHtml(settings.supportPhone || '')}" /></label>
        <label>Platform Fee Type<select id="platformFeeType"><option value="percentage" ${settings.platformFeeType === 'percentage' ? 'selected' : ''}>Percentage</option><option value="fixed" ${settings.platformFeeType === 'fixed' ? 'selected' : ''}>Fixed</option></select></label>
        <label>Platform Fee Value<input id="platformFeeValue" type="number" value="${escapeHtml(settings.platformFeeValue || 8)}" /></label>
        <label>Maintenance Mode<select id="maintenanceMode"><option value="false" ${maintenanceActive ? '' : 'selected'}>Off</option><option value="true" ${maintenanceActive ? 'selected' : ''}>On</option></select><span class="card-subtitle">Pauses customer, seller, and delivery access. Turn it off anytime; admin access stays available.</span></label>
        <label>Maintenance duration (minutes)<input id="maintenanceDurationMinutes" type="number" min="1" max="10080" step="1" value="${escapeHtml(maintenanceDurationMinutes)}" /><span class="card-subtitle">When enabled, maintenance ends automatically after this duration (maximum 7 days).</span></label>
        <div class="modal-actions full">
          <button class="primary-btn" id="saveSettings">Save Settings</button>
          <button class="ghost-btn" type="button" onclick="window.resetAppToFactoryState()">Reset app to fresh state</button>
        </div>
      </div>
    </section>
  `;
  content.insertAdjacentHTML('afterbegin', `
    <section class="card appearance-settings">
      <div class="card-header"><div><h3 class="card-title">Appearance</h3><p class="card-subtitle">Choose the color theme for your account.</p></div></div>
      ${renderThemePreferenceControl()}
    </section>`);
  bindThemePreferenceControl(content, {
    db: initStorage().db,
    userId: state.user.uid,
    onSaved: (theme) => { state.theme = theme; },
    onError: () => createToast('Theme changed on this device, but could not sync to your account.', 'warning')
  });
  content.insertAdjacentHTML('beforeend', getQRCardHTML('adminQrContainer', 'adminQrCard'));
  initQRCode('adminQrContainer');
  bindQRDownloadHandlers();
  document.getElementById('saveCatalogPriceRule').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const scope = document.getElementById('catalogPriceScope').value;
    const direction = document.getElementById('catalogPriceDirection').value;
    const adjustmentType = document.getElementById('catalogPriceType').value;
    const value = Number(document.getElementById('catalogPriceValue').value);
    const durationMinutes = Number(document.getElementById('catalogPriceDuration').value);
    const categoryIds = [...document.getElementById('catalogPriceCategories').selectedOptions].map((option) => option.value);
    if (!Number.isFinite(value) || value <= 0 || value > 1000000 || (adjustmentType === 'percent' && value > 100)) {
      createToast(adjustmentType === 'percent' ? 'Enter a percentage greater than 0 and no more than 100.' : 'Enter a fixed LRD amount greater than 0 and no more than 1,000,000.', 'warning');
      return;
    }
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 10080) {
      createToast('Price adjustment duration must be from 1 minute to 7 days.', 'warning');
      return;
    }
    if (scope === 'categories' && categoryIds.length === 0) {
      createToast('Choose at least one category for this price adjustment.', 'warning');
      return;
    }
    const now = new Date();
    const rule = {
      enabled: true,
      scope,
      categoryIds: scope === 'categories' ? categoryIds : [],
      direction,
      adjustmentType,
      value,
      durationMinutes,
      startsAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + durationMinutes * 60000).toISOString()
    };
    button.disabled = true;
    button.textContent = 'Applying...';
    try {
      const storage = initStorage();
      if (!storage?.db) throw new Error('Database is not available. Please refresh and try again.');
      await storage.db.collection('adminSettings').doc('config').set({
        catalogPriceRule: rule,
        globalCatalogDiscountPercent: 0,
        updatedAt: now
      }, { merge: true });
      state.data.settings = { ...state.data.settings, catalogPriceRule: rule, globalCatalogDiscountPercent: 0 };
      persistData();
      createToast(`Temporary catalog price ${direction} applied for ${durationMinutes} minutes.`, 'success');
      renderSettings();
    } catch (error) {
      console.error('[Manna Marketplace] Catalog price rule save failed:', error);
      button.disabled = false;
      button.textContent = 'Apply Temporary Price Change';
      createToast(error.message || 'The temporary catalog price change could not be saved.', 'error');
    }
  });
  document.getElementById('stopCatalogPriceRule').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    if (!confirmDialog('Stop the temporary catalog price change now? Product prices and seller markups will remain unchanged.')) return;
    button.disabled = true;
    try {
      const storage = initStorage();
      if (!storage?.db) throw new Error('Database is not available. Please refresh and try again.');
      const stoppedRule = { ...(settings.catalogPriceRule || {}), enabled: false, stoppedAt: new Date().toISOString() };
      await storage.db.collection('adminSettings').doc('config').set({
        catalogPriceRule: stoppedRule,
        globalCatalogDiscountPercent: 0,
        updatedAt: new Date()
      }, { merge: true });
      state.data.settings = { ...state.data.settings, catalogPriceRule: stoppedRule, globalCatalogDiscountPercent: 0 };
      persistData();
      createToast('Temporary catalog price change stopped.', 'success');
      renderSettings();
    } catch (error) {
      console.error('[Manna Marketplace] Catalog price rule stop failed:', error);
      button.disabled = false;
      createToast(error.message || 'The temporary catalog price change could not be stopped.', 'error');
    }
  });
  document.getElementById('applyCatalogStock').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    let stockCount;
    try {
      const rawStockCount = document.getElementById('catalogStockCount').value.trim();
      if (!rawStockCount) throw new RangeError('Enter the stock count to set.');
      stockCount = normalizeCatalogStockCount(rawStockCount);
    } catch (error) {
      createToast(error.message, 'warning');
      return;
    }
    const scope = document.getElementById('catalogStockScope').value;
    const categoryIds = [...document.getElementById('catalogStockCategories').selectedOptions].map((option) => option.value);
    if (scope === 'categories' && categoryIds.length === 0) {
      createToast('Choose at least one category for the stock update.', 'warning');
      return;
    }
    const selectedCategoryIds = new Set(categoryIds);
    const products = state.data.products.filter((product) => !product.isDeleted
      && product.status !== 'deleted'
      && (scope === 'all' || selectedCategoryIds.has(normalizeCategoryValue(product.category)?.id)));
    if (!products.length) {
      createToast('No catalog products match the selected stock update.', 'warning');
      return;
    }
    if (!confirmDialog(`Set stock to ${stockCount} for ${products.length} master catalog products and their linked seller copies? Seller-created products will not be changed.`)) return;
    button.disabled = true;
    button.textContent = 'Updating...';
    try {
      const storage = initStorage();
      if (!storage?.db) throw new Error('Database is not available. Please refresh and try again.');
      const db = storage.db;
      const productIds = new Set(products.map((product) => product.id));
      const selectedProductIdList = [...productIds];
      const writes = [];
      const queueStockWrite = (ref, product) => {
        const updatedProduct = setCatalogProductStock(product, stockCount);
        const payload = { stockCount, updatedAt: new Date() };
        ['storageOptions', 'shoeVariants', 'variantOptions'].forEach((field) => {
          if (Array.isArray(updatedProduct[field])) payload[field] = updatedProduct[field];
        });
        writes.push({ ref, payload });
      };
      products.forEach((product) => queueStockWrite(db.collection('masterProducts').doc(product.id), product));
      const sellerSnapshot = await db.collection('sellers').get();
      for (const sellerDoc of sellerSnapshot.docs) {
        for (let offset = 0; offset < selectedProductIdList.length; offset += 10) {
          const masterIdChunk = selectedProductIdList.slice(offset, offset + 10);
          const menuSnapshot = await sellerDoc.ref.collection('menu')
            .where('masterProductId', 'in', masterIdChunk)
            .get();
          menuSnapshot.docs.forEach((menuDoc) => {
            const item = menuDoc.data() || {};
            if (!productIds.has(item.masterProductId) || item.isSellerOwned === true || item.orderFlow === 'seller_owned') return;
            queueStockWrite(menuDoc.ref, item);
          });
        }
      }
      for (let offset = 0; offset < writes.length; offset += 400) {
        const batch = db.batch();
        writes.slice(offset, offset + 400).forEach(({ ref, payload }) => batch.set(ref, payload, { merge: true }));
        await batch.commit();
      }
      state.data.products = state.data.products.map((product) => productIds.has(product.id)
        ? { ...setCatalogProductStock(product, stockCount), updatedAt: new Date() }
        : product);
      persistData();
      createToast(`Stock set to ${stockCount} for ${products.length} catalog products and ${writes.length - products.length} linked seller copies.`, 'success');
      renderSettings();
    } catch (error) {
      console.error('[Manna Marketplace] Catalog stock update failed:', error);
      button.disabled = false;
      button.textContent = 'Set Catalog Stock Count';
      createToast(error.message || 'Catalog stock could not be updated.', 'error');
    }
  });
  document.getElementById('saveSettings').addEventListener('click', async () => {
    const maintenanceEnabled = document.getElementById('maintenanceMode').value === 'true';
    const maintenanceDurationMinutes = Number(document.getElementById('maintenanceDurationMinutes').value);
    if (!Number.isInteger(maintenanceDurationMinutes) || maintenanceDurationMinutes < 1 || maintenanceDurationMinutes > 10080) {
      createToast('Maintenance duration must be from 1 minute to 7 days.', 'warning');
      return;
    }
    const maintenanceUntil = maintenanceEnabled
      ? new Date(Date.now() + maintenanceDurationMinutes * 60 * 1000).toISOString()
      : null;
    const nextSettings = {
      ...settings,
      platformName: document.getElementById('platformName').value,
      commission: Number(document.getElementById('commission').value || 0),
      currency: document.getElementById('currency').value,
      deliveryFee: Number(document.getElementById('deliveryFee').value || 0),
      regularDeliveryFee: Number(document.getElementById('regularDeliveryFee').value || 0),
      expressDeliveryFee: Number(document.getElementById('expressDeliveryFee').value || 0),
      regularDeliveryDays: Number(document.getElementById('regularDeliveryDays').value || 3),
      expressDeliveryHours: Number(document.getElementById('expressDeliveryHours').value || 24),
      adminOrangeMoneyNumber: document.getElementById('adminOrangeMoneyNumber').value.trim(),
      adminLonestarMoneyNumber: document.getElementById('adminLonestarMoneyNumber').value.trim(),
      ubaUsdReceiverName: document.getElementById('ubaUsdReceiverName').value.trim(),
      ubaUsdAccountNumber: document.getElementById('ubaUsdAccountNumber').value.trim(),
      ubaUsdPaymentImage: document.getElementById('ubaUsdPaymentImage').value.trim(),
      ubaLrdReceiverName: document.getElementById('ubaLrdReceiverName').value.trim(),
      ubaLrdAccountNumber: document.getElementById('ubaLrdAccountNumber').value.trim(),
      ubaLrdPaymentImage: document.getElementById('ubaLrdPaymentImage').value.trim(),
      orangeMoneyUsdNumber: document.getElementById('orangeMoneyUsdNumber').value.trim(),
      orangeMoneyUsdReceiverName: document.getElementById('orangeMoneyUsdReceiverName').value.trim(),
      orangeMoneyUsdImage: document.getElementById('orangeMoneyUsdImage').value.trim(),
      orangeMoneyLrdNumber: document.getElementById('orangeMoneyLrdNumber').value.trim(),
      orangeMoneyLrdReceiverName: document.getElementById('orangeMoneyLrdReceiverName').value.trim(),
      orangeMoneyLrdImage: document.getElementById('orangeMoneyLrdImage').value.trim(),
      lonestarMoneyUsdNumber: document.getElementById('lonestarMoneyUsdNumber').value.trim(),
      lonestarMoneyUsdReceiverName: document.getElementById('lonestarMoneyUsdReceiverName').value.trim(),
      lonestarMoneyUsdImage: document.getElementById('lonestarMoneyUsdImage').value.trim(),
      lonestarMoneyLrdNumber: document.getElementById('lonestarMoneyLrdNumber').value.trim(),
      lonestarMoneyLrdReceiverName: document.getElementById('lonestarMoneyLrdReceiverName').value.trim(),
      lonestarMoneyLrdImage: document.getElementById('lonestarMoneyLrdImage').value.trim(),
      adminWhatsAppNumber: document.getElementById('adminWhatsAppNumber').value.trim(),
      tax: Number(document.getElementById('tax').value || 0),
      supportEmail: document.getElementById('supportEmail').value,
      supportPhone: document.getElementById('supportPhone').value,
      platformFeeType: document.getElementById('platformFeeType').value,
      platformFeeValue: Number(document.getElementById('platformFeeValue').value || 0),
      maintenanceMode: maintenanceEnabled,
      maintenanceDurationMinutes,
      maintenanceUntil
    };
    const saveButton = document.getElementById('saveSettings');
    saveButton.disabled = true;
    saveButton.textContent = 'Saving...';
    try {
      const storage = initStorage();
      if (!storage?.db) throw new Error('Database is not available. Please refresh and try again.');
      await Promise.all([
          storage.db.collection('adminSettings').doc('config').set(nextSettings, { merge: true }),
          storage.db.collection('settings').doc('platform').set(nextSettings, { merge: true }),
          storage.db.collection('settings').doc('maintenance').set({
            maintenanceMode: maintenanceEnabled,
            maintenanceUntil
          }, { merge: true }),
          storage.db.collection('appConfig').doc('wallet').set({
            adminMobileName: nextSettings.platformName || 'Manna Marketplace',
            adminMobileNumber: nextSettings.adminOrangeMoneyNumber || nextSettings.adminLonestarMoneyNumber || '',
            adminOrangeMoneyNumber: nextSettings.adminOrangeMoneyNumber || '',
            adminLonestarMoneyNumber: nextSettings.adminLonestarMoneyNumber || '',
            depositNote: 'Send your deposit to the admin mobile-money account, then submit the payment reference.',
            currency: 'LRD',
            updatedAt: new Date()
          }, { merge: true })
      ]);
      state.data.settings = nextSettings;
      persistData();
      createToast('Settings saved.', 'success');
      state.data.logs.unshift({ id: Date.now().toString(), user: state.user.displayName, action: 'Update settings', details: 'Platform settings changed', createdAt: new Date().toISOString() });
      renderSettings();
    } catch (error) {
      console.error(error);
      createToast(error.message || 'Settings could not be saved.', 'error');
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = 'Save Settings';
    }
  });
}

// ===== ADMIN WALLET PREMIUM SESSION =====

function ensureAdminWalletSection() {
  if (document.getElementById('adminWalletSection')) return;
  const nav = document.querySelector('.nav-links');
  if (!nav) return;
  
  // Check if admin-wallet nav item exists
  if (nav.querySelector('[data-section="admin-wallet"]')) return;
  
  const button = document.createElement('button');
  button.className = 'nav-item premium-nav';
  button.setAttribute('data-section', 'admin-wallet');
  button.innerHTML = '<span class="nav-icon">👑</span><span>Admin Wallet</span><span class="premium-badge">PRO</span>';
  button.addEventListener('click', () => openSection('admin-wallet'));
  nav.appendChild(button);
}

async function calculateAdminBalance() {
  const db = window.firebase?.firestore ? window.firebase.firestore(window.firebase.apps.find((app) => app.name === 'manna-marketplace-data')) : null;
  if (!db) return { error: 'Firestore not available' };

  try {
    // Get all wallet transactions
    const transactionsSnapshot = await db.collection('walletTransactions').get();
    const transactions = transactionsSnapshot.docs.map((doc) => doc.data());

    // Get all withdrawal requests
    const withdrawalsSnapshot = await db.collection('withdrawalRequests').get();
    const withdrawals = withdrawalsSnapshot.docs.map((doc) => doc.data());

    // Get all deposit requests
    const depositsSnapshot = await db.collection('depositRequests').get();
    const deposits = depositsSnapshot.docs.map((doc) => doc.data());
    const adminSummarySnapshot = await db.collection('adminWallet').doc('summary').get();

    const adminBalance = {
      totalFeesCollected: 0,
      totalDepositsProcessed: 0,
      totalWithdrawalsPaid: 0,
      adminAccountBalance: 0,
      netAdminEarnings: 0,
      adminTransactions: [],
      pendingDeposits: 0,
      completedDeposits: 0,
      pendingWithdrawals: 0,
      completedWithdrawals: 0
    };

    // Process transactions for platform fees
    // Platform fee = 10% of seller earnings
    const sellerTransactions = transactions.filter((tx) => tx.userType === 'seller' && tx.type === 'order_earning' && tx.status === 'completed');
    sellerTransactions.forEach((tx) => {
      const fee = Math.round(Number(tx.amount || 0) * 0.1 * 100) / 100;
      adminBalance.totalFeesCollected += fee;
    });

    // Process customer deposits
    const confirmedDeposits = deposits.filter((d) => d.status === 'confirmed');
    confirmedDeposits.forEach((d) => {
      adminBalance.totalDepositsProcessed += Number(d.amount || 0);
      adminBalance.completedDeposits++;
    });

    // Count pending deposits
    adminBalance.pendingDeposits = deposits.filter((d) => d.status === 'pending').length;

    // Process withdrawals paid out
    const completedWithdrawals = withdrawals.filter((w) => w.status === 'completed' || w.status === 'received');
    completedWithdrawals.forEach((w) => {
      adminBalance.totalWithdrawalsPaid += Number(w.amount || 0);
      adminBalance.completedWithdrawals++;
    });

    // Count pending withdrawals
    adminBalance.pendingWithdrawals = withdrawals.filter((w) => w.status === 'pending').length;

    // Calculate net admin earnings
    // Admin earns: Fees collected + any admin-specific payments
    // Admin pays: Withdrawals to users + any admin expenses
    adminBalance.netAdminEarnings = adminBalance.totalFeesCollected + adminBalance.totalDepositsProcessed - adminBalance.totalWithdrawalsPaid;
    adminBalance.adminAccountBalance = adminBalance.netAdminEarnings;
    if (adminSummarySnapshot.exists) {
      const summary = adminSummarySnapshot.data() || {};
      adminBalance.totalFeesCollected = Number(summary.totalEarnings || 0);
      adminBalance.totalWithdrawalsPaid = Number(summary.totalPaidOut || adminBalance.totalWithdrawalsPaid);
      adminBalance.adminAccountBalance = Number(summary.balance || 0);
      adminBalance.netAdminEarnings = adminBalance.adminAccountBalance;
    }

    // Create admin transaction list
    adminBalance.adminTransactions = [
      {
        type: 'fees_collected',
        amount: adminBalance.totalFeesCollected,
        description: `Platform fees collected from ${sellerTransactions.length} seller orders`,
        status: 'completed'
      },
      {
        type: 'deposits_processed',
        amount: adminBalance.totalDepositsProcessed,
        description: `Customer deposits processed (${adminBalance.completedDeposits} confirmed)`,
        status: 'completed'
      },
      {
        type: 'withdrawals_paid',
        amount: -adminBalance.totalWithdrawalsPaid,
        description: `Withdrawals paid to users (${adminBalance.completedWithdrawals} completed)`,
        status: 'completed'
      }
    ];

    return adminBalance;
  } catch (error) {
    console.error('Error calculating admin balance:', error);
    return { error: error.message };
  }
}

async function renderAdminWallet() {
  content.innerHTML = `
    <section class="card premium-admin-wallet">
      <div class="card-header premium-header">
        <div>
          <h3 class="card-title">👑 Admin Wallet - Premium Session</h3>
          <p class="card-subtitle">Platform financial account and admin earnings dashboard.</p>
        </div>
      </div>
      <div class="stack">
        <div id="adminWalletLoading" class="panel-card" style="padding: 40px; text-align: center;">
          <div class="muted">Loading admin wallet...</div>
        </div>
      </div>
    </section>
  `;

  // Calculate and render admin balance
  const adminBalance = await calculateAdminBalance();
  
  if (adminBalance.error) {
    const loadingDiv = document.getElementById('adminWalletLoading');
    if (loadingDiv) {
      loadingDiv.innerHTML = `<div class="empty-state">Unable to load admin wallet: ${escapeHtml(adminBalance.error)}</div>`;
    }
    return;
  }

  // Render full admin wallet
  const walletHTML = `
    <section class="card premium-admin-wallet">
      <div class="card-header premium-header">
        <div>
          <h3 class="card-title">👑 Admin Wallet - Premium Session</h3>
          <p class="card-subtitle">Platform financial account and admin earnings dashboard.</p>
        </div>
      </div>
      <div class="stack">
        <!-- Admin Balance Card -->
        <div class="panel-card admin-balance-card">
          <div class="panel-card-header">
            <h4>Admin Account Balance</h4>
            <span class="premium-badge">Live</span>
          </div>
          <div class="admin-balance-display">
            <div class="balance-label">Total Admin Earnings</div>
            <div class="balance-amount premium">${formatCurrency(adminBalance.adminAccountBalance)}</div>
            <div class="balance-subtext">Net balance from platform operations</div>
          </div>
        </div>

        <!-- Admin Revenue Metrics Grid -->
        <div class="panel-card">
          <div class="panel-card-header">
            <h4>Admin Revenue Breakdown</h4>
            <span class="badge">Premium Metrics</span>
          </div>
          <div class="admin-metrics-grid">
            <div class="admin-metric-card">
              <div class="admin-metric-label">Platform Fees Collected</div>
              <div class="admin-metric-amount income">${formatCurrency(adminBalance.totalFeesCollected)}</div>
              <div class="admin-metric-detail">10% commission from seller orders</div>
            </div>
            <div class="admin-metric-card">
              <div class="admin-metric-label">Customer Deposits Processed</div>
              <div class="admin-metric-amount income">${formatCurrency(adminBalance.totalDepositsProcessed)}</div>
              <div class="admin-metric-detail">${adminBalance.completedDeposits} confirmed deposits</div>
            </div>
            <div class="admin-metric-card">
              <div class="admin-metric-label">Withdrawals Paid Out</div>
              <div class="admin-metric-amount expense">${formatCurrency(adminBalance.totalWithdrawalsPaid)}</div>
              <div class="admin-metric-detail">${adminBalance.completedWithdrawals} completed payouts</div>
            </div>
            <div class="admin-metric-card">
              <div class="admin-metric-label">Pending Operations</div>
              <div class="admin-metric-amount alert">${adminBalance.pendingDeposits + adminBalance.pendingWithdrawals}</div>
              <div class="admin-metric-detail">${adminBalance.pendingDeposits} deposits • ${adminBalance.pendingWithdrawals} withdrawals</div>
            </div>
          </div>
        </div>

        <!-- Admin Transaction Summary -->
        <div class="panel-card">
          <div class="panel-card-header">
            <h4>Admin Account Activity</h4>
            <span class="badge">Summary</span>
          </div>
          <div class="admin-transaction-list">
            ${adminBalance.adminTransactions.map((tx) => `
              <div class="admin-transaction-row">
                <div class="admin-tx-info">
                  <strong>${escapeHtml(tx.description)}</strong>
                  <div class="muted">${escapeHtml(tx.type.replace(/_/g, ' '))}</div>
                </div>
                <div class="admin-tx-amount ${tx.amount >= 0 ? 'income' : 'expense'}">
                  ${tx.amount >= 0 ? '+' : ''}${formatCurrency(tx.amount)}
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Admin Financial Summary -->
        <div class="panel-card admin-summary-section">
          <div class="panel-card-header">
            <h4>Financial Summary</h4>
            <span class="premium-badge">Admin Only</span>
          </div>
          <div class="admin-summary-grid">
            <div class="summary-row">
              <span class="summary-label">Total Revenue Collected:</span>
              <span class="summary-value income">${formatCurrency(adminBalance.totalFeesCollected + adminBalance.totalDepositsProcessed)}</span>
            </div>
            <div class="summary-row">
              <span class="summary-label">Total Paid Out:</span>
              <span class="summary-value expense">${formatCurrency(adminBalance.totalWithdrawalsPaid)}</span>
            </div>
            <div class="summary-row highlight">
              <span class="summary-label">Net Admin Balance:</span>
              <span class="summary-value premium-amount">${formatCurrency(adminBalance.adminAccountBalance)}</span>
            </div>
            <div class="summary-row">
              <span class="summary-label">Pending Transactions:</span>
              <span class="summary-value">${adminBalance.pendingDeposits + adminBalance.pendingWithdrawals} items</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;

  content.innerHTML = walletHTML;
}

// Financial Dashboard Helper Functions
async function calculateFinancialMetrics() {
  const db = window.firebase?.firestore ? window.firebase.firestore(window.firebase.apps.find((app) => app.name === 'manna-marketplace-data')) : null;
  if (!db) return { error: 'Firestore not available' };

  try {
    // Get all wallet transactions
    const transactionsSnapshot = await db.collection('walletTransactions').get();
    const transactions = transactionsSnapshot.docs.map((doc) => doc.data());

    // Get all withdrawal requests
    const withdrawalsSnapshot = await db.collection('withdrawalRequests').get();
    const withdrawals = withdrawalsSnapshot.docs.map((doc) => doc.data());

    // Calculate metrics
    const metrics = {
      totalCustomerDeposits: 0,
      totalSellerEarnings: 0,
      totalDeliveryEarnings: 0,
      totalWithdrawals: 0,
      totalWithdrawalsPending: 0,
      totalWithdrawalsCompleted: 0,
      totalTransactionCount: transactions.length,
      totalTransactionsPending: 0,
      totalTransactionsCompleted: 0,
      platformIncome: 0
    };

    // Process transactions
    transactions.forEach((tx) => {
      if (tx.userType === 'customer' && tx.type === 'deposit' && tx.status === 'completed') {
        metrics.totalCustomerDeposits += Number(tx.amount || 0);
      }
      if (tx.userType === 'seller' && tx.type === 'order_earning' && tx.status === 'completed') {
        metrics.totalSellerEarnings += Number(tx.amount || 0);
      }
      if (tx.userType === 'delivery' && tx.type === 'order_earning' && tx.status === 'completed') {
        metrics.totalDeliveryEarnings += Number(tx.amount || 0);
      }
      if (tx.status === 'completed') {
        metrics.totalTransactionsCompleted++;
      } else if (tx.status === 'pending') {
        metrics.totalTransactionsPending++;
      }
    });

    // Process withdrawals
    withdrawals.forEach((w) => {
      const amount = Number(w.amount || 0);
      metrics.totalWithdrawals += amount;
      if (w.status === 'completed' || w.status === 'received') {
        metrics.totalWithdrawalsCompleted += amount;
      } else if (w.status === 'pending') {
        metrics.totalWithdrawalsPending += amount;
      }
    });

    // Platform income = 10% of seller earnings as an example
    // This can be customized based on actual business logic
    metrics.platformIncome = Math.round(metrics.totalSellerEarnings * 0.1 * 100) / 100;

    return metrics;
  } catch (error) {
    console.error('Error calculating financial metrics:', error);
    return { error: error.message };
  }
}

function renderFinancialMetricsCards(metrics) {
  if (metrics.error) {
    return `<div class="panel-card"><div class="empty-state">Unable to load financial metrics: ${escapeHtml(metrics.error)}</div></div>`;
  }

  return `
    <div class="financial-metrics-grid">
      <div class="metric-card">
        <div class="metric-label">Platform Income</div>
        <div class="metric-amount">${formatCurrency(metrics.platformIncome || 0)}</div>
        <div class="metric-description">Estimated 10% of seller earnings</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Customer Deposits</div>
        <div class="metric-amount">${formatCurrency(metrics.totalCustomerDeposits || 0)}</div>
        <div class="metric-description">Total deposited by customers</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Seller Earnings</div>
        <div class="metric-amount">${formatCurrency(metrics.totalSellerEarnings || 0)}</div>
        <div class="metric-description">Total earned by sellers</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Delivery Earnings</div>
        <div class="metric-amount">${formatCurrency(metrics.totalDeliveryEarnings || 0)}</div>
        <div class="metric-description">Total earned by delivery partners</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Total Withdrawals</div>
        <div class="metric-amount">${formatCurrency(metrics.totalWithdrawals || 0)}</div>
        <div class="metric-description">All requested withdrawals</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Pending Withdrawals</div>
        <div class="metric-amount alert">${formatCurrency(metrics.totalWithdrawalsPending || 0)}</div>
        <div class="metric-description">Awaiting processing</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Completed Withdrawals</div>
        <div class="metric-amount success">${formatCurrency(metrics.totalWithdrawalsCompleted || 0)}</div>
        <div class="metric-description">Successfully processed</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Transactions</div>
        <div class="metric-amount">${metrics.totalTransactionCount || 0}</div>
        <div class="metric-description">${metrics.totalTransactionsCompleted || 0} completed • ${metrics.totalTransactionsPending || 0} pending</div>
      </div>
    </div>
  `;
}

function renderFinancials() {
  const payouts = (state.data.financialPayouts || []).slice().sort((first, second) => new Date(second.createdAt || 0) - new Date(first.createdAt || 0));
  const fees = (state.data.platformFeePayments || []).slice().sort((first, second) => new Date(second.createdAt || 0) - new Date(first.createdAt || 0));
  
  // Show loading state while calculating metrics
  content.innerHTML = `
    <section class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">Financial Dashboard</h3>
          <p class="card-subtitle">Real-time platform financial overview and settlement management.</p>
        </div>
      </div>
      <div class="stack">
        <div class="panel-card">
          <div class="panel-card-header">
            <h4>Financial Metrics</h4>
            <div class="muted">Loading real-time data...</div>
          </div>
          <div id="financialMetricsContainer" style="padding: 20px;"><div class="empty-state">Loading financial metrics...</div></div>
        </div>
      </div>
    </section>
  `;

  // Calculate metrics asynchronously
  calculateFinancialMetrics().then((metrics) => {
    const metricsContainer = document.getElementById('financialMetricsContainer');
    if (metricsContainer) {
      metricsContainer.innerHTML = renderFinancialMetricsCards(metrics);
      // Re-render the full page with metrics loaded
      renderFinancialsWithMetrics(metrics, payouts, fees);
    }
  });
}

function renderFinancialsWithMetrics(metrics, payouts, fees) {
  content.innerHTML = `
    <section class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">Financial Dashboard</h3>
          <p class="card-subtitle">Real-time platform financial overview and settlement management.</p>
        </div>
      </div>
      <div class="stack">
        <div class="panel-card">
          <div class="panel-card-header">
            <h4>Financial Overview</h4>
            <span class="badge">Real-time metrics</span>
          </div>
          ${renderFinancialMetricsCards(metrics)}
        </div>

        <div class="panel-card">
          <div class="panel-card-header">
            <h4>Delivery Payouts</h4>
            <span class="badge">${payouts.filter((entry) => String(entry.status || 'pending').toLowerCase() === 'pending').length} pending</span>
          </div>
          <div class="list-stack">${payouts.length ? payouts.map((payout) => `
            <div class="list-item">
              <div class="panel-card-header">
                <strong>${escapeHtml(payout.deliveryPersonName || payout.deliveryPersonUid || 'Delivery partner')}</strong>
                <span class="badge">${escapeHtml(String(payout.status || 'pending').replace(/_/g, ' '))}</span>
              </div>
              <div class="muted">${escapeHtml(formatCurrency(payout.totalDeliveryFees || 0))} • ${escapeHtml(payout.sellerName || payout.sellerId || 'Seller')}</div>
              <div class="muted">Reference: ${escapeHtml(payout.paymentReference || 'Waiting for seller upload')}</div>
              ${payout.status === 'pending' ? `<div class="row-actions"><button class="primary-btn" data-settlement-action="confirm-payout" data-id="${escapeHtml(payout.id || '')}">Confirm payout</button><button class="ghost-btn" data-settlement-action="reject-payout" data-id="${escapeHtml(payout.id || '')}">Reject</button></div>` : ''}
            </div>`).join('') : '<div class="empty-state">No payouts yet.</div>'}</div>
        </div>

        <div class="panel-card">
          <div class="panel-card-header">
            <h4>Platform Fees</h4>
            <span class="badge">${fees.filter((entry) => String(entry.status || 'pending').toLowerCase() === 'pending').length} pending</span>
          </div>
          <div class="list-stack">${fees.length ? fees.map((fee) => `
            <div class="list-item">
              <div class="panel-card-header">
                <strong>${escapeHtml(formatCurrency(fee.feeAmount || 0))}</strong>
                <span class="badge">${escapeHtml(String(fee.status || 'pending').replace(/_/g, ' '))}</span>
              </div>
              <div class="muted">${escapeHtml(fee.sellerName || fee.sellerId || 'Seller')} • ${escapeHtml(formatDate(fee.periodStart))} → ${escapeHtml(formatDate(fee.periodEnd))}</div>
              <div class="muted">Reference: ${escapeHtml(fee.paymentReference || 'Waiting for seller upload')}</div>
              ${fee.status === 'pending' ? `<div class="row-actions"><button class="primary-btn" data-settlement-action="confirm-fee" data-id="${escapeHtml(fee.id || '')}">Confirm fee</button><button class="ghost-btn" data-settlement-action="reject-fee" data-id="${escapeHtml(fee.id || '')}">Reject</button></div>` : ''}
            </div>`).join('') : '<div class="empty-state">No platform fee payments yet.</div>'}</div>
        </div>
      </div>
    </section>
  `;
  
  content.querySelectorAll('[data-settlement-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const action = button.getAttribute('data-settlement-action');
      const id = button.getAttribute('data-id');
      if (!id) return;
      if (action === 'confirm-payout') {
        await confirmPayout(id);
      } else if (action === 'reject-payout') {
        await rejectSettlement(id, 'deliveryPayouts');
      } else if (action === 'confirm-fee') {
        await confirmFee(id);
      } else if (action === 'reject-fee') {
        await rejectSettlement(id, 'platformFeePayments');
      }
    });
  });
}

async function confirmPayout(id) {
  const payout = (state.data.financialPayouts || []).find((entry) => entry.id === id);
  if (!payout) return;
  const paymentReference = window.prompt('Enter the payment reference', payout.paymentReference || '');
  const payerPhone = window.prompt('Enter the payout phone number', payout.payerPhone || '');
  const amountPaid = window.prompt('Enter the amount paid', String(payout.amountPaid || payout.totalDeliveryFees || 0));
  if (!paymentReference || !payerPhone || !amountPaid) {
    createToast('Please complete the payment details.', 'warning');
    return;
  }
  try {
    await updateDocument('deliveryPayouts', id, {
      status: 'confirmed',
      paymentReference: paymentReference.trim(),
      payerPhone: payerPhone.trim(),
      amountPaid: Number(amountPaid || 0),
      updatedAt: new Date()
    });
    await createRoleNotification(initStorage().db, payout.deliveryPersonUid, 'delivery_person', {
      title: 'Payout confirmed',
      message: `Your payout of ${formatCurrency(Number(amountPaid || 0))} was confirmed by the admin team.`,
      type: 'payout'
    });
    createToast('Payout confirmed.', 'success');
    renderFinancials();
  } catch (error) {
    createToast(error.message || 'Unable to confirm the payout.', 'error');
  }
}

async function confirmFee(id) {
  const fee = (state.data.platformFeePayments || []).find((entry) => entry.id === id);
  if (!fee) return;
  const paymentReference = window.prompt('Enter the payment reference', fee.paymentReference || '');
  const payerPhone = window.prompt('Enter the payer phone number', fee.payerPhone || '');
  const amountPaid = window.prompt('Enter the amount paid', String(fee.amountPaid || fee.feeAmount || 0));
  if (!paymentReference || !payerPhone || !amountPaid) {
    createToast('Please complete the fee payment details.', 'warning');
    return;
  }
  try {
    await updateDocument('platformFeePayments', id, {
      status: 'confirmed',
      paymentReference: paymentReference.trim(),
      payerPhone: payerPhone.trim(),
      amountPaid: Number(amountPaid || 0),
      updatedAt: new Date()
    });
    const sellerSnapshot = fee.sellerId ? await initStorage().db.collection('sellers').doc(fee.sellerId).get() : null;
    const sellerRecipientUid = sellerSnapshot?.data()?.ownerUid || fee.sellerId;
    await createRoleNotification(initStorage().db, sellerRecipientUid, 'seller', {
      title: 'Platform fee confirmed',
      message: `Your platform fee payment of ${formatCurrency(Number(amountPaid || 0))} was confirmed by the admin team.`,
      type: 'fee'
    });
    createToast('Fee payment confirmed.', 'success');
    renderFinancials();
  } catch (error) {
    createToast(error.message || 'Unable to confirm the fee payment.', 'error');
  }
}

async function rejectSettlement(id, collectionName) {
  try {
    await updateDocument(collectionName, id, { status: 'rejected', updatedAt: new Date() });
    createToast('Settlement request marked as rejected.', 'warning');
    renderFinancials();
  } catch (error) {
    createToast(error.message || 'Unable to update the settlement request.', 'error');
  }
}

function renderHelpCenter() {
  content.innerHTML = `
    <section class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">Help Center</h3>
          <p class="card-subtitle">Manage help articles and review incoming help suggestions from customers, sellers, and delivery partners.</p>
        </div>
      </div>
      <div class="stack">
        <div class="panel-card">
          <div class="panel-card-header">
            <h4>Incoming suggestions</h4>
            <span class="badge">${(state.data.supportRequests || []).filter((request) => !['reviewed', 'resolved'].includes(String(request.status || '').toLowerCase())).length} pending</span>
          </div>
          <div id="helpSuggestionsList" class="list-stack"></div>
        </div>
        <div class="panel-card">
          <div class="panel-card-header">
            <h4>Help articles</h4>
            <button class="primary-btn" id="openHelpArticleModal">Create article</button>
          </div>
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
          </div>
          <div id="helpArticlesList" class="card-grid"></div>
        </div>
      </div>
    </section>
  `;
  document.getElementById('openHelpArticleModal')?.addEventListener('click', openHelpArticleModal);
  renderHelpSuggestions();
  renderHelpArticleCards();
}

function renderHelpSuggestions() {
  const container = document.getElementById('helpSuggestionsList');
  if (!container) return;
  const suggestions = (state.data.supportRequests || [])
    .slice()
    .sort((first, second) => new Date(second.createdAt || 0) - new Date(first.createdAt || 0))
    .slice(0, 6);
  container.innerHTML = suggestions.length ? suggestions.map((request) => {
    const status = String(request.status || 'new').toLowerCase();
    const preview = String(request.message || '').trim();
    const previewText = preview.length > 140 ? `${preview.slice(0, 137)}...` : preview;
    const sourceText = [request.panel || 'panel', request.email || 'No email'].filter(Boolean).join(' • ');
    return `
      <div class="list-item help-suggestion-feed-item">
        <div class="panel-card-header">
          <strong>${escapeHtml(request.subject || request.category || 'Help suggestion')}</strong>
          <span class="badge">${escapeHtml(status)}</span>
        </div>
        <div class="body-small">${escapeHtml(sourceText)}</div>
        <div class="muted">${escapeHtml(previewText || 'No details provided yet.')}</div>
        <div class="body-small">${escapeHtml(formatDate(request.createdAt) || 'Recently received')}</div>
        <div class="row-actions">
          <button class="primary-btn" data-help-request-action="reviewed" data-help-request-id="${escapeHtml(request.id || '')}" type="button">Mark reviewed</button>
          <button class="ghost-btn" data-help-request-action="resolved" data-help-request-id="${escapeHtml(request.id || '')}" type="button">Resolve</button>
        </div>
      </div>`;
  }).join('') : '<div class="empty-state">No recent suggestions yet.</div>';
  container.querySelectorAll('[data-help-request-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.getAttribute('data-help-request-id');
      const action = button.getAttribute('data-help-request-action');
      if (!id) return;
      try {
        await updateDocument('supportRequests', id, { status: action, updatedAt: new Date().toISOString() });
        createToast('Suggestion updated.', 'success');
        renderHelpSuggestions();
      } catch (error) {
        createToast(error.message || 'Unable to update the suggestion.', 'error');
      }
    });
  });
}

function getHelpArticleImage(article) {
  const imageName = String(article?.image || '').trim();
  if (!imageName) return 'images/placeholders/wrap.jpg';
  const normalizedName = imageName.replace(/^.*[\\/]/, '');
  return `images/help-images/${normalizedName}`;
}

function normalizeHelpArticleTags(value) {
  if (Array.isArray(value)) {
    return value.map((tag) => String(tag || '').trim()).filter(Boolean);
  }
  return String(value || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function renderHelpArticleCards() {
  const container = document.getElementById('helpArticlesList');
  if (!container) return;
  const categoryFilter = String(document.getElementById('helpArticleCategoryFilter')?.value || '').trim().toLowerCase();
  const tagFilter = String(document.getElementById('helpArticleTagFilter')?.value || '').trim().toLowerCase();
  const articles = (state.data.helpArticles || [])
    .slice()
    .filter((article) => {
      const matchesCategory = !categoryFilter || String(article.category || '').trim().toLowerCase() === categoryFilter;
      const tags = normalizeHelpArticleTags(article.tags || []);
      const tagText = tags.join(' ').toLowerCase();
      const matchesTag = !tagFilter || tagText.includes(tagFilter);
      return matchesCategory && matchesTag;
    })
    .sort((first, second) => new Date(second.createdAt || 0) - new Date(first.createdAt || 0));
  const featuredArticles = articles.filter((article) => Boolean(article.featured));
  const regularArticles = articles.filter((article) => !article.featured);
  const renderArticleCard = (article) => {
    const tags = normalizeHelpArticleTags(article.tags || []);
    return `
    <article class="help-card">
      <div class="help-card__body">
        <h4>${escapeHtml(article.title || 'Help article')}</h4>
        <p>${escapeHtml(article.description || '')}</p>
        <div class="body-small">Target roles: ${escapeHtml((article.targetRoles || []).join(', ') || 'All')}</div>
        <div class="row-actions" style="margin-top: 10px; flex-wrap: wrap; gap: 8px;">
          ${article.featured ? '<span class="badge featured-badge">📌 Featured</span>' : ''}
          ${article.category ? `<span class="badge">${escapeHtml(article.category)}</span>` : ''}
          ${tags.map((tag) => `<span class="badge">${escapeHtml(tag)}</span>`).join('')}
        </div>
        <div class="row-actions" style="margin-top: 10px;">
          ${article.videoUrl ? `<a class="primary-btn" href="${escapeHtml(article.videoUrl)}" target="_blank" rel="noopener noreferrer">Watch video</a>` : '<span class="badge">Video coming soon</span>'}
          <button class="ghost-btn" data-edit-help-article="${escapeHtml(article.id || '')}" type="button">Edit</button>
          <button class="ghost-btn" data-delete-help-article="${escapeHtml(article.id || '')}" type="button">Delete</button>
        </div>
      </div>
    </article>`;
  };
  container.innerHTML = articles.length ? `
    <div class="stack">
      ${featuredArticles.length ? `<div class="help-featured-section"><div class="panel-card-header"><h4>Featured guides</h4></div>${featuredArticles.map(renderArticleCard).join('')}</div>` : ''}
      ${regularArticles.length ? `<div class="help-featured-section"><div class="panel-card-header"><h4>More guides</h4></div>${regularArticles.map(renderArticleCard).join('')}</div>` : ''}
    </div>` : renderEmptyState('No help articles yet', 'Create guides for the customer, seller, or delivery experience.');
  document.getElementById('helpArticleCategoryFilter')?.addEventListener('change', renderHelpArticleCards);
  document.getElementById('helpArticleTagFilter')?.addEventListener('input', renderHelpArticleCards);
  container.querySelectorAll('[data-edit-help-article]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.getAttribute('data-edit-help-article');
      const article = (state.data.helpArticles || []).find((entry) => entry.id === id);
      if (article) {
        openHelpArticleModal(article);
      }
    });
  });
  container.querySelectorAll('[data-delete-help-article]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.getAttribute('data-delete-help-article');
      if (!id) return;
      try {
        await deleteDocument('helpArticles', id);
        createToast('Help article removed.', 'success');
      } catch (error) {
        createToast(error.message || 'Unable to delete the article.', 'error');
      }
    });
  });
}

function openHelpArticleModal(article = null) {
  const isEditing = Boolean(article?.id);
  const roleOptions = ['customer', 'seller', 'delivery', 'admin'];
  const contextOptions = ['checkout-payment', 'checkout-shipping', 'checkout-general', 'order-tracking', 'seller-onboarding', 'delivery-onboarding'];
  let selectedRoles = Array.isArray(article?.targetRoles)
    ? article.targetRoles.filter((role) => roleOptions.includes(String(role)))
    : [];
  let selectedContexts = Array.isArray(article?.displayContexts)
    ? article.displayContexts.filter((ctx) => contextOptions.includes(String(ctx)))
    : [];

  openModal(isEditing ? 'Edit Help Article' : 'Create Help Article', `
    <form id="helpArticleForm" class="form-grid" style="padding: 8px 0;">
      <label>Title<input name="title" value="${escapeHtml(article?.title || '')}" required /></label>
      <label>Image<input id="helpArticleImageInput" name="image" value="${escapeHtml(article?.image || '')}" placeholder="help-image.jpg" /></label>
      <div class="stack" style="grid-column: 1 / -1;">
        <img id="helpArticleImagePreview" src="${escapeHtml(getHelpArticleImage(article))}" alt="Preview" style="display: ${article?.image ? 'block' : 'none'}; max-width: 200px; border-radius: 8px;" onerror="this.onerror=null; this.src='images/placeholders/wrap.jpg'; this.style.display='block';" />
      </div>
      <label>Category<select name="category">
        <option value="" ${!article?.category ? 'selected' : ''}>Choose category</option>
        <option value="Getting started" ${article?.category === 'Getting started' ? 'selected' : ''}>Getting started</option>
        <option value="Orders" ${article?.category === 'Orders' ? 'selected' : ''}>Orders</option>
        <option value="Payments" ${article?.category === 'Payments' ? 'selected' : ''}>Payments</option>
        <option value="Account" ${article?.category === 'Account' ? 'selected' : ''}>Account</option>
        <option value="Delivery" ${article?.category === 'Delivery' ? 'selected' : ''}>Delivery</option>
        <option value="Technical" ${article?.category === 'Technical' ? 'selected' : ''}>Technical</option>
      </select></label>
      <label>Tags<input name="tags" value="${escapeHtml((Array.isArray(article?.tags) ? article.tags : normalizeHelpArticleTags(article?.tags || '')).join(', '))}" placeholder="payments, onboarding, orders" /></label>
      <label><input type="checkbox" name="featured" ${article?.featured ? 'checked' : ''} /> Featured article</label>
      <label>Video URL<input name="videoUrl" value="${escapeHtml(article?.videoUrl || '')}" placeholder="https://..." /></label>
      <div style="grid-column: 1 / -1; padding: 12px 0; border-top: 1px solid var(--border-color); border-bottom: 1px solid var(--border-color); margin: 12px 0;">
        <p style="margin: 0 0 8px 0; font-weight: 600;">Where should this help appear?</p>
        <div class="row-actions" style="gap: 12px; flex-wrap: wrap;">
          ${contextOptions.map((ctx) => `<label><input class="help-context-checkbox" type="checkbox" value="${ctx}" ${selectedContexts.includes(ctx) ? 'checked' : ''} /> ${ctx.replace(/-/g, ' ')}</label>`).join('')}
        </div>
      </div>
      <div style="grid-column: 1 / -1; padding: 12px 0; border-bottom: 1px solid var(--border-color); margin: 12px 0;">
        <p style="margin: 0 0 8px 0; font-weight: 600;">Who should see this?</p>
        <div class="row-actions" style="gap: 12px; flex-wrap: wrap;">
          ${roleOptions.map((role) => `<label><input class="help-role-checkbox" type="checkbox" value="${role}" ${selectedRoles.includes(role) ? 'checked' : ''} /> ${role.charAt(0).toUpperCase() + role.slice(1)}</label>`).join('')}
        </div>
      </div>
      <label class="full">Description<textarea name="description" required>${escapeHtml(article?.description || '')}</textarea></label>
      <div class="row-actions">
        <button class="primary-btn" id="submitHelpArticle" type="button">${isEditing ? 'Save changes' : 'Save article'}</button>
        <button class="ghost-btn" id="cancelHelpArticle" type="button">Cancel</button>
      </div>
    </form>
  `);

  const imageInput = document.getElementById('helpArticleImageInput');
  const imagePreview = document.getElementById('helpArticleImagePreview');
  const syncImagePreview = () => {
    const imageValue = String(imageInput?.value || '').trim();
    const filename = imageValue.replace(/^.*[\\/]/, '');
    if (!filename) {
      imagePreview.src = '';
      imagePreview.style.display = 'none';
      return;
    }
    imagePreview.src = `images/help-images/${filename}`;
    imagePreview.style.display = 'block';
  };

  document.querySelectorAll('.help-role-checkbox').forEach((checkbox) => {
    checkbox.addEventListener('change', (event) => {
      const role = event.target.value;
      if (event.target.checked) {
        selectedRoles = Array.from(new Set([...selectedRoles, role]));
      } else {
        selectedRoles = selectedRoles.filter((value) => value !== role);
      }
    });
  });

  document.querySelectorAll('.help-context-checkbox').forEach((checkbox) => {
    checkbox.addEventListener('change', (event) => {
      const ctx = event.target.value;
      if (event.target.checked) {
        selectedContexts = Array.from(new Set([...selectedContexts, ctx]));
      } else {
        selectedContexts = selectedContexts.filter((value) => value !== ctx);
      }
    });
  });

  imageInput?.addEventListener('input', syncImagePreview);
  imageInput?.addEventListener('change', syncImagePreview);
  syncImagePreview();

  document.getElementById('submitHelpArticle').addEventListener('click', async () => {
    const form = document.getElementById('helpArticleForm');
    const data = new FormData(form);
    const payload = {
      title: String(data.get('title') || '').trim(),
      description: String(data.get('description') || '').trim(),
      image: String(data.get('image') || '').trim(),
      category: String(data.get('category') || '').trim(),
      tags: normalizeHelpArticleTags(data.get('tags')),
      featured: Boolean(form.querySelector('input[name="featured"]').checked),
      videoUrl: String(data.get('videoUrl') || '').trim(),
      targetRoles: Array.from(new Set(selectedRoles)),
      displayContexts: Array.from(new Set(selectedContexts)),
      updatedAt: new Date().toISOString()
    };
    if (!payload.title || !payload.description) {
      createToast('Please add a title and description before publishing the article.', 'warning');
      return;
    }
    try {
      if (isEditing && article?.id) {
        await updateDocument('helpArticles', article.id, payload);
        createToast('Help article updated.', 'success');
      } else {
        await addDocument('helpArticles', { ...payload, createdAt: new Date().toISOString() });
        createToast('Help article published.', 'success');
      }
      closeModal();
      renderHelpCenter();
    } catch (error) {
      createToast(error.message || 'Unable to save the article.', 'error');
    }
  });
  document.getElementById('cancelHelpArticle').addEventListener('click', closeModal);
}

function renderLogs() {
  content.innerHTML = `
    <section class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">System Logs</h3>
          <p class="card-subtitle">Administrative audit trail</p>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>User</th><th>Action</th><th>Details</th></tr></thead>
          <tbody>
            ${state.data.logs.map((entry) => `
              <tr>
                <td>${formatDate(entry.createdAt)}</td>
                <td>${escapeHtml(entry.user)}</td>
                <td>${escapeHtml(entry.action)}</td>
                <td>${escapeHtml(entry.details)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function handleAdminModalEscape(event) {
  if (event.key === 'Escape') {
    closeModal();
  }
}

function openModal(title, body) {
  modalRoot.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3>${escapeHtml(title)}</h3>
        <button class="close-btn" id="closeModalBtn">×</button>
      </div>
      <div>${body}</div>
    </div>
  `;
  modalRoot.classList.add('open');
  document.getElementById('closeModalBtn').addEventListener('click', closeModal);
  modalRoot.querySelector('.modal-backdrop').addEventListener('click', closeModal);
  document.addEventListener('keydown', handleAdminModalEscape);
}

function closeModal() {
  clearAdminMessageSession();
  modalRoot.classList.remove('open');
  modalRoot.innerHTML = '';
  document.removeEventListener('keydown', handleAdminModalEscape);
}

function initializeTheme() {
  state.theme = applyThemePreference(state.user);
  adminAvatar.textContent = getInitials(state.user.displayName);
}

function getAdminAllowedEmails() {
  return ['savieisaiah54@gmail.com'];
}

function isAuthorizedAdmin(profile = {}, email = '') {
  if (isAdminOnlyEmail(email)) return true;
  const role = String(profile?.role || profile?.userRole || '').toLowerCase();
  if (role === 'admin' || profile?.isAdmin) return true;
  const normalizedEmail = (email || '').toLowerCase();
  return getAdminAllowedEmails().some((allowed) => (allowed || '').toLowerCase() === normalizedEmail);
}

async function getAdminProfile(db, user) {
  const profileDoc = await db.collection('users').doc(user.uid).get();
  if (profileDoc.exists) return profileDoc.data() || {};
  const emailSnapshot = await db.collection('users').where('email', '==', user.email).limit(1).get();
  return emailSnapshot.docs[0]?.data() || {};
}

let authBootstrapTimer = null;

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
    if (!state.user?.uid || state.user.role === 'guest') {
      state.user = { uid: '', displayName: 'Guest', role: 'guest' };
      showLogin();
    }
  }, 900);
}

function showApp() {
  loginView.classList.add('hidden');
  appShell.classList.remove('hidden');
  initializeAdminDataSync();
}

function showLogin() {
  appShell.classList.add('hidden');
  loginView.classList.remove('hidden');
}

function showAuthNotice(message) {
  showLogin();
  if (message) {
    createToast(message, 'warning');
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
      updatedAt: new Date().toISOString()
    };
    await updateDocument('users', uid, payload);
    state.user = { ...state.user, ...payload };
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

function attachLoginHandler() {
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = loginEmail.value.trim();
    const password = loginPassword.value;

    if (!email || !password) {
      createToast('Please enter both email and password.', 'warning');
      return;
    }

    const { auth, db } = initStorage();
    if (!auth || !db) {
      createToast('local storage is not available. Please refresh and try again.', 'error');
      return;
    }

    try {
      const result = await auth.signInWithEmailAndPassword(email, password);
      const user = result.user;
      const profile = await getAdminProfile(db, user);

      if (!isAuthorizedAdmin(profile, user.email)) {
        state.user = {
          uid: user.uid,
          displayName: profile.displayName || user.displayName || email.split('@')[0],
          role: 'unauthorized',
          email: user.email
        };
        showAuthNotice('This account is not authorized for the admin console.');
        return;
      }

      state.user = {
        uid: user.uid,
        displayName: profile.displayName || user.displayName || email.split('@')[0],
        role: 'admin',
        email: user.email
      };
      initializeTheme();
      showApp();
      createToast('Admin signed in successfully.', 'success');
    } catch (error) {
      const message = error?.message || 'Login failed.';
      createToast(message, 'error');
      if (message.includes('invalid-credential') || message.includes('bad')) {
        createToast('Use the local storage admin account or verify the credentials.', 'warning');
      }
    }
  });
}

function ensureAdminAccess() {
  const { auth, db } = initStorage();
  if (!auth || !db) {
    showLogin();
    return;
  }

  const restoreAdminSession = async (user) => {
    if (!user) {
      clearAuthBootstrapTimer();
      scheduleAuthFallback();
      return;
    }

    try {
      const profile = await getAdminProfile(db, user);
      if (!isAuthorizedAdmin(profile, user.email)) {
        state.user = {
          uid: user.uid,
          displayName: profile.displayName || user.displayName || user.email?.split('@')[0] || 'Admin',
          role: 'unauthorized',
          email: user.email
        };
        showAuthNotice('This account is not authorized for the admin console.');
        return;
      }

      state.user = {
        uid: user.uid,
        displayName: profile.displayName || user.displayName || user.email?.split('@')[0] || 'Admin',
        role: 'admin',
        email: user.email,
        themePreference: profile.themePreference
      };
      initializeTheme();
      showApp();
    } catch (error) {
      console.error(error);
      showLogin();
    }
  };

  auth.onAuthStateChanged((user) => {
    if (user) {
      clearAuthBootstrapTimer();
      restoreAdminSession(user);
      return;
    }

    state.user = { uid: '', displayName: 'Guest', role: 'guest' };
    scheduleAuthFallback();
  });

  if (auth.currentUser) {
    restoreAdminSession(auth.currentUser);
    return;
  }

  scheduleAuthFallback();
}

function normalizeUserEntry(user, role = 'customer') {
  const normalizedRole = role || user?.role || 'customer';
  const displayName = user?.displayName || user?.name || user?.ownerName || (user?.email ? user.email.split('@')[0] : 'User');
  const status = user?.status || user?.accountStatus || (normalizedRole === 'delivery' || normalizedRole === 'delivery_person' ? 'pending' : 'active');

  return {
    ...user,
    id: user?.id || user?.uid || '',
    uid: user?.uid || user?.id || '',
    name: displayName,
    displayName,
    email: user?.email || '',
    phone: user?.phone || '',
    role: normalizedRole,
    status,
    isDeleted: Boolean(user?.isDeleted)
  };
}

function normalizeSellerEntry(entry, fallbackUser = null) {
  const fallbackStatus = entry?.status || entry?.sellerStatus || fallbackUser?.sellerStatus || fallbackUser?.status || 'pending';
  const businessName = entry?.businessName || entry?.name || fallbackUser?.businessName || fallbackUser?.displayName || 'New Seller';
  const ownerName = entry?.ownerName || fallbackUser?.ownerName || fallbackUser?.displayName || '';
  const email = entry?.email || fallbackUser?.email || '';
  const phone = entry?.phone || fallbackUser?.phone || '';
  const location = entry?.location || entry?.address || [entry?.city, entry?.county].filter(Boolean).join(', ') || fallbackUser?.address || '';

  return {
    ...entry,
    id: entry?.id || fallbackUser?.sellerId || fallbackUser?.uid || fallbackUser?.id || '',
    ownerUid: entry?.ownerUid || fallbackUser?.uid || '',
    businessName,
    name: entry?.name || businessName,
    ownerName,
    email,
    phone,
    location,
    status: fallbackStatus,
    sellerStatus: fallbackStatus,
    isActive: entry?.isActive ?? (fallbackStatus === 'approved'),
    isDeleted: Boolean(entry?.isDeleted),
    updatedAt: entry?.updatedAt || new Date().toISOString()
  };
}

function mergeSellerEntries(sellers = [], users = []) {
  const normalizedSellers = sellers.map((seller) => normalizeSellerEntry(seller));
  const sellerUsers = users.filter((user) => user.role === 'seller');
  const matchedIds = new Set();

  normalizedSellers.forEach((seller) => {
    matchedIds.add(seller.id);
  });

  sellerUsers.forEach((user) => {
    const candidateId = user.sellerId || user.uid || user.id;
    const existingIndex = normalizedSellers.findIndex((seller) => {
      return seller.id === candidateId || seller.ownerUid === user.uid || seller.email === user.email || seller.id === user.uid;
    });

    if (existingIndex >= 0) {
      normalizedSellers[existingIndex] = normalizeSellerEntry(normalizedSellers[existingIndex], user);
      matchedIds.add(normalizedSellers[existingIndex].id);
      return;
    }

    normalizedSellers.unshift(normalizeSellerEntry({ id: candidateId, source: 'user' }, user));
    matchedIds.add(candidateId);
  });

  return normalizedSellers.filter((seller) => Boolean(seller.id));
}

function isMarketplaceProduct(product = {}) {
  return isMarketplaceCategory(product.category);
}

async function ensureInternationalProductExists(db, masterProduct, existingMasterProductIds = null) {
  const masterProductId = masterProduct?.id;
  if (!db || !masterProductId) return;

  if (existingMasterProductIds) {
    if (existingMasterProductIds.has(masterProductId)) return;
    existingMasterProductIds.add(masterProductId);
  } else {
    const existingOffer = await db.collection('internationalProducts')
      .where('masterProductId', '==', masterProductId)
      .limit(1)
      .get();
    if (!existingOffer.empty) return;
  }

  const { id, ...masterProductData } = masterProduct;
  const standardPrice = Number(masterProductData.standardPrice ?? masterProductData.price ?? 0);
  const now = new Date().toISOString();
  await db.collection('internationalProducts').doc(masterProductId).set({
    ...masterProductData,
    masterProductId,
    wholesalePrice: Math.round(standardPrice * 0.95 * 100) / 100,
    currency: normalizeCurrency(masterProductData.standardCurrency || masterProductData.currency || 'USD'),
    minimumQuantity: 20,
    status: masterProductData.status || 'active',
    isDeleted: Boolean(masterProductData.isDeleted),
    createdAt: masterProductData.createdAt || now,
    updatedAt: now
  });
}

async function backfillInternationalProducts(db, masterProducts) {
  const offersSnapshot = await db.collection('internationalProducts').get();
  const existingMasterProductIds = new Set(offersSnapshot.docs
    .map((doc) => doc.data()?.masterProductId)
    .filter(Boolean));
  const results = await Promise.allSettled(
    masterProducts.map((product) => ensureInternationalProductExists(db, product, existingMasterProductIds))
  );
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length) {
    console.error(`[Manna Marketplace] Could not create ${failures.length} international product(s) from the master catalog.`, failures);
  }
}

async function removeLegacyFoodProducts(db) {
  const snapshot = await db.collection('masterProducts').get();
  const legacyProducts = snapshot.docs.filter((doc) => !isMarketplaceProduct(doc.data()));
  await Promise.all(legacyProducts.map((doc) => doc.ref.delete()));
  if (legacyProducts.length) {
    console.info(`[Manna Marketplace] Removed ${legacyProducts.length} legacy non-marketplace product(s).`);
  }
}

async function removeLegacyRestaurantSeedData(db) {
  if (!db) return;
  const sellerIds = ['rest-pizza', 'rest-burger', 'rest-dominos'];
  const userIds = ['seller-seed', 'seller-seed-2', 'seller-seed-3', 'delivery-seed'];
  const productIds = ['prod-jollof', 'prod-groundnut', 'prod-fufu', 'prod-pizza', 'prod-juice'];
  const references = [
    ...sellerIds.map((id) => db.collection('sellers').doc(id)),
    ...userIds.map((id) => db.collection('users').doc(id)),
    ...productIds.map((id) => db.collection('masterProducts').doc(id)),
    db.collection('orders').doc('order-seed')
  ];
  for (const sellerId of sellerIds) {
    const sellerRef = db.collection('sellers').doc(sellerId);
    const subcollections = ['menu', 'categories', 'promotions', 'coupons', 'settings', 'chats', 'internationalInventory'];
    for (const collectionName of subcollections) {
      const snapshot = await sellerRef.collection(collectionName).get();
      await Promise.all(snapshot.docs.map((doc) => doc.ref.delete()));
    }
  }
  await Promise.all(references.map((reference) => reference.delete()));
  console.info('[Manna Marketplace] Removed legacy restaurant seed sellers and users.');
}

function initializeLocalStorageSync() {
  const storage = initStorage();
  if (!storage.ready) {
    createToast('Local storage is unavailable.', 'warning');
    return;
  }

  window.setInterval(() => sendPaymentReminders().catch((error) => console.error('[Manna Marketplace] Payment reminder failed:', error)), 30 * 60 * 1000);

  const refreshDashboard = () => {
    if (state.currentSection === 'dashboard') {
      renderDashboard();
    } else {
      renderSection(state.currentSection);
    }
  };

  subscribeCollection('masterProducts', (items) => {
    console.log('[Manna Marketplace] Admin master products snapshot received:', items);
    state.data.products = items.filter(isMarketplaceProduct).map((item) => ({ ...item, category: getCategoryDisplayName(item.category) }));
    if (!initialInternationalProductBackfillStarted) {
      initialInternationalProductBackfillStarted = true;
      backfillInternationalProducts(storage.db, items);
    }
    if (state.currentSection === 'products') {
      renderProducts();
    }
    refreshDashboard();
  });
  subscribeCollection('internationalProducts', (items) => {
    state.data.internationalProducts = items;
    if (state.currentSection === 'international-products') renderInternationalProducts();
    if (state.currentSection === 'signup-rewards') renderSignupBlindBoxCampaign();
  }, [{ field: 'isDeleted', operator: '!=', value: true }]);
  const settingsDb = storage.db;
  if (settingsDb) {
    settingsDb.collection('appConfig').doc('signupBlindBox').onSnapshot((snapshot) => {
      state.data.signupBlindBoxCampaign = snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
      if (state.currentSection === 'signup-rewards') renderSignupBlindBoxCampaign();
    }, (error) => console.error('[Manna Marketplace] Signup reward campaign listener failed:', error));
    settingsDb.collection('adminSettings').doc('config').onSnapshot((snapshot) => {
      if (!snapshot.exists) return;
      state.data.settings = { ...state.data.settings, ...snapshot.data() };
      if (state.currentSection === 'settings') renderSettings();
    }, (error) => {
      console.error('[Manna Marketplace] Admin settings listener failed:', error);
    });
  }
  subscribeCollection('sellers', (items) => {
    state.data.sellers = items.map((seller) => normalizeSellerEntry(seller));
    refreshDashboard();
  }, [{ field: 'isDeleted', operator: '!=', value: true }]);
  subscribeCollection('orders', (items) => {
    state.data.orders = items;
    refreshDashboard();
  }, [{ field: 'isDeleted', operator: '!=', value: true }]);
  subscribeCollection('users', (items) => {
    state.data.customers = items
      .filter((item) => item.role === 'customer' || item.role === 'user')
      .map((item) => normalizeUserEntry(item, 'customer'));
    state.data.delivery = items
      .filter((item) => item.role === 'delivery_person' || item.role === 'delivery')
      .map((item) => normalizeUserEntry(item, 'delivery'));

    const db = initStorage().db;
    const sellerUsers = items.filter((item) => item.role === 'seller');
    state.data.sellers = mergeSellerEntries(state.data.sellers, items);

    if (db) {
      const pendingCreations = sellerUsers.map(async (user) => {
        const existingSeller = state.data.sellers.find((seller) => {
          return seller.id === (user.sellerId || user.uid || user.id) || seller.ownerUid === user.uid || seller.email === user.email;
        });

        if (existingSeller && existingSeller.id && existingSeller.id !== user.uid) {
          return null;
        }

        const sellerDocId = user.sellerId || user.uid || user.id;
        const sellerPayload = {
          ownerUid: user.uid,
          ownerName: user.displayName || user.ownerName || '',
          businessName: user.businessName || user.displayName || 'New Seller',
          name: user.businessName || user.displayName || 'New Seller',
          email: user.email || '',
          phone: user.phone || '',
          address: user.address || '',
          city: user.city || '',
          county: user.county || '',
          location: user.address || '',
          status: user.sellerStatus || user.status || 'pending',
          sellerStatus: user.sellerStatus || user.status || 'pending',
          isActive: Boolean(user.isApproved),
          createdAt: new Date(),
          updatedAt: new Date()
        };

        return db.collection('sellers').doc(sellerDocId).set(sellerPayload, { merge: true });
      });

      Promise.allSettled(pendingCreations).catch(() => { });
    }

    if (state.currentSection === 'signup-rewards') renderSignupBlindBoxCampaign();
    refreshDashboard();
  });
  subscribeCollection('reports', (items) => {
    state.data.reports = items;
    refreshDashboard();
  });
  subscribeCollection('notifications', (items, snapshot) => {
    if (adminNotificationRecipientUid !== state.user.uid) {
      adminNotificationRecipientUid = state.user.uid;
      adminNotificationSnapshotReady = false;
      state.data.notifications = [];
    }
    const notifications = items.filter((item) => item.recipientUid === state.user.uid && (!item.recipientRole || item.recipientRole === 'admin'));
    if (adminNotificationSnapshotReady && !snapshot?.metadata?.fromCache) {
      const existingIds = new Set(state.data.notifications.map((item) => item.id));
      if (notifications.some((item) => !item.read && !item.isDeleted && !existingIds.has(item.id))) {
        playSoundEffect('notification');
      }
    }
    state.data.notifications = notifications;
    if (!snapshot?.metadata?.fromCache) adminNotificationSnapshotReady = true;
    updateNotificationBadge();
    refreshDashboard();
  }, [{ field: 'recipientUid', operator: '==', value: state.user.uid }]);
  subscribeCollection('supportRequests', (items) => {
    state.data.supportRequests = items.sort((first, second) => new Date(second.createdAt || 0) - new Date(first.createdAt || 0));
    refreshDashboard();
  });
  subscribeCollection('deliveryPayouts', (items) => {
    state.data.financialPayouts = items;
    if (state.currentSection === 'financials') {
      renderFinancials();
    }
    refreshDashboard();
  });
  subscribeCollection('platformFeePayments', (items) => {
    state.data.platformFeePayments = items;
    if (state.currentSection === 'financials') {
      renderFinancials();
    }
    refreshDashboard();
  });
  subscribeCollection('helpArticles', (items) => {
    state.data.helpArticles = items;
    if (state.currentSection === 'help') {
      renderHelpCenter();
    }
    refreshDashboard();
  });
}

function initializeAdminDataSync() {
  if (adminDataSyncInitialized || state.user.role !== 'admin') return;
  adminDataSyncInitialized = true;
  initializeLocalStorageSync();
}

function init() {
  seedData();
  loadData();
  initializeTheme();
  attachEvents();
  attachLoginHandler();
  ensureAdminAccess();
  ensureAdminWalletSection();
  const hashSection = window.location.hash.replace('#', '').replace(/^admin-/, '');
  const initialSection = ['dashboard', 'products', 'sellers', 'customers', 'delivery', 'orders', 'analytics', 'reports', 'coupons', 'announcements', 'notifications', 'settings', 'logs', 'wallet', 'admin-wallet'].includes(hashSection) ? hashSection : 'dashboard';
  openSection(initialSection);
  window.seedCategories = async () => {
    const { db } = initStorage();
    const categories = await ensureCategoriesSeeded(db);
    createToast('Marketplace categories are up to date.', 'success');
    return categories;
  };
  console.info('[Manna Marketplace] Admin panel initialized with Firebase. Marketplace categories are active.');
}

init();
