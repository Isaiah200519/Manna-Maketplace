const { randomInt, randomUUID } = require('node:crypto');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { HttpsError, onCall } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const {
    projectPublicCatalogSettings,
    projectPublicInventoryItem,
    projectPublicMenuItem,
    projectPublicPromotion,
    projectPublicSeller
} = require('./public-catalog-utils');

initializeApp();

const db = getFirestore();
const CAMPAIGN_PATH = 'appConfig/signupBlindBox';
const CLAIMS_COLLECTION = 'signupRewardClaims';
const SESSIONS_COLLECTION = 'signupBlindBoxSessions';
const REWARD_ORDER_TYPE = 'signup_blind_box';
const LEGACY_SESSION_ID = 'legacy';
const DEFAULT_CUSTOMER_LIMIT = 25;
const MAX_CUSTOMER_LIMIT = 1000;
const PUBLIC_CATALOG_CACHE_MS = 60 * 1000;
let publicCatalogCache = null;
let publicCatalogCacheExpiresAt = 0;
let publicCatalogLoadPromise = null;

function normalizeCoordinatesValue(value) {
    if (!value || typeof value !== 'object') return null;
    const latitudeValue = value.latitude ?? value.lat;
    const longitudeValue = value.longitude ?? value.lng;
    if (latitudeValue === null || longitudeValue === null
        || String(latitudeValue ?? '').trim() === '' || String(longitudeValue ?? '').trim() === '') return null;
    const latitude = Number(latitudeValue);
    const longitude = Number(longitudeValue);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
        || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
    return { latitude, longitude };
}

function calculateStraightLineDistanceKm(first, second) {
    const toRadians = (degrees) => degrees * Math.PI / 180;
    const latitudeDelta = toRadians(second.latitude - first.latitude);
    const longitudeDelta = toRadians(second.longitude - first.longitude);
    const haversine = Math.sin(latitudeDelta / 2) ** 2
        + Math.cos(toRadians(first.latitude)) * Math.cos(toRadians(second.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
    return 2 * 6371.0088 * Math.asin(Math.sqrt(Math.min(1, haversine)));
}

function toTimestampMillis(value) {
    if (value?.toMillis) return value.toMillis();
    if (value?.toDate) return value.toDate().getTime();
    const millis = Date.parse(value || '');
    return Number.isFinite(millis) ? millis : null;
}

function parseSessionLimit(value) {
    const limit = Number(value);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CUSTOMER_LIMIT) {
        throw new HttpsError('invalid-argument', `Customer limit must be a whole number between 1 and ${MAX_CUSTOMER_LIMIT}.`);
    }
    return limit;
}

function parseSessionDate(value, endOfDay = false) {
    const dateOnly = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
        throw new HttpsError('invalid-argument', 'Choose valid session start and end dates.');
    }
    const date = new Date(`${dateOnly}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
    if (!Number.isFinite(date.getTime())) throw new HttpsError('invalid-argument', 'Choose valid session start and end dates.');
    return date;
}

async function requireAdmin(uid, email = '') {
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in as an administrator.');
    const adminSnapshot = await db.collection('users').doc(uid).get();
    const profile = adminSnapshot.exists ? adminSnapshot.data() || {} : {};
    const isAllowlistedAdmin = String(email).trim().toLowerCase() === 'savieisaiah54@gmail.com';
    if (profile.role !== 'admin' && profile.userRole !== 'admin' && profile.isAdmin !== true && !isAllowlistedAdmin) {
        throw new HttpsError('permission-denied', 'Only administrators can manage this campaign.');
    }
}

function hasUsableAddress(user, address) {
    return Boolean(
        address?.fullAddress
        || address?.address
        || address?.label
        || address?.deliveryDetails
        || user?.address
    );
}

function createBlindBoxAssignments(products) {
    const shuffled = [...products];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const otherIndex = randomInt(index + 1);
        [shuffled[index], shuffled[otherIndex]] = [shuffled[otherIndex], shuffled[index]];
    }
    return shuffled.map((product) => ({ boxId: randomUUID(), productId: product.id }));
}

async function loadPublicCatalog() {
    const [sellerSnapshot, platformSettingsSnapshot, adminSettingsSnapshot] = await Promise.all([
        db.collection('sellers').where('status', '==', 'approved').where('isActive', '==', true).get(),
        db.collection('settings').doc('platform').get(),
        db.collection('adminSettings').doc('config').get()
    ]);
    const sellerDocuments = sellerSnapshot.docs.filter((sellerDoc) => !['rest-pizza', 'rest-burger', 'rest-dominos'].includes(sellerDoc.id));
    const sellers = [];
    const products = [];
    const promotions = {};

    for (let batchStart = 0; batchStart < sellerDocuments.length; batchStart += 6) {
        const batch = sellerDocuments.slice(batchStart, batchStart + 6);
        const results = await Promise.all(batch.map(async (sellerDoc) => {
            const sellerData = sellerDoc.data() || {};
            const sellerRef = db.collection('sellers').doc(sellerDoc.id);
            const [menuSnapshot, promotionSnapshot, inventorySnapshot] = await Promise.all([
                sellerRef.collection('menu').limit(200).get(),
                sellerRef.collection('promotions').limit(50).get(),
                sellerRef.collection('internationalInventory').limit(200).get()
            ]);
            const seller = projectPublicSeller(sellerDoc.id, sellerData);
            const sellerPromotions = promotionSnapshot.docs
                .map((promotionDoc) => projectPublicPromotion(promotionDoc.id, promotionDoc.data() || {}));
            const sellerProducts = [
                ...menuSnapshot.docs
                    .filter((menuDoc) => {
                        const item = menuDoc.data() || {};
                        return item.isAvailable === true || item.availability === true;
                    })
                    .map((menuDoc) => projectPublicMenuItem(menuDoc.id, sellerDoc.id, sellerData, menuDoc.data() || {})),
                ...inventorySnapshot.docs
                    .filter((inventoryDoc) => {
                        const item = inventoryDoc.data() || {};
                        return item.status === 'active' && Number(item.quantity || 0) > 0;
                    })
                    .map((inventoryDoc) => projectPublicInventoryItem(inventoryDoc.id, sellerDoc.id, sellerData, inventoryDoc.data() || {}))
            ];
            return { seller, sellerPromotions, sellerProducts };
        }));

        for (const result of results) {
            sellers.push(result.seller);
            promotions[result.seller.id] = result.sellerPromotions;
            products.push(...result.sellerProducts);
        }
    }

    return {
        sellers,
        products,
        promotions,
        catalogSettings: projectPublicCatalogSettings({
            ...(platformSettingsSnapshot.exists ? platformSettingsSnapshot.data() || {} : {}),
            ...(adminSettingsSnapshot.exists ? adminSettingsSnapshot.data() || {} : {})
        }),
        generatedAt: new Date().toISOString()
    };
}

exports.getPublicCatalog = onCall({ region: 'us-central1', cors: true, maxInstances: 3, timeoutSeconds: 60 }, async () => {
    if (publicCatalogCache && publicCatalogCacheExpiresAt > Date.now()) return publicCatalogCache;
    if (publicCatalogLoadPromise) return publicCatalogLoadPromise;

    publicCatalogLoadPromise = loadPublicCatalog()
        .then((catalog) => {
            publicCatalogCache = catalog;
            publicCatalogCacheExpiresAt = Date.now() + PUBLIC_CATALOG_CACHE_MS;
            return catalog;
        })
        .finally(() => {
            publicCatalogLoadPromise = null;
        });

    return publicCatalogLoadPromise;
});

exports.assignSignupBlindBox = onDocumentCreated({ document: 'users/{uid}', retry: true }, async (event) => {
    const user = event.data?.data();
    const uid = event.params.uid;
    if (!user || user.role !== 'customer') return;

    let authUser;
    try {
        authUser = await getAuth().getUser(uid);
    } catch (error) {
        logger.warn('Signup reward skipped because no Firebase Auth account exists.', { uid, error });
        return;
    }

    const campaignRef = db.doc(CAMPAIGN_PATH);
    const userRef = db.collection('users').doc(uid);
    const claimRef = db.collection(CLAIMS_COLLECTION).doc(uid);
    await db.runTransaction(async (transaction) => {
        const [campaignSnapshot, existingClaim] = await Promise.all([
            transaction.get(campaignRef),
            transaction.get(claimRef)
        ]);
        if (existingClaim.exists || !campaignSnapshot.exists) return;

        const campaign = campaignSnapshot.data() || {};
        const registrationTime = Date.parse(authUser.metadata.creationTime || '');
        const sessionId = String(campaign.sessionId || LEGACY_SESSION_ID);
        const sessionRef = db.collection(SESSIONS_COLLECTION).doc(sessionId);
        const sessionSnapshot = await transaction.get(sessionRef);
        const session = sessionSnapshot.exists ? sessionSnapshot.data() || {} : campaign;
        const startTime = toTimestampMillis(session.startsAt ?? campaign.startsAt);
        const endTime = toTimestampMillis(session.endsAt ?? campaign.endsAt);
        const products = Array.isArray(session.products) ? session.products : [];
        const awardedCount = Number(session.awardedCount || 0);
        const customerLimit = Math.max(1, Math.min(MAX_CUSTOMER_LIMIT, Number(session.customerLimit ?? session.winnerLimit ?? campaign.customerLimit ?? campaign.winnerLimit) || DEFAULT_CUSTOMER_LIMIT));
        if ((session.status || campaign.status) !== 'active'
            || !Number.isFinite(registrationTime)
            || (startTime !== null && registrationTime < startTime)
            || (endTime !== null && registrationTime > endTime)
            || products.length !== 4
            || new Set(products.map((item) => item.internationalProductId || item.id)).size !== 4
            || products.reduce((sum, item) => sum + Number(item.remainingQuantity ?? item.quantity ?? 0), 0) < customerLimit - awardedCount
            || awardedCount >= customerLimit) return;

        const slotNumber = awardedCount + 1;
        const boxAssignments = createBlindBoxAssignments(products);
        const boxOptions = boxAssignments.map(({ boxId }) => ({ boxId }));
        const now = FieldValue.serverTimestamp();
        const nextStatus = slotNumber >= customerLimit ? 'full' : 'active';
        const claimSummary = {
            customerUid: uid,
            customerName: user.displayName || '',
            customerEmail: user.email || '',
            slotNumber,
            status: 'eligible',
            selectedProductName: '',
            orderId: ''
        };
        transaction.create(claimRef, {
            customerUid: uid,
            customerName: user.displayName || '',
            customerEmail: user.email || '',
            status: 'eligible',
            slotNumber,
            sessionId,
            campaignId: sessionId,
            boxOptions,
            boxAssignments,
            selectedProductId: '',
            createdAt: now,
            updatedAt: now
        });
        transaction.update(userRef, {
            signupRewardClaim: {
                claimId: uid,
                status: 'eligible',
                slotNumber,
                sessionId,
                boxOptions,
                campaignId: sessionId,
                createdAt: now,
                updatedAt: now
            },
            updatedAt: now
        });
        transaction.set(sessionRef, {
            ...session,
            sessionId,
            status: nextStatus,
            customerLimit,
            winnerLimit: customerLimit,
            awardedCount: slotNumber,
            claims: [...(Array.isArray(session.claims) ? session.claims : []), claimSummary],
            updatedAt: now
        }, { merge: true });
        transaction.update(campaignRef, {
            sessionId,
            customerLimit,
            winnerLimit: customerLimit,
            awardedCount: slotNumber,
            claims: [...(Array.isArray(session.claims) ? session.claims : []), claimSummary],
            status: nextStatus,
            updatedAt: now
        });
    });
});

exports.manageSignupBlindBoxCampaign = onCall(async (request) => {
    await requireAdmin(request.auth?.uid, request.auth?.token?.email);
    const action = String(request.data?.action || '');
    const campaignRef = db.doc(CAMPAIGN_PATH);

    if (action === 'save') {
        const requestedProducts = Array.isArray(request.data?.products) ? request.data.products : [];
        const customerLimit = parseSessionLimit(request.data?.customerLimit);
        const startDate = parseSessionDate(request.data?.startsAt);
        const endDate = parseSessionDate(request.data?.endsAt, true);
        if (startDate > endDate) throw new HttpsError('invalid-argument', 'The session end date must be on or after its start date.');
        if (requestedProducts.length !== 4) throw new HttpsError('invalid-argument', 'Choose exactly four reward products.');
        const productIds = requestedProducts.map((item) => String(item.internationalProductId || item.id || '').trim());
        if (productIds.some((id) => !id) || new Set(productIds).size !== 4) {
            throw new HttpsError('invalid-argument', 'Choose four different International Products.');
        }
        const productRefs = productIds.map((id) => db.collection('internationalProducts').doc(id));
        const legacySessionRef = db.collection(SESSIONS_COLLECTION).doc(LEGACY_SESSION_ID);
        await db.runTransaction(async (transaction) => {
            const [campaignSnapshot, legacySessionSnapshot, ...productSnapshots] = await Promise.all([
                transaction.get(campaignRef),
                transaction.get(legacySessionRef),
                ...productRefs.map((reference) => transaction.get(reference))
            ]);
            const masterProductRefs = productSnapshots.map((snapshot) => {
                const masterProductId = snapshot.data()?.masterProductId;
                return masterProductId ? db.collection('masterProducts').doc(masterProductId) : null;
            });
            const masterProductSnapshots = await Promise.all(masterProductRefs.map((reference) => reference ? transaction.get(reference) : null));
            const currentCampaign = campaignSnapshot.exists ? campaignSnapshot.data() || {} : {};
            const currentEndTime = toTimestampMillis(currentCampaign.endsAt);
            if (currentCampaign.status === 'active' && (currentEndTime === null || currentEndTime >= Date.now())) {
                throw new HttpsError('failed-precondition', 'Pause or finish the current session before saving a new one.');
            }
            const products = requestedProducts.map((requested, index) => {
                const offer = productSnapshots[index].data() || {};
                const masterProduct = masterProductSnapshots[index]?.data() || {};
                const quantity = Number(requested.quantity || 0);
                if (!productSnapshots[index].exists || offer.status !== 'active' || offer.isDeleted || !masterProductSnapshots[index]?.exists || !Number.isInteger(quantity) || quantity < 1) {
                    throw new HttpsError('invalid-argument', 'Each reward must be an active International Product with a whole-number quantity.');
                }
                return {
                    id: productIds[index],
                    internationalProductId: productIds[index],
                    masterProductId: offer.masterProductId || '',
                    name: masterProduct.name || offer.name || requested.name || 'Reward product',
                    category: masterProduct.category || '',
                    description: masterProduct.description || offer.description || '',
                    image: masterProduct.image || masterProduct.imageFilename || requested.image || '',
                    imageFilename: masterProduct.imageFilename || masterProduct.image || requested.imageFilename || requested.image || '',
                    storageOptions: Array.isArray(masterProduct.storageOptions) ? masterProduct.storageOptions : [],
                    colorOptions: Array.isArray(masterProduct.colorOptions) ? masterProduct.colorOptions : [],
                    shoeVariants: Array.isArray(masterProduct.shoeVariants) ? masterProduct.shoeVariants : [],
                    variantOptions: Array.isArray(masterProduct.variantOptions) ? masterProduct.variantOptions : [],
                    quantity,
                    remainingQuantity: quantity,
                    claimedQuantity: 0
                };
            });
            if (products.reduce((sum, item) => sum + item.quantity, 0) < customerLimit) {
                throw new HttpsError('failed-precondition', 'Reward quantities must cover the configured customer limit.');
            }
            if (!legacySessionSnapshot.exists && Array.isArray(currentCampaign.claims) && currentCampaign.claims.length) {
                transaction.set(legacySessionRef, {
                    ...currentCampaign,
                    sessionId: LEGACY_SESSION_ID,
                    customerLimit: Number(currentCampaign.customerLimit || currentCampaign.winnerLimit || DEFAULT_CUSTOMER_LIMIT),
                    winnerLimit: Number(currentCampaign.customerLimit || currentCampaign.winnerLimit || DEFAULT_CUSTOMER_LIMIT),
                    updatedAt: FieldValue.serverTimestamp()
                });
            }
            transaction.set(campaignRef, {
                status: 'draft',
                sessionId: '',
                startsAt: startDate,
                endsAt: endDate,
                customerLimit,
                winnerLimit: customerLimit,
                awardedCount: 0,
                deliveryFeesPaid: 0,
                claims: [],
                products,
                updatedAt: FieldValue.serverTimestamp()
            }, { merge: true });
        });
        return { status: 'draft' };
    }

    if (action === 'activate') {
        await db.runTransaction(async (transaction) => {
            const campaignSnapshot = await transaction.get(campaignRef);
            if (!campaignSnapshot.exists) throw new HttpsError('not-found', 'Save a reward session before activating.');
            const campaign = campaignSnapshot.data() || {};
            const products = Array.isArray(campaign.products) ? campaign.products : [];
            const remainingStock = products.reduce((sum, item) => sum + Number(item.remainingQuantity ?? item.quantity ?? 0), 0);
            const customerLimit = parseSessionLimit(campaign.customerLimit ?? campaign.winnerLimit);
            const startsAt = campaign.startsAt;
            const endsAt = campaign.endsAt;
            const startTime = toTimestampMillis(startsAt);
            const endTime = toTimestampMillis(endsAt);
            if (!campaign.products || !startsAt || !endsAt || startTime === null || endTime === null || startTime > endTime) {
                throw new HttpsError('failed-precondition', 'Save valid session dates and four reward products before activating.');
            }
            const now = Date.now();
            if (now < startTime || now > endTime) {
                throw new HttpsError('failed-precondition', 'The session can only be activated during its configured date range.');
            }
            const currentEndTime = toTimestampMillis(campaign.endsAt);
            if (campaign.status === 'active' && currentEndTime !== null && currentEndTime >= now) {
                throw new HttpsError('failed-precondition', 'Pause or finish the current session before activating another.');
            }
            if (products.length !== 4 || new Set(products.map((item) => item.internationalProductId || item.id)).size !== 4
                || remainingStock < customerLimit) {
                throw new HttpsError('failed-precondition', 'Four different products and enough stock for the configured customer limit are required.');
            }
            const sessionId = db.collection(SESSIONS_COLLECTION).doc().id;
            const sessionRef = db.collection(SESSIONS_COLLECTION).doc(sessionId);
            const session = {
                ...campaign,
                sessionId,
                status: 'active',
                customerLimit,
                winnerLimit: customerLimit,
                awardedCount: 0,
                claims: [],
                startsAt,
                endsAt,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            };
            transaction.create(sessionRef, session);
            transaction.update(campaignRef, {
                sessionId,
                status: 'active',
                customerLimit,
                winnerLimit: customerLimit,
                awardedCount: 0,
                claims: [],
                updatedAt: FieldValue.serverTimestamp()
            });
        });
        return { status: 'active' };
    }

    if (action === 'pause') {
        await db.runTransaction(async (transaction) => {
            const campaignSnapshot = await transaction.get(campaignRef);
            if (!campaignSnapshot.exists) throw new HttpsError('not-found', 'The reward campaign does not exist.');
            const campaign = campaignSnapshot.data() || {};
            const sessionId = String(campaign.sessionId || '');
            const sessionRef = sessionId ? db.collection(SESSIONS_COLLECTION).doc(sessionId) : null;
            const sessionSnapshot = sessionRef ? await transaction.get(sessionRef) : null;
            const now = FieldValue.serverTimestamp();
            if (sessionSnapshot?.exists && sessionSnapshot.data()?.status === 'active') {
                transaction.update(sessionRef, { status: 'paused', updatedAt: now });
            }
            transaction.update(campaignRef, { status: 'paused', updatedAt: now });
        });
        return { status: 'paused' };
    }

    throw new HttpsError('invalid-argument', 'Choose a valid campaign action.');
});

exports.claimSignupBlindBox = onCall(async (request) => {
    const uid = request.auth?.uid;
    const boxId = String(request.data?.boxId || '').trim();
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in to claim your reward.');
    if (!boxId) throw new HttpsError('invalid-argument', 'Choose one of the four reward boxes.');

    const userRef = db.collection('users').doc(uid);
    const claimRef = db.collection(CLAIMS_COLLECTION).doc(uid);
    const campaignRef = db.doc(CAMPAIGN_PATH);
    let result;

    await db.runTransaction(async (transaction) => {
        const [userSnapshot, claimSnapshot, campaignSnapshot, activeAddresses] = await Promise.all([
            transaction.get(userRef),
            transaction.get(claimRef),
            transaction.get(campaignRef),
            transaction.get(userRef.collection('addresses').where('isActive', '==', true).limit(1))
        ]);
        if (!userSnapshot.exists || userSnapshot.data()?.role !== 'customer') {
            throw new HttpsError('permission-denied', 'Only customer accounts can claim this reward.');
        }
        const user = userSnapshot.data() || {};
        if (!user.displayName || !user.phone || !hasUsableAddress(user, activeAddresses.docs[0]?.data())) {
            throw new HttpsError('failed-precondition', 'Complete your profile and save a delivery address before choosing a box.');
        }
        if (!claimSnapshot.exists || claimSnapshot.data()?.status !== 'eligible') {
            throw new HttpsError('failed-precondition', 'This account does not have an unclaimed signup reward.');
        }
        if (!campaignSnapshot.exists) throw new HttpsError('not-found', 'The reward campaign is unavailable.');

        const claimData = claimSnapshot.data() || {};
        const sessionId = String(claimData.sessionId || LEGACY_SESSION_ID);
        const sessionRef = db.collection(SESSIONS_COLLECTION).doc(sessionId);
        const sessionSnapshot = await transaction.get(sessionRef);
        if (!sessionSnapshot.exists && sessionId !== LEGACY_SESSION_ID) {
            throw new HttpsError('not-found', 'The reward session for this claim is unavailable.');
        }
        const campaign = sessionSnapshot.exists ? sessionSnapshot.data() || {} : campaignSnapshot.data() || {};
        const products = Array.isArray(campaign.products) ? campaign.products : [];
        if (products.length !== 4 || new Set(products.map((item) => item.internationalProductId || item.id)).size !== 4) {
            throw new HttpsError('failed-precondition', 'The campaign choices or available reward stock are not configured.');
        }
        const assignedClaim = (Array.isArray(campaign.claims) ? campaign.claims : []).find((claim) => claim.customerUid === uid);
        if (!assignedClaim || assignedClaim.status !== 'eligible' || assignedClaim.slotNumber !== claimData.slotNumber) {
            throw new HttpsError('permission-denied', 'This account was not assigned one of the campaign reward slots.');
        }
        const boxAssignment = Array.isArray(claimData.boxAssignments)
            ? claimData.boxAssignments.find((item) => item.boxId === boxId)
            : null;
        if (!boxAssignment) {
            throw new HttpsError('invalid-argument', 'That box does not belong to this customer claim.');
        }
        const productIndex = products.findIndex((item) => item.id === boxAssignment.productId);
        if (productIndex < 0) throw new HttpsError('invalid-argument', 'That product is not one of the campaign choices.');
        const product = products[productIndex];
        const remainingQuantity = Number(product.remainingQuantity ?? product.quantity ?? 0);
        if (remainingQuantity <= 0) throw new HttpsError('failed-precondition', 'That reward is no longer available. Choose another box.');
        if (!product.masterProductId) throw new HttpsError('failed-precondition', 'The reward is not linked to a master product.');
        const masterProductSnapshot = await transaction.get(db.collection('masterProducts').doc(product.masterProductId));
        if (!masterProductSnapshot.exists) throw new HttpsError('failed-precondition', 'The reward master product no longer exists.');
        const masterProduct = masterProductSnapshot.data() || {};
        const updatedProducts = products.map((entry, index) => index === productIndex
            ? { ...entry, remainingQuantity: remainingQuantity - 1, claimedQuantity: Number(entry.claimedQuantity || 0) + 1 }
            : entry);
        const safeProduct = {
            id: product.id,
            internationalProductId: product.internationalProductId || product.id,
            masterProductId: product.masterProductId || '',
            name: masterProduct.name || product.name || 'Reward product',
            category: masterProduct.category || '',
            description: masterProduct.description || product.description || '',
            image: masterProduct.image || masterProduct.imageFilename || product.image || '',
            imageFilename: masterProduct.imageFilename || masterProduct.image || product.imageFilename || product.image || '',
            storageOptions: Array.isArray(masterProduct.storageOptions) ? masterProduct.storageOptions : [],
            colorOptions: Array.isArray(masterProduct.colorOptions) ? masterProduct.colorOptions : [],
            shoeVariants: Array.isArray(masterProduct.shoeVariants) ? masterProduct.shoeVariants : [],
            variantOptions: Array.isArray(masterProduct.variantOptions) ? masterProduct.variantOptions : []
        };
        const now = FieldValue.serverTimestamp();

        const updatedSession = {
            products: updatedProducts,
            claims: (Array.isArray(campaign.claims) ? campaign.claims : []).map((claim) => claim.customerUid === uid
                ? { ...claim, status: 'selected', selectedProductName: safeProduct.name }
                : claim),
            updatedAt: now
        };
        if (sessionSnapshot.exists) transaction.update(sessionRef, updatedSession);
        else transaction.update(campaignRef, updatedSession);
        if (sessionSnapshot.exists && campaignSnapshot.exists
            && String(campaignSnapshot.data()?.sessionId || LEGACY_SESSION_ID) === sessionId) {
            transaction.update(campaignRef, updatedSession);
        }
        transaction.update(claimRef, {
            sessionId,
            status: 'selected',
            selectedProductId: product.id,
            selectedProductName: safeProduct.name,
            selectedProduct: safeProduct,
            revealedProducts: products.map((entry) => ({
                id: entry.id,
                boxId: claimData.boxAssignments.find((assignment) => assignment.productId === entry.id)?.boxId || '',
                name: entry.name || 'Reward product',
                image: entry.image || '',
                imageFilename: entry.imageFilename || entry.image || '',
                selected: entry.id === product.id
            })),
            selectedAt: now,
            updatedAt: now
        });
        transaction.update(userRef, {
            signupRewardClaim: {
                claimId: uid,
                status: 'selected',
                slotNumber: claimData.slotNumber,
                sessionId,
                campaignId: sessionId,
                selectedProductId: safeProduct.id,
                selectedProductName: safeProduct.name,
                selectedProduct: safeProduct,
                revealedProducts: products.map((entry) => ({
                    id: entry.id,
                    boxId: claimData.boxAssignments.find((assignment) => assignment.productId === entry.id)?.boxId || '',
                    name: entry.name || 'Reward product',
                    image: entry.image || '',
                    imageFilename: entry.imageFilename || entry.image || '',
                    selected: entry.id === product.id
                })),
                selectedAt: now,
                updatedAt: now
            },
            updatedAt: now
        });
        result = {
            productId: safeProduct.id,
            productName: safeProduct.name,
            selectedProduct: safeProduct,
            revealedProducts: products.map((entry) => ({
                id: entry.id,
                boxId: claimData.boxAssignments.find((assignment) => assignment.productId === entry.id)?.boxId || '',
                name: entry.name || 'Reward product',
                image: entry.image || '',
                imageFilename: entry.imageFilename || entry.image || '',
                selected: entry.id === product.id
            }))
        };
    });

    return result;
});

exports.submitSignupRewardOrder = onCall(async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in to place your reward order.');
    const selections = request.data?.selections || {};
    const userRef = db.collection('users').doc(uid);
    const claimRef = db.collection(CLAIMS_COLLECTION).doc(uid);
    const campaignRef = db.doc(CAMPAIGN_PATH);
    const settingsRef = db.collection('adminSettings').doc('config');
    const orderRef = db.collection('orders').doc();
    let result;

    await db.runTransaction(async (transaction) => {
        const [userSnapshot, claimSnapshot, campaignSnapshot, addressSnapshot, settingsSnapshot] = await Promise.all([
            transaction.get(userRef),
            transaction.get(claimRef),
            transaction.get(campaignRef),
            transaction.get(userRef.collection('addresses').where('isActive', '==', true).limit(1)),
            transaction.get(settingsRef)
        ]);
        if (!userSnapshot.exists || userSnapshot.data()?.role !== 'customer') {
            throw new HttpsError('permission-denied', 'Only customer accounts can order this reward.');
        }
        const user = userSnapshot.data() || {};
        const claim = claimSnapshot.data() || {};
        if (claim.status === 'ordered' && claim.orderId) {
            result = { orderId: claim.orderId, alreadySubmitted: true };
            return;
        }
        if (claim.status !== 'selected' || !claim.selectedProduct) {
            throw new HttpsError('failed-precondition', 'Choose one mystery box before placing your reward order.');
        }
        const sessionId = String(claim.sessionId || LEGACY_SESSION_ID);
        const sessionRef = db.collection(SESSIONS_COLLECTION).doc(sessionId);
        const sessionSnapshot = await transaction.get(sessionRef);
        if (!sessionSnapshot.exists && sessionId !== LEGACY_SESSION_ID) {
            throw new HttpsError('not-found', 'The reward session for this claim is unavailable.');
        }
        const campaign = sessionSnapshot.exists ? sessionSnapshot.data() || {} : campaignSnapshot.data() || {};
        const platformSettings = settingsSnapshot.exists ? settingsSnapshot.data() || {} : {};
        const campaignProducts = Array.isArray(campaign.products) ? campaign.products : [];
        const campaignProductIndex = campaignProducts.findIndex((item) => item.id === claim.selectedProduct.id);
        if (campaignProductIndex < 0) throw new HttpsError('failed-precondition', 'The selected reward is no longer in this campaign.');
        const campaignProduct = campaignProducts[campaignProductIndex];
        const product = claim.selectedProduct;
        const addresses = addressSnapshot.docs;
        const address = addresses[0]?.data() || user;
        if (!hasUsableAddress(user, address)) {
            throw new HttpsError('failed-precondition', 'Save your delivery address before placing the reward order.');
        }
        const warehouse = platformSettings.warehouseLocation || {};
        const warehouseCoordinates = normalizeCoordinatesValue(warehouse);
        if (!warehouseCoordinates) {
            throw new HttpsError('failed-precondition', 'The admin must configure the warehouse pickup location before reward orders can be placed.');
        }
        const customerCoordinates = normalizeCoordinatesValue(address.coordinates)
            || normalizeCoordinatesValue(address)
            || normalizeCoordinatesValue(user.deliveryAddress);
        if (!customerCoordinates) {
            throw new HttpsError('failed-precondition', 'Confirm a delivery map pin before placing the reward order.');
        }
        const rawDeliveryRate = platformSettings.distanceDeliveryRatePerKm;
        const deliveryRatePerKm = Number(rawDeliveryRate);
        if (rawDeliveryRate === null || rawDeliveryRate === undefined || String(rawDeliveryRate).trim() === ''
            || !Number.isFinite(deliveryRatePerKm) || deliveryRatePerKm < 0) {
            throw new HttpsError('failed-precondition', 'The admin must configure the distance delivery rate before reward orders can be placed.');
        }
        const deliveryDistanceKm = calculateStraightLineDistanceKm(warehouseCoordinates, customerCoordinates);
        const deliveryFee = Math.round(deliveryDistanceKm * deliveryRatePerKm * 100) / 100;
        const storageSize = String(selections.storageSize || '').trim();
        const color = String(selections.color || '').trim();
        const shoeSize = String(selections.shoeSize || '').trim();
        const storageOptions = Array.isArray(campaignProduct.storageOptions) ? campaignProduct.storageOptions : [];
        const storageLabels = storageOptions.map((option) => typeof option === 'string' ? option : String(option?.label || '')).filter(Boolean);
        if (storageLabels.length && !storageLabels.includes(storageSize)) {
            throw new HttpsError('invalid-argument', 'Choose a valid storage option for this reward.');
        }
        const storedStorageOptions = Array.isArray(campaignProduct.storageOptions) ? [...campaignProduct.storageOptions] : [];
        const selectedStorageIndex = storedStorageOptions.findIndex((option) => (typeof option === 'string' ? option : String(option?.label || '')) === storageSize);
        if (selectedStorageIndex >= 0 && typeof storedStorageOptions[selectedStorageIndex] !== 'string' && Number(storedStorageOptions[selectedStorageIndex].stockCount ?? 1) <= 0) {
            throw new HttpsError('failed-precondition', 'That storage option is no longer available.');
        }
        if (selectedStorageIndex >= 0 && typeof storedStorageOptions[selectedStorageIndex] !== 'string' && storedStorageOptions[selectedStorageIndex].stockCount != null) {
            storedStorageOptions[selectedStorageIndex] = { ...storedStorageOptions[selectedStorageIndex], stockCount: Number(storedStorageOptions[selectedStorageIndex].stockCount) - 1 };
        }
        const availableColors = Array.isArray(campaignProduct.colorOptions) ? campaignProduct.colorOptions.map(String) : [];
        if (availableColors.length && !availableColors.includes(color)) {
            throw new HttpsError('invalid-argument', 'Choose a valid color for this reward.');
        }
        const shoeVariants = Array.isArray(campaignProduct.shoeVariants) ? [...campaignProduct.shoeVariants] : [];
        const selectedShoeIndex = shoeVariants.findIndex((variant) => String(variant.size) === shoeSize && String(variant.color) === color);
        if (shoeVariants.length && (selectedShoeIndex < 0 || Number(shoeVariants[selectedShoeIndex].stockCount ?? 1) <= 0)) {
            throw new HttpsError('invalid-argument', 'Choose an available shoe size and color for this reward.');
        }
        if (selectedShoeIndex >= 0 && shoeVariants[selectedShoeIndex].stockCount != null) {
            shoeVariants[selectedShoeIndex] = { ...shoeVariants[selectedShoeIndex], stockCount: Number(shoeVariants[selectedShoeIndex].stockCount) - 1 };
        }
        const variantOptions = Array.isArray(campaignProduct.variantOptions) ? [...campaignProduct.variantOptions] : [];
        if (variantOptions.length) {
            const selectedValues = selections.variantValues || {};
            const matchingVariantIndex = variantOptions.findIndex((variant) => Object.entries(variant.values || {}).every(([key, value]) => String(selectedValues[key] || '') === String(value)));
            if (matchingVariantIndex < 0 || Number(variantOptions[matchingVariantIndex].stockCount ?? 1) <= 0) {
                throw new HttpsError('invalid-argument', 'Choose an available configured variant for this reward.');
            }
            if (variantOptions[matchingVariantIndex].stockCount != null) {
                variantOptions[matchingVariantIndex] = { ...variantOptions[matchingVariantIndex], stockCount: Number(variantOptions[matchingVariantIndex].stockCount) - 1 };
            }
        }
        campaignProducts[campaignProductIndex] = { ...campaignProduct, storageOptions: storedStorageOptions, shoeVariants, variantOptions };
        const addressLine = address.fullAddress || address.address || address.label || address.deliveryDetails || user.address || '';
        const now = FieldValue.serverTimestamp();
        transaction.create(orderRef, {
            orderType: REWARD_ORDER_TYPE,
            rewardClaimId: uid,
            rewardSessionId: sessionId,
            customerUid: uid,
            customerName: user.displayName || '',
            customerPhone: String(request.data?.customerPhone || user.phone || ''),
            sellerId: 'manna_marketplace',
            sellerName: 'Manna Marketplace Rewards',
            warehouseName: warehouse.name || 'Manna Marketplace Warehouse',
            warehouseAddress: warehouse.address || '',
            warehouseCoordinates,
            warehouseLocation: warehouseCoordinates ? {
                name: warehouse.name || 'Manna Marketplace Warehouse',
                address: warehouse.address || '',
                ...warehouseCoordinates
            } : null,
            internationalProductId: product.internationalProductId,
            masterProductId: product.masterProductId,
            fulfillmentSource: 'internationalProducts',
            address: addressLine,
            deliveryLocationId: addresses[0]?.id || '',
            deliveryCoordinates: customerCoordinates,
            deliveryLat: customerCoordinates.latitude,
            deliveryLng: customerCoordinates.longitude,
            coordinates: customerCoordinates,
            deliveryLocationLabel: address.label || '',
            deliveryDistanceKm,
            deliveryRatePerKm,
            deliveryFee,
            status: 'pending',
            paymentStatus: 'pending',
            paymentMethod: 'balance',
            paymentCurrency: 'LRD',
            paymentAmount: 0,
            customerDeliveryFee: 0,
            total: 0,
            subtotal: 0,
            totalPrice: 0,
            amount: 0,
            deliveryOption: 'regular',
            deliveryPayoutStatus: 'pending',
            items: [{
                menuItemId: product.masterProductId,
                internationalProductId: product.internationalProductId,
                masterProductId: product.masterProductId,
                name: product.name,
                category: product.category || '',
                image: product.image || '',
                imageFilename: product.imageFilename || product.image || '',
                quantity: 1,
                price: 0,
                totalPrice: 0,
                defaultPrice: 0,
                sellerMarkup: 0,
                storageSize,
                color,
                shoeSize,
                selectedVariants: selections.variantValues || {},
                variantOptions: Object.keys(selections.variantValues || {}).length ? [{ values: selections.variantValues }] : [],
                isSellerOwned: false,
                orderFlow: REWARD_ORDER_TYPE
            }],
            notes: String(request.data?.notes || ''),
            rewardOrderSubmittedAt: now,
            createdAt: now,
            updatedAt: now,
            isDeleted: false
        });
        transaction.update(claimRef, { sessionId, status: 'ordered', orderId: orderRef.id, orderedAt: now, updatedAt: now });
        transaction.update(userRef, {
            'signupRewardClaim.status': 'ordered',
            'signupRewardClaim.sessionId': sessionId,
            'signupRewardClaim.orderId': orderRef.id,
            'signupRewardClaim.orderedAt': now,
            updatedAt: now
        });
        const updatedSession = {
            products: campaignProducts,
            claims: (Array.isArray(campaign.claims) ? campaign.claims : []).map((entry) => entry.customerUid === uid
                ? { ...entry, status: 'ordered', orderId: orderRef.id }
                : entry),
            updatedAt: now
        };
        if (sessionSnapshot.exists) transaction.update(sessionRef, updatedSession);
        else if (campaignSnapshot.exists) transaction.update(campaignRef, updatedSession);
        if (sessionSnapshot.exists && campaignSnapshot.exists
            && String(campaignSnapshot.data()?.sessionId || LEGACY_SESSION_ID) === sessionId) {
            transaction.update(campaignRef, updatedSession);
        }
        result = { orderId: orderRef.id, alreadySubmitted: false };
    });

    return result;
});

exports.confirmSignupRewardOrder = onCall(async (request) => {
    await requireAdmin(request.auth?.uid, request.auth?.token?.email);
    const orderId = String(request.data?.orderId || '').trim();
    if (!orderId) throw new HttpsError('invalid-argument', 'An order ID is required.');
    const orderRef = db.collection('orders').doc(orderId);
    const platformSettingsRef = db.doc('settings/platform');
    const adminSettingsRef = db.doc('adminSettings/config');
    const campaignRef = db.doc(CAMPAIGN_PATH);
    let result;

    await db.runTransaction(async (transaction) => {
        const [orderSnapshot, platformSnapshot, adminSettingsSnapshot] = await Promise.all([
            transaction.get(orderRef),
            transaction.get(platformSettingsRef),
            transaction.get(adminSettingsRef)
        ]);
        if (!orderSnapshot.exists) throw new HttpsError('not-found', 'Reward order not found.');
        const order = orderSnapshot.data() || {};
        if (order.orderType !== REWARD_ORDER_TYPE) throw new HttpsError('failed-precondition', 'This is not a signup reward order.');
        if (order.paymentStatus === 'confirmed') {
            result = { alreadyConfirmed: true };
            return;
        }
        if (order.status !== 'pending' || Number(order.total || 0) !== 0 || Number(order.paymentAmount || 0) !== 0) {
            throw new HttpsError('failed-precondition', 'This reward order is not a pending zero-charge order.');
        }

        const settings = { ...(platformSnapshot.data() || {}), ...(adminSettingsSnapshot.data() || {}) };
        const regularDays = Math.max(1, Number(settings.regularDeliveryDays || 3));
        const now = new Date();
        const estimate = new Date(now.getTime() + regularDays * 24 * 60 * 60 * 1000);
        const deliveryDeadlineAt = new Date(now.getTime() + 48 * 60 * 60 * 1000);
        const campaignSnapshot = await transaction.get(campaignRef);
        const claimRef = db.collection(CLAIMS_COLLECTION).doc(order.customerUid);
        const customerRef = db.collection('users').doc(order.customerUid);
        const [claimSnapshot, customerSnapshot] = await Promise.all([transaction.get(claimRef), transaction.get(customerRef)]);
        const sessionId = String(claimSnapshot.data()?.sessionId || order.rewardSessionId || LEGACY_SESSION_ID);
        const sessionRef = db.collection(SESSIONS_COLLECTION).doc(sessionId);
        const sessionSnapshot = await transaction.get(sessionRef);
        if (!sessionSnapshot.exists && sessionId !== LEGACY_SESSION_ID) {
            throw new HttpsError('not-found', 'The reward session for this order is unavailable.');
        }
        transaction.update(orderRef, {
            paymentMethod: 'balance',
            paymentStatus: 'confirmed',
            paymentAmount: 0,
            customerDeliveryFee: 0,
            deliveryDays: regularDays,
            status: 'ready',
            readyAt: now,
            deliveryDeadlineHours: 48,
            deliveryDeadlineAt,
            paymentConfirmedAt: FieldValue.serverTimestamp(),
            paymentConfirmedBy: request.auth.uid,
            paymentConfirmationReference: 'Signup reward · 0 LRD',
            estimatedDeliveryTime: estimate,
            updatedAt: FieldValue.serverTimestamp()
        });
        if (claimSnapshot.exists) transaction.update(claimRef, { sessionId, status: 'confirmed', confirmedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
        if (customerSnapshot.exists) transaction.update(customerRef, { 'signupRewardClaim.sessionId': sessionId, 'signupRewardClaim.status': 'confirmed', 'signupRewardClaim.confirmedAt': FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
        const claims = Array.isArray(sessionSnapshot.data()?.claims)
            ? sessionSnapshot.data().claims
            : Array.isArray(campaignSnapshot.data()?.claims) ? campaignSnapshot.data().claims : [];
        const updatedSession = {
            claims: claims.map((entry) => entry.customerUid === order.customerUid
                ? { ...entry, status: 'confirmed' }
                : entry),
            updatedAt: FieldValue.serverTimestamp()
        };
        if (sessionSnapshot.exists) transaction.update(sessionRef, updatedSession);
        else if (campaignSnapshot.exists) transaction.update(campaignRef, updatedSession);
        if (sessionSnapshot.exists && campaignSnapshot.exists
            && String(campaignSnapshot.data()?.sessionId || LEGACY_SESSION_ID) === sessionId) {
            transaction.update(campaignRef, updatedSession);
        }
        result = { alreadyConfirmed: false, estimatedDeliveryTime: estimate.toISOString(), deliveryFee: Number(order.deliveryFee || 0) };
    });
    return result;
});

exports.settleSignupRewardDelivery = onDocumentUpdated({ document: 'orders/{orderId}', retry: true }, async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after
        || before.status === 'received'
        || after.status !== 'received'
        || after.orderType !== REWARD_ORDER_TYPE
        || after.rewardDeliveryPayoutRecorded) return;

    const deliveryUid = after.deliveryPersonUid;
    const deliveryFee = Math.max(0, Number(after.deliveryFee || 0));
    if (!deliveryUid) return;

    const orderRef = db.collection('orders').doc(event.params.orderId);
    const deliveryRef = db.collection('users').doc(deliveryUid);
    const ledgerRef = db.collection('walletTransactions').doc(`signup_reward_delivery_${event.params.orderId}`);
    const campaignRef = db.doc(CAMPAIGN_PATH);
    const claimRef = db.collection(CLAIMS_COLLECTION).doc(String(after.rewardClaimId || after.customerUid || ''));
    const customerRef = db.collection('users').doc(after.customerUid);
    const adminSummaryRef = db.collection('adminWallet').doc('summary');
    const adminLedgerRef = db.collection('adminWallet').doc('transactions').collection('log').doc(`signup_reward_delivery_${event.params.orderId}`);
    await db.runTransaction(async (transaction) => {
        const [orderSnapshot, deliverySnapshot, ledgerSnapshot, campaignSnapshot, claimSnapshot, customerSnapshot, adminSummarySnapshot, adminLedgerSnapshot] = await Promise.all([
            transaction.get(orderRef),
            transaction.get(deliveryRef),
            transaction.get(ledgerRef),
            transaction.get(campaignRef),
            transaction.get(claimRef),
            transaction.get(customerRef),
            transaction.get(adminSummaryRef),
            transaction.get(adminLedgerRef)
        ]);
        if (!orderSnapshot.exists) return;
        const order = orderSnapshot.data() || {};
        if (order.status !== 'received' || order.rewardDeliveryPayoutRecorded) return;
        const sessionId = String(claimSnapshot.data()?.sessionId || order.rewardSessionId || LEGACY_SESSION_ID);
        const sessionRef = db.collection(SESSIONS_COLLECTION).doc(sessionId);
        const sessionSnapshot = await transaction.get(sessionRef);
        if (!sessionSnapshot.exists && sessionId !== LEGACY_SESSION_ID) {
            throw new Error('The reward session for this delivery settlement is unavailable.');
        }

        if (deliveryFee > 0 && !order.deliveryCredited && !ledgerSnapshot.exists) {
            const balanceBefore = Number(deliverySnapshot.data()?.balance || 0);
            const adminBalanceBefore = Number(adminSummarySnapshot.data()?.balance || 0);
            transaction.set(deliveryRef, { balance: balanceBefore + deliveryFee, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
            transaction.set(adminSummaryRef, {
                balance: adminBalanceBefore - deliveryFee,
                totalPaidOut: Number(adminSummarySnapshot.data()?.totalPaidOut || 0) + deliveryFee,
                signupRewardDeliveryFeesPaid: Number(adminSummarySnapshot.data()?.signupRewardDeliveryFeesPaid || 0) + deliveryFee,
                updatedAt: FieldValue.serverTimestamp()
            }, { merge: true });
            transaction.create(ledgerRef, {
                transactionId: ledgerRef.id,
                userId: deliveryUid,
                userType: 'delivery',
                type: 'signup_reward_delivery_earning',
                amount: deliveryFee,
                currency: 'LRD',
                balanceBefore,
                balanceAfter: balanceBefore + deliveryFee,
                reference: event.params.orderId,
                description: `Signup reward delivery #${event.params.orderId.slice(0, 8)}`,
                status: 'completed',
                createdAt: FieldValue.serverTimestamp()
            });
            if (!adminLedgerSnapshot.exists) {
                transaction.create(adminLedgerRef, {
                    type: 'signup_reward_delivery_cost',
                    amount: -deliveryFee,
                    currency: 'LRD',
                    reference: event.params.orderId,
                    description: `Signup reward delivery paid for Order #${event.params.orderId.slice(0, 8)}`,
                    createdAt: FieldValue.serverTimestamp()
                });
            }
        }

        transaction.update(orderRef, {
            deliveryCredited: deliveryFee > 0,
            rewardDeliveryPayoutRecorded: true,
            rewardDeliveryPayoutRecordedAt: FieldValue.serverTimestamp(),
            deliveryPayoutStatus: deliveryFee > 0 ? 'paid' : 'not_required',
            updatedAt: FieldValue.serverTimestamp()
        });
        const sessionData = sessionSnapshot.exists ? sessionSnapshot.data() || {} : campaignSnapshot.data() || {};
        const updatedSession = {
            deliveryFeesPaid: Number(sessionData.deliveryFeesPaid || 0) + deliveryFee,
            claims: (Array.isArray(sessionData.claims) ? sessionData.claims : []).map((claim) => claim.customerUid === order.customerUid
                ? { ...claim, status: 'received' }
                : claim),
            updatedAt: FieldValue.serverTimestamp()
        };
        if (sessionSnapshot.exists) transaction.update(sessionRef, updatedSession);
        else if (campaignSnapshot.exists) transaction.update(campaignRef, updatedSession);
        if (sessionSnapshot.exists && campaignSnapshot.exists
            && String(campaignSnapshot.data()?.sessionId || LEGACY_SESSION_ID) === sessionId) {
            transaction.update(campaignRef, updatedSession);
        }
        if (claimSnapshot.exists) {
            transaction.update(claimRef, { status: 'received', receivedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
        }
        if (customerSnapshot.exists) {
            transaction.update(customerRef, {
                'signupRewardClaim.sessionId': sessionId,
                'signupRewardClaim.status': 'received',
                'signupRewardClaim.receivedAt': FieldValue.serverTimestamp(),
                'signupRewardClaim.updatedAt': FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            });
        }
    }).catch((error) => {
        logger.error('Signup reward delivery settlement failed.', { orderId: event.params.orderId, error });
        throw error;
    });
});