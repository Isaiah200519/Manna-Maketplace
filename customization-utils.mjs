export function isCustomizedOrder(order = {}) {
    if (typeof order.customizationRequested === 'boolean') return order.customizationRequested;
    return Array.isArray(order.items) && order.items.some((item) => item?.customizationRequested === true);
}

export function canChangeOrderCustomization(order = {}) {
    return order.paymentStatus !== 'confirmed'
        && !['submitted', 'paid'].includes(order.customizationFeePaymentStatus)
        && order.status === 'pending'
        && order.refundStatus !== 'requested'
        && order.refundStatus !== 'approved';
}

export function canFulfillCustomizedOrder(order = {}) {
    if (!isCustomizedOrder(order)) return true;
    return ['paid', 'waived'].includes(order.customizationFeePaymentStatus);
}

export function getCustomizationFeeStatus(order = {}) {
    if (!isCustomizedOrder(order)) return 'not_applicable';
    return String(order.customizationFeePaymentStatus || 'not_quoted');
}

export function normalizeCustomizationFee(value) {
    const fee = Number(value);
    if (!Number.isFinite(fee) || fee < 0 || fee > 1000000) {
        throw new RangeError('Customization fee must be from 0 to 1,000,000 LRD.');
    }
    return Math.round(fee * 100) / 100;
}
