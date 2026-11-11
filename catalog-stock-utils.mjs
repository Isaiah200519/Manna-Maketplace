export function normalizeCatalogStockCount(value) {
    const stockCount = Number(value);
    if (!Number.isInteger(stockCount) || stockCount < 0 || stockCount > 1000000) {
        throw new RangeError('Stock count must be a whole number from 0 to 1,000,000.');
    }
    return stockCount;
}

export function setCatalogProductStock(product, value) {
    const stockCount = normalizeCatalogStockCount(value);
    const nextProduct = { ...product, stockCount };
    for (const field of ['storageOptions', 'shoeVariants', 'variantOptions']) {
        if (Array.isArray(product[field])) {
            nextProduct[field] = product[field].map((variant) => {
                if (field === 'storageOptions' && typeof variant === 'string') {
                    return { label: variant.trim(), priceModifier: 0, stockCount };
                }
                return variant && typeof variant === 'object' && !Array.isArray(variant)
                    ? { ...variant, stockCount }
                    : variant;
            });
        }
    }
    return nextProduct;
}
