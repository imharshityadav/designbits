# DesignBits — full-stack starter

This package has two parts:

```
designbits-site/
  frontend/designbits.html   ← the site (open directly in a browser, or host anywhere static)
  server/                    ← Node backend for Razorpay + Stripe payments and gated downloads
```

The frontend still works with **zero setup** (Demo Mode on the checkout page).
Follow the steps below to turn on real Razorpay and Stripe payments.

## 1. Install and configure the backend

```bash
cd server
npm install
cp .env.example .env
```

Open `.env` and fill in:

- `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` — from the [Razorpay dashboard](https://dashboard.razorpay.com/app/keys). Test-mode keys work for development.
- `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` — from the [Stripe dashboard](https://dashboard.stripe.com/apikeys).
- `STRIPE_WEBHOOK_SECRET` — see step 3.
- `TOKEN_SECRET` — any long random string (used to sign download links).
- `FRONTEND_URL` — where you're serving `frontend/designbits.html` from (e.g. `http://localhost:8080`).

Enable **PayPal** in Stripe Checkout: Stripe Dashboard → Settings → Payment methods → turn on PayPal (availability depends on your Stripe account's country).

## 2. Run the backend

```bash
npm start
```

You should see `DesignBits backend running on http://localhost:4000`.

## 3. Point Stripe's webhook at your backend

Stripe needs to tell your server when a payment actually succeeds.

- **Local development:** install the [Stripe CLI](https://stripe.com/docs/stripe-cli), then run:
  ```bash
  stripe listen --forward-to localhost:4000/api/stripe/webhook
  ```
  It will print a `whsec_...` value — put that in `.env` as `STRIPE_WEBHOOK_SECRET`.
- **Production:** in the Stripe Dashboard → Developers → Webhooks, add an endpoint pointing at `https://your-domain.com/api/stripe/webhook`, listening for `checkout.session.completed`. Copy the signing secret it gives you into `STRIPE_WEBHOOK_SECRET`.

Razorpay doesn't need a webhook for this starter — the payment is verified synchronously right after checkout via `/api/razorpay/verify`. (Optional: add a Razorpay webhook too for extra reliability against dropped connections — same pattern as the Stripe one.)

## 4. Serve the frontend and point it at your backend

Open `frontend/designbits.html` and find this line near the top of the `<script>` block:

```js
let API_BASE = 'http://localhost:4000';
```

Change it to wherever your backend actually runs (e.g. your deployed backend's URL). Then serve the HTML file with any static server, e.g.:

```bash
cd frontend
python3 -m http.server 8080
```

Visit `http://localhost:8080/designbits.html`, add something to your cart, and go to checkout — Razorpay and Stripe will now hit your real backend.

## 5. Add your real product files (from Google Drive)

1. Share each file on Google Drive as **Anyone with the link**.
2. Paste the links into `server/drive-links.csv` next to each product's slug.
3. Run `node scripts/apply-drive-links.js` from inside `server/`.

Full details, trade-offs, and the local-file fallback are in `server/files/README.md`.

## Notes on what's demo-grade vs. production-grade

- **Order storage** (`server/lib/orders.js`) is a single JSON file for simplicity. Swap it for a real database (Postgres, MySQL, MongoDB) before handling real traffic — every function keeps the same shape, so `server.js` won't need to change much.
- **Stripe currency conversion** is a flat rate in `.env` (`INR_TO_USD_RATE`) for demo purposes. Replace with real per-market pricing or a live FX rate source.
- **File storage** is local disk for the demo. For a real catalog, move files to S3/Cloudinary/Google Cloud Storage and have `/api/download` redirect to a signed URL from that provider instead.
- **CORS** is restricted to `FRONTEND_URL` from `.env` — update it (comma-separated for multiple origins) as you add environments.
