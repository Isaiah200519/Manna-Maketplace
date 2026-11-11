export function getReviewProductReferences(orderItem = {}, menuItem = {}) {
    const menuItemId = String(orderItem.menuItemId || orderItem.productId || '').trim();
    const isSellerOwned = orderItem.isSellerOwned === true
        || orderItem.orderFlow === 'seller_owned'
        || menuItem.isSellerOwned === true
        || menuItem.orderFlow === 'seller_owned';
    const isInternationalInventory = Boolean(orderItem.internationalProductId || menuItem.internationalProductId);

    return {
        menuItemId,
        masterProductId: isSellerOwned || isInternationalInventory
            ? ''
            : String(orderItem.masterProductId || menuItem.masterProductId || '').trim()
    };
}