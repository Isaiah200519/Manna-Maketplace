export const COMMUNITY_OPTIONS = [
    'Central Monrovia',
    'Sinkor',
    'Paynesville',
    'Brewerville',
    'Kakata',
    'Buchanan',
    'Gbarnga',
    'Harbel',
    'Bensonville',
    'Robertsport',
    'Zwedru',
    'Gbanzon',
    'Clay-Ashland'
];

export function getCommunityOptions() {
    return COMMUNITY_OPTIONS;
}

export function parseDateInput(value) {
    if (!value) return null;
    const parsed = new Date(`${value}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isDateInRange(value, startDate, endDate) {
    if (!value) return false;
    const date = value.toDate ? value.toDate() : new Date(value);
    if (!Number.isFinite(date.getTime())) return false;
    if (startDate) {
        const start = startDate.toDate ? startDate.toDate() : new Date(startDate);
        const startBoundary = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0);
        if (date < startBoundary) return false;
    }
    if (endDate) {
        const end = endDate.toDate ? endDate.toDate() : new Date(endDate);
        const endBoundary = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999);
        if (date > endBoundary) return false;
    }
    return true;
}

export const CURRENCY_RATES = { LRD: 195, USD: 195 };

export function normalizeCurrency(currency) {
    return String(currency || 'LRD').toUpperCase() === 'USD' ? 'USD' : 'LRD';
}

export function formatCurrency(value, currency = 'LRD') {
    const normalizedCurrency = normalizeCurrency(currency);
    const symbol = normalizedCurrency === 'USD' ? 'US$' : 'L$';
    return `${symbol}${Number(value || 0).toLocaleString('en-LR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function convertCurrency(value, fromCurrency, toCurrency) {
    const from = normalizeCurrency(fromCurrency);
    const to = normalizeCurrency(toCurrency);
    const amount = Number(value || 0);
    if (from === to) return amount;
    return from === 'USD' ? amount * CURRENCY_RATES.USD : amount / CURRENCY_RATES.LRD;
}

export function formatDate(value) {
    if (!value) return '—';
    const date = value.toDate ? value.toDate() : new Date(value);
    return new Intl.DateTimeFormat('en-LR', {
        dateStyle: 'medium',
        timeStyle: 'short'
    }).format(date);
}

export function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function getInitials(name = 'Admin') {
    return name
        .split(' ')
        .map((part) => part[0])
        .slice(0, 2)
        .join('')
        .toUpperCase();
}

export function getAvatarHtml(name = 'User', size = '40px') {
    return `<div class="avatar" style="width: ${size}; height: ${size}; font-size: ${parseInt(size) * 0.4}px;">${escapeHtml(getInitials(name))}</div>`;
}

export function createToast(message, type = 'info') {
    const root = document.getElementById('toastRoot');
    if (!root) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    root.appendChild(toast);
    window.setTimeout(() => toast.remove(), 2600);
}

export async function copyText(value, fallbackMessage = 'Copied to clipboard.') {
    const text = String(value ?? '').trim();
    if (!text) return false;

    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (error) {
            console.warn('[Manna Marketplace] Clipboard API failed:', error);
        }
    }

    try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        return true;
    } catch (error) {
        console.warn('[Manna Marketplace] Fallback copy failed:', error);
        return false;
    }
}

export function dialUSSD(code) {
    const text = String(code ?? '').trim();
    if (!text) return false;
    const encoded = encodeURIComponent(text);
    window.location.href = `tel:${encoded}`;
    return true;
}

export function confirmDialog(message) {
    return window.confirm(message);
}

export function getImageUrl(filename, fallback = './images/placeholder.png') {
    if (!filename) return fallback;
    const normalized = String(filename).trim();
    if (!normalized) return fallback;
    if (/^https?:\/\//i.test(normalized)) return normalized;
    if (normalized.startsWith('./') || normalized.startsWith('../') || normalized.startsWith('/')) return normalized;
    if (normalized.startsWith('images/')) return `./${normalized}`;
    return `./images/products/${normalized}`;
}

const imagesWithoutThumbnails = new Set([
    'accessories & gadgets/hand-electric-fan-1.jpg',
    'books & stationery/fountain-pen-1.jpg',
    'clothes/scarf-1.jpg',
    'hair care/women-hair-1.jpg',
    'hair care/women-hair-2.jpg',
    'hair care/women-hair-3.jpg',
    'hair care/women-hair-4.jpg',
    'hair care/women-hair-5.jpg',
    'hair care/women-hair-6.jpg',
    'hair care/women-hair-7.jpg',
    'hair care/women-hair-8.jpg',
    'hair care/women-hair-9.jpg',
    'hair care/women-hair-10.jpg',
    'hair care/women-hair-11.jpg',
    'jewelry & watches/medal-1.jpg',
    'jewelry & watches/medal-2.jpg',
    'jewelry & watches/medal-3.jpg',
    'kitchen & dining/bottle-22.jpg.jpg',
    'men-clothing/cap-15.jpg',
    'men-clothing/t-shirt-17.jpg',
    'products/samsung-galaxy-z-flod-2.jpg',
    'products/samsung-galaxy-z-flod-3.jpg',
    'products/samsung-galaxy-z-flod-4.jpg',
    'products/samsung-galaxy-z-flod-5.jpg',
    'products/samsung-galaxy-z-flod-6.jpg'
]);

export function getProductThumbnailUrl(filename, fallback = './images/placeholder.png') {
    const imageUrl = getImageUrl(filename, fallback);
    const localImagePath = imageUrl
        .replace(/^(?:\.\/|\.\.\/|\/)?images\//i, '')
        .split(/[?#]/, 1)[0]
        .replace(/\\/g, '/')
        .toLowerCase();
    if (imagesWithoutThumbnails.has(localImagePath)) return imageUrl;

    const productMatch = imageUrl.match(/^(\.\/images\/products\/)(?!optimized\/)([^/?#]+)\.(jpe?g)([?#].*)?$/i);
    if (productMatch) return `${productMatch[1]}optimized/${productMatch[2]}.${productMatch[3]}${productMatch[4] || ''}`;

    const localImageMatch = imageUrl.match(/^(?:\.\/|\.\.\/|\/)images\/(?!logo\/|products\/optimized\/|thumbnails\/)(.+\.(?:jpe?g|png))([?#].*)?$/i);
    if (!localImageMatch) return imageUrl;
    return `./images/thumbnails/${localImageMatch[1]}${localImageMatch[2] || ''}`;
}

export async function deleteOrder(orderId, db, options = {}) {
    if (!orderId || !db) return false;
    const { onSuccess, onError, userId, role } = options;
    try {
        const update = { isDeleted: true, updatedAt: new Date() };
        await db.collection('orders').doc(orderId).set(update, { merge: true });
        if (typeof onSuccess === 'function') onSuccess();
        return true;
    } catch (error) {
        if (typeof onError === 'function') onError(error);
        return false;
    }
}

export function getSellerImageUrl(sellerOrLogo, fallback = './images/placeholder.png') {
    if (!sellerOrLogo) return fallback;
    const candidate = typeof sellerOrLogo === 'string' ? sellerOrLogo : (sellerOrLogo.imagePath || sellerOrLogo.image || sellerOrLogo.logo || sellerOrLogo.sellerImage || '');
    let normalized = String(candidate).trim().replace(/\\/g, '/');
    if (!normalized) return fallback;
    if (/^(https?:\/\/|data:image\/|blob:)/i.test(normalized)) return normalized;
    normalized = normalized.replace(/^\.\//, '').replace(/^\//, '');
    normalized = normalized.replace(/^images\/sellers\//i, 'images/sellers-store-pic/');
    if (/^images\/sellers-store-pic\/placeholder\.(png|svg)$/i.test(normalized) || /^placeholder\.(png|svg)$/i.test(normalized)) {
        return `./images/${normalized.split('.').pop().toLowerCase() === 'svg' ? 'placeholder.svg' : 'placeholder.png'}`;
    }
    if (normalized.startsWith('../')) return normalized;
    if (normalized.startsWith('images/')) return `./${normalized}`;
    return `./images/sellers-store-pic/${normalized}`;
}

export function getSellerLogo(logo, fallback = './images/placeholder.png') {
    return getSellerImageUrl(logo, fallback);
}

export function slugify(value = '') {
    return String(value).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export function calculateDistance(lat1, lon1, lat2, lon2) {
    const parsedLat1 = Number(lat1);
    const parsedLon1 = Number(lon1);
    const parsedLat2 = Number(lat2);
    const parsedLon2 = Number(lon2);

    if (![parsedLat1, parsedLon1, parsedLat2, parsedLon2].every(Number.isFinite)) {
        return null;
    }

    const R = 6371;
    const dLat = (parsedLat2 - parsedLat1) * (Math.PI / 180);
    const dLon = (parsedLon2 - parsedLon1) * (Math.PI / 180);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(parsedLat1 * (Math.PI / 180)) * Math.cos(parsedLat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Number((R * c).toFixed(2));
}

export function getHelpArticlesByContext(helpArticles, context, userRole = 'customer') {
    if (!Array.isArray(helpArticles) || !context) return [];
    return helpArticles.filter((article) => {
        const hasContext = Array.isArray(article.displayContexts) && article.displayContexts.includes(context);
        const hasRole = !Array.isArray(article.targetRoles) || article.targetRoles.length === 0 || article.targetRoles.includes(userRole);
        return hasContext && hasRole;
    });
}
