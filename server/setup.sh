#!/usr/bin/env bash
# Run this from inside the server/ folder: ./setup.sh
set -e

echo "== DesignBits backend setup =="

NODE_VERSION=$(node -v 2>/dev/null || echo "none")
echo "Node version: $NODE_VERSION"
if [[ "$NODE_VERSION" == "none" ]]; then
  echo "Node.js is not installed. Install Node 18+ from https://nodejs.org first."
  exit 1
fi

if [ ! -f package.json ]; then
  echo "Run this script from inside the server/ folder (where package.json lives)."
  exit 1
fi

echo "Installing dependencies..."
npm install

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example — open it now and fill in your real keys:"
  echo "  - RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET  (https://dashboard.razorpay.com/app/keys)"
  echo "  - STRIPE_SECRET_KEY / STRIPE_PUBLISHABLE_KEY  (https://dashboard.stripe.com/apikeys)"
  echo "  - STRIPE_WEBHOOK_SECRET  (see README.md — needs the Stripe CLI or a deployed webhook)"
  echo "  - TOKEN_SECRET  (any long random string)"
else
  echo ".env already exists, leaving it as-is."
fi

echo ""
echo "Setup done. Next steps:"
echo "  1. Edit .env with your real keys."
echo "  2. In a second terminal: stripe listen --forward-to localhost:4000/api/stripe/webhook"
echo "  3. Run: npm start"
echo "  4. Open frontend/designbits.html (served over http://, not file://) and set API_BASE to this backend's URL."
