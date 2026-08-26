# Manna Marketplace Deployment Guide

Manna Marketplace uses Firebase Authentication and Cloud Firestore when the Firebase SDK is available. The local storage adapter remains available as an offline preview fallback.

## Live application

The current GitHub Pages deployment is available at:

<https://isaiah200519.github.io/Manna-Maketplace/>

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
- `sellers`
- `orders`
- `deliveryPayouts`
- `platformFeePayments`
- `adminSessions`
- `helpArticles`
- `notifications`

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
