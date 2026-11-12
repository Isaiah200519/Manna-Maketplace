# Manna Marketplace
Manna Marketplace is a multi-category e-commerce platform for discovering products from local sellers, managing seller stores, and completing customer orders through a shared marketplace experience. It supports seller, customer, delivery, and admin panels backed by Firebase Authentication and Cloud Firestore.

## Firestore maintenance status

The public maintenance listener reads only `settings/maintenance`, which contains `maintenanceMode` and `maintenanceUntil`. Firestore rules allow unauthenticated reads of that document only; keep payment and other platform settings in the protected `settings/platform` document. Deploy rules with `firebase deploy --only firestore:rules --project manna-marketplace`.

## Production App

The official production website is:

<https://mannamarketplace.online/>

The public website is served through the existing Cloudflare Worker deployment (`manna-maketplace`). This source checkout does not contain its Wrangler configuration; use the existing Cloudflare deployment workflow rather than Firebase Hosting or Netlify to publish the frontend.

## Marketplace Concept

Customers can browse products across categories such as electronics, fashion, home and living, health and beauty, automotive, and packaged foods and drinks. Sellers choose their marketplace category, add products to their store, set pricing and availability, provide payment details, and optionally attach product video links. Customers can open those videos directly from product cards, add products to checkout, select a delivery location, and place orders.

The platform supports shareable product checkout links. Sellers can copy a link from their Store product cards or the product editor. Each link carries both IDs, for example:

`https://mannamarketplace.online/customer.html?sellerId=SELLER_ID&productId=PRODUCT_ID`

When a customer opens the link, the app verifies that the seller and available product exist, then pre-fills checkout with that product after sign-in.

Deploy the static frontend through the existing Cloudflare workflow. Do not deploy the site with Firebase Hosting or Netlify.

## Panels

- Customer: browse sellers and products, manage favorites, and create a checkout delivery pin with Auto location or by tapping or dragging the map; pins can also be saved or selected from saved locations. Order notifications link to their order and any required confirmation; order cards expand for full details, and received orders can be repeated or used to contact the assigned delivery partner.
- Delivery routes: the admin sets one warehouse pickup point and a delivery rate in LRD per kilometer. New orders snapshot the warehouse and customer coordinates, straight-line distance, and rate; the distance fee is calculated from that snapshot. Customers and assigned delivery partners can expand an order to view the route; coordinate links open Google Maps. Rider GPS is requested only on demand and is never written to an order.
- Seller: manage a store, categories, products, prices, availability, payment details, and delivery partners. Store pins are informational for admin review; they are not used as order pickup locations.
- Delivery: claim available orders, complete deliveries, and manage payout preferences.
- Admin: manage categories, products, sellers, customers, orders, and platform operations.
