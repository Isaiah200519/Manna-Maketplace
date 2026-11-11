import assert from 'node:assert/strict';
import test from 'node:test';
import { getProductThumbnailUrl } from './utils.js';

test('uses the original image when a generated thumbnail is unavailable', () => {
    const cases = [
        ['images/Clothes/scarf-1.jpg', './images/Clothes/scarf-1.jpg'],
        ['images/men-clothing/T-shirt-17.jpg', './images/men-clothing/T-shirt-17.jpg'],
        ['images/Kitchen & Dining/bottle-22.jpg.jpg', './images/Kitchen & Dining/bottle-22.jpg.jpg'],
        ['images/Jewelry & Watches/medal-1.jpg', './images/Jewelry & Watches/medal-1.jpg'],
        ['images/products/samsung-galaxy-z-flod-4.jpg', './images/products/samsung-galaxy-z-flod-4.jpg']
    ];

    for (const [source, expected] of cases) {
        assert.equal(getProductThumbnailUrl(source), expected);
    }
});

test('continues using generated thumbnails and optimized product images', () => {
    assert.equal(
        getProductThumbnailUrl('images/men-clothing/T-shirt-1.jpg'),
        './images/thumbnails/men-clothing/T-shirt-1.jpg'
    );
    assert.equal(
        getProductThumbnailUrl('iPhone_16.jpg'),
        './images/products/optimized/iPhone_16.jpg'
    );
});
