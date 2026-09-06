const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'products.json');

/**
 * Loaded fresh on every call so you can edit data/products.json (or swap this
 * for a real database query) without restarting the server. For a production
 * catalog with real traffic, replace this with a DB-backed lookup and add
 * caching as needed.
 */
function loadProducts() {
  const raw = fs.readFileSync(DATA_PATH, 'utf8');
  return JSON.parse(raw);
}

function findBySlug(slug) {
  return loadProducts().find(p => p.slug === slug && p.active !== false);
}

/**
 * Turns a client-submitted cart ([{slug, qty}]) into a priced, validated
 * order line list using OUR OWN catalog prices — never the client's numbers.
 * Throws if any slug is unknown or quantity is invalid, so bad requests are
 * rejected before any payment is created.
 */
function priceCart(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Cart is empty.');
  }
  const lines = items.map(({ slug, qty }) => {
    const product = findBySlug(slug);
    if (!product) throw new Error(`Unknown product: ${slug}`);
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
