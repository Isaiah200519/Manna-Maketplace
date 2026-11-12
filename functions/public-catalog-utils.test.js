const test = require('node:test');
const assert = require('node:assert/strict');
const {
    projectPublicCatalogSettings,
    projectPublicInventoryItem,
    projectPublicMenuItem,
    projectPublicPromotion,
    projectPublicSeller
} = require('./public-catalog-utils');

test('public seller projection excludes account and payment details', () => {
    const seller = projectPublicSeller('seller-1', {
        businessName: 'Local Market',
        category: 'Food',
        description: 'Fresh products',
        phone: '+231000000',
        email: 'private@example.test',
        ownerName: 'Private Owner',
        mobileMoneyNumber: 'private-payment',
        address: 'Private address',
        pickupCoordinates: { latitude: 6, longitude: -10 }
    });

    assert.equal(seller.name, 'Local Market');
    assert.equal(seller.category, 'Food');
    assert.equal('phone' in seller, false);
    assert.equal('email' in seller, false);
    assert.equal('ownerName' in seller, false);
    assert.equal('mobileMoneyNumber' in seller, false);
    assert.equal('address' in seller, false);
    assert.equal('pickupCoordinates' in seller, false);
});

test('public menu projection includes only supported product fields', () => {
    const product = projectPublicMenuItem('item-1', 'seller-1', { name: 'Local Market', category: 'Food' }, {
        name: 'Cassava',
        price: 250,
        availability: true,
        notes: 'private seller note',
        internalCost: 100,
        videoUrl: 'javascript:alert(1)'
    });

    assert.equal(product.name, 'Cassava');
    assert.equal(product.price, 250);
    assert.equal(product.availability, true);
    assert.equal(product.videoUrl, '');
    assert.equal('notes' in product, false);
    assert.equal('internalCost' in product, false);
});

test('public inventory and promotions are bounded and sanitized', () => {
    const inventory = projectPublicInventoryItem('inventory-1', 'seller-1', { name: 'Local Market' }, {
        name: 'Resale item',
        resalePrice: '45',
        quantity: -2,
        purchasePrice: 20,
        purchaseCurrency: 'USD'
    });
    const promotion = projectPublicPromotion('promo-1', {
        title: 'Weekend sale',
        discountPercent: 150,
        productIds: ['item-1'],
        internalNote: 'private'
    });

    assert.equal(inventory.quantity, 0);
    assert.equal(inventory.isInventoryItem, true);
    assert.equal('purchasePrice' in inventory, false);
    assert.equal(promotion.discountPercent, 100);
    assert.deepEqual(promotion.productIds, ['item-1']);
    assert.equal('internalNote' in promotion, false);
});

test('public catalog settings expose only price-rule fields', () => {
    const settings = projectPublicCatalogSettings({
        catalogPriceRule: {
            enabled: true,
            scope: 'categories',
            adjustmentType: 'percent',
            direction: 'decrease',
            value: 10,
            categoryIds: ['food'],
            secret: 'private'
        },
        adminWhatsAppNumber: '+231000000',
        paymentMethods: ['private']
    });

    assert.equal(settings.catalogPriceRule.value, 10);
    assert.deepEqual(settings.catalogPriceRule.categoryIds, ['food']);
    assert.equal('secret' in settings.catalogPriceRule, false);
    assert.equal('adminWhatsAppNumber' in settings, false);
    assert.equal('paymentMethods' in settings, false);
});
