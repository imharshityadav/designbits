# How product files get delivered

Downloads are served two possible ways — the backend checks Google Drive first,
and falls back to a local file in this folder if no Drive link is set.

## Option A — Google Drive (recommended, this is what's wired up)

1. In Google Drive, right-click each product's file → **Share** → **Anyone with the link** (Viewer is enough).
2. Copy that share link.
3. Open `server/drive-links.csv` and paste the link next to the matching `slug`
   (one row per product — the slugs already match `data/products.json`).
4. Run:
   ```bash
   cd server
   node scripts/apply-drive-links.js
   ```
   This fills in each product's `driveFileId` in `data/products.json`. It
   accepts any of Drive's link formats, or a bare file ID.
5. Done — `/api/download` will now redirect a paid, verified buyer straight to
   that file on Drive.

**Trade-off to know:** because the file is shared as "anyone with the link,"
the raw Drive link itself isn't checked against payment — only our own
`/api/download?token=...` link is gated. If someone extracted and shared the
raw Drive link elsewhere, they could bypass payment. For a small catalog at
reasonable prices this is a common, practical trade-off. If you want files to
stay fully private on Drive and only ever be reachable through a paid,
verified request, ask for the "secure" version (a Google service account +
Drive API integration) instead — same `/api/download` route, no frontend
changes needed.

**A note on large files:** Drive's direct-download link can show an
interstitial "can't scan this file for viruses" page instead of the file
itself for some large or executable-like files. PDFs and typical digital
products under ~100MB are generally fine. If you hit this with a specific
file, either compress it or switch that one product to the service-account
approach.

## Option B — Local file fallback

If a product's `driveFileId` is still `null`, the backend falls back to
looking for a local file at `server/files/<fileName>`, where `fileName` is
listed per product in `data/products.json`. Useful for testing a single
product before your whole Drive folder is organized.
