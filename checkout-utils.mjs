export function resolveSellerPaymentDetails(seller = {}, cart = {}) {
    const fallbackMethods = ['mobile_money', 'cash'];
    const cartMethods = Array.isArray(cart.sellerAcceptedPaymentMethods)
        ? cart.sellerAcceptedPaymentMethods.filter(Boolean)
        : [];
    const sellerMethods = Array.isArray(seller?.acceptedPaymentMethods)
        ? seller.acceptedPaymentMethods.filter(Boolean)
        : [];
    const acceptedPaymentMethods = (cartMethods.length ? cartMethods : sellerMethods.length ? sellerMethods : fallbackMethods)
        .map((method) => String(method).trim().toLowerCase())
        .filter(Boolean);

    const paymentReceiver = String(
        cart.sellerPaymentReceiver || seller?.mobileMoneyNumber || seller?.paymentReceiver || seller?.paymentPhone || ''
    ).trim();

    return {
        sellerMobileMoney: paymentReceiver,
        sellerPaymentReceiver: paymentReceiver,
        acceptedPaymentMethods: acceptedPaymentMethods.length ? acceptedPaymentMethods : fallbackMethods
    };
}
