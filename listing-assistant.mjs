import { DEFAULT_CATEGORY_TAXONOMY, normalizeCategoryValue } from './category-taxonomy.js';

const STOP_WORDS = new Set([
    'about', 'after', 'again', 'also', 'and', 'are', 'because', 'been', 'before', 'being', 'between',
    'from', 'have', 'into', 'just', 'more', 'most', 'over', 'than', 'that', 'their', 'there', 'these',
    'they', 'this', 'those', 'through', 'under', 'very', 'with', 'your', 'the', 'for', 'you', 'our',
    'use', 'used', 'new', 'good', 'best', 'great', 'item', 'product'
]);

function tokenize(value) {
    return String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .match(/[a-z0-9]+/g)?.filter((token) => token.length > 2 && !STOP_WORDS.has(token)) || [];
}

function trainCategoryClassifier(products = []) {
    const categories = new Map(DEFAULT_CATEGORY_TAXONOMY.map((category) => [category.id, {
        category,
        documents: 0,
        tokenCounts: new Map(),
        totalTokens: 0,
        productExamples: 0
    }]));
    const vocabulary = new Set();

    const addTrainingDocument = (category, text, isProduct = false) => {
        const entry = categories.get(category.id);
        const tokens = tokenize(text);
        if (!tokens.length) return;
        entry.documents += 1;
        if (isProduct) entry.productExamples += 1;
        tokens.forEach((token) => {
            vocabulary.add(token);
            entry.tokenCounts.set(token, (entry.tokenCounts.get(token) || 0) + 1);
            entry.totalTokens += 1;
        });
    };

    DEFAULT_CATEGORY_TAXONOMY.forEach((category) => {
        addTrainingDocument(category, `${category.name} ${category.group} ${category.description} ${category.id.replace(/_/g, ' ')}`);
    });

    products.forEach((product) => {
        const category = normalizeCategoryValue(product.category);
        if (!category || !categories.has(category.id)) return;
        const keywords = Array.isArray(product.searchKeywords) ? product.searchKeywords.join(' ') : product.searchKeywords;
        addTrainingDocument(category, `${product.name || ''} ${product.description || ''} ${keywords || ''}`, true);
    });

    return { categories: [...categories.values()], vocabulary, productExampleCount: [...categories.values()].reduce((sum, entry) => sum + entry.productExamples, 0) };
}

function classifyCategory(model, text) {
    const tokens = tokenize(text);
    if (!tokens.length) return { category: '', confidence: 0 };

    const knownTokens = tokens.filter((token) => model.vocabulary.has(token));
    if (knownTokens.length < 2) return { category: '', confidence: 0 };

    const totalDocuments = model.categories.reduce((sum, entry) => sum + entry.documents, 0);
    const vocabularySize = Math.max(1, model.vocabulary.size);
    const scores = model.categories.map((entry) => {
        let score = Math.log((entry.documents + 1) / (totalDocuments + model.categories.length));
        knownTokens.forEach((token) => {
            const frequency = entry.tokenCounts.get(token) || 0;
            score += Math.log((frequency + 1) / (entry.totalTokens + vocabularySize));
        });
        return { category: entry.category.name, score };
    }).sort((first, second) => second.score - first.score);

    const maxScore = scores[0].score;
    const probabilities = scores.map((entry) => Math.exp(entry.score - maxScore));
    const probabilityTotal = probabilities.reduce((sum, value) => sum + value, 0);
    const confidence = probabilities[0] / probabilityTotal;
    const runnerUp = probabilities[1] / probabilityTotal;
    if (confidence < 0.2 || confidence - runnerUp < 0.04) return { category: '', confidence };

    return { category: scores[0].category, confidence };
}

export function generateLocalListingDraft({ productName, currentDescription, currentCategory, productBrief, catalogProducts = [] }) {
    const facts = String(productBrief || '').replace(/\s+/g, ' ').trim();
    if (!facts) throw new Error('Enter product facts before creating a draft.');

    const existingDescription = String(currentDescription || '').replace(/\s+/g, ' ').trim();
    const descriptions = [...new Set([facts, existingDescription].filter(Boolean))];
    const title = String(productName || '').trim() || facts.split(/[.!?]/, 1)[0].split(' ').slice(0, 8).join(' ').slice(0, 80);
    const model = trainCategoryClassifier(catalogProducts);
    const prediction = classifyCategory(model, `${title} ${facts}`);
    const keywords = [...new Set(tokenize(`${title} ${facts}`))].slice(0, 8);

    return {
        title,
        description: descriptions.join('\n\n').slice(0, 1200),
        suggestedCategory: prediction.category,
        categoryConfidence: prediction.confidence,
        trainingExamples: model.productExampleCount,
        keywords,
        currentCategory: String(currentCategory || '').trim()
    };
}