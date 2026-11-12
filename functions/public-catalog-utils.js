function cleanText(value, maxLength = 500) {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function cleanUrl(value) {
    const text = cleanText(value, 2048);
    if (!text) return '';

    try {
        const url = new URL(text);
        return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch {
        return '';
    }
}

function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function cleanOptions(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 100).map((option) => {
        if (typeof option === 'string') return cleanText(option, 120);
        if (!option || typeof option !== 'object') return null;
        const result = {};
        for (const key of ['label', 'name', 'size', 'color', 'value', 'field', 'stockCount', 'priceModifier', 'values']) {
            if (key in option) {
                result[key] = Array.isArray(option[key])
                    ? option[key].slice(0, 100).map((item) => cleanText(item, 120))
                    : typeof option[key] === 'number'
                        ? option[key]
                        : cleanText(option[key], 120);
            }
        }
        return result;
    }).filter(Boolean);
}

function projectPublicSeller(id, seller = {}) {
    const image = cleanText(seller.imagePath || seller.logo || seller.image, 2048);
    return {
        id: cleanText(id, 256),
        name: cleanText(seller.businessName || seller.name || 'Seller', 160),
        category: cleanText(seller.category || 'General', 120),
        description: cleanText(seller.description, 2000),
        imagePath: image,
        logo: image,
        image,
        banner: cleanText(seller.banner, 2048),
        city: cleanText(seller.city, 120),
        county: cleanText(seller.county, 120),
        community: cleanText(seller.community, 120),
        district: cleanText(seller.district, 120),
        rating: finiteNumber(seller.rating),
        reviewCount: finiteNumber(seller.reviewCount),
        orderCount: finiteNumber(seller.orderCount),
        standardDeliveryDays: finiteNumber(seller.standardDeliveryDays),
        estimatedPrepTime: finiteNumber(seller.estimatedPrepTime),
        websiteUrl: cleanUrl(seller.websiteUrl || seller.website || seller.storeUrl || seller.storeWebsite),
        facebookUrl: cleanUrl(seller.facebookUrl),
        instagramUrl: cleanUrl(seller.instagramUrl),
        youtubeUrl: cleanUrl(seller.youtubeUrl)
    };
}

function projectPublicMenuItem(id, sellerId, seller, item = {}) {
    const image = cleanText(item.image || item.imageFilename || 'placeholder.svg', 2048);
    return {
        id: cleanText(id, 256),
        sellerId: cleanText(sellerId, 256),
        sellerName: cleanText(seller.businessName || seller.name || 'Seller', 160),
        name: cleanText(item.name || 'Product', 200),
        category: cleanText(item.category || seller.category || 'General', 120),
        description: cleanText(item.description || item.sellerDescription, 2000),
        sellerDescription: cleanText(item.sellerDescription || item.description, 2000),
        price: finiteNumber(item.price ?? item.totalPrice ?? item.priceInLRD),
        priceInLRD: finiteNumber(item.priceInLRD ?? item.price ?? item.totalPrice),
        priceInUSD: finiteNumber(item.priceInUSD),
        defaultPrice: finiteNumber(item.defaultPrice ?? item.standardPrice ?? item.price),
        sellerMarkup: finiteNumber(item.sellerMarkup),
        totalPrice: finiteNumber(item.totalPrice ?? item.price),
        currency: String(item.currency || 'LRD').toUpperCase() === 'USD' ? 'USD' : 'LRD',
        isSellerOwned: item.isSellerOwned === true,
        orderFlow: item.orderFlow === 'seller_owned' ? 'seller_owned' : 'catalog',
        masterProductId: cleanText(item.masterProductId, 256),
        image,
        imageFilename: cleanText(item.imageFilename || image, 2048),
        videoUrl: cleanUrl(item.videoUrl || item.videoLink),
        availability: true,
        isAvailable: true,
        featured: item.featured === true,
        recommended: item.recommended === true,
        todayDeal: item.todayDeal === true,
        preparationTime: finiteNumber(item.preparationTime),
        deliveryDays: finiteNumber(item.deliveryDays),
        storageOptions: cleanOptions(item.storageOptions),
        colorOptions: cleanOptions(item.colorOptions),
        shoeVariants: cleanOptions(item.shoeVariants),
        variantOptions: cleanOptions(item.variantOptions),
        sellerTags: Array.isArray(item.sellerTags) ? item.sellerTags.slice(0, 20).map((tag) => cleanText(tag, 80)).filter(Boolean) : []
    };
}

function projectPublicInventoryItem(id, sellerId, seller, item = {}) {
    const image = cleanText(item.image || item.imageFilename || 'placeholder.svg', 2048);
    return {
        id: cleanText(id, 256),
        sellerId: cleanText(sellerId, 256),
        sellerName: cleanText(seller.businessName || seller.name || 'Seller', 160),
        name: cleanText(item.name || 'Product', 200),
        category: cleanText(item.category || seller.category || 'General', 120),
        description: cleanText(item.resaleDescription || item.sourceDescription, 2000),
        sellerDescription: cleanText(item.resaleDescription || item.sourceDescription, 2000),
        price: finiteNumber(item.resalePrice),
        priceInLRD: finiteNumber(item.resalePrice),
        priceInUSD: finiteNumber(item.resalePrice),
        currency: String(item.resaleCurrency || 'LRD').toUpperCase() === 'USD' ? 'USD' : 'LRD',
        image,
        imageFilename: cleanText(item.imageFilename || image, 2048),
        isSellerOwned: true,
        orderFlow: 'seller_owned',
        isInventoryItem: true,
        availability: true,
        isAvailable: true,
        quantity: Math.max(0, finiteNumber(item.quantity))
    };
}

function projectPublicPromotion(id, promotion = {}) {
    const productIds = Array.isArray(promotion.productIds)
        ? promotion.productIds.slice(0, 200).map((productId) => cleanText(productId, 256)).filter(Boolean)
        : [];
    return {
        id: cleanText(id, 256),
        title: cleanText(promotion.title || 'Promotion', 160),
        discountPercent: Math.min(100, Math.max(0, finiteNumber(promotion.discountPercent))),
        status: cleanText(promotion.status, 32),
        scope: promotion.scope === 'selected' ? 'selected' : 'all',
        productIds,
        validFrom: cleanText(promotion.validFrom, 10),
        validUntil: cleanText(promotion.validUntil, 10)
    };
}

function projectPublicCatalogSettings(settings = {}) {
    const rule = settings.catalogPriceRule;
    const catalogPriceRule = rule && typeof rule === 'object' ? {
        enabled: rule.enabled === true,
        legacy: rule.legacy === true,
        scope: rule.scope === 'categories' ? 'categories' : 'all',
        adjustmentType: rule.adjustmentType === 'fixed' ? 'fixed' : 'percent',
        direction: rule.direction === 'increase' ? 'increase' : 'decrease',
        value: finiteNumber(rule.value),
        expiresAt: cleanText(rule.expiresAt, 64),
        categoryIds: Array.isArray(rule.categoryIds) ? rule.categoryIds.slice(0, 100).map((id) => cleanText(id, 128)).filter(Boolean) : []
    } : null;

    return {
        catalogPriceRule,
        globalCatalogDiscountPercent: finiteNumber(settings.globalCatalogDiscountPercent)
    };
}

module.exports = {
    projectPublicCatalogSettings,
    projectPublicInventoryItem,
    projectPublicMenuItem,
    projectPublicPromotion,
    projectPublicSeller
};
