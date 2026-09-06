require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { nanoid } = require('nanoid');
const Razorpay = require('razorpay');
const Stripe = require('stripe');

const { loadProducts, findBySlug, priceCart } = require('./lib/products');
const orders = require('./lib/orders');
const { createDownloadToken, verifyDownloadToken } = require('./lib/tokens');

const app = express();
const PORT = process.env.PORT || 4000;
const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:8080').split(',')[0].trim();
const ALLOWED_ORIGINS = (process.env.FRONTEND_URL || 'http://localhost:8080').split(',').map(s => s.trim());

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});
const stripe = Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_missing');

app.use(cors({ origin: ALLOWED_ORIGINS }));

// Stripe webhooks need the RAW request body to verify the signature, so this
// route is registered with express.raw() BEFORE the global express.json()
// middleware below (Express matches routes in registration order).
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), handleStripeWebhook);

app.use(express.json());

/* ------------------------------------------------------------------ */
/* Catalog                                                              */
/* ------------------------------------------------------------------ */

// Public catalog read — safe to expose. Prices here are for display only;
// the server always re-prices from data/products.json before charging.
app.get('/api/products', (req, res) => {
  const products = loadProducts().filter(p => p.active !== false);
  res.json(products);
});

/* ------------------------------------------------------------------ */
/* Razorpay — India (UPI, cards, netbanking, wallets)                  */
/* ------------------------------------------------------------------ */

app.post('/api/razorpay/create-order', async (req, res) => {
  try {
    const { items, customer } = req.body;
    const { lines, totalInr } = priceCart(items);

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
/* Stripe — international (cards, PayPal via Stripe Checkout, wallets) */
/* ------------------------------------------------------------------ */

app.post('/api/stripe/create-checkout-session', async (req, res) => {
  try {
    const { items, customer } = req.body;
    const { lines, totalInr } = priceCart(items);

    const currency = (process.env.STRIPE_CURRENCY || 'usd').toLowerCase();
    const rate = Number(process.env.INR_TO_USD_RATE || 0.012);
    // Demo-only conversion. Replace with real per-market pricing or a live
    // FX rate provider before going live.
    const toMinorUnits = inr => Math.round(inr * rate * 100);

    const orderId = 'DB' + nanoid(8).toUpperCase();

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      // Card + PayPal (PayPal must also be enabled in your Stripe Dashboard
      // under Settings > Payment methods for your account/region).
      payment_method_types: ['card', 'paypal'],
      line_items: lines.map(l => ({
        quantity: l.quantity,
        price_data: {
          currency,
          unit_amount: toMinorUnits(l.unitPriceInr),
          product_data: { name: l.title },
        },
      })),
      customer_email: customer && customer.email ? customer.email : undefined,
      metadata: { designbitsOrderId: orderId },
      success_url: `${FRONTEND_URL}/#/order-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL}/#/checkout`,
    });

    orders.createOrder({
      id: orderId,
      gateway: 'stripe',
      gatewayRef: session.id,
      status: 'pending',
      items: lines,
      totalInr,
      currency,
      customer: customer || {},
      createdAt: new Date().toISOString(),
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('stripe/create-checkout-session error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

function handleStripeWebhook(req, res) {
  let event;
  try {
    const signature = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(req.body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe webhook signature check failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const orderId = session.metadata && session.metadata.designbitsOrderId;
    if (orderId) {
      orders.updateOrder(orderId, {
        status: 'paid',
        gatewayPaymentId: session.payment_intent,
        paidAt: new Date().toISOString(),
      });
    }
  }
  res.json({ received: true });
}

// The frontend calls this after Stripe redirects back with ?session_id=...
// The webhook above is the real source of truth; this endpoint just reads
// whatever state we've stored (and double-checks with Stripe directly if the
// webhook hasn't landed yet, which can happen with a slight delay locally).
app.get('/api/stripe/verify-session', async (req, res) => {
  try {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: 'session_id is required.' });

    let order = orders.findByGatewayRef(session_id);
    if (!order) return res.status(404).json({ error: 'Order not found for this session.' });

    if (order.status !== 'paid') {
      const session = await stripe.checkout.sessions.retrieve(session_id);
      if (session.payment_status === 'paid') {
        order = orders.updateOrder(order.id, {
          status: 'paid',
          gatewayPaymentId: session.payment_intent,
          paidAt: new Date().toISOString(),
        });
      }
    }

    if (order.status !== 'paid') {
      return res.json({ success: false, status: order.status });
    }
    res.json({ success: true, order: buildOrderResponse(order) });
  } catch (err) {
    console.error('stripe/verify-session error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

/* ------------------------------------------------------------------ */
/* Downloads — only reachable via a signed, time-limited token          */
/* ------------------------------------------------------------------ */

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

app.get('/api/download', (req, res) => {
  const { token } = req.query;
  const check = verifyDownloadToken(token);
  if (!check.valid) return res.status(403).send(check.reason);

  const order = orders.getOrder(check.orderId);
  if (!order || order.status !== 'paid') return res.status(403).send('Order not paid.');

  const product = findBySlug(check.slug);
  if (!product) return res.status(404).send('Product not found.');

  // Preferred path: file lives in Google Drive, shared as "Anyone with the
  // link can view". We redirect the (already payment-verified) buyer
  // straight to Drive's direct-download endpoint.
  if (product.driveFileId) {
    const driveUrl = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(product.driveFileId)}&export=download&confirm=t`;
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
  console.log(`DesignBits backend running on http://localhost:${PORT}`);
  console.log(`Allowing requests from: ${ALLOWED_ORIGINS.join(', ')}`);
});
