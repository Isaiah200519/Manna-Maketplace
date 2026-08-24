// seed-marketplace-categories.js
// HOW TO RUN:
//   1. Open your browser console on any Manna Marketplace admin page
//   2. Paste this entire file into the console
//   3. Call: runCategorySeed()
//   4. Wait for: Manna Marketplace categories seeded - 27 categories added

const MARKETPLACE_CATEGORIES = [
  {
    id: 'phones_tablets',
    name: 'Phones & Tablets',
    description: 'Smartphones, tablets, and mobile accessories for every budget',
    group: 'Electronics',
    icon: 'phone_icon.png',
    imageFilename: 'phones_tablets.jpg',
    isActive: true
  },
  {
    id: 'laptops_computers',
    name: 'Laptops & Computers',
    description: 'Laptops, desktops, monitors, and computing accessories',
    group: 'Electronics',
    icon: 'laptop_icon.png',
    imageFilename: 'laptops_computers.jpg',
    isActive: true
  },
  {
    id: 'tv_audio_video',
    name: 'TV, Audio & Video',
    description: 'Smart TVs, speakers, headphones, and home entertainment',
    group: 'Electronics',
    icon: 'tv_icon.png',
    imageFilename: 'tv_audio_video.jpg',
    isActive: true
  },
  {
    id: 'cameras_photography',
    name: 'Cameras & Photography',
    description: 'Digital cameras, DSLRs, lenses, and photography equipment',
    group: 'Electronics',
    icon: 'camera_icon.png',
    imageFilename: 'cameras_photography.jpg',
    isActive: true
  },
  {
    id: 'gaming',
    name: 'Gaming',
    description: 'Consoles, games, controllers, and gaming accessories',
    group: 'Electronics',
    icon: 'gaming_icon.png',
    imageFilename: 'gaming.jpg',
    isActive: true
  },
  {
    id: 'accessories_gadgets',
    name: 'Accessories & Gadgets',
    description: 'Chargers, cables, power banks, smartwatches, and tech gadgets',
    group: 'Electronics',
    icon: 'gadgets_icon.png',
    imageFilename: 'accessories_gadgets.jpg',
    isActive: true
  },
  {
    id: 'mens_clothing',
    name: "Men's Clothing",
    description: 'Shirts, trousers, suits, traditional attire, and casual wear for men',
    group: 'Fashion',
    icon: 'mens_icon.png',
    imageFilename: 'mens_clothing.jpg',
    isActive: true
  },
  {
    id: 'womens_clothing',
    name: "Women's Clothing",
    description: 'Dresses, blouses, skirts, traditional attire, and casual wear for women',
    group: 'Fashion',
    icon: 'womens_icon.png',
    imageFilename: 'womens_clothing.jpg',
    isActive: true
  },
  {
    id: 'kids_clothing',
    name: "Kids' Clothing",
    description: 'Clothes, school uniforms, and outfits for boys and girls',
    group: 'Fashion',
    icon: 'kids_clothing_icon.png',
    imageFilename: 'kids_clothing.jpg',
    isActive: true
  },
  {
    id: 'shoes_footwear',
    name: 'Shoes & Footwear',
    description: 'Sneakers, sandals, heels, boots, and formal shoes for all ages',
    group: 'Fashion',
    icon: 'shoes_icon.png',
    imageFilename: 'shoes_footwear.jpg',
    isActive: true
  },
  {
    id: 'bags_luggage',
    name: 'Bags & Luggage',
    description: 'Handbags, backpacks, travel luggage, and wallets',
    group: 'Fashion',
    icon: 'bags_icon.png',
    imageFilename: 'bags_luggage.jpg',
    isActive: true
  },
  {
    id: 'jewelry_watches',
    name: 'Jewelry & Watches',
    description: 'Gold, silver, fashion jewelry, luxury and casual watches',
    group: 'Fashion',
    icon: 'jewelry_icon.png',
    imageFilename: 'jewelry_watches.jpg',
    isActive: true
  },
  {
    id: 'furniture',
    name: 'Furniture',
    description: 'Sofas, beds, tables, chairs, and all home furniture',
    group: 'Home & Living',
    icon: 'furniture_icon.png',
    imageFilename: 'furniture.jpg',
    isActive: true
  },
  {
    id: 'kitchen_dining',
    name: 'Kitchen & Dining',
    description: 'Cookware, kitchen appliances, cutlery, and dining accessories',
    group: 'Home & Living',
    icon: 'kitchen_icon.png',
    imageFilename: 'kitchen_dining.jpg',
    isActive: true
  },
  {
    id: 'bedding_bath',
    name: 'Bedding & Bath',
    description: 'Bed sheets, pillows, towels, and bathroom essentials',
    group: 'Home & Living',
    icon: 'bedding_icon.png',
    imageFilename: 'bedding_bath.jpg',
    isActive: true
  },
  {
    id: 'home_decor',
    name: 'Home Décor',
    description: 'Curtains, rugs, wall art, vases, and decorative accessories',
    group: 'Home & Living',
    icon: 'decor_icon.png',
    imageFilename: 'home_decor.jpg',
    isActive: true
  },
  {
    id: 'tools_hardware',
    name: 'Tools & Hardware',
    description: 'Power tools, hand tools, electrical supplies, and building materials',
    group: 'Home & Living',
    icon: 'tools_icon.png',
    imageFilename: 'tools_hardware.jpg',
    isActive: true
  },
  {
    id: 'garden_outdoor',
    name: 'Garden & Outdoor',
    description: 'Garden tools, outdoor furniture, plants, and patio equipment',
    group: 'Home & Living',
    icon: 'garden_icon.png',
    imageFilename: 'garden_outdoor.jpg',
    isActive: true
  },
  {
    id: 'skincare_beauty',
    name: 'Skincare & Beauty',
    description: 'Moisturizers, sunscreen, makeup, perfumes, and personal care products',
    group: 'Health & Beauty',
    icon: 'beauty_icon.png',
    imageFilename: 'skincare_beauty.jpg',
    isActive: true
  },
  {
    id: 'hair_care',
    name: 'Hair Care',
    description: 'Hair products, wigs, extensions, clippers, and styling tools',
    group: 'Health & Beauty',
    icon: 'hair_icon.png',
    imageFilename: 'hair_care.jpg',
    isActive: true
  },
  {
    id: 'vitamins_health',
    name: 'Vitamins & Health',
    description: 'Vitamins, supplements, health monitors, and wellness products',
    group: 'Health & Beauty',
    icon: 'health_icon.png',
    imageFilename: 'vitamins_health.jpg',
    isActive: true
  },
  {
    id: 'sports_fitness',
    name: 'Sports & Fitness',
    description: 'Gym equipment, sportswear, footballs, and fitness accessories',
    group: 'Sports',
    icon: 'sports_icon.png',
    imageFilename: 'sports_fitness.jpg',
    isActive: true
  },
  {
    id: 'toys_games',
    name: 'Toys & Games',
    description: 'Educational toys, action figures, board games, and outdoor toys',
    group: 'Kids & Baby',
    icon: 'toys_icon.png',
    imageFilename: 'toys_games.jpg',
    isActive: true
  },
  {
    id: 'baby_care',
    name: 'Baby & Care',
    description: 'Baby food, diapers, strollers, cribs, and newborn essentials',
    group: 'Kids & Baby',
    icon: 'baby_icon.png',
    imageFilename: 'baby_care.jpg',
    isActive: true
  },
  {
    id: 'books_stationery',
    name: 'Books & Stationery',
    description: 'Textbooks, novels, school supplies, pens, and office stationery',
    group: 'Education',
    icon: 'books_icon.png',
    imageFilename: 'books_stationery.jpg',
    isActive: true
  },
  {
    id: 'musical_instruments',
    name: 'Musical Instruments',
    description: 'Guitars, keyboards, drums, microphones, and music accessories',
    group: 'Education',
    icon: 'music_icon.png',
    imageFilename: 'musical_instruments.jpg',
    isActive: true
  },
  {
    id: 'car_accessories',
    name: 'Car & Moto Accessories',
    description: 'Car parts, motor oil, seat covers, motorcycle accessories, and tyres',
    group: 'Automotive',
    icon: 'car_icon.png',
    imageFilename: 'car_accessories.jpg',
    isActive: true
  },
  {
    id: 'packaged_foods',
    name: 'Packaged Foods & Drinks',
    description: 'Canned goods, snacks, cooking ingredients, beverages, and household staples',
    group: 'Food & Grocery',
    icon: 'grocery_icon.png',
    imageFilename: 'packaged_foods.jpg',
    isActive: true
  }
];

async function runCategorySeed() {
  const firestoreDb = getFirestoreDb();
  if (!firestoreDb) {
    console.error('Firebase db is not defined. Make sure you are on a Manna admin page.');
    return;
  }

  console.log('Seeding categories...');

  try {
    const BATCH_SIZE = 20;
    let count = 0;
    const timestamp = () => firebase.firestore.FieldValue.serverTimestamp();

    for (let i = 0; i < MARKETPLACE_CATEGORIES.length; i += BATCH_SIZE) {
      const batch = firestoreDb.batch();
      const chunk = MARKETPLACE_CATEGORIES.slice(i, i + BATCH_SIZE);

      chunk.forEach((category) => {
        const reference = firestoreDb.collection('categories').doc(category.id);
        batch.set(reference, {
          ...category,
          createdAt: timestamp(),
          updatedAt: timestamp()
        }, { merge: false });
        count++;
      });

      await batch.commit();
    }

    console.log(`Manna Marketplace categories seeded - ${count} categories added`);
    console.log('Categories seeded:');
    MARKETPLACE_CATEGORIES.forEach((category) => {
      console.log(`   [${category.group}] ${category.id} -> ${category.name}`);
    });
  } catch (error) {
    console.error('Seeding failed:', error);
  }
}

async function verifyCategorySeed() {
  const firestoreDb = getFirestoreDb();
  if (!firestoreDb) {
    console.error('Firebase db is not defined. Make sure you are on a Manna admin page.');
    return;
  }

  const snapshot = await firestoreDb.collection('categories').get();
  console.log(`Total categories in Firestore: ${snapshot.size}`);
  snapshot.docs.forEach((doc) => {
    const data = doc.data();
    console.log(`  ${doc.id} -> ${data.name} [${data.group}]`);
  });
}

function getFirestoreDb() {
  if (typeof db !== 'undefined') return db;
  if (typeof firebase === 'undefined') return null;

  try {
    const app = firebase.app('manna-marketplace-data');
    return firebase.firestore(app);
  } catch (error) {
    console.error('The named Manna Marketplace Firebase app is unavailable:', error);
    return null;
  }
}

if (typeof window !== 'undefined') {
  window.MARKETPLACE_CATEGORIES = MARKETPLACE_CATEGORIES;
  window.runCategorySeed = runCategorySeed;
  window.verifyCategorySeed = verifyCategorySeed;
}

console.log('Manna category seed script loaded. Call runCategorySeed() to begin.');
