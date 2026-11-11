import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCatalogStockCount, setCatalogProductStock } from './catalog-stock-utils.mjs';

test('stock count accepts whole numbers from zero through one million', () => {
    assert.equal(normalizeCatalogStockCount('0'), 0);
    assert.equal(normalizeCatalogStockCount('1000000'), 1000000);
    assert.throws(() => normalizeCatalogStockCount('-1'), RangeError);
    assert.throws(() => normalizeCatalogStockCount('1.5'), RangeError);
    assert.throws(() => normalizeCatalogStockCount('1000001'), RangeError);
});

test('setting catalog stock updates top-level and selectable variant counts', () => {
    const product = {
        stockCount: 1,
        storageOptions: [{ label: '128 GB', stockCount: 2, priceModifier: 10 }, '256 GB'],
        shoeVariants: [{ label: 'Size 8', stockCount: 3 }],
        variantOptions: [{ values: { size: 'M' }, stockCount: 4 }]
    };
    const updated = setCatalogProductStock(product, 12);
    assert.equal(updated.stockCount, 12);
    assert.equal(updated.storageOptions[0].stockCount, 12);
    assert.deepEqual(updated.storageOptions[1], { label: '256 GB', priceModifier: 0, stockCount: 12 });
    assert.equal(updated.shoeVariants[0].stockCount, 12);
    assert.equal(updated.variantOptions[0].stockCount, 12);
    assert.equal(product.stockCount, 1);
    assert.equal(product.storageOptions[0].stockCount, 2);
});
