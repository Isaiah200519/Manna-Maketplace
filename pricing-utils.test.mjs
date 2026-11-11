import test from 'node:test';
import assert from 'node:assert/strict';
import {
    applyCatalogDiscount,
    getActiveCatalogPriceRule,
    getCatalogPriceBreakdown
} from './pricing-utils.mjs';

const activeRule = (overrides = {}) => ({
    enabled: true,
    scope: 'all',
    adjustmentType: 'percent',
    direction: 'decrease',
    value: 20,
    startsAt: '2025-01-01T00:00:00.000Z',
    expiresAt: '2035-01-01T00:00:00.000Z',
    ...overrides
});

test('percentage reduction applies to the master price and leaves seller markup intact', () => {
    const breakdown = getCatalogPriceBreakdown(1000, 250, activeRule(), 'Phones & Tablets');
    assert.equal(breakdown.basePrice, 800);
    assert.equal(breakdown.sellerMarkup, 250);
    assert.equal(breakdown.totalPrice, 1050);
});

test('fixed increases and decreases affect only the base price', () => {
    const decrease = getCatalogPriceBreakdown(500, 70, activeRule({
        adjustmentType: 'fixed',
        value: 125
    }), 'Clothes');
    const increase = getCatalogPriceBreakdown(500, 70, activeRule({
        adjustmentType: 'fixed',
        direction: 'increase',
        value: 125
    }), 'Clothes');
    assert.deepEqual([decrease.basePrice, decrease.totalPrice], [375, 445]);
    assert.deepEqual([increase.basePrice, increase.totalPrice], [625, 695]);
});

test('category-scoped rules do not change products outside the selected categories', () => {
    const rule = activeRule({ scope: 'categories', categoryIds: ['clothes'] });
    assert.equal(getCatalogPriceBreakdown(100, 25, rule, 'Clothes').totalPrice, 105);
    assert.equal(getCatalogPriceBreakdown(100, 25, rule, 'Shoes & Footwear').totalPrice, 125);
});

test('expired or disabled price rules are inactive', () => {
    const now = Date.parse('2030-01-01T00:00:00.000Z');
    const expiredRule = activeRule({ expiresAt: '2029-12-31T23:59:59.000Z' });
    assert.equal(getActiveCatalogPriceRule({ catalogPriceRule: expiredRule }, now), null);
    assert.equal(getCatalogPriceBreakdown(100, 25, expiredRule, 'Clothes', now).totalPrice, 125);
    assert.equal(getActiveCatalogPriceRule({ catalogPriceRule: activeRule({ enabled: false }) }, now), null);
});

test('legacy global reductions remain supported until replaced by a rule', () => {
    const rule = getActiveCatalogPriceRule({ globalCatalogDiscountPercent: 10 });
    assert.equal(getCatalogPriceBreakdown(100, 50, rule, 'Clothes').totalPrice, 140);
});

test('applying a catalog rule does not mutate its input product', () => {
    const product = { defaultPrice: 100, sellerMarkup: 25, category: 'Clothes', currency: 'LRD' };
    const adjusted = applyCatalogDiscount(product, activeRule());
    assert.equal(product.defaultPrice, 100);
    assert.equal(adjusted.defaultPrice, 80);
    assert.equal(adjusted.sellerMarkup, 25);
    assert.equal(adjusted.priceInLRD, 105);
});
