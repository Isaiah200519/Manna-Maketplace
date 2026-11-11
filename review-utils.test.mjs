import assert from 'node:assert/strict';
import test from 'node:test';
import { getReviewProductReferences } from './review-utils.mjs';

test('catalog reviews retain both seller menu and master product references', () => {
    assert.deepEqual(getReviewProductReferences({ menuItemId: 'menu-1', masterProductId: 'master-1' }), {
        menuItemId: 'menu-1',
        masterProductId: 'master-1'
    });
});

test('legacy catalog order resolves its master ID from the seller menu copy', () => {
    assert.deepEqual(getReviewProductReferences({ menuItemId: 'menu-1' }, { masterProductId: 'master-1' }), {
        menuItemId: 'menu-1',
        masterProductId: 'master-1'
    });
});

test('seller-owned and international items cannot update a master product', () => {
    assert.equal(getReviewProductReferences({ menuItemId: 'menu-1', masterProductId: 'master-1', isSellerOwned: true }).masterProductId, '');
    assert.equal(getReviewProductReferences({ menuItemId: 'menu-2', masterProductId: 'master-2', internationalProductId: 'intl-2' }).masterProductId, '');
});