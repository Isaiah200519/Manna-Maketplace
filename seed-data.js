import { initStorage } from './storage.js';
import { DEFAULT_CATEGORY_TAXONOMY, ensureCategoriesSeeded } from './category-taxonomy.js';

async function seedDatabase() {
    const db = initStorage().db;
    if (!db) return;

    await ensureCategoriesSeeded(db);

    const batch = db.batch();
    batch.set(db.collection('users').doc('admin-savieisaiah54'), { uid: 'admin-savieisaiah54', role: 'admin', displayName: 'Manna Administrator', email: 'savieisaiah54@gmail.com', createdAt: new Date(), updatedAt: new Date() });
    batch.set(db.collection('users').doc('customer-seed'), { uid: 'customer-seed', role: 'customer', displayName: 'Demo Customer', email: 'customer@manna.test', createdAt: new Date(), updatedAt: new Date() });

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
