import assert from 'node:assert/strict';
import test from 'node:test';
import { findConfiguredVariant, normalizeConfiguredVariants } from './product-variant-utils.mjs';

test('normalizes existing configured variant values without changing stored data', () => {
    const original = [{ values: { size: ' M ', color: 'Blue' }, priceModifier: '25', stockCount: '3' }];
    const variants = normalizeConfiguredVariants(original);

    assert.deepEqual(variants[0].values, { size: 'M', color: 'Blue' });
    assert.equal(variants[0].priceModifier, 25);
    assert.equal(variants[0].stockCount, 3);
    assert.equal(original[0].values.size, ' M ');
});

test('matches only the exact configured option combination', () => {
    const variants = [
        { values: { size: 'M', color: 'Blue' }, stockCount: 2 },
        { values: { size: 'L', color: 'Blue' }, stockCount: 0 }
    ];

    assert.equal(findConfiguredVariant(variants, { size: 'M', color: 'Blue' })?.stockCount, 2);
    assert.equal(findConfiguredVariant(variants, { size: 'L', color: 'Blue' })?.stockCount, 0);
    assert.equal(findConfiguredVariant(variants, { size: 'M' }), null);
    assert.equal(findConfiguredVariant(variants, { size: 'M', color: 'Blue', material: 'Cotton' }), null);
});
