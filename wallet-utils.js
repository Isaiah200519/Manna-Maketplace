/**
 * Shared wallet operations for Manna Marketplace.
 * Firebase compatibility scripts must load before the panel scripts.
 */
(function () {
    function firestore() {
        if (!window.firebase?.firestore) throw new Error('Wallet storage is not available.');
        const app = window.firebase.apps?.find((entry) => entry.name === 'manna-marketplace-data');
        if (!app) throw new Error('Wallet Firebase app is not initialized.');
        return window.firebase.firestore(app);
    }

    function userRef(userId, userType) {
        if (!userId) throw new Error('A wallet owner is required.');
        const collection = userType === 'seller' ? 'sellers' : 'users';
        if (!['seller', 'customer', 'delivery'].includes(userType)) throw new Error('Unknown wallet user type.');
        return firestore().collection(collection).doc(userId);
    }

    function amount(value) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('Amount must be greater than zero.');
        return Math.round(parsed * 100) / 100;
    }

    function normalizeWalletCurrency(currency) {
        return String(currency || 'LRD').toUpperCase() === 'USD' ? 'USD' : 'LRD';
    }

    function walletBalanceField(currency) {
        return normalizeWalletCurrency(currency) === 'USD' ? 'balanceUSD' : 'balance';
    }

    function walletBalanceLabel(currency) {
        return normalizeWalletCurrency(currency) === 'USD' ? 'USD' : 'LRD';
    }

    async function getBalance(userId, userType, currency = 'LRD') {
        const snapshot = await userRef(userId, userType).get();
        return snapshot.exists ? Number(snapshot.data()[walletBalanceField(currency)] || 0) : 0;
    }

    async function changeBalance(userId, userType, value, transactionData = {}) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed === 0) throw new Error('Balance change must not be zero.');
        const change = Math.round(parsed * 100) / 100;
        const currency = normalizeWalletCurrency(transactionData.currency);
        const balanceField = walletBalanceField(currency);
        const ref = userRef(userId, userType);
        const db = firestore();
        const ledgerRef = transactionData.idempotencyKey
            ? db.collection('walletTransactions').doc(String(transactionData.idempotencyKey).replace(/[^a-zA-Z0-9_-]/g, '_'))
            : db.collection('walletTransactions').doc();
        await db.runTransaction(async (transaction) => {
            if (transactionData.idempotencyKey && (await transaction.get(ledgerRef)).exists) return;
            const snapshot = await transaction.get(ref);
            const before = Number(snapshot.data()?.[balanceField] || 0);
            if (change < 0 && before < Math.abs(change)) throw new Error('Insufficient balance.');
            const after = before + change;
            transaction.set(ref, { [balanceField]: after, updatedAt: new Date() }, { merge: true });
            transaction.set(ledgerRef, {
                transactionId: ledgerRef.id,
                userId,
                userType,
                amount: change,
                currency,
                balanceBefore: before,
                balanceAfter: after,
                status: 'completed',
                createdAt: new Date(),
                ...transactionData
            });
        });
    }

    async function creditBalance(userId, userType, value, transactionData = {}) {
        return changeBalance(userId, userType, Math.abs(amount(value)), transactionData);
    }

    async function debitBalance(userId, userType, value, transactionData = {}) {
        return changeBalance(userId, userType, -Math.abs(amount(value)), transactionData);
    }

    async function processBalanceOrderPayment(customerId, sellerId, value, orderId) {
        const payment = amount(value);
        const db = firestore();
        const customerRef = userRef(customerId, 'customer');
        const orderRef = db.collection('orders').doc(orderId);
        await db.runTransaction(async (transaction) => {
            const [customerSnapshot, orderSnapshot] = await Promise.all([
                transaction.get(customerRef),
                transaction.get(orderRef)
            ]);
            if (orderSnapshot.exists && orderSnapshot.data()?.walletPaymentCompleted) return;
            const customerBefore = Number(customerSnapshot.data()?.balance || 0);
            if (customerBefore < payment) throw new Error('Insufficient balance.');
            const now = new Date();
            transaction.set(customerRef, { balance: customerBefore - payment, updatedAt: now }, { merge: true });
            transaction.set(orderRef, { paymentMethod: 'balance', paymentStatus: 'pending', walletPaymentCompleted: true, status: 'pending', paidAt: now, updatedAt: now }, { merge: true });
            const customerLedger = db.collection('walletTransactions').doc();
            transaction.set(customerLedger, { transactionId: customerLedger.id, userId: customerId, userType: 'customer', type: 'order_payment', amount: -payment, balanceBefore: customerBefore, balanceAfter: customerBefore - payment, reference: orderId, description: `Order payment #${orderId.slice(0, 8)}`, status: 'completed', createdAt: now });
        });
    }

    async function processBalanceCustomizationFee(customerId, value, orderId) {
        const payment = amount(value);
        const db = firestore();
        const customerRef = userRef(customerId, 'customer');
        const orderRef = db.collection('orders').doc(orderId);
        const ledgerRef = db.collection('walletTransactions').doc(`customization-fee-${String(orderId).replace(/[^a-zA-Z0-9_-]/g, '_')}`);
        await db.runTransaction(async (transaction) => {
            const [customerSnapshot, orderSnapshot] = await Promise.all([
                transaction.get(customerRef),
                transaction.get(orderRef)
            ]);
            if (!orderSnapshot.exists) throw new Error('Order not found.');
            const order = orderSnapshot.data() || {};
            if (order.customerUid !== customerId) throw new Error('This customization fee does not belong to your account.');
            if (order.customizationRequested !== true) throw new Error('This order does not have a customization request.');
            if (order.customizationFeePaymentStatus === 'submitted' && order.customizationFeePaymentMethod === 'balance') return;
            if (order.customizationFeeWalletPaymentCompleted) throw new Error('A wallet payment for this customization fee has already been submitted. Contact the admin to resolve it.');
            if (!['unpaid', 'rejected'].includes(order.customizationFeePaymentStatus)) throw new Error('The customization fee is not awaiting payment.');
            if (Math.abs(Number(order.customizationFee || 0) - payment) > 0.01) throw new Error('The customization fee changed. Refresh the order and try again.');
            const customerBefore = Number(customerSnapshot.data()?.balance || 0);
            if (customerBefore < payment) throw new Error('Insufficient wallet balance.');
            const now = new Date();
            transaction.set(customerRef, { balance: customerBefore - payment, updatedAt: now }, { merge: true });
            transaction.set(orderRef, {
                customizationFeePaymentStatus: 'submitted',
                customizationFeePaymentPhone: 'Wallet balance',
                customizationFeePaymentReference: ledgerRef.id,
                customizationFeePaymentMethod: 'balance',
                customizationFeePaymentCurrency: 'LRD',
                customizationFeeWalletPaymentCompleted: true,
                customizationFeePaymentSubmittedAt: now,
                updatedAt: now
            }, { merge: true });
            transaction.set(ledgerRef, {
                transactionId: ledgerRef.id,
                userId: customerId,
                userType: 'customer',
                type: 'customization_fee_payment',
                amount: -payment,
                currency: 'LRD',
                balanceBefore: customerBefore,
                balanceAfter: customerBefore - payment,
                reference: orderId,
                description: `Customization fee for Order #${order.orderNumber || orderId.slice(0, 8)}`,
                status: 'completed',
                createdAt: now
            });
        });
    }

    async function distributeOrderRevenue(order = {}) {
        const orderId = order.orderId || order.id;
        if (!orderId || !order.sellerId) throw new Error('A seller and order are required for revenue distribution.');
        const db = firestore();
        const orderRef = db.collection('orders').doc(orderId);
        const revenueConfigSnapshot = await db.collection('appConfig').doc('revenue').get();
        const revenueConfig = revenueConfigSnapshot.exists ? revenueConfigSnapshot.data() : {};
        const sellerOwnedSellerShare = Number(revenueConfig.sellerOwnedSellerShare ?? 0.8);
        const sellerOwnedPlatformShare = Number(revenueConfig.sellerOwnedPlatformShare ?? 0.2);
        const items = Array.isArray(order.items) ? order.items : [];
        const productTotal = items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1), 0);
        const defaultPrice = Number(order.defaultPrice ?? items.reduce((sum, item) => sum + Number(item.defaultPrice || 0) * Number(item.quantity || 1), 0));
        const sellerMarkup = Number(order.sellerMarkup ?? items.reduce((sum, item) => sum + Number(item.sellerMarkup || 0) * Number(item.quantity || 1), 0));
        const totalPrice = Number(order.totalPrice ?? productTotal);
        const isSellerOwned = Boolean(order.isSellerOwned ?? items.some((item) => item.isSellerOwned));
        const sellerShare = Math.round((isSellerOwned ? totalPrice * sellerOwnedSellerShare : sellerMarkup) * 100) / 100;
        const platformShare = Math.round((isSellerOwned ? totalPrice * sellerOwnedPlatformShare : (defaultPrice || totalPrice - sellerMarkup)) * 100) / 100;
        await db.runTransaction(async (transaction) => {
            const orderSnapshot = await transaction.get(orderRef);
            if (!orderSnapshot.exists) throw new Error('Order not found.');
            if (orderSnapshot.data()?.revenueDistributed) return;
            const sellerRef = userRef(order.sellerId, 'seller');
            const adminRef = db.collection('adminWallet').doc('summary');
            const [sellerSnapshot, adminSnapshot] = await Promise.all([transaction.get(sellerRef), transaction.get(adminRef)]);
            const now = new Date();
            if (sellerShare > 0) {
                const sellerBefore = Number(sellerSnapshot.data()?.balance || 0);
                transaction.set(sellerRef, { balance: sellerBefore + sellerShare, updatedAt: now }, { merge: true });
                const sellerLedger = db.collection('walletTransactions').doc();
                transaction.set(sellerLedger, {
                    transactionId: sellerLedger.id,
                    userId: order.sellerId,
                    userType: 'seller',
                    type: isSellerOwned ? 'order_earning' : 'markup_earning',
                    amount: sellerShare,
                    balanceBefore: sellerBefore,
                    balanceAfter: sellerBefore + sellerShare,
                    reference: orderId,
                    description: isSellerOwned ? `Seller share from Order #${orderId.slice(0, 8)}` : `Markup earning from Order #${orderId.slice(0, 8)}`,
                    status: 'completed',
                    createdAt: now
                });
            }
            if (platformShare > 0) {
                const adminBefore = Number(adminSnapshot.data()?.balance || 0);
                transaction.set(adminRef, {
                    balance: adminBefore + platformShare,
                    totalEarnings: Number(adminSnapshot.data()?.totalEarnings || 0) + platformShare,
                    updatedAt: now
                }, { merge: true });
                const adminLedger = db.collection('adminWallet').doc('transactions').collection('log').doc();
                transaction.set(adminLedger, {
                    type: 'order_revenue',
                    amount: platformShare,
                    reference: orderId,
                    description: isSellerOwned ? `Platform share from Order #${orderId.slice(0, 8)}` : `Catalog price from Order #${orderId.slice(0, 8)}`,
                    createdAt: now
                });
            }
            transaction.set(orderRef, {
                isSellerOwned,
                defaultPrice,
                sellerMarkup,
                totalPrice,
                sellerShare,
                platformShare,
                revenueDistributed: true,
                distributedAt: now
            }, { merge: true });
        });
    }

    async function creditSellerForOrder(sellerId, value, orderId) {
        const payment = amount(value);
        const db = firestore();
        const sellerRef = userRef(sellerId, 'seller');
        const orderRef = db.collection('orders').doc(orderId);
        await db.runTransaction(async (transaction) => {
            const [sellerSnapshot, orderSnapshot] = await Promise.all([transaction.get(sellerRef), transaction.get(orderRef)]);
            if (orderSnapshot.data()?.sellerCredited) return;
            const before = Number(sellerSnapshot.data()?.balance || 0);
            const after = before + payment;
            const now = new Date();
            transaction.set(sellerRef, { balance: after, updatedAt: now }, { merge: true });
            transaction.set(orderRef, { sellerCredited: true, creditedAt: now, updatedAt: now }, { merge: true });
            const ledgerRef = db.collection('walletTransactions').doc();
            transaction.set(ledgerRef, { transactionId: ledgerRef.id, userId: sellerId, userType: 'seller', type: 'order_earning', amount: payment, balanceBefore: before, balanceAfter: after, reference: orderId, description: `Earning from Order #${orderId.slice(0, 8)}`, status: 'completed', createdAt: now });
        });
    }

    async function creditDeliveryForOrder(deliveryUserId, value, orderId) {
        const payment = amount(value);
        const db = firestore();
        const deliveryRef = userRef(deliveryUserId, 'delivery');
        const orderRef = db.collection('orders').doc(orderId);
        await db.runTransaction(async (transaction) => {
            const [deliverySnapshot, orderSnapshot] = await Promise.all([transaction.get(deliveryRef), transaction.get(orderRef)]);
            if (orderSnapshot.data()?.deliveryCredited) return;
            const before = Number(deliverySnapshot.data()?.balance || 0);
            const now = new Date();
            transaction.set(deliveryRef, { balance: before + payment, updatedAt: now }, { merge: true });
            transaction.set(orderRef, { deliveryCredited: true, deliveryCreditedAt: now, updatedAt: now }, { merge: true });
            const ledgerRef = db.collection('walletTransactions').doc();
            transaction.set(ledgerRef, { transactionId: ledgerRef.id, userId: deliveryUserId, userType: 'delivery', type: 'order_earning', amount: payment, balanceBefore: before, balanceAfter: before + payment, reference: orderId, description: `Delivery earning - Order #${orderId.slice(0, 8)}`, status: 'completed', createdAt: now });
        });
    }

    async function submitDepositRequest(userId, userType, userName, userEmail, value, paymentRef, senderPhone, paymentMethod = 'uba_usd', currency = 'USD') {
        const deposit = amount(value);
        if (!paymentRef?.trim()) throw new Error('Payment reference is required.');
        if (!senderPhone?.trim()) throw new Error('Sender phone number is required.');
        const myPaymentMethod = String(paymentMethod || 'uba_usd').trim() || 'uba_usd';
        const myCurrency = String(currency || (myPaymentMethod === 'uba_lrd' ? 'LRD' : 'USD')).trim().toUpperCase() || 'USD';
        const ref = firestore().collection('depositRequests').doc();
        await ref.set({ requestId: ref.id, userId, userType, userName: userName || '', userEmail: userEmail || '', amount: deposit, paymentRef: paymentRef.trim(), senderPhone: senderPhone.trim(), paymentMethod: myPaymentMethod, currency: myCurrency, status: 'pending', createdAt: new Date(), confirmedAt: null, confirmedBy: null }, { merge: true });
        return ref.id;
    }

    async function submitWithdrawalRequest(userId, userType, userName, value, recipientName, recipientPhone) {
        const withdrawal = amount(value);
        const balance = await getBalance(userId, userType, 'LRD');
        if (withdrawal <= balance) {
            throw new Error(`Withdrawal amount must be greater than your current balance (${formatLRD(balance)}).`);
        }
        if (!recipientName?.trim()) throw new Error('Recipient name is required.');
        if (!recipientPhone?.trim()) throw new Error('Recipient phone number is required.');
        await debitBalance(userId, userType, withdrawal, { type: 'withdrawal', currency: 'LRD', reference: 'pending', description: `Withdrawal request - L$${withdrawal.toLocaleString()}` });
        const ref = firestore().collection('withdrawalRequests').doc();
        await ref.set({ requestId: ref.id, userId, userType, userName: userName || '', amount: withdrawal, recipientName: recipientName.trim(), recipientPhone: recipientPhone.trim(), status: 'pending', createdAt: new Date(), paidAt: null, receivedAt: null, paidBy: null }, { merge: true });
        return ref.id;
    }

    async function loadTransactionHistory(userId, limitCount = 20) {
        const snapshot = await firestore().collection('walletTransactions').where('userId', '==', userId).orderBy('createdAt', 'desc').limit(limitCount).get();
        return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    }

    async function loadWalletConfig() {
        const db = firestore();
        const walletSnapshot = await db.collection('appConfig').doc('wallet').get();
        const wallet = walletSnapshot.exists ? walletSnapshot.data() : {};
        const settingsSnapshot = await db.collection('adminSettings').doc('config').get();
        const settings = settingsSnapshot.exists ? settingsSnapshot.data() : {};
        return {
            ...wallet,
            ...settings,
            adminMobileName: settings.platformName || wallet.adminMobileName || 'Manna Marketplace',
            adminMobileNumber: settings.adminOrangeMoneyNumber || settings.adminLonestarMoneyNumber || wallet.adminMobileNumber || '',
            adminOrangeMoneyNumber: settings.adminOrangeMoneyNumber || wallet.adminOrangeMoneyNumber || '',
            adminLonestarMoneyNumber: settings.adminLonestarMoneyNumber || wallet.adminLonestarMoneyNumber || '',
            ubaUsdAccountNumber: settings.ubaUsdAccountNumber || wallet.ubaUsdAccountNumber || '',
            ubaLrdAccountNumber: settings.ubaLrdAccountNumber || wallet.ubaLrdAccountNumber || '',
            ubaUsdReceiverName: settings.ubaUsdReceiverName || wallet.ubaUsdReceiverName || '',
            ubaLrdReceiverName: settings.ubaLrdReceiverName || wallet.ubaLrdReceiverName || '',
            ubaUsdPaymentImage: settings.ubaUsdPaymentImage || wallet.ubaUsdPaymentImage || '',
            ubaLrdPaymentImage: settings.ubaLrdPaymentImage || wallet.ubaLrdPaymentImage || '',
            orangeMoneyUsdNumber: settings.orangeMoneyUsdNumber || wallet.orangeMoneyUsdNumber || settings.adminOrangeMoneyNumber || '',
            orangeMoneyLrdNumber: settings.orangeMoneyLrdNumber || wallet.orangeMoneyLrdNumber || settings.adminOrangeMoneyNumber || '',
            orangeMoneyUsdReceiverName: settings.orangeMoneyUsdReceiverName || wallet.orangeMoneyUsdReceiverName || '',
            orangeMoneyLrdReceiverName: settings.orangeMoneyLrdReceiverName || wallet.orangeMoneyLrdReceiverName || '',
            orangeMoneyUsdImage: settings.orangeMoneyUsdImage || wallet.orangeMoneyUsdImage || './images/payments/orange.png',
            orangeMoneyLrdImage: settings.orangeMoneyLrdImage || wallet.orangeMoneyLrdImage || './images/payments/orange.png',
            lonestarMoneyUsdNumber: settings.lonestarMoneyUsdNumber || wallet.lonestarMoneyUsdNumber || settings.adminLonestarMoneyNumber || '',
            lonestarMoneyLrdNumber: settings.lonestarMoneyLrdNumber || wallet.lonestarMoneyLrdNumber || settings.adminLonestarMoneyNumber || '',
            lonestarMoneyUsdReceiverName: settings.lonestarMoneyUsdReceiverName || wallet.lonestarMoneyUsdReceiverName || '',
            lonestarMoneyLrdReceiverName: settings.lonestarMoneyLrdReceiverName || wallet.lonestarMoneyLrdReceiverName || '',
            lonestarMoneyUsdImage: settings.lonestarMoneyUsdImage || wallet.lonestarMoneyUsdImage || './images/payments/lonestar.png',
            lonestarMoneyLrdImage: settings.lonestarMoneyLrdImage || wallet.lonestarMoneyLrdImage || './images/payments/lonestar.png',
        };
    }

    function getConfiguredDepositMethods(config, currency) {
        const normalizedCurrency = String(currency || 'USD').toUpperCase();
        const methods = [];
        if (normalizedCurrency === 'USD' && config.ubaUsdAccountNumber) methods.push({ value: 'uba_usd', label: 'UBA USD Account', receiverName: config.ubaUsdReceiverName, details: `${config.ubaUsdReceiverName || 'Receiver'} • ${config.ubaUsdAccountNumber}`, image: config.ubaUsdPaymentImage });
        if (normalizedCurrency === 'LRD' && config.ubaLrdAccountNumber) methods.push({ value: 'uba_lrd', label: 'UBA LRD Account', receiverName: config.ubaLrdReceiverName, details: `${config.ubaLrdReceiverName || 'Receiver'} • ${config.ubaLrdAccountNumber}`, image: config.ubaLrdPaymentImage });
        const orangeNumber = normalizedCurrency === 'USD' ? config.orangeMoneyUsdNumber : config.orangeMoneyLrdNumber;
        const lonestarNumber = normalizedCurrency === 'USD' ? config.lonestarMoneyUsdNumber : config.lonestarMoneyLrdNumber;
        if (orangeNumber) methods.push({ value: 'orange_money', label: 'Orange Money', receiverName: normalizedCurrency === 'USD' ? config.orangeMoneyUsdReceiverName : config.orangeMoneyLrdReceiverName, details: `${(normalizedCurrency === 'USD' ? config.orangeMoneyUsdReceiverName : config.orangeMoneyLrdReceiverName) || 'Receiver'} • ${orangeNumber}`, image: normalizedCurrency === 'USD' ? config.orangeMoneyUsdImage : config.orangeMoneyLrdImage });
        if (lonestarNumber) methods.push({ value: 'lonestar_mobile_money', label: 'Lonestar Cell', receiverName: normalizedCurrency === 'USD' ? config.lonestarMoneyUsdReceiverName : config.lonestarMoneyLrdReceiverName, details: `${(normalizedCurrency === 'USD' ? config.lonestarMoneyUsdReceiverName : config.lonestarMoneyLrdReceiverName) || 'Receiver'} • ${lonestarNumber}`, image: normalizedCurrency === 'USD' ? config.lonestarMoneyUsdImage : config.lonestarMoneyLrdImage });
        return methods;
    }

    async function autoReceiveOldWithdrawals(userId) {
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        const snapshot = await firestore().collection('withdrawalRequests').where('userId', '==', userId).orderBy('createdAt', 'desc').get();
        await Promise.all(snapshot.docs.filter((doc) => {
            if (doc.data().status !== 'paid') return false;
            const paidAt = doc.data().paidAt?.toDate?.() || new Date(doc.data().paidAt || 0);
            return paidAt.getTime() && paidAt.getTime() < cutoff;
        }).map((doc) => doc.ref.update({ status: 'received', receivedAt: new Date() })));
    }

    function formatLRD(value) {
        return `L$${Number(value || 0).toLocaleString('en-LR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    Object.assign(window, { getBalance, creditBalance, debitBalance, processBalanceOrderPayment, processBalanceCustomizationFee, distributeOrderRevenue, creditSellerForOrder, creditDeliveryForOrder, submitDepositRequest, submitWithdrawalRequest, loadTransactionHistory, loadWalletConfig, getConfiguredDepositMethods, autoReceiveOldWithdrawals, formatLRD });
})();
