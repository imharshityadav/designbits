require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { nanoid } = require('nanoid');
const Razorpay = require('razorpay');
const paypal = require('./lib/paypal');

const { loadProducts, findBySlug, priceCart } = require('./lib/products');
const orders = require('./lib/orders');
const { createDownloadToken, verifyDownloadToken } = require('./lib/tokens');

const app = express();
const PORT = process.env.PORT || 4000;
const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:8080').split(',')[0].trim();
// Normalizes an origin so small differences (trailing slash, www vs no-www,
// upper/lower case) don't accidentally block a legitimate request — this is
// what caused the CORS errors earlier when FRONTEND_URL was typed slightly
// differently from the browser's actual origin.
function normalizeOrigin(o) {
  return String(o || '')
    .trim()
    .toLowerCase()
    .replace(/\/$/, '')
    .replace(/^https?:\/\/www\./, 'https://');
}

const ALLOWED_ORIGINS = (process.env.FRONTEND_URL || 'http://localhost:8080')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const ALLOWED_ORIGINS_NORMALIZED = ALLOWED_ORIGINS.map(normalizeOrigin);

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

app.use(cors({
  origin: (origin, callback) => {
    // Non-browser requests (health checks, curl, server-to-server) send no
    // Origin header at all — always allow those.
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS_NORMALIZED.includes(normalizeOrigin(origin))) {
      return callback(null, true);
    }
    console.warn(`CORS blocked origin "${origin}" — allowed: ${ALLOWED_ORIGINS.join(', ')}`);
    callback(new Error('Not allowed by CORS'));
  },
}));
app.use(express.json());

/* ------------------------------------------------------------------ */
/* Catalog                                                              */
/* ------------------------------------------------------------------ */

// Public catalog read — safe to expose. Prices here are for display only;
// the server always re-prices from data/products.json before charging.
app.get('/api/products', async (req, res) => {
  const products = (await loadProducts()).filter(p => p.active !== false);
  res.json(products);
});

/* ------------------------------------------------------------------ */
/* Razorpay — India (UPI, cards, netbanking, wallets)                  */
/* ------------------------------------------------------------------ */

app.post('/api/razorpay/create-order', async (req, res) => {
  try {
    const { items, customer } = req.body;
    const { lines, totalInr } = await priceCart(items);

    const orderId = 'DB' + nanoid(8).toUpperCase();
    const razorpayOrder = await razorpay.orders.create({
      amount: totalInr * 100, // Razorpay expects the amount in paise
      currency: 'INR',
      receipt: orderId,
      notes: { designbitsOrderId: orderId },
    });

    orders.createOrder({
      id: orderId,
      gateway: 'razorpay',
      gatewayRef: razorpayOrder.id,
      status: 'pending',
      items: lines,
      totalInr,
      currency: 'INR',
      customer: customer || {},
      createdAt: new Date().toISOString(),
    });

    res.json({
      orderId,
      razorpayOrderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error('razorpay/create-order error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/razorpay/verify', (req, res) => {
  try {
    const { designbitsOrderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ error: 'Payment signature verification failed.' });
    }

    const order = orders.updateOrder(designbitsOrderId, {
      status: 'paid',
      gatewayPaymentId: razorpay_payment_id,
      paidAt: new Date().toISOString(),
    });
    if (!order) return res.status(404).json({ error: 'Order not found.' });

    res.json({ success: true, order: buildOrderResponse(order) });
  } catch (err) {
    console.error('razorpay/verify error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

/* ------------------------------------------------------------------ */
/* PayPal — international (cards + PayPal balance)                     */
/* ------------------------------------------------------------------ */

app.post('/api/paypal/create-order', async (req, res) => {
  try {
    const { items, customer } = req.body;
    const { lines, totalInr } = await priceCart(items);

    const currency = (process.env.PAYPAL_CURRENCY || 'USD').toUpperCase();
    const rate = Number(process.env.INR_TO_USD_RATE || 0.012);
    // Demo-only conversion. Replace with real per-market pricing or a live
    // FX rate provider before going live.
    const amountValue = (totalInr * rate).toFixed(2);

    const orderId = 'DB' + nanoid(8).toUpperCase();

    // PayPal appends ?token=<paypalOrderId>&PayerID=<id> to this return_url
    // itself once the buyer approves — no placeholder needed here.
    const { paypalOrderId, approveUrl } = await paypal.createOrder({
      orderId,
      amountValue,
      currency,
      returnUrl: `${FRONTEND_URL}/#/order-success`,
      cancelUrl: `${FRONTEND_URL}/#/checkout`,
    });

    orders.createOrder({
      id: orderId,
      gateway: 'paypal',
      gatewayRef: paypalOrderId,
      status: 'pending',
      items: lines,
      totalInr,
      currency,
      customer: customer || {},
      createdAt: new Date().toISOString(),
    });

    res.json({ approveUrl });
  } catch (err) {
    console.error('paypal/create-order error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// The frontend calls this once PayPal redirects back with ?token=...
// (PayPal's own order id). We capture the payment here rather than via a
// webhook, since PayPal's redirect flow only fires after buyer approval.
app.post('/api/paypal/capture-order', async (req, res) => {
  try {
    const { paypalOrderId } = req.body;
    if (!paypalOrderId) return res.status(400).json({ error: 'paypalOrderId is required.' });

    let order = orders.findByGatewayRef(paypalOrderId);
    if (!order) return res.status(404).json({ error: 'Order not found for this PayPal order.' });

    if (order.status !== 'paid') {
      await paypal.captureOrder(paypalOrderId);
      order = orders.updateOrder(order.id, { status: 'paid', paidAt: new Date().toISOString() });
    }

    res.json({ success: true, order: buildOrderResponse(order) });
  } catch (err) {
    console.error('paypal/capture-order error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

/* ------------------------------------------------------------------ */
/* Downloads — only reachable via a signed, time-limited token          */
/* ------------------------------------------------------------------ */

/**
 * Accepts either a bare Google Drive file ID or a full share link (any of
 * Drive's common formats) and returns just the file ID. Lets you paste
 * whatever Drive gives you straight into products.json's driveFileId field.
 */
function extractDriveFileId(raw) {
  const value = String(raw || '').trim();
  let match = value.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  if (match) return match[1];
  match = value.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (match) return match[1];
  return value; // already looks like a bare ID
}

function buildOrderResponse(order) {
  return {
    id: order.id,
    status: order.status,
    totalInr: order.totalInr,
    customer: order.customer,
    downloads: order.items.map(item => ({
      slug: item.slug,
      title: item.title,
      url: `/api/download?token=${createDownloadToken(order.id, item.slug)}`,
    })),
  };
}

app.get('/api/download', async (req, res) => {
  const { token } = req.query;
  const check = verifyDownloadToken(token);
  if (!check.valid) return res.status(403).send(check.reason);

  const order = orders.getOrder(check.orderId);
  if (!order || order.status !== 'paid') return res.status(403).send('Order not paid.');

  const product = await findBySlug(check.slug);
  if (!product) return res.status(404).send('Product not found.');

  // Preferred path: file lives in Google Drive, shared as "Anyone with the
  // link can view". We redirect the (already payment-verified) buyer
  // straight to Drive's direct-download endpoint.
  // Preferred path: file lives in Google Drive, shared as "Anyone with the
  // link can view". We redirect the (already payment-verified) buyer
  // straight to Drive's direct-download endpoint. Accepts either a bare
  // file ID or a full Drive share link pasted straight from "Copy link" —
  // extractDriveFileId() figures out which.
  if (product.driveFileId) {
    const fileId = extractDriveFileId(product.driveFileId);
    const driveUrl = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`;
    return res.redirect(driveUrl);
  }

  // Fallback: a file dropped locally into server/files/ (see files/README.md).
  const filePath = path.join(__dirname, 'files', product.fileName);
  if (fs.existsSync(filePath)) {
    return res.download(filePath, product.fileName);
  }

  res.status(404).send(
    `No file linked yet for "${product.title}". Set its driveFileId in data/products.json, ` +
    `or add server/files/${product.fileName}.`
  );
});

/* ------------------------------------------------------------------ */

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`DigitalByte backend running on http://localhost:${PORT}`);
  console.log(`Allowing requests from: ${ALLOWED_ORIGINS.join(', ')}`);
});
