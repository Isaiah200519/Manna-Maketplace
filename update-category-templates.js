// update-category-templates.js
// RUN: Open the browser console on an admin page, paste this file, then run:
// runTemplateUpdate()

const attribute = (key, label, options) => ({ key, label, options });
const TEMPLATES = {
  phones_tablets: { attributes: [attribute('Storage', 'Storage', ['32GB', '64GB', '128GB', '256GB', '512GB', '1TB']), attribute('RAM', 'RAM', ['3GB', '4GB', '6GB', '8GB', '12GB', '16GB']), attribute('Color', 'Color', ['Black', 'White', 'Gold', 'Silver', 'Blue', 'Red', 'Purple', 'Rose Gold']), attribute('Network', 'Network', ['4G', '5G']), attribute('Condition', 'Condition', ['Brand New', 'Refurbished', 'Used - Good'])] },
  laptops_computers: { attributes: [attribute('Storage', 'Storage', ['128GB SSD', '256GB SSD', '512GB SSD', '1TB SSD', '2TB HDD']), attribute('RAM', 'RAM', ['4GB', '8GB', '16GB', '32GB', '64GB']), attribute('Processor', 'Processor', ['Intel i3', 'Intel i5', 'Intel i7', 'AMD Ryzen 5', 'AMD Ryzen 7', 'Apple M1', 'Apple M2']), attribute('ScreenSize', 'Screen Size', ['11in', '13in', '14in', '15.6in', '17in']), attribute('Color', 'Color', ['Silver', 'Space Grey', 'Black', 'White', 'Gold'])] },
  tv_audio_video: { attributes: [attribute('ScreenSize', 'Screen Size', ['32in', '40in', '43in', '50in', '55in', '65in', '75in']), attribute('Resolution', 'Resolution', ['HD', 'Full HD', '4K', '8K']), attribute('Type', 'Type', ['Smart TV', 'Regular TV', 'OLED', 'Soundbar', 'Speaker', 'Headphones', 'Earbuds']), attribute('Color', 'Color', ['Black', 'White', 'Silver'])] },
  cameras_photography: { attributes: [attribute('Type', 'Camera Type', ['DSLR', 'Mirrorless', 'Action Camera', 'Point & Shoot', 'Security Camera']), attribute('Resolution', 'Megapixels', ['12MP', '20MP', '24MP', '36MP', '48MP', '64MP+']), attribute('Color', 'Color', ['Black', 'Silver', 'White'])] },
  gaming: { attributes: [attribute('Platform', 'Platform', ['PS5', 'PS4', 'Xbox Series X', 'Xbox One', 'Nintendo Switch', 'PC']), attribute('Type', 'Type', ['Console', 'Game', 'Controller', 'Headset', 'Gaming Chair']), attribute('Color', 'Color', ['Black', 'White', 'Red', 'Blue', 'Custom'])] },
  accessories_gadgets: { attributes: [attribute('Type', 'Type', ['Charger', 'Power Bank', 'Earbuds', 'Smartwatch', 'Phone Case', 'Cable', 'USB Hub', 'Adapter']), attribute('Compatibility', 'Works With', ['Universal', 'iPhone', 'Samsung', 'All Android', 'MacBook', 'iPad']), attribute('Color', 'Color', ['Black', 'White', 'Grey', 'Blue', 'Red', 'Rose Gold', 'Transparent'])] },
  mens_clothing: { attributes: [attribute('Size', 'Size', ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL']), attribute('Color', 'Color', ['Black', 'White', 'Navy', 'Grey', 'Red', 'Blue', 'Green', 'Brown', 'Khaki', 'Burgundy']), attribute('Material', 'Material', ['Cotton', 'Polyester', 'Linen', 'Denim', 'Wool', 'Silk']), attribute('Style', 'Style', ['Casual', 'Formal', 'Traditional', 'Sports', 'Smart Casual'])] },
  womens_clothing: { attributes: [attribute('Size', 'Size', ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL']), attribute('Color', 'Color', ['Black', 'White', 'Red', 'Pink', 'Blue', 'Green', 'Purple', 'Yellow', 'Nude', 'Floral', 'Gold', 'Silver']), attribute('Material', 'Material', ['Cotton', 'Polyester', 'Silk', 'Chiffon', 'Lace', 'Denim', 'Satin', 'Velvet']), attribute('Style', 'Style', ['Casual', 'Formal', 'Traditional', 'Evening', 'Party', 'Office'])] },
  kids_clothing: { attributes: [attribute('AgeGroup', 'Age Group', ['0-3m', '3-6m', '6-12m', '1-2yr', '2-4yr', '4-6yr', '6-8yr', '8-10yr', '10-12yr']), attribute('Color', 'Color', ['Blue', 'Red', 'Pink', 'Yellow', 'Green', 'Purple', 'White', 'Black', 'Multicolor']), attribute('Gender', 'Gender', ['Boys', 'Girls', 'Unisex']), attribute('Material', 'Material', ['Cotton', 'Polyester', 'Fleece', 'Denim'])] },
  shoes_footwear: { attributes: [attribute('Size', 'EU Size', ['35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46', '47']), attribute('Color', 'Color', ['Black', 'White', 'Brown', 'Tan', 'Navy', 'Red', 'Grey', 'Beige', 'Blue']), attribute('Material', 'Material', ['Leather', 'Suede', 'Canvas', 'Synthetic', 'Mesh']), attribute('Gender', 'Gender', ['Men', 'Women', 'Kids', 'Unisex'])] },
  bags_luggage: { attributes: [attribute('Size', 'Size', ['Mini', 'Small', 'Medium', 'Large', 'Extra Large']), attribute('Color', 'Color', ['Black', 'Brown', 'Tan', 'Navy', 'Red', 'Grey', 'Beige', 'White', 'Pink', 'Blue']), attribute('Material', 'Material', ['Genuine Leather', 'PU Leather', 'Canvas', 'Nylon', 'Polyester']), attribute('Type', 'Type', ['Handbag', 'Backpack', 'Tote', 'Clutch', 'Crossbody', 'Suitcase', 'Wallet'])] },
  jewelry_watches: { attributes: [attribute('Material', 'Material', ['Gold', 'Silver', 'Rose Gold', 'Stainless Steel', 'Gold-Plated', 'Alloy']), attribute('Type', 'Type', ['Necklace', 'Bracelet', 'Ring', 'Earrings', 'Watch', 'Anklet', 'Set']), attribute('Color', 'Color', ['Gold', 'Silver', 'Rose Gold', 'Black', 'Two-Tone', 'Multicolor']), attribute('Size', 'Size', ['One Size', 'Adjustable', '6in', '7in', '8in', 'S', 'M', 'L'])] },
  furniture: { attributes: [attribute('Material', 'Material', ['Solid Wood', 'Engineered Wood', 'Metal', 'Glass', 'Upholstered Fabric', 'Leather', 'Rattan']), attribute('Color', 'Color', ['Brown/Walnut', 'Black', 'White', 'Natural Wood', 'Grey', 'Oak', 'Beige']), attribute('Size', 'Size', ['Single', 'Double', 'Queen', 'King', 'Small', 'Medium', 'Large']), attribute('Assembly', 'Assembly', ['Requires Assembly', 'Pre-Assembled'])] },
  kitchen_dining: { attributes: [attribute('Material', 'Material', ['Stainless Steel', 'Non-Stick', 'Cast Iron', 'Ceramic', 'Glass', 'Plastic']), attribute('Size', 'Size/Capacity', ['Small', 'Medium', 'Large', '1L', '2L', '3L', '5L', 'Set']), attribute('Color', 'Color', ['Black', 'Silver', 'Red', 'White', 'Blue', 'Grey']), attribute('Type', 'Type', ['Cookware', 'Cutlery', 'Appliance', 'Bakeware', 'Blender', 'Storage', 'Plate Set'])] },
  bedding_bath: { attributes: [attribute('Size', 'Bed Size', ['Single', 'Double', 'Queen', 'King', 'Baby/Cot']), attribute('Material', 'Material', ['Cotton', 'Polyester', 'Microfiber', 'Bamboo', 'Silk', 'Linen']), attribute('Color', 'Color', ['White', 'Cream', 'Grey', 'Blue', 'Pink', 'Green', 'Navy', 'Patterned']), attribute('Type', 'Type', ['Bedsheet Set', 'Duvet/Comforter', 'Pillow', 'Towel Set', 'Curtain', 'Bath Mat'])] },
  home_decor: { attributes: [attribute('Style', 'Style', ['Modern', 'Traditional', 'Rustic', 'Minimalist', 'Bohemian', 'Industrial']), attribute('Color', 'Color', ['White', 'Black', 'Gold', 'Silver', 'Natural', 'Brown', 'Blue', 'Green', 'Multicolor']), attribute('Material', 'Material', ['Wood', 'Metal', 'Ceramic', 'Glass', 'Fabric', 'Marble', 'Wicker']), attribute('Size', 'Size', ['Small', 'Medium', 'Large', 'Extra Large', 'Set'])] },
  tools_hardware: { attributes: [attribute('Type', 'Tool Type', ['Power Drill', 'Circular Saw', 'Sander', 'Wrench Set', 'Screwdriver Set', 'Hammer', 'Safety Gear']), attribute('PowerSource', 'Power Source', ['Corded Electric', 'Battery 18V', 'Battery 20V', 'Manual', 'Pneumatic']), attribute('Brand', 'Brand', ['DeWalt', 'Makita', 'Bosch', 'Stanley', 'Black & Decker', 'Generic'])] },
  garden_outdoor: { attributes: [attribute('Type', 'Type', ['Garden Tool', 'Outdoor Furniture', 'Plant Pot', 'Watering Equipment', 'BBQ & Grill', 'Lighting']), attribute('Material', 'Material', ['Metal', 'Plastic', 'Wood', 'Rattan', 'Terracotta', 'Concrete']), attribute('Color', 'Color', ['Green', 'Brown', 'Black', 'Natural', 'Grey', 'White']), attribute('Size', 'Size', ['Small', 'Medium', 'Large', 'Extra Large', 'Set'])] },
  skincare_beauty: { attributes: [attribute('SkinType', 'Skin Type', ['All Skin Types', 'Dry', 'Oily', 'Combination', 'Sensitive', 'Mature']), attribute('Size', 'Volume', ['15ml', '30ml', '50ml', '100ml', '150ml', '200ml', '500ml']), attribute('Type', 'Product Type', ['Moisturizer', 'Cleanser', 'Toner', 'Serum', 'SPF/Sunscreen', 'Foundation', 'Lipstick', 'Mascara', 'Eye Shadow', 'Perfume']), attribute('Shade', 'Shade/Tone', ['Light', 'Medium', 'Tan', 'Deep', 'Universal'])] },
  hair_care: { attributes: [attribute('HairType', 'Hair Type', ['All Types', 'Natural/Coily', 'Relaxed', 'Wavy', 'Straight', 'Colored/Bleached']), attribute('Size', 'Size', ['100ml', '200ml', '250ml', '400ml', '500ml', '1L', 'Bundle']), attribute('Type', 'Type', ['Shampoo', 'Conditioner', 'Treatment', 'Serum', 'Edge Control', 'Wig (Human)', 'Wig (Synthetic)', 'Extension', 'Hair Dye', 'Clippers']), attribute('Color', 'Hair Color', ['Natural Black', 'Dark Brown', 'Auburn', 'Blonde', 'Red', 'Ombre', 'Custom'])] },
  vitamins_health: { attributes: [attribute('Form', 'Form', ['Capsule', 'Tablet', 'Liquid', 'Gummy', 'Powder', 'Spray']), attribute('Quantity', 'Quantity', ['30 count', '60 count', '90 count', '120 count', '180 count', '365 count']), attribute('Type', 'Type', ['Vitamin C', 'Vitamin D', 'Multivitamin', 'Omega-3', 'Protein', 'Iron', 'Calcium', 'Collagen', 'Probiotics'])] },
  sports_fitness: { attributes: [attribute('Size', 'Size', ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'One Size', 'Adjustable']), attribute('Color', 'Color', ['Black', 'White', 'Red', 'Blue', 'Grey', 'Green', 'Orange', 'Navy', 'Multicolor']), attribute('Type', 'Sport', ['Football/Soccer', 'Basketball', 'Tennis', 'Running', 'Swimming', 'Gym Equipment', 'Cycling', 'Boxing', 'Yoga', 'General Sportswear']), attribute('Gender', 'Gender', ['Men', 'Women', 'Kids', 'Unisex'])] },
  toys_games: { attributes: [attribute('AgeRange', 'Age Range', ['0-12m', '1-3yr', '3-6yr', '6-8yr', '8-12yr', '12yr+', 'Adult']), attribute('Material', 'Material', ['Plastic', 'Wood', 'Fabric/Plush', 'Electronic', 'Foam', 'Cardboard']), attribute('Type', 'Type', ['Educational', 'Action Figures', 'Board Games', 'Puzzle', 'Building Blocks', 'Remote Control', 'Outdoor', 'Doll', 'Art & Craft']), attribute('Gender', 'Gender', ['Boys', 'Girls', 'Unisex'])] },
  baby_care: { attributes: [attribute('AgeGroup', 'Age Group', ['Newborn 0-3m', '3-6m', '6-12m', '12-18m', '18-24m', '2-3yr']), attribute('Gender', 'Gender', ['Boys', 'Girls', 'Unisex']), attribute('Type', 'Category', ['Feeding', 'Bathing', 'Clothing', 'Safety', 'Sleep', 'Stroller/Travel', 'Diapers', 'Nursing', 'Toys']), attribute('Size', 'Size', ['Newborn', 'S', 'M', 'L', 'XL', 'One Size'])] },
  books_stationery: { attributes: [attribute('Format', 'Format', ['Hardcover', 'Paperback', 'Spiral Bound', 'eBook', 'Box Set', 'Flash Cards']), attribute('Language', 'Language', ['English', 'French', 'Arabic', 'Bilingual', 'Local Language']), attribute('Category', 'Category', ['Textbook', 'Novel/Fiction', "Children's", 'Religious', 'Self-Help', 'Academic', 'Business', 'Science']), attribute('Type', 'Item Type', ['Book', 'Notebook', 'Pen/Pencil Set', 'Marker Set', 'Calculator', 'File/Folder', 'Geometry Set', 'Highlighter'])] },
  musical_instruments: { attributes: [attribute('Type', 'Instrument', ['Guitar (Acoustic)', 'Guitar (Electric)', 'Bass Guitar', 'Piano/Keyboard', 'Drums', 'Violin', 'Trumpet', 'Microphone', 'Ukulele', 'Amplifier']), attribute('Level', 'Level', ['Beginner', 'Intermediate', 'Professional']), attribute('Color', 'Color', ['Natural Wood', 'Black', 'White', 'Sunburst', 'Red', 'Blue', 'Custom'])] },
  car_accessories: { attributes: [attribute('VehicleType', 'Vehicle', ['Car', 'Motorcycle', 'Truck', 'Bus/Van', 'Universal']), attribute('Type', 'Type', ['Interior', 'Exterior', 'Engine Parts', 'Safety/Security', 'Electronics', 'Tyres', 'Cleaning', 'Lights', 'Seat Covers', 'Car Mats']), attribute('Compatibility', 'Fits', ['Universal', 'Toyota', 'Honda', 'Mitsubishi', 'Hyundai', 'Kia', 'Ford', 'Mercedes', 'BMW', 'Nissan', 'Other'])] },
  packaged_foods: { attributes: [attribute('WeightSize', 'Weight/Size', ['100g', '250g', '500g', '1kg', '2kg', '5kg', '250ml', '500ml', '1L', '2L', 'Pack of 6', 'Bundle']), attribute('Type', 'Food Type', ['Rice', 'Flour', 'Cooking Oil', 'Canned Goods', 'Snacks', 'Beverages', 'Condiments', 'Spices', 'Pasta/Noodles', 'Cereals', 'Dairy']), attribute('Dietary', 'Dietary', ['Regular', 'Halal', 'Organic', 'Gluten-Free', 'Vegan', 'No Preservatives', 'Locally Produced', 'Imported'])] }
};

Object.values(TEMPLATES).forEach((template) => {
  template.priceRules = Object.fromEntries(template.attributes.map((item) => [
    item.key,
    Object.fromEntries(item.options.map((option) => [option, 0]))
  ]));
});

function getFirestoreDb() {
  if (typeof db !== 'undefined') return db;
  if (typeof firebase === 'undefined') return null;
  try {
    return firebase.firestore(firebase.app('manna-marketplace-data'));
  } catch (error) {
    console.error('The named Manna Marketplace Firebase app is unavailable:', error);
    return null;
  }
}

async function runTemplateUpdate() {
  const firestoreDb = getFirestoreDb();
  if (!firestoreDb) {
    console.error('Run this from a Manna admin page with Firebase loaded.');
    return;
  }
  const ids = Object.keys(TEMPLATES);
  let count = 0;
  for (let i = 0; i < ids.length; i += 20) {
    const batch = firestoreDb.batch();
    ids.slice(i, i + 20).forEach((id) => {
      const template = TEMPLATES[id];
      const attributes = template.attributes.map((item) => ({ ...item, type: 'checkbox', isActive: true }));
      batch.set(firestoreDb.collection('categories').doc(id), {
        template: { attributes, priceRules: template.priceRules || {} },
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      count++;
    });
    await batch.commit();
  }
  console.log(`Manna Marketplace category templates updated - ${count} categories`);
}

if (typeof window !== 'undefined') {
  window.TEMPLATES = TEMPLATES;
  window.runTemplateUpdate = runTemplateUpdate;
}

console.log('Manna category template updater loaded. Call runTemplateUpdate().');
