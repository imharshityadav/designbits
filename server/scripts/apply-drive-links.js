/**
 * Fills in each product's `driveFileId` from server/drive-links.csv.
 *
 * Usage:
 *   1. In Google Drive, set each file's sharing to "Anyone with the link".
 *   2. Copy its share link into drive-links.csv next to the matching slug.
 *   3. Run: node scripts/apply-drive-links.js
 *
 * Accepts any of these link formats (or a bare file ID) per row:
 *   https://drive.google.com/file/d/FILE_ID/view?usp=sharing
 *   https://drive.google.com/open?id=FILE_ID
 *   https://drive.google.com/uc?id=FILE_ID&export=download
 *   FILE_ID
 */
const fs = require('fs');
const path = require('path');

const CSV_PATH = path.join(__dirname, '..', 'drive-links.csv');
const PRODUCTS_PATH = path.join(__dirname, '..', 'data', 'products.json');

function extractFileId(input) {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  let m = trimmed.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  if (m) return m[1];
  m = trimmed.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed)) return trimmed;
  return null;
}

function parseCsv(text) {
  return text
    .split(/\r?\n/)
    .slice(1) // skip header row
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const idx = line.indexOf(',');
      const slug = idx === -1 ? line : line.slice(0, idx).trim();
      const link = idx === -1 ? '' : line.slice(idx + 1).trim();
      return { slug, link };
    });
}

function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`Could not find ${CSV_PATH}.`);
    process.exit(1);
  }
  const rows = parseCsv(fs.readFileSync(CSV_PATH, 'utf8'));
  const products = JSON.parse(fs.readFileSync(PRODUCTS_PATH, 'utf8'));
  const bySlug = new Map(products.map(p => [p.slug, p]));

  let updated = 0;
  let skipped = 0;
  const unmatchedSlugs = [];

  for (const { slug, link } of rows) {
    if (!link) { skipped++; continue; }
    const product = bySlug.get(slug);
    if (!product) { unmatchedSlugs.push(slug); continue; }
    const fileId = extractFileId(link);
    if (!fileId) {
      console.warn(`Could not read a file ID from the link for "${slug}": ${link}`);
      continue;
    }
    product.driveFileId = fileId;
    updated++;
  }

  fs.writeFileSync(PRODUCTS_PATH, JSON.stringify(products, null, 2));

  console.log(`Updated ${updated} product(s) with a Drive file ID.`);
  if (skipped) console.log(`${skipped} row(s) had no link yet — left untouched.`);
  if (unmatchedSlugs.length) {
    console.log(`Slugs in the CSV that don't match products.json: ${unmatchedSlugs.join(', ')}`);
  }

  const stillMissing = products.filter(p => !p.driveFileId && p.active !== false);
  if (stillMissing.length) {
    console.log(`\nStill missing a Drive link (${stillMissing.length}):`);
    stillMissing.forEach(p => console.log(`  - ${p.slug}`));
  } else {
    console.log('\nEvery active product now has a driveFileId.');
  }
}

main();
