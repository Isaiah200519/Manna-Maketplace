// Run once in the browser console on a Firebase-loaded page: initWalletSchema()
async function initWalletSchema() {
    if (!window.firebase?.firestore) throw new Error('Firebase Firestore is not available.');
    await firebase.firestore().collection('appConfig').doc('wallet').set({
        adminMobileName: 'Manna Marketplace',
        adminMobileNumber: '+231XXXXXXXXX',
        ubaUsdAccountNumber: '53020500624780',
        ubaLrdAccountNumber: '53020500624799',
        ubaAccountName: 'Isaiah Savie',
        depositNote: 'Default payment is USD. You can choose UBA USD or UBA LRD before making a deposit or direct checkout payment.',
        currency: 'USD',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    console.log('[Manna Wallet] Ready. Balances are stored on sellers/{id} and users/{id}.');
    console.log('[Manna Wallet] Collections created on first write: depositRequests, withdrawalRequests, walletTransactions.');
}
