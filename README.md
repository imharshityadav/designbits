# DesignBits — full-stack starter

This package has two parts:

```
designbits-site/
  frontend/designbits.html   ← the site (open directly in a browser, or host anywhere static)
  server/                    ← Node backend for Razorpay + PayPal payments and gated downloads
```

The frontend still works with **zero setup** (Demo Mode on the checkout page).
Follow the steps below to turn on real Razorpay and PayPal payments.

## 1. Install and configure the backend

```bash
cd server
npm install
cp .env.example .env
```

Open `.env` and fill in:

- `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` — from the [Razorpay dashboard](https://dashboard.razorpay.com/app/keys). Test-mode keys work for development.
- `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` — log into [developer.paypal.com](https://developer.paypal.com) with your normal PayPal account, then go to Dashboard → My Apps & Credentials → Create App. Use the **Sandbox** app's credentials while testing.
- `TOKEN_SECRET` — any long random string (used to sign download links).
- `FRONTEND_URL` — where you're serving `frontend/designbits.html` from (e.g. `http://localhost:8080`), with **no trailing slash**.

## 2. Run the backend

```bash
npm start
```

You should see `DesignBits backend running on http://localhost:4000`.

## 3. Test PayPal with a sandbox account

Real PayPal accounts don't work in `PAYPAL_MODE=sandbox`. In the PayPal Developer Dashboard, go to **Sandbox → Accounts** — PayPal auto-creates a fake buyer and seller account for you. Use the sandbox buyer's email/password to "pay" during testing; no real money moves. Switch `PAYPAL_MODE` to `live` (and use your live app credentials) only when you're ready for real payments.

Razorpay and PayPal in this starter both verify payment synchronously right after checkout (`/api/razorpay/verify` and `/api/paypal/capture-order`) — no webhook setup required to get started. (Optional, for production reliability: add a Razorpay webhook and/or PayPal webhook so a payment still gets recorded even if the buyer closes the tab right after paying.)

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

Visit `http://localhost:8080/designbits.html`, add something to your cart, and go to checkout — Razorpay and PayPal will now hit your real backend.

## 5. Add your real product files (from Google Drive)

1. Share each file on Google Drive as **Anyone with the link**.
2. Paste the links into `server/drive-links.csv` next to each product's slug.
3. Run `node scripts/apply-drive-links.js` from inside `server/`.

Full details, trade-offs, and the local-file fallback are in `server/files/README.md`.

## 6. (Optional) Manage products from a Google Sheet instead of code

Want to add new products without editing any files? See `server/PRODUCTS_SHEET.md`
— it walks through publishing a Google Sheet as CSV and pointing the backend
at it. Once set up, adding a row to the sheet is enough; both the backend API
and the storefront pick it up automatically (with local `data/products.json`
as an automatic fallback if the sheet is ever unreachable).

## Notes on what's demo-grade vs. production-grade

- **Order storage** (`server/lib/orders.js`) is a single JSON file for simplicity. Swap it for a real database (Postgres, MySQL, MongoDB) before handling real traffic — every function keeps the same shape, so `server.js` won't need to change much.
- **PayPal currency conversion** is a flat rate in `.env` (`INR_TO_USD_RATE`) for demo purposes. Replace with real per-market pricing or a live FX rate source.
- **File storage** is local disk for the demo. For a real catalog, move files to S3/Cloudinary/Google Cloud Storage and have `/api/download` redirect to a signed URL from that provider instead.
- **CORS** is restricted to `FRONTEND_URL` from `.env` — it must match your frontend's URL *exactly* (scheme, domain, no trailing slash) or the browser will block requests with a CORS error.
