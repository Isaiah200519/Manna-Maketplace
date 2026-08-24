export const DEFAULT_CATEGORY_TAXONOMY = [
    { id: 'phones_tablets', name: 'Phones & Tablets', group: 'Electronics', description: 'Smartphones, tablets, and mobile accessories', icon: 'phone_icon.png', imageFilename: 'phones_tablets.jpg' },
    { id: 'laptops_computers', name: 'Laptops & Computers', group: 'Electronics', description: 'Laptops, desktops, monitors, and computing accessories', icon: 'laptop_icon.png', imageFilename: 'laptops_computers.jpg' },
    { id: 'tv_audio_video', name: 'TV, Audio & Video', group: 'Electronics', description: 'Smart TVs, speakers, headphones, and home entertainment', icon: 'tv_icon.png', imageFilename: 'tv_audio_video.jpg' },
    { id: 'cameras_photography', name: 'Cameras & Photography', group: 'Electronics', description: 'Digital cameras, DSLRs, lenses, and photography equipment', icon: 'camera_icon.png', imageFilename: 'cameras_photography.jpg' },
    { id: 'gaming', name: 'Gaming', group: 'Electronics', description: 'Consoles, games, controllers, and gaming accessories', icon: 'gaming_icon.png', imageFilename: 'gaming.jpg' },
    { id: 'accessories_gadgets', name: 'Accessories & Gadgets', group: 'Electronics', description: 'Chargers, power banks, smartwatches, and tech gadgets', icon: 'gadgets_icon.png', imageFilename: 'accessories_gadgets.jpg' },
    { id: 'mens_clothing', name: "Men's Clothing", group: 'Fashion', description: 'Shirts, trousers, suits, traditional and casual wear for men', icon: 'mens_icon.png', imageFilename: 'mens_clothing.jpg' },
    { id: 'womens_clothing', name: "Women's Clothing", group: 'Fashion', description: 'Dresses, blouses, skirts, traditional and casual wear', icon: 'womens_icon.png', imageFilename: 'womens_clothing.jpg' },
    { id: 'kids_clothing', name: "Kids' Clothing", group: 'Fashion', description: 'School uniforms and outfits for boys and girls', icon: 'kids_icon.png', imageFilename: 'kids_clothing.jpg' },
    { id: 'shoes_footwear', name: 'Shoes & Footwear', group: 'Fashion', description: 'Sneakers, sandals, heels, boots, and formal shoes', icon: 'shoes_icon.png', imageFilename: 'shoes_footwear.jpg' },
    { id: 'bags_luggage', name: 'Bags & Luggage', group: 'Fashion', description: 'Handbags, backpacks, travel luggage, and wallets', icon: 'bags_icon.png', imageFilename: 'bags_luggage.jpg' },
    { id: 'jewelry_watches', name: 'Jewelry & Watches', group: 'Fashion', description: 'Gold, silver, fashion jewelry, and watches', icon: 'jewelry_icon.png', imageFilename: 'jewelry_watches.jpg' },
    { id: 'furniture', name: 'Furniture', group: 'Home & Living', description: 'Sofas, beds, tables, chairs, and all home furniture', icon: 'furniture_icon.png', imageFilename: 'furniture.jpg' },
    { id: 'kitchen_dining', name: 'Kitchen & Dining', group: 'Home & Living', description: 'Cookware, appliances, cutlery, and dining accessories', icon: 'kitchen_icon.png', imageFilename: 'kitchen_dining.jpg' },
    { id: 'bedding_bath', name: 'Bedding & Bath', group: 'Home & Living', description: 'Bed sheets, pillows, towels, and bathroom essentials', icon: 'bedding_icon.png', imageFilename: 'bedding_bath.jpg' },
    { id: 'home_decor', name: 'Home Décor', group: 'Home & Living', description: 'Curtains, rugs, wall art, and decorative accessories', icon: 'decor_icon.png', imageFilename: 'home_decor.jpg' },
    { id: 'tools_hardware', name: 'Tools & Hardware', group: 'Home & Living', description: 'Power tools, hand tools, and electrical supplies', icon: 'tools_icon.png', imageFilename: 'tools_hardware.jpg' },
    { id: 'garden_outdoor', name: 'Garden & Outdoor', group: 'Home & Living', description: 'Garden tools, outdoor furniture, and patio equipment', icon: 'garden_icon.png', imageFilename: 'garden_outdoor.jpg' },
    { id: 'skincare_beauty', name: 'Skincare & Beauty', group: 'Health & Beauty', description: 'Moisturizers, makeup, perfumes, and personal care products', icon: 'beauty_icon.png', imageFilename: 'skincare_beauty.jpg' },
    { id: 'hair_care', name: 'Hair Care', group: 'Health & Beauty', description: 'Hair products, wigs, extensions, and styling tools', icon: 'hair_icon.png', imageFilename: 'hair_care.jpg' },
    { id: 'vitamins_health', name: 'Vitamins & Health', group: 'Health & Beauty', description: 'Vitamins, supplements, and wellness products', icon: 'health_icon.png', imageFilename: 'vitamins_health.jpg' },
    { id: 'sports_fitness', name: 'Sports & Fitness', group: 'Sports', description: 'Gym equipment, sportswear, footballs, and fitness accessories', icon: 'sports_icon.png', imageFilename: 'sports_fitness.jpg' },
    { id: 'toys_games', name: 'Toys & Games', group: 'Kids & Baby', description: 'Educational toys, board games, and outdoor toys', icon: 'toys_icon.png', imageFilename: 'toys_games.jpg' },
    { id: 'baby_care', name: 'Baby & Care', group: 'Kids & Baby', description: 'Baby food, diapers, strollers, and newborn essentials', icon: 'baby_icon.png', imageFilename: 'baby_care.jpg' },
    { id: 'books_stationery', name: 'Books & Stationery', group: 'Education', description: 'Textbooks, novels, school supplies, and office stationery', icon: 'books_icon.png', imageFilename: 'books_stationery.jpg' },
    { id: 'musical_instruments', name: 'Musical Instruments', group: 'Education', description: 'Guitars, keyboards, drums, and music accessories', icon: 'music_icon.png', imageFilename: 'musical_instruments.jpg' },
    { id: 'car_accessories', name: 'Car & Moto Accessories', group: 'Automotive', description: 'Car parts, motor oil, seat covers, and motorcycle accessories', icon: 'car_icon.png', imageFilename: 'car_accessories.jpg' },
    { id: 'packaged_foods', name: 'Packaged Foods & Drinks', group: 'Food & Grocery', description: 'Canned goods, snacks, beverages, and household staples', icon: 'grocery_icon.png', imageFilename: 'packaged_foods.jpg' }
];

export function normalizeCategoryValue(value) {
    if (!value) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    const normalized = raw.toLowerCase();
    const match = DEFAULT_CATEGORY_TAXONOMY.find((category) => {
        const candidates = [category.name, category.id, category.group, category.name.toLowerCase(), category.id.toLowerCase()];
        return candidates.includes(raw) || candidates.includes(normalized);
    });
    if (match) return { ...match };
    const fallback = DEFAULT_CATEGORY_TAXONOMY.find((category) => category.name.toLowerCase().includes(normalized) || category.id.toLowerCase().includes(normalized));
    return fallback ? { ...fallback } : null;
}

export function getCategoryDisplayName(value) {
    const match = normalizeCategoryValue(value);
    return match?.name || (value ? String(value).trim() : 'General');
}

export function getCategoryOptions(includeAll = false) {
    const categories = includeAll ? [{ id: 'all', name: 'All Categories' }, ...DEFAULT_CATEGORY_TAXONOMY] : DEFAULT_CATEGORY_TAXONOMY;
    return categories.map((category) => ({
        id: category.id,
        name: category.name,
        group: category.group,
        description: category.description,
        imageFilename: category.imageFilename,
        icon: category.icon
    }));
}

export async function ensureCategoriesSeeded(db) {
    if (!db || typeof db.collection !== 'function') return [];
    const snapshot = await db.collection('categories').get();
    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    DEFAULT_CATEGORY_TAXONOMY.forEach((category) => {
        batch.set(db.collection('categories').doc(category.id), {
            ...category,
            isActive: true,
            createdAt: window.firebase?.firestore?.FieldValue?.serverTimestamp?.() || new Date(),
            updatedAt: window.firebase?.firestore?.FieldValue?.serverTimestamp?.() || new Date()
        }, { merge: false });
    });
    await batch.commit();
    return DEFAULT_CATEGORY_TAXONOMY;
}
