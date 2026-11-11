import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_CATEGORY_TAXONOMY, ensureCategoriesSeeded, getCategoryDisplayName, getCategoryOptions, isMarketplaceCategory } from './category-taxonomy.js';
import { getCategoryVariantConfig } from './category-variants.js';

test('Clothes is a new category with clothing attributes and leaves existing categories available', () => {
    const clothes = DEFAULT_CATEGORY_TAXONOMY.find((category) => category.id === 'clothes');
    const existingCategories = ['mens_clothing', 'womens_clothing', 'kids_clothing', 'shoes_footwear'];

    assert.equal(clothes?.name, 'Clothes');
    assert.equal(getCategoryDisplayName('clothes'), 'Clothes');
    assert.ok(getCategoryOptions().some((category) => category.id === 'clothes'));
    existingCategories.forEach((id) => {
        assert.ok(DEFAULT_CATEGORY_TAXONOMY.some((category) => category.id === id));
    });

    const fields = getCategoryVariantConfig('clothes').fields;
    assert.deepEqual(fields.map((field) => field.key), ['size', 'color', 'material', 'style']);
    assert.ok(fields.find((field) => field.key === 'color').allowedOptions.some((option) => option.label === 'Navy' && option.hex));
    assert.ok(getCategoryVariantConfig('mens_clothing').fields.some((field) => field.key === 'size'));
});

test('Accessories & Gadgets has one general Gadget type option rather than fan-specific options', () => {
    const fields = getCategoryVariantConfig('accessories_gadgets').fields;
    const typeField = fields.find((field) => field.key === 'type');
    const colorField = fields.find((field) => field.key === 'color');
    const availableTypes = typeField.allowedOptions.map((option) => option.label);
    const availableColors = colorField.allowedOptions.map((option) => option.label);

    assert.deepEqual(availableTypes, ['Gadget']);
    assert.ok(availableColors.includes('Silver'));
    assert.ok(availableColors.includes('Green'));
    assert.ok(availableColors.includes('Gold'));
    assert.ok(availableColors.includes('Multicolor'));
});

test('General and uncategorized products remain in the marketplace catalog', () => {
    assert.equal(isMarketplaceCategory(''), true);
    assert.equal(isMarketplaceCategory('  '), true);
    assert.equal(isMarketplaceCategory('General'), true);
    assert.equal(isMarketplaceCategory('Phones & Tablets'), true);
    assert.equal(isMarketplaceCategory('phones_tablets'), true);
    assert.equal(isMarketplaceCategory('unrelated legacy category'), false);
});

test('category seeding adds missing categories without deleting or overwriting existing documents', async () => {
    const existingDocuments = new Map([
        ['mens_clothing', { id: 'mens_clothing', customField: 'keep existing data' }]
    ]);
    const writes = [];
    let commits = 0;
    const db = {
        collection(name) {
            assert.equal(name, 'categories');
            return {
                async get() {
                    return { docs: [...existingDocuments.keys()].map((id) => ({ id })) };
                },
                doc(id) {
                    return { id };
                }
            };
        },
        batch() {
            return {
                set(reference, data, options) {
                    writes.push({ id: reference.id, data, options });
                },
                async commit() {
                    commits += 1;
                    writes.forEach(({ id, data, options }) => {
                        existingDocuments.set(id, options.merge
                            ? { ...existingDocuments.get(id), ...data }
                            : data);
                    });
                }
            };
        }
    };

    const returnedCategories = await ensureCategoriesSeeded(db);
    assert.equal(existingDocuments.get('mens_clothing').customField, 'keep existing data');
    assert.ok(existingDocuments.has('clothes'));
    assert.equal(writes.some((write) => write.id === 'mens_clothing'), false);
    assert.deepEqual(writes.map((write) => write.id), DEFAULT_CATEGORY_TAXONOMY
        .filter((category) => category.id !== 'mens_clothing')
        .map((category) => category.id));
    assert.equal(commits, 1);
    assert.equal(returnedCategories.length, DEFAULT_CATEGORY_TAXONOMY.length);

    await ensureCategoriesSeeded(db);
    assert.equal(commits, 1);
});
