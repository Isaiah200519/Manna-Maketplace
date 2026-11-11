import { getCategoryDisplayName, normalizeCategoryValue } from './category-taxonomy.js';

const COLOR_HEX_MAP = {
    black: '#111827',
    white: '#F8FAFC',
    silver: '#C0C0C0',
    grey: '#6B7280',
    gray: '#6B7280',
    red: '#DC2626',
    blue: '#2563EB',
    navy: '#1E3A8A',
    green: '#16A34A',
    yellow: '#FACC15',
    pink: '#EC4899',
    purple: '#7C3AED',
    orange: '#F97316',
    brown: '#A16207',
    tan: '#D2B48C',
    beige: '#D6B98C',
    nude: '#F2D1B3',
    cream: '#F5F1E6',
    gold: '#D4AF37',
    'rose gold': '#CFA89A',
    khaki: '#BDB76B',
    burgundy: '#7F1D1D',
    maroon: '#7F1D1D',
    teal: '#14B8A6',
    natural: '#C7B299',
    'natural wood': '#A67C52',
    'space grey': '#7B818A',
    'dark brown': '#3B2F2F',
    'dark blue': '#1D4ED8',
    'light blue': '#93C5FD',
    'dark green': '#166534',
    'light green': '#86EFAC',
    'light pink': '#F9A8D4',
    'rose': '#F9A8D4',
    'floral': '#F472B6',
    'multicolor': '#8B5CF6',
    'two-tone': '#A78BFA',
    charcoal: '#364152',
    'light grey': '#D1D5DB',
    'light gray': '#D1D5DB',
    'dark grey': '#4B5563',
    'dark gray': '#4B5563',
    olive: '#808000',
    turquoise: '#40E0D0',
    cyan: '#06B6D4',
    lavender: '#A78BFA',
    peach: '#FDBA9A',
    coral: '#F97373',
    mint: '#6EE7B7',
    lime: '#84CC16',
    'sky blue': '#38BDF8',
    'royal blue': '#4169E1',
    'light purple': '#C4B5FD',
    'dark purple': '#581C87',
    'mustard yellow': '#D4A017',
    'off white': '#F5F5F4',
    'denim blue': '#3B5998',
    'rainbow': '#EC4899'
};

const resolveColorHex = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return '#64748b';
    const direct = COLOR_HEX_MAP[normalized];
    if (direct) return direct;

    const normalizedNoSymbols = normalized.replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const directNoSymbols = COLOR_HEX_MAP[normalizedNoSymbols];
    if (directNoSymbols) return directNoSymbols;

    if (normalized.includes('brown') || normalized.includes('walnut') || normalized.includes('oak')) return '#A16207';
    if (normalized.includes('silver') || normalized.includes('metal')) return '#C0C0C0';
    if (normalized.includes('gold')) return '#D4AF37';
    if (normalized.includes('rose')) return '#CFA89A';
    if (normalized.includes('navy') || normalized.includes('blue')) return '#2563EB';
    if (normalized.includes('green')) return '#16A34A';
    if (normalized.includes('red')) return '#DC2626';
    if (normalized.includes('pink')) return '#EC4899';
    if (normalized.includes('purple')) return '#7C3AED';
    if (normalized.includes('grey') || normalized.includes('gray') || normalized.includes('grey')) return '#6B7280';
    if (normalized.includes('white')) return '#F8FAFC';
    if (normalized.includes('black')) return '#111827';
    if (normalized.includes('yellow')) return '#FACC15';
    if (normalized.includes('orange')) return '#F97316';
    if (normalized.includes('tan') || normalized.includes('beige')) return '#D6B98C';
    return '#64748b';
};

const field = (key, label, options, inputType = 'checkbox') => ({
    key,
    label,
    inputType,
    allowedOptions: options.map((option) => {
        const raw = typeof option === 'string' ? option : String(option.value ?? option.label ?? '').trim();
        const labelText = typeof option === 'string' ? option : String(option.label ?? option.value ?? '').trim();
        if (!raw || !labelText) return null;

        const value = String(raw).trim();
        const text = String(labelText).trim();
        return {
            value,
            label: text,
            hex: inputType === 'color' ? resolveColorHex(value) : String((typeof option === 'string' ? '' : option.hex) || '')
        };
    }).filter(Boolean).filter((option) => option.value && option.label)
});

const CATEGORY_VARIANT_CONFIG = {
    laptops_computers: [
        field('storage', 'Storage', ['128GB SSD', '256GB SSD', '512GB SSD', '1TB SSD', '2TB HDD']),
        field('ram', 'RAM', ['4GB', '8GB', '16GB', '32GB', '64GB']),
        field('processor', 'Processor', ['Intel i3', 'Intel i5', 'Intel i7', 'AMD Ryzen 5', 'AMD Ryzen 7', 'Apple M1', 'Apple M2']),
        field('screenSize', 'Screen Size', ['11in', '13in', '14in', '15.6in', '17in']),
        field('color', 'Color', ['Silver', 'Space Grey', 'Black', 'White', 'Gold'], 'color')
    ],
    tv_audio_video: [
        field('screenSize', 'Screen Size', ['32in', '40in', '43in', '50in', '55in', '65in', '75in']),
        field('resolution', 'Resolution', ['HD', 'Full HD', '4K', '8K']),
        field('type', 'Type', ['Smart TV', 'Regular TV', 'OLED', 'Soundbar', 'Speaker', 'Headphones', 'Earbuds']),
        field('color', 'Color', ['Black', 'White', 'Silver'], 'color')
    ],
    cameras_photography: [
        field('cameraType', 'Camera Type', ['DSLR', 'Mirrorless', 'Action Camera', 'Point & Shoot', 'Security Camera']),
        field('resolution', 'Megapixels', ['12MP', '20MP', '24MP', '36MP', '48MP', '64MP+']),
        field('color', 'Color', ['Black', 'Silver', 'White'], 'color')
    ],
    gaming: [
        field('platform', 'Platform', ['PS5', 'PS4', 'Xbox Series X', 'Xbox One', 'Nintendo Switch', 'PC']),
        field('type', 'Type', ['Console', 'Game', 'Controller', 'Headset', 'Gaming Chair']),
        field('color', 'Color', ['Black', 'White', 'Red', 'Blue', 'Custom'], 'color')
    ],
    accessories_gadgets: [
        field('type', 'Type', ['Gadget']),
        field('compatibility', 'Works With', ['Universal', 'iPhone', 'Samsung', 'All Android', 'MacBook', 'iPad']),
        field('color', 'Color', ['Black', 'White', 'Grey', 'Silver', 'Blue', 'Navy', 'Red', 'Green', 'Yellow', 'Orange', 'Pink', 'Purple', 'Brown', 'Beige', 'Gold', 'Rose Gold', 'Teal', 'Transparent', 'Multicolor'], 'color')
    ],
    mens_clothing: [
        field('size', 'Size', ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL']),
        field('color', 'Color', ['Black', 'White', 'Navy', 'Grey', 'Light Grey', 'Charcoal', 'Red', 'Burgundy', 'Maroon', 'Blue', 'Royal Blue', 'Sky Blue', 'Denim Blue', 'Green', 'Olive', 'Khaki', 'Brown', 'Tan', 'Beige', 'Cream', 'Mustard Yellow', 'Orange', 'Pink', 'Purple'], 'color'),
        field('style', 'Style', ['Casual', 'Formal', 'Traditional', 'Sports', 'Smart Casual'])
    ],
    womens_clothing: [
        field('size', 'Size', ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL']),
        field('color', 'Color', ['Black', 'White', 'Off White', 'Cream', 'Red', 'Burgundy', 'Pink', 'Peach', 'Coral', 'Blue', 'Navy', 'Sky Blue', 'Turquoise', 'Green', 'Mint', 'Olive', 'Purple', 'Lavender', 'Yellow', 'Mustard Yellow', 'Orange', 'Brown', 'Tan', 'Beige', 'Nude', 'Gold', 'Rose Gold', 'Silver', 'Grey', 'Charcoal', 'Floral', 'Multicolor'], 'color'),
        field('style', 'Style', ['Casual', 'Formal', 'Traditional', 'Evening', 'Party', 'Office'])
    ],
    kids_clothing: [
        field('ageGroup', 'Age Group', ['0-3m', '3-6m', '6-12m', '1-2yr', '2-4yr', '4-6yr', '6-8yr', '8-10yr', '10-12yr']),
        field('color', 'Color', ['Blue', 'Sky Blue', 'Royal Blue', 'Turquoise', 'Red', 'Coral', 'Pink', 'Peach', 'Yellow', 'Mustard Yellow', 'Orange', 'Green', 'Mint', 'Lime', 'Purple', 'Lavender', 'White', 'Off White', 'Black', 'Grey', 'Brown', 'Beige', 'Rainbow', 'Multicolor'], 'color'),
        field('gender', 'Gender', ['Boys', 'Girls', 'Unisex']),
    ],
    clothes: [
        field('size', 'Size', ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', 'One Size']),
        field('color', 'Color', ['Black', 'White', 'Navy', 'Grey', 'Red', 'Blue', 'Green', 'Brown', 'Beige', 'Pink', 'Purple', 'Yellow', 'Orange', 'Multicolor'], 'color'),
        field('material', 'Material', ['Cotton', 'Polyester', 'Denim', 'Linen', 'Wool', 'Silk', 'Leather', 'Rayon']),
        field('style', 'Style', ['Casual', 'Formal', 'Traditional', 'Sportswear', 'Office', 'Party'])
    ],
    bags_luggage: [
        field('size', 'Size', ['Mini', 'Small', 'Medium', 'Large', 'Extra Large']),
        field('color', 'Color', ['Black', 'Brown', 'Tan', 'Navy', 'Red', 'Grey', 'Beige', 'White', 'Pink', 'Blue'], 'color'),
        field('material', 'Material', ['Genuine Leather', 'PU Leather', 'Canvas', 'Nylon', 'Polyester']),
        field('type', 'Type', ['Handbag', 'Backpack', 'Tote', 'Clutch', 'Crossbody', 'Suitcase', 'Wallet'])
    ],
    jewelry_watches: [
        field('material', 'Material', ['Gold', 'Silver', 'Rose Gold', 'Stainless Steel', 'Gold-Plated', 'Alloy']),
        field('type', 'Type', ['Necklace', 'Bracelet', 'Ring', 'Earrings', 'Watch', 'Anklet', 'Set']),
        field('color', 'Color', ['Gold', 'Silver', 'Rose Gold', 'Black', 'Two-Tone', 'Multicolor'], 'color'),
        field('size', 'Size', ['One Size', 'Adjustable', '6in', '7in', '8in', 'S', 'M', 'L'])
    ],
    furniture: [
        field('material', 'Material', ['Solid Wood', 'Engineered Wood', 'Metal', 'Glass', 'Upholstered Fabric', 'Leather', 'Rattan']),
        field('color', 'Color', ['Brown/Walnut', 'Black', 'White', 'Natural Wood', 'Grey', 'Oak', 'Beige'], 'color'),
        field('size', 'Size', ['Single', 'Double', 'Queen', 'King', 'Small', 'Medium', 'Large']),
        field('assembly', 'Assembly', ['Requires Assembly', 'Pre-Assembled'])
    ],
    kitchen_dining: [
        field('material', 'Material', ['Stainless Steel', 'Non-Stick', 'Cast Iron', 'Ceramic', 'Glass', 'Plastic']),
        field('size', 'Size/Capacity', ['Small', 'Medium', 'Large', '1L', '2L', '3L', '5L', 'Set']),
        field('color', 'Color', ['Black', 'Silver', 'Red', 'White', 'Blue', 'Grey', 'Green', 'Pink', 'Orange', 'Yellow', 'Purple', 'Gold', 'Rose Gold', 'Cream', 'Brown', 'Beige', 'Navy', 'Teal', 'Natural', 'Multicolor'], 'color'),
        field('type', 'Type', ['Cookware', 'Cutlery', 'Appliance', 'Bakeware', 'Blender', 'Storage', 'Plate Set'])
    ],
    bedding_bath: [
        field('size', 'Bed Size', ['Single', 'Double', 'Queen', 'King', 'Baby/Cot']),
        field('material', 'Material', ['Cotton', 'Polyester', 'Microfiber', 'Bamboo', 'Silk', 'Linen']),
        field('color', 'Color', ['White', 'Cream', 'Grey', 'Blue', 'Pink', 'Green', 'Navy', 'Patterned'], 'color'),
        field('type', 'Type', ['Bedsheet Set', 'Duvet/Comforter', 'Pillow', 'Towel Set', 'Curtain', 'Bath Mat'])
    ],
    home_decor: [
        field('style', 'Style', ['Modern', 'Traditional', 'Rustic', 'Minimalist', 'Bohemian', 'Industrial']),
        field('color', 'Color', ['White', 'Black', 'Gold', 'Silver', 'Natural', 'Brown', 'Blue', 'Green', 'Multicolor'], 'color'),
        field('material', 'Material', ['Wood', 'Metal', 'Ceramic', 'Glass', 'Fabric', 'Marble', 'Wicker']),
        field('size', 'Size', ['Small', 'Medium', 'Large', 'Extra Large', 'Set'])
    ],
    tools_hardware: [
        field('toolType', 'Tool Type', ['Power Drill', 'Circular Saw', 'Sander', 'Wrench Set', 'Screwdriver Set', 'Hammer', 'Safety Gear']),
        field('powerSource', 'Power Source', ['Corded Electric', 'Battery 18V', 'Battery 20V', 'Manual', 'Pneumatic']),
        field('brand', 'Brand', ['DeWalt', 'Makita', 'Bosch', 'Stanley', 'Black & Decker', 'Generic'])
    ],
    garden_outdoor: [
        field('type', 'Type', ['Garden Tool', 'Outdoor Furniture', 'Plant Pot', 'Watering Equipment', 'BBQ & Grill', 'Lighting']),
        field('material', 'Material', ['Metal', 'Plastic', 'Wood', 'Rattan', 'Terracotta', 'Concrete']),
        field('color', 'Color', ['Green', 'Brown', 'Black', 'Natural', 'Grey', 'White'], 'color'),
        field('size', 'Size', ['Small', 'Medium', 'Large', 'Extra Large', 'Set'])
    ],
    skincare_beauty: [
        field('skinType', 'Skin Type', ['All Skin Types', 'Dry', 'Oily', 'Combination', 'Sensitive', 'Mature']),
        field('size', 'Volume', ['15ml', '30ml', '50ml', '100ml', '150ml', '200ml', '500ml']),
        field('type', 'Product Type', ['Moisturizer', 'Cleanser', 'Toner', 'Serum', 'SPF/Sunscreen', 'Foundation', 'Lipstick', 'Mascara', 'Eye Shadow', 'Perfume']),
        field('shade', 'Shade/Tone', ['Light', 'Medium', 'Tan', 'Deep', 'Universal'])
    ],
    hair_care: [
        field('hairType', 'Hair Type', ['All Types', 'Natural/Coily', 'Relaxed', 'Wavy', 'Straight', 'Colored/Bleached']),
        field('size', 'Size', ['100ml', '200ml', '250ml', '400ml', '500ml', '1L', 'Bundle']),
        field('type', 'Type', ['Shampoo', 'Conditioner', 'Treatment', 'Serum', 'Edge Control', 'Wig (Human)', 'Wig (Synthetic)', 'Extension', 'Hair Dye', 'Clippers']),
        field('hairColor', 'Hair Color', ['Natural Black', 'Dark Brown', 'Auburn', 'Blonde', 'Red', 'Ombre', 'Custom'])
    ],
    vitamins_health: [
        field('form', 'Form', ['Capsule', 'Tablet', 'Liquid', 'Gummy', 'Powder', 'Spray']),
        field('quantity', 'Quantity', ['30 count', '60 count', '90 count', '120 count', '180 count', '365 count']),
        field('type', 'Type', ['Vitamin C', 'Vitamin D', 'Multivitamin', 'Omega-3', 'Protein', 'Iron', 'Calcium', 'Collagen', 'Probiotics'])
    ],
    sports_fitness: [
        field('size', 'Size', ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'One Size', 'Adjustable']),
        field('color', 'Color', ['Black', 'White', 'Red', 'Blue', 'Grey', 'Green', 'Orange', 'Navy', 'Multicolor'], 'color'),
        field('sport', 'Sport', ['Football/Soccer', 'Basketball', 'Tennis', 'Running', 'Swimming', 'Gym Equipment', 'Cycling', 'Boxing', 'Yoga', 'General Sportswear']),
        field('gender', 'Gender', ['Men', 'Women', 'Kids', 'Unisex'])
    ],
    toys_games: [
        field('ageRange', 'Age Range', ['0-12m', '1-3yr', '3-6yr', '6-8yr', '8-12yr', '12yr+', 'Adult']),
        field('material', 'Material', ['Plastic', 'Wood', 'Fabric/Plush', 'Electronic', 'Foam', 'Cardboard']),
        field('type', 'Type', ['Educational', 'Action Figures', 'Board Games', 'Puzzle', 'Building Blocks', 'Remote Control', 'Outdoor', 'Doll', 'Art & Craft']),
        field('gender', 'Gender', ['Boys', 'Girls', 'Unisex'])
    ],
    baby_care: [
        field('ageGroup', 'Age Group', ['Newborn 0-3m', '3-6m', '6-12m', '12-18m', '18-24m', '2-3yr']),
        field('gender', 'Gender', ['Boys', 'Girls', 'Unisex']),
        field('type', 'Category', ['Feeding', 'Bathing', 'Clothing', 'Safety', 'Sleep', 'Stroller/Travel', 'Diapers', 'Nursing', 'Toys']),
        field('size', 'Size', ['Newborn', 'S', 'M', 'L', 'XL', 'One Size'])
    ],
    books_stationery: [
        field('format', 'Format', ['Hardcover', 'Paperback', 'Spiral Bound', 'eBook', 'Box Set', 'Flash Cards']),
        field('language', 'Language', ['English', 'French', 'Arabic', 'Bilingual', 'Local Language']),
        field('category', 'Category', ['Textbook', 'Novel/Fiction', "Children's", 'Religious', 'Self-Help', 'Academic', 'Business', 'Science']),
        field('itemType', 'Item Type', ['Book', 'Notebook', 'Pen/Pencil Set', 'Marker Set', 'Calculator', 'File/Folder', 'Geometry Set', 'Highlighter'])
    ],
    musical_instruments: [
        field('instrument', 'Instrument', ['Guitar (Acoustic)', 'Guitar (Electric)', 'Bass Guitar', 'Piano/Keyboard', 'Drums', 'Violin', 'Trumpet', 'Microphone', 'Ukulele', 'Amplifier']),
        field('level', 'Level', ['Beginner', 'Intermediate', 'Professional']),
        field('color', 'Color', ['Natural Wood', 'Black', 'White', 'Sunburst', 'Red', 'Blue', 'Custom'], 'color')
    ],
    car_accessories: [
        field('vehicleType', 'Vehicle', ['Car', 'Motorcycle', 'Truck', 'Bus/Van', 'Universal']),
        field('type', 'Type', ['Interior', 'Exterior', 'Engine Parts', 'Safety/Security', 'Electronics', 'Tyres', 'Cleaning', 'Lights', 'Seat Covers', 'Car Mats']),
        field('compatibility', 'Fits', ['Universal', 'Toyota', 'Honda', 'Mitsubishi', 'Hyundai', 'Kia', 'Ford', 'Mercedes', 'BMW', 'Nissan', 'Other'])
    ],
    packaged_foods: [
        field('weightSize', 'Weight/Size', ['100g', '250g', '500g', '1kg', '2kg', '5kg', '250ml', '500ml', '1L', '2L', 'Pack of 6', 'Bundle']),
        field('type', 'Food Type', ['Rice', 'Flour', 'Cooking Oil', 'Canned Goods', 'Snacks', 'Beverages', 'Condiments', 'Spices', 'Pasta/Noodles', 'Cereals', 'Dairy']),
        field('dietary', 'Dietary', ['Regular', 'Halal', 'Organic', 'Gluten-Free', 'Vegan', 'No Preservatives', 'Locally Produced', 'Imported'])
    ]
};

export function getCategoryVariantConfig(category) {
    const categoryName = getCategoryDisplayName(category || '');
    if (categoryName === 'Phones & Tablets' || categoryName === 'Shoes & Footwear') {
        return { fields: [] };
    }

    const match = normalizeCategoryValue(categoryName) || normalizeCategoryValue(category || '');
    const key = match?.id || '';
    const variantFields = CATEGORY_VARIANT_CONFIG[key] || [];
    return { fields: variantFields };
}

export function getVariantDisplayEntries(item) {
    if (!item || typeof item !== 'object') return [];
    if (getCategoryDisplayName(item.category || '') === 'Phones & Tablets' || getCategoryDisplayName(item.category || '') === 'Shoes & Footwear') {
        return [];
    }

    const variantOptions = Array.isArray(item.variantOptions) ? item.variantOptions : [];
    if (!variantOptions.length) return [];

    const config = getCategoryVariantConfig(item.category || '');
    const fieldMap = new Map((config.fields || []).map((fieldDef) => [fieldDef.key, fieldDef.label]));

    return variantOptions.flatMap((variant) => {
        const values = variant?.values || {};
        return Object.entries(values).map(([key, value]) => {
            if (!value || !fieldMap.has(key)) return null;
            return {
                label: fieldMap.get(key),
                value: String(value).trim()
            };
        }).filter(Boolean);
    });
}
