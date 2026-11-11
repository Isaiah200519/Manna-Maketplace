export function normalizeConfiguredVariants(variants) {
    if (!Array.isArray(variants)) return [];
    return variants.map((variant) => {
        const priceModifier = Number(variant?.priceModifier || 0);
        const stockCount = Number(variant?.stockCount ?? 1);
        return {
            ...variant,
            values: Object.fromEntries(Object.entries(variant?.values || {})
                .map(([key, value]) => [String(key), String(value ?? '').trim()])
                .filter(([, value]) => value)),
            priceModifier: Number.isFinite(priceModifier) ? priceModifier : 0,
            stockCount: Number.isFinite(stockCount) ? Math.max(0, stockCount) : 0
        };
    }).filter((variant) => Object.keys(variant.values).length > 0);
}

export function findConfiguredVariant(variants, selectedValues) {
    const selection = selectedValues && typeof selectedValues === 'object' ? selectedValues : {};
    const selectedKeys = Object.keys(selection);
    if (!selectedKeys.length) return null;
    return normalizeConfiguredVariants(variants).find((variant) => {
        const variantKeys = Object.keys(variant.values);
        return variantKeys.length === selectedKeys.length
            && variantKeys.every((key) => String(selection[key] ?? '') === variant.values[key]);
    }) || null;
}
