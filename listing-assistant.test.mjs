import assert from 'node:assert/strict';
import test from 'node:test';
import { generateLocalListingDraft } from './listing-assistant.mjs';

const catalogProducts = [
    {
        name: 'Stainless Steel Cooking Pot',
        description: 'Cookware pot for the kitchen',
        category: 'Kitchen & Dining',
        searchKeywords: ['pot', 'cookware']
    },
    {
        name: 'Blender',
        description: 'Kitchen appliance for blending',
        category: 'Kitchen & Dining'
    },
    {
        name: 'Wireless Smartphone',
        description: 'Android phone and mobile accessories',
        category: 'Phones & Tablets'
    }
];

test('classifies from labeled catalog products and keeps draft text grounded in seller facts', () => {
    const draft = generateLocalListingDraft({
        productName: 'Steel Pot',
        currentCategory: 'General',
        productBrief: 'Stainless steel cookware pot for cooking soup',
        catalogProducts
    });

    assert.equal(draft.title, 'Steel Pot');
    assert.equal(draft.suggestedCategory, 'Kitchen & Dining');
    assert.equal(draft.trainingExamples, 3);
    assert.match(draft.description, /Stainless steel cookware pot for cooking soup/);
    assert.ok(draft.keywords.includes('stainless'));
});

test('requires seller-provided product facts', () => {
    assert.throws(() => generateLocalListingDraft({ productBrief: '  ' }), /Enter product facts/);
});