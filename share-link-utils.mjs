export function createCustomerProductShareUrl(sellerId, productId) {
    const normalizedSellerId = String(sellerId ?? '').trim();
    const normalizedProductId = String(productId ?? '').trim();
    if (!normalizedSellerId || !normalizedProductId) return '';

    const url = new URL('https://mannamarketplace.online/customer.html');
    url.searchParams.set('sellerId', normalizedSellerId);
    url.searchParams.set('productId', normalizedProductId);
    return url.href;
}
