import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDirectory = fileURLToPath(new URL('.', import.meta.url));
const outputDirectory = join(projectDirectory, 'public');
const staticExtensions = new Set([
    '.css',
    '.html',
    '.ico',
    '.jpeg',
    '.jpg',
    '.js',
    '.mjs',
    '.png',
    '.svg',
    '.txt',
    '.webp',
    '.woff',
    '.woff2',
    '.xml'
]);
const excludedFiles = new Set([
    'build-static-site.mjs',
    'generate-favicon.js',
    'init-wallet.js',
    'seed-marketplace-categories.js',
    'update-category-templates.js'
]);

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const rootFiles = await readdir(projectDirectory, { withFileTypes: true });
let copiedFiles = 0;

for (const entry of rootFiles) {
    if (!entry.isFile() || excludedFiles.has(entry.name) || entry.name.includes('.test.')) continue;
    if (entry.name !== 'manifest.json' && !staticExtensions.has(extname(entry.name).toLowerCase())) continue;
    await cp(join(projectDirectory, entry.name), join(outputDirectory, entry.name));
    copiedFiles += 1;
}

await cp(join(projectDirectory, 'images'), join(outputDirectory, 'images'), { recursive: true });
console.log(`Prepared ${copiedFiles} application files and the images directory in public/.`);
