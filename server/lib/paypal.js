/**
 * Minimal PayPal Orders v2 REST API client using Node's built-in fetch
 * (Node 18+) — no PayPal SDK package required.
 *
 * Docs: https://developer.paypal.com/docs/api/orders/v2/
 */

const BASE_URLS = {
  sandbox: 'https://api-m.sandbox.paypal.com',
  live: 'https://api-m.paypal.com',
};

function getBaseUrl() {
  const mode = (process.env.PAYPAL_MODE || 'sandbox').toLowerCase();
  return BASE_URLS[mode] || BASE_URLS.sandbox;
}

async function getAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const resp = await fetch(`${getBaseUrl()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data.error_description || 'Could not authenticate with PayPal. Check PAYPAL_CLIENT_ID/SECRET.');
  }
  return data.access_token;
}

/**
 * Creates a PayPal order and returns the URL to redirect the buyer to for
 * approval. PayPal appends `?token=<id>&PayerID=<id>` to whatever
 * `returnUrl` you pass once the buyer approves — no manual placeholder
 * needed (unlike Stripe's `{CHECKOUT_SESSION_ID}`).
 */
async function createOrder({ orderId, amountValue, currency, returnUrl, cancelUrl }) {
  const accessToken = await getAccessToken();
  const resp = await fetch(`${getBaseUrl()}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          custom_id: orderId,
          amount: { currency_code: currency, value: amountValue },
        },
      ],
      application_context: {
        brand_name: 'DesignBits',
        return_url: returnUrl,
        cancel_url: cancelUrl,
        user_action: 'PAY_NOW',
        shipping_preference: 'NO_SHIPPING',
      },
    }),
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error((data.details && data.details[0] && data.details[0].description) || data.message || 'Could not create PayPal order.');
  }
  const approveLink = (data.links || []).find(l => l.rel === 'approve');
  if (!approveLink) throw new Error('PayPal did not return an approval link.');
  return { paypalOrderId: data.id, approveUrl: approveLink.href };
}

async function captureOrder(paypalOrderId) {
  const accessToken = await getAccessToken();
  const resp = await fetch(`${getBaseUrl()}/v2/checkout/orders/${paypalOrderId}/capture`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error((data.details && data.details[0] && data.details[0].description) || data.message || 'Could not capture PayPal payment.');
  }
  return data;
}

module.exports = { createOrder, captureOrder };
