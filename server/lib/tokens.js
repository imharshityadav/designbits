const crypto = require('crypto');

const SECRET = process.env.TOKEN_SECRET || 'dev-only-insecure-secret-change-me';
const TTL_MINUTES = Number(process.env.DOWNLOAD_LINK_TTL_MINUTES || 60);

/**
 * Creates a signed, expiring token for one file: `${orderId}.${slug}.${expiry}.${signature}`
 * Anyone with the link can download the file until it expires — no login
 * system required, which keeps this demo simple. If you need stronger
 * protection (e.g. one-time-use links, per-account libraries), add a
 * `downloads used` counter in the orders store and check it in server.js.
 */
function createDownloadToken(orderId, slug) {
  const expiresAt = Date.now() + TTL_MINUTES * 60 * 1000;
  const payload = `${orderId}.${slug}.${expiresAt}`;
  const signature = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  return `${payload}.${signature}`;
}

function verifyDownloadToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 4) return { valid: false, reason: 'Malformed token' };
  const [orderId, slug, expiresAtStr, signature] = parts;
  const payload = `${orderId}.${slug}.${expiresAtStr}`;
  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false, reason: 'Bad signature' };
  }
  if (Date.now() > Number(expiresAtStr)) {
    return { valid: false, reason: 'Link expired' };
  }
  return { valid: true, orderId, slug };
}

module.exports = { createDownloadToken, verifyDownloadToken };
