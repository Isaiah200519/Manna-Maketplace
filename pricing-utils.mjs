import { getCategoryDisplayName, normalizeCategoryValue } from './category-taxonomy.js';
import { convertCurrency } from './utils.js';

export function normalizeCatalogDiscountPercent(value) {
    const percent = Number(value);
    return Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
}

export function getActiveCatalogPriceRule(settings = {}, now = Date.now()) {
    const savedRule = settings.catalogPriceRule;
    if (savedRule?.enabled === true) {
        if (savedRule.legacy === true) return savedRule;
        const expiresAt = Date.parse(savedRule.expiresAt || '');
        if (Number.isFinite(expiresAt) && expiresAt > now) return savedRule;
    }

    const legacyDiscount = normalizeCatalogDiscountPercent(settings.globalCatalogDiscountPercent);
    if (!savedRule && legacyDiscount > 0) {
        return {
            enabled: true,
            scope: 'all',
            adjustmentType: 'percent',
            direction: 'decrease',
            value: legacyDiscount,
            legacy: true
        };
    }

    return null;
}

export function isCatalogProductInRuleScope(productCategory, rule) {
    if (!rule || rule.scope !== 'categories') return true;
    const category = normalizeCategoryValue(productCategory);
    const categoryIds = Array.isArray(rule.categoryIds) ? rule.categoryIds : [];
    return Boolean(category && categoryIds.includes(category.id));
}

export function getCatalogPriceBreakdown(basePrice, sellerMarkup, discountOrRule, productCategory = '', now = Date.now()) {
    const normalizedBasePrice = Math.max(0, Number(basePrice) || 0);
    const normalizedSellerMarkup = Math.max(0, Number(sellerMarkup) || 0);
    const rule = typeof discountOrRule === 'object' && discountOrRule !== null
        ? getActiveCatalogPriceRule({ catalogPriceRule: discountOrRule }, now)
        : getActiveCatalogPriceRule({ globalCatalogDiscountPercent: discountOrRule }, now);
    let adjustedBasePrice = normalizedBasePrice;
    if (rule && isCatalogProductInRuleScope(productCategory, rule)) {
        const value = Number(rule.value) || 0;
        const adjustment = rule.adjustmentType === 'fixed'
            ? value
            : normalizedBasePrice * value / 100;
        adjustedBasePrice = rule.direction === 'increase'
            ? normalizedBasePrice + adjustment
            : normalizedBasePrice - adjustment;
    }
    adjustedBasePrice = Math.round(Math.max(0, adjustedBasePrice) * 100) / 100;
    const totalPrice = Math.round((adjustedBasePrice + normalizedSellerMarkup) * 100) / 100;

    return {
        basePrice: adjustedBasePrice,
        sellerMarkup: normalizedSellerMarkup,
        totalPrice,
        discountPercent: rule?.adjustmentType === 'percent' && rule.direction === 'decrease' ? Number(rule.value) || 0 : 0,
        priceRule: rule
    };
}

export function applyCatalogDiscount(product, discountPercent) {
    if (!product || typeof product !== 'object') return product;
    const basePrice = Number(product.defaultPrice ?? product.standardPrice ?? product.price ?? 0) || 0;
    const sellerMarkup = Number(product.sellerMarkup ?? 0) || 0;
    const category = getCategoryDisplayName(product.category || '');
    const breakdown = getCatalogPriceBreakdown(basePrice, sellerMarkup, discountPercent, category);
    const currency = String(product.currency || product.standardCurrency || 'LRD').toUpperCase() === 'USD' ? 'USD' : 'LRD';

    return {
        ...product,
        defaultPrice: breakdown.basePrice,
        sellerMarkup: breakdown.sellerMarkup,
        price: currency === 'USD' ? convertCurrency(breakdown.totalPrice, 'LRD', 'USD') : breakdown.totalPrice,
        totalPrice: breakdown.totalPrice,
        discountPercent: breakdown.discountPercent,
        priceInLRD: breakdown.totalPrice,
        priceInUSD: convertCurrency(breakdown.totalPrice, 'LRD', 'USD'),
        updatedAt: product.updatedAt || new Date()
    };
}