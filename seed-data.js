import { initStorage } from './storage.js';
import { DEFAULT_CATEGORY_TAXONOMY, ensureCategoriesSeeded } from './category-taxonomy.js';

async function seedDatabase() {
    const db = initStorage().db;
    if (!db) return;

    await ensureCategoriesSeeded(db);

    const batch = db.batch();
    const products = [
        { id: 'prod-jollof', name: 'Jollof Rice', description: 'Spicy tomato rice with peppers and herbs.', category: 'Rice Dishes', image: 'jollof_rice.jpg', status: 'active', searchKeywords: ['jollof', 'rice'], preparationCategory: 'Main', tags: ['featured'] },
        { id: 'prod-groundnut', name: 'Groundnut Soup', description: 'Creamy peanut soup served with rice or fufu.', category: 'Soup & Stews', image: 'groundnut_soup.jpg', status: 'active', searchKeywords: ['groundnut', 'soup'], preparationCategory: 'Soup', tags: ['traditional'] },
        { id: 'prod-fufu', name: 'Fufu with Soup', description: 'Cassava fufu served with rich soup.', category: 'Fufu & Swallow', image: 'fufu_soup.jpg', status: 'active', searchKeywords: ['fufu', 'cassava'], preparationCategory: 'Main', tags: ['traditional'] },
        { id: 'prod-pizza', name: 'Pepperoni Pizza', description: 'Classic pizza with pepperoni and melted cheese.', category: 'Pizza & Italian', image: 'pizza_pepperoni.jpg', status: 'active', searchKeywords: ['pizza', 'italian'], preparationCategory: 'Main', tags: ['featured'] },
        { id: 'prod-juice', name: 'Fresh Orange Juice', description: 'Cold fresh orange juice.', category: 'Juices & Smoothies', image: 'orange_juice.jpg', status: 'active', searchKeywords: ['juice', 'orange'], preparationCategory: 'Drink', tags: ['refreshing'] }
    ];

    const sellers = [
        { id: 'rest-pizza', name: 'Pizza Palace', location: 'Sinkor', phone: '0770000001', mobileMoneyNumber: '0770000001', logo: 'pizza_palace.png', rating: 4.8, deliveryPersons: [], category: 'Pizza & Italian', status: 'approved', isActive: true, ownerUid: 'seller-seed', geopoint: { latitude: 6.3000, longitude: -10.8000 } },
        { id: 'rest-burger', name: 'Burger King', location: 'Gardnersville', phone: '0770000002', mobileMoneyNumber: '0770000002', logo: 'burger_king.png', rating: 4.6, deliveryPersons: [], category: 'Burgers & Sandwiches', status: 'approved', isActive: true, ownerUid: 'seller-seed-2', geopoint: { latitude: 6.3150, longitude: -10.7600 } },
        { id: 'rest-dominos', name: 'Dominos', location: 'Broad Street', phone: '0770000003', mobileMoneyNumber: '0770000003', logo: 'dominos.png', rating: 4.7, deliveryPersons: [], category: 'Pizza & Italian', status: 'approved', isActive: true, ownerUid: 'seller-seed-3', geopoint: { latitude: 6.2900, longitude: -10.7800 } }
    ];

    products.forEach((product) => {
        batch.set(db.collection('masterProducts').doc(product.id), { ...product, createdAt: new Date(), updatedAt: new Date() });
    });

    sellers.forEach((seller) => {
        const sellerPayload = { ...seller, createdAt: new Date(), updatedAt: new Date() };
        batch.set(db.collection('sellers').doc(seller.id), sellerPayload);
    });

    batch.set(db.collection('users').doc('admin-savieisaiah54'), { uid: 'admin-savieisaiah54', role: 'admin', displayName: 'Manna Administrator', email: 'savieisaiah54@gmail.com', createdAt: new Date(), updatedAt: new Date() });
    batch.set(db.collection('users').doc('customer-seed'), { uid: 'customer-seed', role: 'customer', displayName: 'Demo Customer', email: 'customer@manna.test', createdAt: new Date(), updatedAt: new Date() });
    batch.set(db.collection('users').doc('seller-seed'), { uid: 'seller-seed', role: 'seller', displayName: 'Demo Seller', email: 'seller@manna.test', createdAt: new Date(), updatedAt: new Date() });
    batch.set(db.collection('users').doc('delivery-seed'), { uid: 'delivery-seed', role: 'delivery_person', displayName: 'Demo Rider', email: 'delivery@manna.test', approvedSellers: ['rest-pizza'], isActive: true, rating: 4.9, totalDeliveries: 5, vehicleType: 'Motorcycle', createdAt: new Date(), updatedAt: new Date() });

    batch.set(db.collection('orders').doc('order-seed'), {
        customerUid: 'customer-seed',
        sellerId: 'rest-pizza',
        sellerName: 'Pizza Palace',
        customerName: 'Demo Customer',
        address: '123 Tubman Boulevard',
        deliveryDetails: 'Ring the bell',
        items: [{ masterProductId: 'prod-jollof', name: 'Jollof Rice', quantity: 1, price: 650 }],
        subtotal: 650,
        deliveryFee: 0,
        discount: 0,
        total: 650,
        status: 'accepted',
        deliveryPersonUid: null,
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date()
    });

    await batch.commit();
    console.info('Database seeded successfully');
}

window.seedDatabase = seedDatabase;
window.seedCategories = () => ensureCategoriesSeeded(initStorage().db);

if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        const seedButton = document.getElementById('seedButton');
        if (seedButton) {
            seedButton.addEventListener('click', async () => {
                await seedDatabase();
            });
        }
    });
}
