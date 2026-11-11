# Manna Marketplace Deployment Guide

Manna Marketplace uses Firebase Authentication and Cloud Firestore when the Firebase SDK is available. The local storage adapter remains available as an offline preview fallback.

## Live application

The default live deployment is available at:

<https://manna-marketplace.web.app/>

The repository provides marketplace browsing, seller stores, checkout, order tracking, and role-based panels. Sellers can copy direct product checkout links containing `sellerId` and `productId`, and authenticated customers are taken to a pre-filled checkout. Unauthenticated visitors are sent through login while the link parameters are preserved.

## Firebase setup

1. Open the `manna-marketplace` project in the Firebase console.
2. Enable **Authentication > Sign-in method > Email/Password**.
3. Create a **Firestore Database** and choose the region closest to your users.
4. Publish Firestore security rules before using this application with real users. Do not use Firestore test mode in production.

The web configuration is in `firebase-config.js`. Firebase web API keys identify the project and are safe to ship in browser code; access control must be enforced with Authentication and Firestore Security Rules.

The application uses these top-level collections:

- `users`
- `categories`
- `masterProducts`
- `internationalProducts` (admin-managed wholesale offers referencing `masterProducts` by `masterProductId`)
- `sellers`
- `orders`
- `deliveryPayouts`
- `platformFeePayments`
- `adminSessions`
- `helpArticles`
- `notifications`
- `appConfig/wallet`
- `depositRequests`
- `withdrawalRequests`
- `walletTransactions`

The wallet stores seller balances on `sellers/{sellerId}.balance` and customer/delivery balances on `users/{userId}.balance`. Run `init-wallet.js` once from the browser console on a Firebase-loaded page by calling `initWalletSchema()`, then update the saved admin mobile-money number before accepting deposits.

### Seller listing assistant

The listing assistant runs entirely in the seller's browser. It learns category suggestions from active master products and the built-in category descriptions, extracts search keywords from seller-provided facts, and assembles a factual draft without an external AI API, API key, or Cloud Function. Suggestions are not saved until the seller applies them and clicks **Save** in the listing editor. The category suggestion is optional and requires a separate seller action.

### Deploy Firestore indexes

The composite indexes used by wallet history and withdrawal queries are defined in `firestore.indexes.json`. Deploy them after logging in to the Firebase CLI from this project directory:

```powershell
firebase login
firebase use manna-marketplace
firebase deploy --only firestore:indexes
```

Updating `firestore.indexes.json` locally does not create the indexes in the Firebase project until this deploy command completes. The first deployment can take several minutes while Firebase builds each index.

Sellers purchase international offers into their private `sellers/{sellerId}/internationalInventory` subcollection. Inventory records retain `internationalProductId` and `masterProductId` references instead of copying master catalog documents. Sellers can edit resale price, currency, quantity, and customer-facing resale details; only active inventory with quantity remaining appears in the customer storefront.

## Run locally

Serve the project directory with any static web server so browser modules and Firebase requests work reliably. For example, use VS Code Live Server or any static hosting provider.

## Seed demo data

On the landing page, use the demo-data action to create sample accounts and catalog data in the current browser.

In Firebase mode, the seed action creates the demo profiles and catalog documents in the shared Firestore project. Demo accounts are profile documents only; create their Authentication accounts separately or use the registration form.

Local fallback demo accounts:

- Admin: `admin@manna.test`
- Customer: `customer@manna.test`
- Seller: `seller@manna.test`
- Delivery: `delivery@manna.test`

The local fallback data remains isolated to the browser profile that created it.

## Reset local data

Use the admin reset action to clear application data, or clear site storage from the browser's developer tools. Clearing browser storage removes accounts, orders, catalog data, settings, and cart data from that browser.
