const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'products.json');
const CACHE_TTL_MS = 5 * 60 * 1000; // re-fetch the sheet at most every 5 minutes

let sheetCache = { data: null, fetchedAt: 0 };

/**
 * Minimal CSV parser that handles quoted fields containing commas
 * (Google Sheets wraps any cell with a comma in double quotes when it
 * exports CSV, e.g. a product description).
 */
function parseCsvLine(line) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuotes = false; }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      result.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]).map(h => h.trim());
  return lines.slice(1).map(line => {
    const cells = parseCsvLine(line);
    const row = {};
    header.forEach((h, i) => { row[h] = (cells[i] || '').trim(); });
    return row;
  });
}

/** Converts one spreadsheet row into a product object matching the site's shape. */
function rowToProduct(row) {
  return {
    slug: row.slug,
    title: row.title,
    cat: row.cat,
    price: Number(row.price) || 0,
    mrp: row.mrp ? Number(row.mrp) : undefined,
    badge: row.badge || undefined,
    icon: row.icon || '📦',
    blurb: row.blurb || '',
    desc: row.desc || row.blurb || '',
    // Multiple "what's included" bullet points go in one cell separated by "|"
    includes: row.includes ? row.includes.split('|').map(s => s.trim()).filter(Boolean) : [],
    format: row.format || 'PDF (digital download)',
    pages: row.pages ? Number(row.pages) : undefined,
    language: row.language || 'English',
    fileName: row.fileName || (row.slug ? `${row.slug}.pdf` : undefined),
    driveFileId: row.driveFileId || null,
    image: row.image || undefined,
    active: row.active ? row.active.toLowerCase() !== 'false' : true,
  };
}

/**
 * If PRODUCTS_SHEET_CSV_URL is set (a Google Sheet published-to-web CSV
 * link), fetch and parse it. Cached for CACHE_TTL_MS so a page full of
 * shoppers doesn't hammer Google Sheets on every request. Falls back to the
 * last good cached copy if a fetch fails, and to `null` (meaning "use the
 * local JSON file instead") if the env var isn't set at all.
 */
async function fetchSheetProducts() {
  const url = process.env.PRODUCTS_SHEET_CSV_URL;
  if (!url) return null;

  const now = Date.now();
  if (sheetCache.data && (now - sheetCache.fetchedAt) < CACHE_TTL_MS) {
    return sheetCache.data;
  }

  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Sheet returned HTTP ${resp.status}`);
    const text = await resp.text();
    const rows = parseCsv(text);
    const products = rows.map(rowToProduct).filter(p => p.slug && p.title);
    sheetCache = { data: products, fetchedAt: now };
    return products;
  } catch (err) {
    console.error('Could not fetch products sheet, using last cached copy:', err.message);
    return sheetCache.data; // may be null if we've never fetched successfully
  }
}

function loadLocalProducts() {
  const raw = fs.readFileSync(DATA_PATH, 'utf8');
  return JSON.parse(raw);
}

/** Main entry point: prefers the live Google Sheet, falls back to the bundled JSON file. */
async function loadProducts() {
  const sheetProducts = await fetchSheetProducts();
  if (sheetProducts && sheetProducts.length) return sheetProducts;
  return loadLocalProducts();
}

async function findBySlug(slug) {
  const products = await loadProducts();
  return products.find(p => p.slug === slug && p.active !== false);
}

/**
 * Turns a client-submitted cart ([{slug, qty}]) into a priced, validated
 * order line list using OUR OWN catalog prices — never the client's numbers.
 * Throws if any slug is unknown or quantity is invalid, so bad requests are
 * rejected before any payment is created.
 */
async function priceCart(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Cart is empty.');
  }
  const products = await loadProducts();
  const bySlug = new Map(products.map(p => [p.slug, p]));

  const lines = items.map(({ slug, qty }) => {
    const product = bySlug.get(slug);
    if (!product || product.active === false) throw new Error(`Unknown product: ${slug}`);
    const quantity = Number(qty) || 0;
    if (quantity < 1 || quantity > 20) throw new Error(`Invalid quantity for ${slug}`);
    return {
      slug: product.slug,
      title: product.title,
      fileName: product.fileName,
      unitPriceInr: product.price,
      quantity,
      subtotalInr: product.price * quantity,
    };
  });
  const totalInr = lines.reduce((sum, l) => sum + l.subtotalInr, 0);
  return { lines, totalInr };
}

module.exports = { loadProducts, findBySlug, priceCart };
