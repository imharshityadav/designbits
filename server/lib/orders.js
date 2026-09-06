const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'orders.json');

/**
 * ---------------------------------------------------------------------------
 * DEMO STORAGE ONLY.
 * This reads/writes a single JSON file with no locking, so it is fine for
 * local testing and small volumes but is NOT safe for concurrent production
 * traffic (two requests writing at once can clobber each other). Before
 * going live, swap this module for a real database (Postgres, MySQL,
 * MongoDB, etc.) — every function below keeps the same shape so callers
 * (server.js) don't need to change.
 * ---------------------------------------------------------------------------
 */

function readAll() {
  if (!fs.existsSync(DATA_PATH)) return {};
  const raw = fs.readFileSync(DATA_PATH, 'utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

function writeAll(orders) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(orders, null, 2));
}

function createOrder(order) {
  const orders = readAll();
  orders[order.id] = order;
  writeAll(orders);
  return order;
}

function getOrder(id) {
  const orders = readAll();
  return orders[id] || null;
}

function updateOrder(id, patch) {
  const orders = readAll();
  if (!orders[id]) return null;
  orders[id] = Object.assign({}, orders[id], patch);
  writeAll(orders);
  return orders[id];
}

/** Look up an order by the gateway's own reference (Razorpay order id or Stripe session id). */
function findByGatewayRef(gatewayRef) {
  const orders = readAll();
  return Object.values(orders).find(o => o.gatewayRef === gatewayRef) || null;
}

module.exports = { createOrder, getOrder, updateOrder, findByGatewayRef };
