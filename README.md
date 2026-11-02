# 📦 StockFlow — Inventory / Stock Management App

A simple, easy-to-use web app to organize your stock by quantity, with **Add Stock** and **Deduct Stock** flows, **bill/invoice image upload with AI (OCR)** to auto-extract product name and quantity, plus a full **GST billing, purchase entry, khata and automobile-shop toolkit**.

## 🔗 Live

| Where | Link |
|---|---|
| **Vercel (production)** | https://stockflow-eight-puce.vercel.app |
| **GitHub repo** | https://github.com/shivansh189/stockflow |

> Works on both mobile and desktop browsers. On a phone, use the browser menu → **Add to Home Screen** to install it as an app.

## Run it

Any static server works. Easiest options:

```bash
# Option 1: Python
python -m http.server 8000
# then open http://localhost:8000/stockflow/

# Option 2: Node
npx serve .
# then open http://localhost:3000/stockflow/
```

The app loads the Tesseract.js OCR engine from a CDN, so an internet connection is required for bill upload.

## Features

### Dashboard & Reports
- Total SKUs, units in stock, stock value, low-stock alerts, recent transactions.
- **Today's Sales** and **This Month's Sales** computed from invoices (cancelled invoices excluded).

### Stock / Inventory Management
- Searchable product list (name / SKU / category / **part number / brand / vehicle compatibility**) with status badges (In Stock / Low / Out) and edit/delete.
- Products support automobile-shop fields: **OEM/company part number**, **brand** (Bosch, MRF, Castrol, Exide…) and **vehicle compatibility**.
- **Add Stock** — two ways:
  - ✏️ **Manual**: pick existing product or create a new one, enter quantity.
  - 📄 **Bill Upload (AI OCR)**: upload a bill/invoice image → Tesseract OCR → parsed product name + quantity (user reviews & confirms before adding).
- **Deduct Stock** — deduct quantity for reasons (Sale, Return, Damage, Loss, Transfer, Other); blocks deductions above available stock; optional specific serial-number deduction.
- **Serial Numbers** — add serial numbers and track status (in stock / sold / damaged / returned).
- **Transactions** — full history of every add/deduct with source (manual / bill / invoice) and note.

### Billing / GST Invoice
- Create GST invoices with multiple line items (product, qty, price, **GST rate 0/5/12/18/28%**, discount per line).
- Automatic subtotal, GST, discount and grand total calculation.
- Saving an invoice (non-cancelled) **auto-deducts stock** and logs transactions (`Sale · <invoice no>`).
- Invoice list with paid / unpaid / cancelled status; **🖨 Print** renders a clean GST bill and opens the browser print dialog.

### Customer & Supplier Records
- Customers: name, phone, GST number, **vehicle registration & model**, and computed **outstanding balance** (invoice totals − payments received).
- Suppliers: name, phone, GST, address, **total purchases** and **amount owed** (purchases − payments made).

### Purchase Entry
- Record goods bought from suppliers: purchase/bill number, date, supplier, multiple line items (product, qty, **unit cost**), optional note.
- Saving a purchase **auto-adds stock** and logs transactions (`Purchase · <purchase no>`).
- Unit costs update each product's **cost price** (weighted average) — the foundation for profit tracking.
- Supplier khata updates automatically: total purchases and outstanding amount owed show on the Suppliers tab.
- Dashboard shows **This Month's Purchases** alongside sales.

### Khata & Payment Tracking
- Record payments (Cash / UPI / Card / Credit) against any customer or supplier, optionally linked to an invoice.
- Paying an invoice marks it **paid** automatically; outstanding balances update live.

## How the bill OCR works

1. User uploads image (JPG/PNG).
2. Tesseract.js (English, LSTM) runs in the browser.
3. Heuristic parsing extracts quantity (`Qty: X`, `Quantity: X`, `X PCS/Units/Nos...`) and product name + unit price from the text.
4. User **verifies and edits** the parsed values in the modal, then confirms → stock is added.

> OCR accuracy depends on bill quality/image. Always review before confirming.

## Data

Data is persisted in the browser's `localStorage` (key `stockflow_db_v1`, per browser) as `{ products, serials, transactions, invoices, parties, payments, purchases }`. Seeded on first run with 6 sample products, a customer, a supplier and one sample invoice, payment and purchase.

## Deploy (free, works on phone + desktop)

The app is a static site, so any static host gives you **one URL that works on mobile and Windows browsers**. Two easy options:

### Vercel (or Netlify)
```bash
npm i -g vercel
vercel login      # opens browser, confirm the login
# If index.html is at the repo root, just:
vercel --prod
```

### GitHub Pages
1. Push the folder to a GitHub repo.
2. Repo **Settings → Pages → Deploy from branch → main → / (root)**.
3. Your app is live at `https://<username>.github.io/<repo>/`.

### PWA (installable on phones)
The app includes a manifest + service worker (`manifest.json`, `sw.js`, icons). After opening the URL on an Android/iPhone browser, tap **Add to Home Screen** — StockFlow opens full-screen like a native app and keeps working offline (data saved on that device). Note: this version stores data in the browser's localStorage, so data **does not sync between devices** — each device keeps its own records.## Roadmap / suggested next features

- Explicit **sales returns** flow linking back to an invoice (restock + credit note).
- **Profit estimates** on the dashboard (cost price is now tracked via purchases — just needs the calc).
- Barcode / QR scanning for fast stock intake and part-number lookup.
- Low-stock email / notification alerts.
- Backend + database sync for multi-device access (e.g., Firebase / Supabase / Postgres).
- Charts (stock value over time, top movers).

---

Built as a plain HTML/CSS/JS static app (no build step).
- `index.html` — structure (includes modals for bill OCR, product, GST invoice, and purchase entry)
- `styles.css` — styling (incl. line-item rows, print styles for invoices)
- `app.js` — logic, state, OCR, invoices, purchases, parties, payments, actions
