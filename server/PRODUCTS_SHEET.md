# Managing products via a Google Sheet (no code changes needed)

By default the site's products live in `data/products.json`. If you'd rather
add/edit products by just editing a spreadsheet, set this up once:

## 1. Create the sheet

Make a new Google Sheet with **exactly these column headers** in row 1:

```
slug,title,cat,price,mrp,badge,icon,blurb,desc,includes,format,pages,language,driveFileId,image,active
```

| Column | Required? | Notes |
|---|---|---|
| `slug` | Yes | Unique, URL-safe id, e.g. `30-day-habit-tracker` |
| `title` | Yes | Product name shown on the site |
| `cat` | Yes | One of: `ebookbyte`, `templatebits`, `cartoon-activity`, `lifebyte`, `celebrationbits` |
| `price` | Yes | Number only, e.g. `249` |
| `mrp` | No | Original price if discounted, e.g. `399` |
| `badge` | No | `Bestseller`, `New`, or `Sale` (leave blank for none) |
| `icon` | No | One emoji shown on the placeholder cover, e.g. `📚` |
| `blurb` | No | One-line description on product cards |
| `desc` | No | Longer description on the product page |
| `includes` | No | Bullet points separated by `\|`, e.g. `Point one\|Point two\|Point three` |
| `format` | No | e.g. `PDF (digital download)` |
| `pages` | No | Number of pages, if relevant |
| `language` | No | e.g. `English` |
| `driveFileId` | No | The Google Drive file ID for the actual download (see main README) |
| `image` | No | Path/URL to a real cover photo (see "Real product photos" below) |
| `active` | No | Set to `false` to hide a product without deleting the row |

Add one row per product below the header row.

## 2. Publish it as CSV

In the sheet: **File → Share → Publish to web**. Under "Link", choose the
specific sheet/tab, and change the format dropdown to **Comma-separated
values (.csv)**. Click **Publish**. Copy the URL it gives you.

## 3. Point the backend at it

In `server/.env`, set:

```
PRODUCTS_SHEET_CSV_URL=https://docs.google.com/spreadsheets/d/e/xxxxxxxx/pub?output=csv
```

Restart the backend (or redeploy on Render). From then on, `/api/products`
serves live data from the sheet, cached for 5 minutes — add a new row, wait
up to 5 minutes, refresh the site, and it appears. No code edits, no
redeploying the frontend.

## Notes

- If the sheet is unreachable or empty, the backend automatically falls back
  to `data/products.json`, so a typo in the sheet can't take the whole store
  down.
- Prices in the sheet are the **only** prices ever charged — nothing the
  browser sends is trusted (see `lib/products.js`).
- To go back to fully local/manual management, just clear
  `PRODUCTS_SHEET_CSV_URL` in `.env`.
