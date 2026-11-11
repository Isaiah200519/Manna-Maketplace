# Manna Marketplace
/*netlify deploy --prod*/
Manna Marketplace is a multi-category e-commerce platform for discovering products from local sellers, managing seller stores, and completing customer orders through a shared marketplace experience. It supports seller, customer, delivery, and admin panels backed by Firebase Authentication and Cloud Firestore.

## Cloudflare Workers deployment

The Worker serves the static site from the generated `public/` directory. Install the project dependencies and prepare the assets with `npm ci` and `npm run build`. Wrangler is configured in `wrangler.jsonc`; run `npm run deploy` from the repository root to build and deploy.

For Cloudflare Workers Builds connected to this repository, set the build command to `npm run build` and the deploy command to `npx wrangler deploy`. Keep the repository root as the root directory. The generated `public/` directory is ignored by Git and recreated by the build command for each deployment.

## Firestore maintenance status

The public maintenance listener reads only `settings/maintenance`, which contains `maintenanceMode` and `maintenanceUntil`. Firestore rules allow unauthenticated reads of that document only; keep payment and other platform settings in the protected `settings/platform` document. Deploy rules with `firebase deploy --only firestore:rules --project manna-marketplace`.

## Live App

Open the deployed application at:

<https://isaiah200519.github.io/Manna-Maketplace/>

## Marketplace Concept

Customers can browse products across categories such as electronics, fashion, home and living, health and beauty, automotive, and packaged foods and drinks. Sellers choose their marketplace category, add products to their store, set pricing and availability, provide payment details, and optionally attach product video links. Customers can open those videos directly from product cards, add products to checkout, select a delivery location, and place orders.

The platform supports shareable product checkout links. Sellers can copy a link from their Store product cards or the product editor. Each link carries both IDs, for example:

`https://isaiah200519.github.io/Manna-Maketplace/?sellerId=SELLER_ID&productId=PRODUCT_ID`

When a customer opens the link, the app verifies that the seller and available product exist, then pre-fills checkout with that product. Unauthenticated visitors complete login first, and the link parameters are preserved during the role redirect.

## Panels

- Customer: browse sellers and products, manage favorites, choose delivery locations, and place orders.
- Seller: manage a store, categories, products, prices, availability, payment details, and delivery partners.
- Delivery: claim available orders, complete deliveries, and manage payout preferences.
- Admin: manage categories, products, sellers, customers, orders, and platform operations.
