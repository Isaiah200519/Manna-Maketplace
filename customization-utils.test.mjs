import test from 'node:test';
import assert from 'node:assert/strict';
import {
    canChangeOrderCustomization,
    canFulfillCustomizedOrder,
    getCustomizationFeeStatus,
    isCustomizedOrder,
    normalizeCustomizationFee
} from './customization-utils.mjs';

test('customers may change a customization request only while order payment is unconfirmed', () => {
    assert.equal(canChangeOrderCustomization({ customizationRequested: true, paymentStatus: 'pending', status: 'pending' }), true);
    assert.equal(canChangeOrderCustomization({ customizationRequested: true, paymentStatus: 'confirmed', status: 'pending' }), false);
    assert.equal(canChangeOrderCustomization({ customizationRequested: true, paymentStatus: 'pending', status: 'preparing' }), false);
    assert.equal(canChangeOrderCustomization({ customizationRequested: true, paymentStatus: 'pending', status: 'pending', customizationFeePaymentStatus: 'unpaid' }), true);
    assert.equal(canChangeOrderCustomization({ customizationRequested: true, paymentStatus: 'pending', status: 'pending', customizationFeePaymentStatus: 'submitted' }), false);
    assert.equal(canChangeOrderCustomization({ customizationRequested: true, paymentStatus: 'pending', status: 'pending', customizationFeePaymentStatus: 'paid' }), false);
});

test('customized orders cannot proceed until their quoted fee is paid or waived', () => {
    assert.equal(canFulfillCustomizedOrder({ customizationRequested: false }), true);
    assert.equal(canFulfillCustomizedOrder({ customizationRequested: true, customizationFeePaymentStatus: 'not_quoted' }), false);
    assert.equal(canFulfillCustomizedOrder({ customizationRequested: true, customizationFeePaymentStatus: 'unpaid' }), false);
    assert.equal(canFulfillCustomizedOrder({ customizationRequested: true, customizationFeePaymentStatus: 'paid' }), true);
    assert.equal(canFulfillCustomizedOrder({ customizationRequested: true, customizationFeePaymentStatus: 'waived' }), true);
});

test('customization fee status defaults safely for old and non-custom orders', () => {
    assert.equal(getCustomizationFeeStatus({}), 'not_applicable');
    assert.equal(getCustomizationFeeStatus({ customizationRequested: true }), 'not_quoted');
    assert.equal(isCustomizedOrder({ items: [{ customizationRequested: true }] }), true);
    assert.equal(isCustomizedOrder({ customizationRequested: false, items: [{ customizationRequested: true }] }), false);
});

test('customization fees must be finite non-negative LRD amounts', () => {
    assert.equal(normalizeCustomizationFee('12.345'), 12.35);
    assert.throws(() => normalizeCustomizationFee(-1), RangeError);
    assert.throws(() => normalizeCustomizationFee('not a fee'), RangeError);
    assert.throws(() => normalizeCustomizationFee(1000001), RangeError);
});
