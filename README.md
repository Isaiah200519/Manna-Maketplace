# Manna Marketplace

Manna Marketplace is a multi-category e-commerce platform for discovering products from local sellers, managing seller stores, and completing customer orders through a shared marketplace experience. It supports seller, customer, delivery, and admin panels backed by Firebase Authentication and Cloud Firestore.

## Live App

Open the deployed application at:

<https://isaiah200519.github.io/Manna%20Marketplace/>

## Marketplace Concept

Customers can browse products across categories such as electronics, fashion, home and living, health and beauty, automotive, and packaged foods and drinks. Sellers choose their marketplace category, add products to their store, set pricing and availability, provide payment details, and optionally attach product video links. Customers can open those videos directly from product cards, add products to checkout, select a delivery location, and place orders.

The platform is designed to support shareable product checkout links. A future product link can carry a product ID and seller ID so an authenticated customer can open the marketplace with the correct seller and product preselected for checkout. Unauthenticated visitors should be routed through login before continuing. The current repository does not yet implement URL-parameter product prefill; this README records that as the next shareable-checkout capability rather than describing it as already live.

## Panels

- Customer: browse sellers and products, manage favorites, choose delivery locations, and place orders.
- Seller: manage a store, categories, products, prices, availability, payment details, and delivery partners.
- Delivery: claim available orders, complete deliveries, and manage payout preferences.
- Admin: manage categories, products, sellers, customers, orders, and platform operations.
