import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomerProductShareUrl } from './share-link-utils.mjs';

test('creates customer-panel product links on the production domain', () => {
    const url = new URL(createCustomerProductShareUrl('seller-123', 'product-456'));

    assert.equal(url.origin, 'https://mannamarketplace.online');
    assert.equal(url.pathname, '/customer.html');
    assert.equal(url.searchParams.get('sellerId'), 'seller-123');
    assert.equal(url.searchParams.get('productId'), 'product-456');
});

test('encodes product link parameters and rejects missing IDs', () => {
    const url = new URL(createCustomerProductShareUrl('seller #1', 'product one'));

    assert.equal(url.searchParams.get('sellerId'), 'seller #1');
    assert.equal(url.searchParams.get('productId'), 'product one');
    assert.equal(createCustomerProductShareUrl('', 'product-456'), '');
    assert.equal(createCustomerProductShareUrl('seller-123', ''), '');
});
