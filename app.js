'use strict';

const DB_KEY = 'stockflow_db_v1';
const CURRENCY = '₹';
const LOW_STOCK_DEFAULT = 5;

const state = { products: [], serials: [], transactions: [], invoices: [], parties: [], payments: [], purchases: [] };
let currentPage = 'dashboard';
let cloudLastSync = null;
let cloudPushTimer = null;
let cloudSessionEmail = null;
let cloudAuthEmail = '';
let cloudAuthStage = 'email';
const bill = { file: null, progress: 0, busy: false, parsed: null };

const tesseractLib = window.Tesseract || null;
const createWorker = tesseractLib ? tesseractLib.createWorker.bind(tesseractLib) : null;

let deductProductId = '';
let serialProductId = '';
let manualProductId = '';
let editingProductId = null;
const PAGE_TITLES = {
  dashboard: ['Home', 'Your shop at a glance — tap ＋ for quick actions'],
  stock: ['Stock', 'All your products, quantities and status'],
  add: ['Add Stock', 'Record new stock you received'],
  deduct: ['Deduct Stock', 'Remove sold / damaged / lost quantities'],
  purchases: ['Purchases', 'Stock you bought from suppliers'],
  billing: ['Bills / GST Invoices', 'Invoices you raised — tap a bill to print'],
  serials: ['Serial Numbers', 'Track individual serial numbers'],
  parties: ['Parties & Khata', 'Customers, suppliers, payments and who owes what'],
  transactions: ['Transactions', 'Full history of stock movements'],
  sync: ['☁️ Cloud Save', 'Your account saves everything automatically'],
  more: ['More', 'All tools & features'],
};

/* ---------------- utils ---------------- */
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
const $ = (id) => document.getElementById(id);
function num(v) { const n = parseFloat(v); return isFinite(n) ? n : 0; }
function esc(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtMoney(n) { return CURRENCY + num(n).toFixed(2); }
function confirmDialog(msg, onYes) { if (window.confirm(msg)) onYes(); }
function fmtDate(iso) { const d = new Date(iso); return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

function toast(msg, type) {
  type = type || 'info';
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

function stockStatus(p) {
  const q = p.quantity || 0;
  if (q <= 0) return { label: 'Out of Stock', cls: 'badge-out' };
  if (q <= (p.lowStockThreshold || 0)) return { label: 'Low Stock', cls: 'badge-low' };
  return { label: 'In Stock', cls: 'badge-ok' };
}

function loadState() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      state.products = d.products || [];
      state.serials = d.serials || [];
      state.transactions = d.transactions || [];
      state.invoices = d.invoices || [];
      state.parties = d.parties || [];
      state.payments = d.payments || [];
      state.purchases = d.purchases || [];
      return;
    }
  } catch (e) { /* fall through to seed */ }
  seedState();
  saveState();
}
function saveState() {
  try { localStorage.setItem(DB_KEY, JSON.stringify(state)); } catch (e) {}
  if (window.CloudSync && cloudSessionEmail) {
    if (cloudPushTimer) clearTimeout(cloudPushTimer);
    cloudPushTimer = setTimeout(function () { cloudPushTimer = null; doCloudPush(true); }, 1200);
  }
}

function seedState() {
  state.products = [
    { id: 'p-steel', name: 'Steel Rod 12mm', sku: 'STL-0001', category: 'Raw Material', unitPrice: 85, quantity: 42, lowStockThreshold: 10, createdAt: new Date().toISOString() },
    { id: 'p-copper', name: 'Copper Wire 1.5mm', sku: 'CUW-0002', category: 'Raw Material', unitPrice: 220, quantity: 18, lowStockThreshold: 8, createdAt: new Date().toISOString() },
    { id: 'p-brass', name: 'Brass Nut M8', sku: 'BRN-0044', category: 'Hardware', unitPrice: 12, quantity: 5, lowStockThreshold: 20, createdAt: new Date().toISOString() },
    { id: 'p-pvc', name: 'PVC Pipe 40mm', sku: 'PLS-0099', category: 'Raw Material', unitPrice: 45, quantity: 27, lowStockThreshold: 10, createdAt: new Date().toISOString() },
    { id: 'p-oil', name: 'Engine Oil 15W-40', sku: 'OIL-0007', category: 'Automotive Fluids', unitPrice: 320, quantity: 12, lowStockThreshold: 6, partNumber: 'OEM-OIL-15W40', brand: 'Castrol', vehicleCompatibility: '2 Wheeler / 4 Wheeler', createdAt: new Date().toISOString() },
    { id: 'p-batt', name: 'Bike Battery 12V', sku: 'BAT-0011', category: 'Automotive Electrical', unitPrice: 1450, quantity: 6, lowStockThreshold: 3, partNumber: 'AC-BAT-12V', brand: 'Exide', vehicleCompatibility: '2 Wheeler', createdAt: new Date().toISOString() },
  ];
  state.serials = [
    { id: 's1', productId: 'p-steel', serialNumber: 'SN-2401', status: 'in_stock' },
    { id: 's2', productId: 'p-steel', serialNumber: 'SN-2402', status: 'in_stock' },
    { id: 's3', productId: 'p-steel', serialNumber: 'SN-2403', status: 'sold' },
    { id: 's4', productId: 'p-copper', serialNumber: 'SN-5510', status: 'in_stock' },
    { id: 's5', productId: 'p-copper', serialNumber: 'SN-5511', status: 'in_stock' },
    { id: 's6', productId: 'p-copper', serialNumber: 'SN-5512', status: 'damaged' },
  ];
  state.transactions = [
    { id: 't1', type: 'add', productId: 'p-steel', productName: 'Steel Rod 12mm', quantity: 20, serialNumbers: [], source: 'manual', note: '', date: new Date(Date.now() - 86400000 * 2).toISOString() },
    { id: 't2', type: 'add', productId: 'p-steel', productName: 'Steel Rod 12mm', quantity: 22, serialNumbers: ['SN-2401', 'SN-2402'], source: 'bill', note: 'Bill #INV-1042', date: new Date(Date.now() - 86400000).toISOString() },
    { id: 't3', type: 'deduct', productId: 'p-steel', productName: 'Steel Rod 12mm', quantity: 1, serialNumbers: ['SN-2403'], source: 'manual', note: 'Sale', date: new Date(Date.now() - 3600000 * 5).toISOString() },
  ];
  state.parties = [
    { id: 'c1', type: 'customer', name: 'Ramesh Auto Works', phone: '98765 43210', gst: '27ABCA1234C1Z5', vehicleReg: 'MH12AB1234', vehicleModel: 'Maruti Swift Dzire', address: '12, Industrial Estate, Pune' },
    { id: 's1', type: 'supplier', name: 'ABC Spares Pvt Ltd', phone: '91234 56789', gst: '27AABCU9603R1ZM', address: '45, Warehouse Road, Mumbai' },
  ];
  state.invoices = [
    { id: 'inv1', invoiceNo: 'INV-0001', customerId: 'c1', customerName: 'Ramesh Auto Works', date: new Date(Date.now() - 86400000 * 3).toISOString(), items: [{ productId: 'p-steel', name: 'Steel Rod 12mm', qty: 2, unitPrice: 85, gstRate: 18, discount: 0 }], subtotal: 170, gst: 30.6, discountTotal: 0, total: 200.6, status: 'paid', paymentId: 'pay1' },
  ];
  state.payments = [
    { id: 'pay1', partyType: 'customer', partyId: 'c1', invoiceId: 'inv1', amount: 200.6, method: 'UPI', date: new Date(Date.now() - 86400000 * 2).toISOString(), note: 'Invoice INV-0001' },
  ];
  state.purchases = [
    { id: 'pur1', purchaseNo: 'PUR-0001', supplierId: 's1', supplierName: 'ABC Spares Pvt Ltd', date: new Date(Date.now() - 86400000 * 4).toISOString(), items: [{ productId: 'p-oil', name: 'Engine Oil 15W-40', qty: 4, unitCost: 240 }, { productId: 'p-batt', name: 'Bike Battery 12V', qty: 3, unitCost: 1100 }], total: 4260, note: 'First purchase' },
  ];
}
loadState();

/* ---------------- navigation & render ---------------- */
function setPage(page) {
  currentPage = page;
  const NAV_ACTIVE = { dashboard: 'nav-dashboard', stock: 'nav-stock', billing: 'nav-billing', parties: 'nav-parties', more: 'nav-more' };
  const target = NAV_ACTIVE[page] || 'nav-more';
  document.querySelectorAll('.bn-item').forEach(b => b.classList.toggle('active', b.dataset.action === target));
  const [title, sub] = PAGE_TITLES[page] || PAGE_TITLES.dashboard;
  document.getElementById('page-title').textContent = title;
  document.getElementById('page-sub').textContent = sub;
  window.scrollTo({ top: 0 });
  render();
}

function render() {
  closeQuickSheet();
  const host = document.getElementById('page');
  let html = '';
  switch (currentPage) {
    case 'dashboard': html = renderDashboard(); break;
    case 'stock': html = renderStock(); break;
    case 'add': html = renderAddStock(); break;
    case 'deduct': html = renderDeduct(); break;
    case 'purchases': html = renderPurchases(); break;
    case 'billing': html = renderBilling(); break;
    case 'serials': html = renderSerials(); break;
    case 'parties': html = renderParties(); break;
    case 'transactions': html = renderTransactions(); break;
    case 'sync': html = renderSync(); break;
    case 'more': html = renderMore(); break;
  }
  host.innerHTML = html;
}

/* ---------------- quick-create sheet ---------------- */
function openQuickSheet() { document.getElementById('quick-sheet').removeAttribute('hidden'); }
function closeQuickSheet() { const s = document.getElementById('quick-sheet'); if (s) s.setAttribute('hidden', ''); }

function topbarActions(page) {
  let btn = '';
  if (page === 'stock') btn = `<button class="btn btn-primary" data-action="product-new">✚ New Product</button>`;
  if (page === 'billing') btn = `<button class="btn btn-primary" data-action="goto-invoice">🧾 New Invoice</button>`;
  if (page === 'purchases') btn = `<button class="btn btn-primary" data-action="goto-purchase">📥 New Purchase</button>`;
  return btn;
}
function setTopbarActions(html) { document.getElementById('topbar-actions').innerHTML = html; }

/* ---------------- dashboard ---------------- */
function quickActionsHtml() {
  return `<div class="qa-grid">
    <button class="qa-tile" data-action="goto-invoice"><span class="qa-ic">🧾</span><span>New Invoice</span></button>
    <button class="qa-tile" data-action="goto-purchase"><span class="qa-ic">📥</span><span>New Purchase</span></button>
    <button class="qa-tile" data-action="nav-add"><span class="qa-ic">➕</span><span>Add Stock</span></button>
    <button class="qa-tile" data-action="nav-deduct"><span class="qa-ic">➖</span><span>Deduct Stock</span></button>
    <button class="qa-tile" data-action="party-add"><span class="qa-ic">👥</span><span>Add Party</span></button>
    <button class="qa-tile" data-action="pay-quick"><span class="qa-ic">💳</span><span>Payment</span></button>
  </div>`;
}

function renderDashboard() {
  const totalUnits = state.products.reduce((s, p) => s + (p.quantity || 0), 0);
  const stockValue = state.products.reduce((s, p) => s + (p.quantity || 0) * (p.unitPrice || 0), 0);
  const lowStock = state.products.filter(p => (p.quantity || 0) <= (p.lowStockThreshold || 0));
  const todayStr = new Date().toISOString().slice(0, 10);
  const monthStr = new Date().toISOString().slice(0, 7);
  const validInvoices = state.invoices.filter(i => i.status !== 'cancelled');
  const unpaid = validInvoices.filter(i => i.status === 'unpaid');
  const todaySales = validInvoices.filter(i => (i.date || '').slice(0, 10) === todayStr).reduce((s, i) => s + i.total, 0);
  const monthSales = validInvoices.filter(i => (i.date || '').slice(0, 7) === monthStr).reduce((s, i) => s + i.total, 0);
  const monthPurchases = (state.purchases || []).filter(pu => (pu.date || '').slice(0, 7) === monthStr).reduce((s, pu) => s + (pu.total || 0), 0);

  const h = new Date().getHours();
  const greet = h < 5 ? 'Working late?' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const uname = cloudSessionEmail ? ' <strong>' + esc(cloudSessionEmail.split('@')[0].replace(/[._]/g, ' ')) + '</strong>' : '';

  let html = `<div class="dash-greet"><h2>${greet}${uname}! 👋</h2><p class="muted">What's happening in your shop today</p></div>`;

  html += `<h3 class="section-title">⚡ Quick Actions <span class="muted" style="font-size:12px;font-weight:400">— one tap to start</span></h3>`;
  html += quickActionsHtml();

  html += `<h3 class="section-title" style="margin-top:20px">📊 Today's Numbers</h3>`;
  html += `<div class="stat-mini">
    <div class="card stat-card"><span class="stat-label">Today's Sales</span><span class="stat-value">${fmtMoney(todaySales)}</span></div>
    <div class="card stat-card"><span class="stat-label">This Month's Sales</span><span class="stat-value">${fmtMoney(monthSales)}</span></div>
    <div class="card stat-card"><span class="stat-label">Stock Value</span><span class="stat-value">${fmtMoney(stockValue)}</span><span class="muted" style="font-size:12px">${state.products.length} products · ${totalUnits} units</span></div>
    <div class="card stat-card warn"><span class="stat-label">Needs Attention</span><span class="stat-value">${lowStock.length}</span><span class="muted" style="font-size:12px">low / out of stock · ${unpaid.length} unpaid bills</span></div>
  </div>`;

  html += `<div class="card" style="margin-bottom:16px">
    <h3>🧾 Recent Activity</h3>
    <a class="see-all muted" data-action="nav-transactions">See all →</a>`;
  if (state.transactions.length === 0) {
    html += `<div class="empty">No activity yet — start with ➕ Add Stock above.</div>`;
  } else {
    state.transactions.slice(0, 5).forEach(t => {
      html += `<div class="list-row">
        <div class="grow"><span class="badge ${t.type === 'add' ? 'badge-add' : 'badge-deduct'}">${t.type === 'add' ? '+' : '−'}${t.quantity}</span> <span class="strong">${esc(t.productName)}</span> <span class="muted" style="font-size:12px">via ${esc(t.source)}</span></div>
        <div class="muted" style="font-size:12px;white-space:nowrap">${fmtDate(t.date)}</div>
      </div>`;
    });
  }
  html += `</div>`;

  html += `<div class="card">
    <h3>⚠️ Low Stock <a class="see-all muted" data-action="nav-stock">View stock →</a></h3>`;
  if (lowStock.length === 0) {
    html += `<div class="empty">✅ Everything is well stocked.</div>`;
  } else {
    lowStock.slice(0, 5).forEach(p => {
      const st = stockStatus(p);
      html += `<div class="list-row">
        <div class="grow"><div class="strong">${esc(p.name)}</div><div class="muted" style="font-size:12px">${esc(p.sku || '')}</div></div>
        <div style="text-align:right"><span class="badge ${st.cls}">${st.label}</span><div style="font-weight:700;margin-top:4px">${p.quantity} / ${p.lowStockThreshold}</div></div>
      </div>`;
    });
  }
  html += `</div>`;
  setTopbarActions('');
  return html;
}

/* ---------------- more ---------------- */
function renderMore() {
  const tiles = [
    ['➕', 'Add Stock', 'New items or received quantity', 'nav-add'],
    ['➖', 'Deduct Stock', 'Sales, damages, losses', 'nav-deduct'],
    ['📥', 'Purchases', 'Bills from suppliers', 'nav-purchases'],
    ['🔢', 'Serial Numbers', 'Track units one-by-one', 'nav-serials'],
    ['🧾', 'Transactions', 'Every stock movement', 'nav-transactions'],
    ['☁️', 'Cloud Save', 'Account & sync status', 'nav-sync'],
  ];
  let html = `<div class="tile-grid">`;
  tiles.forEach(([ic, t, d, act]) => {
    html += `<button class="tile" data-action="${act}"><span class="tile-ic">${ic}</span><span class="tile-t">${t}</span><span class="tile-d">${d}</span></button>`;
  });
  html += `</div>`;
  setTopbarActions('');
  return html;
}

/* ---------------- stock ---------------- */
function renderStock() {
  const q = (stockQuery || '').toLowerCase();
  const rows = state.products.filter(p => (p.name || '').toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q) || (p.partNumber || '').toLowerCase().includes(q) || (p.brand || '').toLowerCase().includes(q) || (p.vehicleCompatibility || '').toLowerCase().includes(q));
  let html = `<div class="toolbar">
    <input class="search-input" id="stock-search" placeholder="🔍 Search by name, SKU, brand…" value="${esc(stockQuery || '')}" oninput="stockQuery=this.value; render()" enterkeyhint="search">
    <div class="toolbar-right"><button class="btn btn-primary" data-action="product-new">✚ New Product</button></div>
  </div>`;
  html += `<div class="card table-wrap"><table class="data">`;
  html += `<thead><tr><th>Product</th><th>SKU</th><th>Category</th><th>Unit Price</th><th>In Stock</th><th>Status</th><th style="text-align:right">Actions</th></tr></thead><tbody>`;
  if (rows.length === 0) {
    html += `<tr><td colspan="7"><div class="empty">No products found.</div></td></tr>`;
  }
  rows.forEach(p => {
    const st = stockStatus(p);
    html += `<tr>
      <td><div class="strong">${esc(p.name)}</div></td>
      <td class="mono">${esc(p.sku || '—')}</td>
      <td>${esc(p.category || '—')}</td>
      <td>${fmtMoney(p.unitPrice)}</td>
      <td><span class="strong">${p.quantity}</span></td>
      <td><span class="badge ${st.cls}">${st.label}</span></td>
      <td><div class="row-actions" style="justify-content:flex-end">
        <button class="btn btn-sm" data-action="product-edit" data-id="${p.id}">✏️ Edit</button>
        <button class="btn btn-sm" data-action="goto-deduct" data-id="${p.id}">➖ Deduct</button>
        <button class="btn btn-sm" data-action="goto-serials" data-id="${p.id}">🔢 Serials</button>
        <button class="btn btn-sm btn-danger" data-action="product-delete" data-id="${p.id}">🗑</button>
      </div></td>
    </tr>`;
  });
  html += `</tbody></table></div>`;
  $('page').innerHTML = html;
  setTopbarActions(`<button class="btn btn-primary" data-action="product-new">✚ New Product</button>`);
  return html;
}

/* ---------------- add stock ---------------- */
function renderAddStock() {
  let html = `<div class="tabs">
    <button class="tab ${addTab === 'manual' ? 'active' : ''}" data-action="add-tab" data-tab="manual">✏️ Manual Add</button>
    <button class="tab ${addTab === 'bill' ? 'active' : ''}" data-action="add-tab" data-tab="bill">📄 Bill Upload (AI OCR)</button>
  </div>`;

  if (addTab === 'manual') {
    html += `<form id="manual-add-form" class="card" style="max-width:560px" novalidate>
      <h3>➕ Received stock? Add it here</h3>
      <p class="hint" style="margin:-6px 0 12px">Step 1: pick the item (or create a new one) · Step 2: enter how many units · done</p>
      <div class="field">
        <label>Step 1 · Product *</label>
        <select id="manual-product" onchange="manualProductId=this.value; document.getElementById('manual-new-fields').classList.toggle('hidden', this.value!=='new')">
          <option value="">— Select existing product —</option>
          ${state.products.map(p => `<option value="${p.id}" ${p.id === manualProductId ? 'selected' : ''}>${esc(p.name)} (${p.quantity} in stock)</option>`).join('')}
          <option value="new">✚ Create a brand-new product</option>
        </select>
        <p class="hint">Pick an item you already have, or create a new one</p>
      </div>
      <div id="manual-new-fields" class="hidden">
        <div class="form-grid">
          <div class="field"><label>New Product Name *</label><input id="manual-new-name" type="text" placeholder="e.g. Brake Pad Set"></div>
          <div class="field"><label>SKU / Code</label><input id="manual-new-sku" type="text" placeholder="Auto if empty"></div>
          <div class="field"><label>Category</label><input id="manual-new-category" type="text" placeholder="e.g. Brakes"></div>
          <div class="field"><label>Selling Price ₹</label><input id="manual-new-price" type="number" min="0" step="0.01" placeholder="e.g. 450"></div>
        </div>
      </div>
      <div class="field">
        <label>Step 2 · How many units arrived? *</label>
        <input id="manual-qty" type="number" min="1" step="1" value="1" required inputmode="numeric">
        <p class="hint">Whole number, e.g. 10</p>
      </div>
      <div class="field">
        <label>Note (optional)</label>
        <input id="manual-note" type="text" placeholder="e.g. From ABC Spares, Bill #42">
      </div>
      <button type="submit" class="btn btn-primary btn-lg">➕ Add to Stock</button>
    </form>`;
  } else {
    html += `<div class="card" style="max-width:560px">
      <h3>Upload a Bill / Invoice Image</h3>
      <div class="dropzone" id="bill-dropzone" data-action="bill-dropzone">
        <div class="dz-icon">🖼️</div>
        <div><strong>Click to upload</strong> or drag a bill image here</div>
        <div class="muted" style="font-size:12px;margin-top:6px">JPG / PNG / PDF · Bill should show product name & quantity</div>
      </div>
      <input type="file" id="bill-file" accept="image/*" style="display:none" onchange="billFileSelected(this)">
      <div id="bill-progress-wrap" class="hidden" style="margin-top:14px"><div class="progress"><div id="bill-progress-bar"></div></div><p class="muted" id="bill-progress-text">0%</p></div>
      <p class="muted" id="bill-status" style="margin-bottom:0">No bill uploaded yet.</p>
    </div>`;
  }

  $('page').innerHTML = html;
  setTopbarActions('');
  return html;
}

function renderBillModal() {
  const overlay = document.getElementById('modal-bill');
  overlay.removeAttribute('hidden');
  // populate existing product select
  const sel = document.getElementById('bill-product-select');
  sel.innerHTML = '<option value="">➕ Create a new product</option>' + state.products.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
}

function closeBillModal() { document.getElementById('modal-bill').setAttribute('hidden', ''); bill.parsed = null; bill.file = null; bill.busy = false; bill.progress = 0; }

function billFileSelected(input) { if (input.files && input.files[0]) runBillOCR(input.files[0]); }

async function runBillOCR(file) {
  bill.file = file; bill.progress = 0; bill.busy = true;
  document.getElementById('bill-status').textContent = '⏳ Analyzing bill image…';
  document.getElementById('bill-progress-wrap').classList.remove('hidden');
  document.getElementById('bill-progress-bar').style.width = '0%';
  document.getElementById('bill-progress-text').textContent = '0%';
  document.getElementById('bill-ocr-text').textContent = '';
  document.getElementById('modal-bill').removeAttribute('hidden');
  try {
    const worker = await createWorker('eng', 1, {
      logger: m => { if (m.status === 'recognizing text') { bill.progress = Math.round(m.progress || 0); document.getElementById('bill-progress-bar').style.width = bill.progress + '%'; document.getElementById('bill-progress-text').textContent = bill.progress + '%'; } },
    });
    const { data } = await worker.recognize(file);
    await worker.terminate();
    bill.parsed = parseBillText(data.text || '');
    bill.parsed.rawText = data.text || '';
    openBillModal(bill.parsed);
    document.getElementById('bill-status').textContent = '✅ Analysis complete — please verify and confirm:';
  } catch (err) {
    document.getElementById('bill-status').textContent = '❌ OCR failed: ' + (err && err.message ? err.message : 'unknown error') + ' — you can still enter details manually.';
  }
  bill.busy = false;
}

function openBillModal(parsed) {
  document.getElementById('bill-product-name').value = parsed.productName || '';
  document.getElementById('bill-quantity').value = parsed.quantity || '';
  document.getElementById('bill-unit-price').value = parsed.unitPrice || '';
  document.getElementById('bill-ocr-text').textContent = parsed.rawText || '';
  const sel = document.getElementById('bill-product-select');
  sel.innerHTML = '<option value="">➕ Create a new product</option>' + state.products.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  document.getElementById('bill-status').textContent = '✅ Analysis complete — please verify and confirm:';
}

function parseBillText(text) {
  const cleanLines = text.split(/\r?\n/).map(l => l.replace(/[|*_#]/g, ' ').replace(/\s+/g, ' ').trim()).filter(l => l.length > 1);
  let productName = '';
  let quantity = null;
  let unitPrice = null;
  let qtyLine = '';
  const qtyPatterns = [
    /(?:^|\s)qty\.?\s*[:=]?\s*(\d+(?:\.\d+)?)/i,
    /(?:^|\s)quantity\.?\s*[:=]?\s*(\d+(?:\.\d+)?)/i,
    /(?:^|\s)(\d+(?:\.\d+)?)\s*(?:pcs|pieces|units?|nos|boxes?|packs?|qt|q|qty|units)\b/i,
  ];
  for (const line of cleanLines) {
    let found = null;
    for (const re of qtyPatterns) {
      const m = line.match(re);
      if (m) { found = { value: parseFloat(m[1]), re: re.source }; break; }
    }
    if (found) { quantity = found.value; qtyLine = line; break; }
  }
  // product name: first meaningful line that isn't the qty line
  for (const line of cleanLines) {
    if (line === qtyLine) continue;
    if (/^[₹$]?\s*\d/.test(line) || /(?:date|invoice|bill|no|tel|gst|vat|total|subtotal)/i.test(line)) continue;
    productName = line.replace(/^(?:[A-Z]{2,4}\s*-\s*)?/, '').trim();
    if (productName.length > 2) break;
  }
  productName = productName.replace(/₹|[$]/g, '').replace(/\b(Rs\.?|INR)\b/gi, '').replace(/\s{2,}/g, ' ').trim();
  if (!productName) productName = 'Unknown Product';
  const priceM = (text || '').match(/(?:₹|Rs\.?|INR|\$)\s*(\d+(?:[.,]\d+)?)/);
  if (priceM) unitPrice = parseFloat(priceM[1].replace(/,/g, ''));
  return { productName, quantity, unitPrice, rawText: text || '' };
}

function confirmBillAdd() {
  const name = document.getElementById('bill-product-name').value.trim();
  const qty = parseFloat(document.getElementById('bill-quantity').value);
  const price = parseFloat(document.getElementById('bill-unit-price').value) || 0;
  const productId = document.getElementById('bill-product-select').value;
  if (!name || !isFinite(qty) || qty <= 0) { toast('Please enter a product name and a valid quantity before adding.', 'error'); return; }
  addStockEntry({
    productId: productId && productId !== '' ? productId : null,
    name, sku: '', category: '', unitPrice: price, quantity: qty, source: 'bill', note: 'From bill',
  });
  closeBillModal();
  toast(`✅ Added ${qty} × ${name} from bill.`);
  setPage('transactions');
}

/* ---------------- stock operations ---------------- */
function addStockEntry({ productId, name, sku, category, unitPrice, quantity, source, note, partNumber, brand, vehicleCompatibility }) {
  const qty = num(quantity);
  if (qty <= 0) { toast('Quantity must be greater than 0', 'error'); return { ok: false }; }
  let product = null;
  let isNew = false;
  if (productId) {
    product = state.products.find(p => p.id === productId) || null;
  }
  if (!product) {
    product = {
      id: 'p-' + uid(), name: name || 'Unnamed Product', sku: sku || ('SKU-' + uid().slice(0, 6)).toUpperCase(),
      category: category || '', unitPrice: num(unitPrice), quantity: 0, lowStockThreshold: LOW_STOCK_DEFAULT,
      partNumber: partNumber || '', brand: brand || '', vehicleCompatibility: vehicleCompatibility || '',
      createdAt: new Date().toISOString(),
    };
    state.products.push(product);
    isNew = true;
  }
  product.quantity = (product.quantity || 0) + qty;
  if (name) product.name = name;
  if (category) product.category = category;
  if (num(unitPrice)) product.unitPrice = num(unitPrice);
  state.transactions.unshift({ id: uid(), type: 'add', productId: product.id, productName: product.name, quantity: qty, serialNumbers: [], source: source || 'manual', note: note || '', date: new Date().toISOString() });
  saveState(); render();
  return { ok: true, product, isNew };
}

function deductStockEntry({ productId, quantity, serialNumbers, reason, source }) {
  const product = state.products.find(p => p.id === productId);
  if (!product) { toast('Product not found', 'error'); return { ok: false }; }
  const qty = num(quantity);
  if (qty <= 0) { toast('Enter a valid quantity to deduct', 'error'); return { ok: false }; }
  if ((product.quantity || 0) < qty) { toast(`❌ Insufficient stock. Available: ${product.quantity}`, 'error'); return { ok: false }; }
  product.quantity -= qty;
  const marked = [];
  (serialNumbers || []).forEach(sn => {
    const s = state.serials.find(x => x.productId === productId && x.serialNumber === sn && x.status === 'in_stock');
    if (s) { s.status = 'sold'; marked.push(sn); }
  });
  state.transactions.unshift({ id: uid(), type: 'deduct', productId: product.id, productName: product.name, quantity: qty, serialNumbers: marked, source: source || 'manual', note: reason || '', date: new Date().toISOString() });
  saveState(); render();
  return { ok: true };
}

/* ---------------- serials ---------------- */
function renderSerials() {
  const html = `<div class="card" style="max-width:760px">
    <div class="field" style="max-width:420px">
      <label>Product</label>
      <select id="serial-product" onchange="serialProductId=this.value; renderSerialList()">
        <option value="">— Select product —</option>
        ${state.products.map(p => `<option value="${p.id}" ${p.id === serialProductId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
      </select>
    </div>
    <h3 class="section-title">Serial Numbers</h3>
    <div class="list-row"><div class="grow"><input id="new-serial" type="text" placeholder="e.g. SN-2468" style="max-width:260px"></div><button class="btn btn-success" data-action="serial-add">➕ Add Serial</button></div>
    <div id="serial-list"></div>
  </div>`;
  $('page').innerHTML = html;
  setTopbarActions('');
  renderSerialList();
  return html;
}

function renderSerialList() {
  const host = document.getElementById('serial-list');
  const product = state.products.find(p => p.id === serialProductId);
  if (!product) { host.innerHTML = `<div class="empty">Select a product to view its serial numbers.</div>`; return; }
  const serials = state.serials.filter(s => s.productId === product.id).sort((a, b) => b.serialNumber.localeCompare(a.serialNumber, undefined, { numeric: true }));
  if (serials.length === 0) { host.innerHTML = `<div class="empty">No serial numbers recorded for <strong>${esc(product.name)}</strong> yet.</div>`; return; }
  let html = '';
  serials.forEach(s => {
    const statusCls = s.status === 'in_stock' ? 'badge-ok' : s.status === 'sold' ? 'badge-deduct' : s.status === 'damaged' ? 'badge-low' : 'badge-neutral';
    html += `<div class="serial-item">
      <div><span class="mono strong">${esc(s.serialNumber)}</span> <span class="badge ${statusCls}">${s.status.replace('_', ' ')}</span></div>
      <div class="row-actions">
        ${['in_stock', 'sold', 'damaged', 'returned'].map(st => `<button class="btn btn-sm" data-action="serial-status" data-id="${product.id}" data-serial="${esc(s.serialNumber)}" ${s.status === st ? 'disabled' : ''}>${st.replace('_', ' ')}</button>`).join('')}
      </div>
    </div>`;
  });
  host.innerHTML = html;
}

function addSerialFromForm(el) {
  const product = state.products.find(p => p.id === serialProductId);
  const sn = document.getElementById('new-serial').value.trim();
  if (!product) { toast('Select a product first', 'error'); return; }
  if (!sn) { toast('Enter a serial number', 'error'); return; }
  if (state.serials.some(s => s.productId === product.id && s.serialNumber.toLowerCase() === sn.toLowerCase())) { toast('Serial already exists', 'error'); return; }
  state.serials.push({ id: uid(), productId: product.id, serialNumber: sn, status: 'in_stock' });
  document.getElementById('new-serial').value = '';
  saveState(); render();
  toast(`✅ Serial ${sn} added to ${product.name}`);
}

function setSerialStatus(productId, serialNumber, status) {
  const s = state.serials.find(x => x.productId === productId && x.serialNumber === serialNumber);
  if (s) { s.status = status; saveState(); render(); }
}

/* ---------------- transactions ---------------- */
function renderTransactions() {
  let html = `<div class="card table-wrap"><table class="data">`;
  html += `<thead><tr><th>Date</th><th>Type</th><th>Product</th><th>Quantity</th><th>Source</th><th>Note</th></tr></thead><tbody>`;
  if (state.transactions.length === 0) {
    html += `<tr><td colspan="6"><div class="empty">No transactions yet.</div></td></tr>`;
  }
  state.transactions.forEach(t => {
    html += `<tr>
      <td style="white-space:nowrap">${fmtDate(t.date)}</td>
      <td><span class="badge ${t.type === 'add' ? 'badge-add' : 'badge-deduct'}">${t.type === 'add' ? 'ADD' : 'DEDUCT'}</span></td>
      <td>${esc(t.productName)}</td>
      <td><span class="strong">${t.quantity}</span></td>
      <td>${esc(t.source)}</td>
      <td>${esc(t.note || '—')}</td>
    </tr>`;
  });
  html += `</tbody></table></div>`;
  $('page').innerHTML = html;
  setTopbarActions('');
  return html;
}

/* ---------------- deduct page ---------------- */
function renderDeduct() {
  const product = state.products.find(p => p.id === deductProductId) || null;
  const serials = product ? state.serials.filter(s => s.productId === product.id && s.status === 'in_stock') : [];
  let checklist = '';
  if (product && serials.length > 0) {
    checklist = `<div class="field"><label>Select specific serial numbers to deduct (optional)</label><div style="border:1px solid var(--border);border-radius:8px;padding:8px;max-height:180px;overflow:auto">
      ${serials.map(s => `<label style="display:flex;gap:8px;align-items:center;padding:5px 0;font-weight:400"><input type="checkbox" class="serial-check" data-serial="${s.serialNumber}" value="${s.serialNumber}"> <span class="mono">${esc(s.serialNumber)}</span></label>`).join('')}
    </div></div>`;
  }
  $('page').innerHTML = `<form id="deduct-form" class="card" style="max-width:560px" novalidate>
    <h3>➖ Removing stock? (sale, damage, return…)</h3>
    <div class="field">
      <label>Step 1 · Product *</label>
      <select id="deduct-product" onchange="deductProductId=this.value; render();">
        <option value="">— Select product —</option>
        ${state.products.map(p => `<option value="${p.id}" ${p.id === deductProductId ? 'selected' : ''}>${esc(p.name)} (${p.quantity} in stock)</option>`).join('')}
      </select>
    </div>
    <div id="deduct-product-summary" class="muted" style="margin:-6px 0 12px;font-size:13px"></div>
    <div class="field">
      <label>Step 2 · How many units to remove? *</label>
      <input id="deduct-qty" type="number" min="1" step="1" value="1" required inputmode="numeric">
      <p class="hint">Whole number, e.g. 2</p>
    </div>
    ${checklist}
    <div class="field">
      <label>Step 3 · Why remove? *</label>
      <select id="deduct-reason" required>
        <option value="">— Select reason —</option>
        <option value="Sale">Sold to customer</option>
        <option value="Return">Return to supplier</option>
        <option value="Damage">Damaged</option>
        <option value="Loss">Loss / Theft</option>
        <option value="Transfer">Transfer to another shop</option>
        <option value="Other">Other</option>
      </select>
      <p class="hint">For billing customers use 🧾 Bills instead — invoices deduct stock automatically</p>
    </div>
    <div class="field"><label>Note (optional)</label><input id="deduct-note" type="text" placeholder="e.g. Sold to Ramesh"></div>
    <button type="submit" class="btn btn-danger btn-lg">➖ Deduct from Stock</button>
  </form>`;
  setTopbarActions('');
  renderDeductProducts();
  return $('page').innerHTML;
}

function renderDeductProducts() {
  const summary = document.getElementById('deduct-product-summary');
  const product = state.products.find(p => p.id === deductProductId);
  if (product) summary.textContent = `📦 Current stock of ${product.name}: ${product.quantity} units`;
  else summary.textContent = '';
}

/* ---------------- billing ---------------- */
let billingPartyFilter = '';

function renderBilling() {
  const list = state.invoices.filter(inv => !billingPartyFilter || inv.customerId === billingPartyFilter);
  const fltName = (state.parties.find(p => p.id === billingPartyFilter) || {}).name;
  let html = `<div class="toolbar">
    <div class="muted" style="font-size:13px">${billingPartyFilter ? `Showing bills of <strong>${esc(fltName)}</strong>` : ''}</div>
    <div class="toolbar-right">
      ${billingPartyFilter ? `<button class="btn btn-sm" data-action="billing-clear-filter">✕ Clear filter</button>` : ''}
      <button class="btn btn-primary" data-action="goto-invoice">🧾 New Invoice</button>
    </div></div>`;
  html += `<div class="cards-list">`;
  if (list.length === 0) {
    html += `<div class="card"><div class="empty">No bills yet.<br><button class="btn btn-primary" style="margin-top:12px" data-action="goto-invoice">🧾 Create your first invoice</button></div></div>`;
  }
  list.forEach(inv => {
    const stCls = inv.status === 'paid' ? 'badge-ok' : inv.status === 'unpaid' ? 'badge-low' : 'badge-neutral';
    html += `<div class="card party-card">
      <div class="party-head">
        <div>
          <div class="strong">${esc(inv.customerName)}</div>
          <div class="muted" style="font-size:12px"><span class="mono">${esc(inv.invoiceNo)}</span> · ${inv.items ? inv.items.length : 0} items · ${fmtDate(inv.date)}</div>
        </div>
        <div style="text-align:right">
          <span class="badge ${stCls}">${inv.status}</span>
          <div class="strong" style="margin-top:4px">${fmtMoney(inv.total)}</div>
        </div>
      </div>
      <div class="row-actions" style="margin-top:10px">
        <button class="btn btn-sm" data-action="invoice-view" data-id="${inv.id}">👁 View</button>
        <button class="btn btn-sm" data-action="invoice-print" data-id="${inv.id}">🖨 Print</button>
      </div>
    </div>`;
  });
  html += `</div>`;
  document.getElementById('page').innerHTML = html;
  setTopbarActions(`<button class="btn btn-primary" data-action="goto-invoice">🧾 New Invoice</button>`);
  return html;
}

function printInvoice(id) {
  const inv = state.invoices.find(i => i.id === id);
  if (!inv) return;
  const lines = inv.items || [];
  let html = `<div style="font-family:Arial,sans-serif;padding:20px;color:#000">
    <h2 style="margin:0">StockFlow</h2>
    <div style="margin-bottom:10px">GST Invoice / Bill</div>
    <div style="display:flex;justify-content:space-between">
      <div><strong>Invoice No:</strong> ${esc(inv.invoiceNo)}</div>
      <div><strong>Date:</strong> ${fmtDate(inv.date)}</div>
    </div>
    <div style="margin:12px 0"><strong>Customer:</strong> ${esc(inv.customerName)}</div>
    <table style="width:100%;border-collapse:collapse;margin-top:8px">
      <tr style="background:#eee"><th style="border:1px solid #999;padding:4px">Product</th><th style="border:1px solid #999;padding:4px">Qty</th><th style="border:1px solid #999;padding:4px">Rate</th><th style="border:1px solid #999;padding:4px">GST</th><th style="border:1px solid #999;padding:4px">Amount</th></tr>
      ${lines.map(l => `<tr><td style="border:1px solid #999;padding:4px">${esc(l.name)}</td><td style="border:1px solid #999;padding:4px">${l.qty}</td><td style="border:1px solid #999;padding:4px">${fmtMoney(l.unitPrice)}</td><td style="border:1px solid #999;padding:4px">${l.gstRate}%</td><td style="border:1px solid #999;padding:4px">${fmtMoney(l.qty * l.unitPrice - (l.discount||0))}</td></tr>`).join('')}
    </table>
    <div style="margin-top:10px;text-align:right">
      <div>Subtotal: ${fmtMoney(inv.subtotal)} &nbsp; GST: ${fmtMoney(inv.gst)} &nbsp; Discount: ${fmtMoney(inv.discountTotal)} &nbsp; <strong>Total: ${fmtMoney(inv.total)}</strong></div>
    </div>
    <div style="margin-top:20px">Thank you for your business!</div>
  </div>`;
  document.getElementById('print-area').innerHTML = html;
  document.getElementById('print-area').classList.remove('hidden');
  window.print();
  document.getElementById('print-area').classList.add('hidden');
}

function openInvoiceModal(invoice) {
  editingProductId = invoice ? invoice.id : null;
  document.getElementById('invoice-modal-title').textContent = invoice ? '🧾 ' + invoice.invoiceNo : '🧾 New GST Invoice';
  document.getElementById('inv-no').value = invoice ? invoice.invoiceNo : ('INV-' + (state.invoices.length + 1));
  document.getElementById('inv-date').value = invoice ? (invoice.date || '').slice(0, 10) : new Date().toISOString().slice(0, 10);
  const custSel = document.getElementById('inv-customer');
  custSel.innerHTML = '<option value="">Walk-in Customer</option>' + state.parties.filter(p => p.type === 'customer').map(p => `<option value="${p.id}" ${invoice && invoice.customerId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  document.getElementById('inv-status').value = invoice ? (invoice.status || 'unpaid') : 'unpaid';
  invoiceLines = (invoice && invoice.items && invoice.items.length) ? invoice.items.map(i => ({ productId: i.productId || '', qty: i.qty || 0, unitPrice: i.unitPrice || 0, gstRate: i.gstRate || 18, discount: i.discount || 0 })) : [ { productId: '', qty: 1, unitPrice: 0, gstRate: 18, discount: 0 } ];
  renderInvoiceLines();
  computeInvoiceTotals();
  document.getElementById('modal-invoice').removeAttribute('hidden');
}

function closeInvoiceModal() { document.getElementById('modal-invoice').setAttribute('hidden', ''); editingProductId = null; }

let invoiceLines = [ { productId: '', qty: 1, unitPrice: 0, gstRate: 18, discount: 0 } ];
let partyTab = 'customers';

function addInvoiceLine() { invoiceLines.push({ productId: '', qty: 1, unitPrice: 0, gstRate: 18, discount: 0 }); renderInvoiceLines(); }

function renderInvoiceLines() {
  const host = document.getElementById('invoice-lines');
  host.innerHTML = '';
  invoiceLines.forEach((it, i) => {
    const row = document.createElement('div');
    row.className = 'invoice-line invoice-line-row';
    row.dataset.line = i;
    row.innerHTML = `<select class="line-product"><option value="">Select product…</option>${state.products.map(p => `<option value="${p.id}" ${p.id === it.productId ? 'selected' : ''}>${esc(p.name)}${p.unitPrice ? ' · ' + fmtMoney(p.unitPrice) : ''}</option>`).join('')}</select>
      <input class="line-qty" type="number" min="1" step="1" value="${it.qty || 1}" inputmode="numeric" title="Quantity">
      <input class="line-price" type="number" min="0" step="0.01" value="${it.unitPrice || 0}" inputmode="decimal" title="Rate ₹">
      <select class="line-gst">${[0, 5, 12, 18, 28].map(g => `<option value="${g}" ${(it.gstRate || 18) === g ? 'selected' : ''}>${g}%</option>`).join('')}</select>
      <input class="line-discount" type="number" min="0" step="0.01" value="${it.discount || 0}" inputmode="decimal" title="Discount ₹">
      <div class="line-amt">0.00</div>
      <button type="button" class="btn btn-sm btn-danger line-remove" data-action="invoice-line-remove">✕</button>`;
    host.appendChild(row);
  });
  syncInvoiceLines();
  host.addEventListener('input', onInvoiceLineInput);
  host.addEventListener('change', onInvoiceLineInput);
}

function onInvoiceLineInput(e) {
  const t = e.target;
  const row = t.closest && t.closest('.invoice-line-row');
  if (!row) return;
  syncInvoiceLines();
  if (t.classList && t.classList.contains('line-product')) {
    const i = parseInt(row.dataset.line);
    const p = state.products.find(x => x.id === invoiceLines[i].productId);
    if (p) {
      invoiceLines[i].unitPrice = p.unitPrice || 0;
      const priceEl = row.querySelector('.line-price');
      if (priceEl) priceEl.value = invoiceLines[i].unitPrice.toFixed(2);
      toast('Price auto-filled: ' + p.name + ' @ ' + fmtMoney(p.unitPrice || 0), 'info');
    }
  }
  computeInvoiceTotals();
}

function syncInvoiceLines() {
  const rows = document.querySelectorAll('#invoice-lines .invoice-line-row');
  rows.forEach(row => {
    const i = parseInt(row.dataset.line);
    const l = invoiceLines[i];
    if (!l) return;
    l.productId = row.querySelector('.line-product').value;
    l.qty = num(row.querySelector('.line-qty').value);
    l.unitPrice = num(row.querySelector('.line-price').value);
    l.gstRate = num(row.querySelector('.line-gst').value);
    l.discount = num(row.querySelector('.line-discount').value);
  });
}

function computeInvoiceTotals() {
  const amtEls = document.querySelectorAll('#invoice-lines .line-amt');
  let subtotal = 0, gst = 0, discountTotal = 0;
  invoiceLines.forEach((l, i) => {
    const lt = (num(l.qty) * num(l.unitPrice)) - num(l.discount);
    subtotal += lt; discountTotal += num(l.discount); gst += lt * num(l.gstRate) / 100;
    if (amtEls[i]) amtEls[i].textContent = lt.toFixed(2);
  });
  const total = subtotal + gst;
  document.getElementById('inv-subtotal').value = subtotal.toFixed(2);
  document.getElementById('inv-gst').value = gst.toFixed(2);
  document.getElementById('inv-discount').value = discountTotal.toFixed(2);
  document.getElementById('inv-total').value = total.toFixed(2);
  return { subtotal, gst, discountTotal, total };
}

function handleInvoiceSave(e) {
  e.preventDefault();
  const lines = invoiceLines.map(l => ({ productId: l.productId, qty: num(l.qty), unitPrice: num(l.unitPrice), gstRate: num(l.gstRate), discount: num(l.discount) })).filter(l => l.productId);
  if (lines.length === 0) { toast('Add at least one line item to the invoice', 'error'); return; }
  const { subtotal, gst, discountTotal, total } = computeInvoiceTotals();
  const customer = state.parties.find(p => p.id === (document.getElementById('inv-customer').value || '')) || null;
  const invoice = {
    id: editingProductId || 'inv-' + uid(),
    invoiceNo: document.getElementById('inv-no').value.trim() || ('INV-' + (state.invoices.length + 1)),
    customerId: customer ? customer.id : null,
    customerName: customer ? customer.name : 'Walk-in Customer',
    date: new Date(document.getElementById('inv-date').value || new Date().toISOString().slice(0, 10)).toISOString(),
    items: lines.map(l => ({ productId: l.productId, name: (state.products.find(p => p.id === l.productId) || {}).name || 'Item', qty: l.qty, unitPrice: l.unitPrice, gstRate: l.gstRate, discount: l.discount })),
    subtotal, gst, discountTotal, total,
    status: document.getElementById('inv-status').value || 'unpaid',
  };
  state.invoices.unshift(invoice);
  if (invoice.status !== 'cancelled') {
    lines.forEach(l => {
      const p = state.products.find(x => x.id === l.productId);
      if (p && l.qty > 0) {
        p.quantity -= l.qty;
        state.transactions.unshift({ id: uid(), type: 'deduct', productId: p.id, productName: p.name, quantity: l.qty, serialNumbers: [], source: 'invoice', note: `Sale · ${invoice.invoiceNo}`, date: new Date().toISOString() });
      }
    });
  }
  saveState(); render(); closeInvoiceModal();
  toast(`✅ Invoice ${invoice.invoiceNo} saved. Stock deducted for ${lines.length} item(s).`);
}

/* ---------------- purchases (purchase entry) ---------------- */
function renderPurchases() {
  let html = `<div class="toolbar"><div></div><div class="toolbar-right"><button class="btn btn-primary" data-action="goto-purchase">📥 New Purchase Entry</button></div></div>`;
  html += `<div class="card table-wrap"><table class="data">`;
  html += `<thead><tr><th>Purchase</th><th>Date</th><th>Supplier</th><th>Items</th><th>Total Cost</th><th>Note</th></tr></thead><tbody>`;
  if ((state.purchases || []).length === 0) { html += `<tr><td colspan="6"><div class="empty">No purchases recorded yet. Record goods bought from a supplier to add stock automatically.</div></td></tr>`; }
  (state.purchases || []).forEach(pu => {
    html += `<tr>
      <td class="mono">${esc(pu.purchaseNo)}</td>
      <td style="white-space:nowrap">${fmtDate(pu.date)}</td>
      <td>${esc(pu.supplierName)}</td>
      <td>${pu.items ? pu.items.length : 0}</td>
      <td><span class="strong">${fmtMoney(pu.total)}</span></td>
      <td>${esc(pu.note || '—')}</td>
    </tr>`;
  });
  html += `</tbody></table></div>`;
  document.getElementById('page').innerHTML = html;
  setTopbarActions('');
  return html;
}

let purchaseLines = [ { productId: '', qty: 1, unitCost: 0 } ];

function openPurchaseModal() {
  document.getElementById('purchase-modal-title').textContent = '📥 New Purchase Entry';
  document.getElementById('pur-no').value = 'PUR-' + ((state.purchases || []).length + 1);
  document.getElementById('pur-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('pur-note').value = '';
  const sel = document.getElementById('pur-supplier');
  sel.innerHTML = '<option value="">— Select supplier —</option>' + state.parties.filter(p => p.type === 'supplier').map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  purchaseLines = [ { productId: '', qty: 1, unitCost: 0 } ];
  renderPurchaseLines();
  computePurchaseTotals();
  document.getElementById('modal-purchase').removeAttribute('hidden');
}

function closePurchaseModal() { document.getElementById('modal-purchase').setAttribute('hidden', ''); }

function renderPurchaseLines() {
  const host = document.getElementById('purchase-lines');
  host.innerHTML = '';
  purchaseLines.forEach((it, i) => {
    const row = document.createElement('div');
    row.className = 'purchase-line-row';
    row.dataset.line = i;
    row.innerHTML = `<select class="p-line-product"><option value="">Select product…</option>${state.products.map(p => `<option value="${p.id}" ${p.id === it.productId ? 'selected' : ''}>${esc(p.name)}${p.unitPrice ? ' · buy ~' + fmtMoney(p.costPrice || p.unitPrice) : ''}</option>`).join('')}</select>
      <input class="p-line-qty" type="number" min="1" step="1" value="${it.qty || 1}" inputmode="numeric" title="Quantity">
      <input class="p-line-cost" type="number" min="0" step="0.01" value="${it.unitCost || 0}" inputmode="decimal" title="Cost ₹">
      <div class="line-amt">0.00</div>
      <button type="button" class="btn btn-sm btn-danger" data-action="purchase-line-remove">✕</button>`;
    host.appendChild(row);
  });
  syncPurchaseLines();
  host.addEventListener('input', onPurchaseLineInput);
  host.addEventListener('change', onPurchaseLineInput);
}

function onPurchaseLineInput(e) {
  const t = e.target;
  const row = t.closest && t.closest('.purchase-line-row');
  if (!row) return;
  syncPurchaseLines();
  if (t.classList && t.classList.contains('p-line-product')) {
    const i = parseInt(row.dataset.line);
    const p = state.products.find(x => x.id === purchaseLines[i].productId);
    if (p) {
      purchaseLines[i].unitCost = num(p.costPrice) || p.unitPrice || 0;
      const costEl = row.querySelector('.p-line-cost');
      if (costEl) costEl.value = purchaseLines[i].unitCost.toFixed(2);
      toast('Cost auto-filled from last purchase', 'info');
    }
  }
  computePurchaseTotals();
}

function syncPurchaseLines() {
  const rows = document.querySelectorAll('#purchase-lines .purchase-line-row');
  rows.forEach(row => {
    const i = parseInt(row.dataset.line);
    const l = purchaseLines[i];
    if (!l) return;
    l.productId = row.querySelector('.p-line-product').value;
    l.qty = num(row.querySelector('.p-line-qty').value);
    l.unitCost = num(row.querySelector('.p-line-cost').value);
  });
}

function computePurchaseTotals() {
  let total = 0;
  const amtEls = document.querySelectorAll('#purchase-lines .line-amt');
  purchaseLines.forEach((l, i) => {
    const lt = num(l.qty) * num(l.unitCost);
    total += lt;
    if (amtEls[i]) amtEls[i].textContent = lt.toFixed(2);
  });
  const t = document.getElementById('pur-total');
  if (t) t.value = total.toFixed(2);
  return { total };
}

function handlePurchaseSave(e) {
  e.preventDefault();
  const supplier = state.parties.find(p => p.id === document.getElementById('pur-supplier').value) || null;
  if (!supplier) { toast('Select a supplier for this purchase', 'error'); return; }
  const lines = purchaseLines.map(l => ({ productId: l.productId, qty: num(l.qty), unitCost: num(l.unitCost) })).filter(l => l.productId && l.qty > 0);
  if (lines.length === 0) { toast('Add at least one line item to the purchase', 'error'); return; }
  const total = lines.reduce((s, l) => s + l.qty * l.unitCost, 0);
  const purchase = {
    id: 'pur-' + uid(),
    purchaseNo: document.getElementById('pur-no').value.trim() || ('PUR-' + ((state.purchases || []).length + 1)),
    supplierId: supplier.id,
    supplierName: supplier.name,
    date: new Date(document.getElementById('pur-date').value || new Date().toISOString().slice(0, 10)).toISOString(),
    items: lines.map(l => ({ productId: l.productId, name: (state.products.find(p => p.id === l.productId) || {}).name || 'Item', qty: l.qty, unitCost: l.unitCost })),
    total,
    note: document.getElementById('pur-note').value.trim(),
  };
  state.purchases.unshift(purchase);
  lines.forEach(l => {
    const p = state.products.find(x => x.id === l.productId);
    if (p) {
      const oldQty = Math.max(0, p.quantity || 0);
      const oldCost = num(p.costPrice) || num(p.unitPrice) || l.unitCost;
      p.costPrice = (oldQty + l.qty) > 0 ? ((oldQty * oldCost + l.qty * l.unitCost) / (oldQty + l.qty)) : l.unitCost;
      p.quantity = (p.quantity || 0) + l.qty;
      state.transactions.unshift({ id: uid(), type: 'add', productId: p.id, productName: p.name, quantity: l.qty, serialNumbers: [], source: 'purchase', note: `Purchase · ${purchase.purchaseNo}`, date: new Date().toISOString() });
    }
  });
  saveState(); render(); closePurchaseModal();
  toast(`✅ Purchase ${purchase.purchaseNo} saved (${fmtMoney(total)}). Stock added for ${lines.length} item(s).`);
}

/* ---------------- parties & payments ---------------- */
function partyOutstanding(type, id) {
  if (type === 'customer') {
    const invTotal = state.invoices.filter(i => i.customerId === id && i.status !== 'cancelled').reduce((s, i) => s + i.total, 0);
    const paid = state.payments.filter(p => p.partyType === 'customer' && p.partyId === id).reduce((s, p) => s + p.amount, 0);
    return invTotal - paid;
  }
  const purchTotal = (state.purchases || []).filter(pu => pu.supplierId === id).reduce((s, pu) => s + (pu.total || 0), 0);
  const paid = state.payments.filter(p => p.partyType === 'supplier' && p.partyId === id).reduce((s, p) => s + (p.amount || 0), 0);
  return purchTotal - paid;
}

function renderParties() {
  const tab = partyTab;
  let html = `<div class="tabs">
    <button class="tab ${tab === 'customers' ? 'active' : ''}" data-action="party-tab" data-tab="customers">👥 Customers</button>
    <button class="tab ${tab === 'suppliers' ? 'active' : ''}" data-action="party-tab" data-tab="suppliers">🏭 Suppliers</button>
    <button class="tab ${tab === 'payments' ? 'active' : ''}" data-action="party-tab" data-tab="payments">💳 Khata</button>
  </div>`;
  if (tab === 'customers' || tab === 'suppliers') {
    const customers = tab === 'customers';
    const list = state.parties.filter(p => p.type === tab);
    html += `<div class="toolbar"><div class="muted" style="font-size:13px">${customers ? 'People you bill' : 'People you buy from'} · ${list.length}</div>
      <div class="toolbar-right"><button class="btn btn-primary" data-action="party-add" data-type="${tab}">✚ Add ${customers ? 'Customer' : 'Supplier'}</button></div></div>`;
    if (list.length === 0) {
      html += `<div class="card"><div class="empty">No ${tab} yet.<br><button class="btn btn-primary" style="margin-top:12px" data-action="party-add" data-type="${tab}">✚ Add your first ${customers ? 'customer' : 'supplier'}</button></div></div>`;
    } else {
      html += `<div class="cards-list">`;
      list.forEach(c => {
        const outstanding = partyOutstanding(tab, c.id);
        const oweCls = outstanding > 0.005 ? 'badge-low' : 'badge-ok';
        const oweTxt = customers ? (outstanding > 0.005 ? 'owes you ' : 'all settled ') : (outstanding > 0.005 ? 'you owe ' : 'all settled ');
        html += `<div class="card party-card">
          <div class="party-head">
            <div>
              <div class="strong">${esc(c.name)}</div>
              <div class="muted" style="font-size:12px">${esc(c.phone || '')}${c.phone && c.gst ? ' · ' : ''}${esc(c.gst || '')}</div>
              ${c.vehicleReg ? `<div class="muted" style="font-size:12px">🚗 ${esc(c.vehicleReg)} ${esc(c.vehicleModel || '')}</div>` : ''}
            </div>
            <div style="text-align:right">
              <span class="badge ${oweCls}">${oweTxt}${fmtMoney(Math.abs(outstanding))}</span>
            </div>
          </div>
          <div class="row-actions" style="margin-top:10px">
            <button class="btn btn-sm" data-action="party-edit" data-id="${c.id}">✏️ Edit</button>
            <button class="btn btn-sm" data-action="pay-for" data-id="${c.id}">💳 ${customers ? 'Receive' : 'Pay'}</button>
            <button class="btn btn-sm" data-action="party-invoices" data-id="${c.id}">🧾 Bills</button>
            <button class="btn btn-sm btn-danger" data-action="party-delete" data-id="${c.id}">🗑</button>
          </div>
        </div>`;
      });
      html += `</div>`;
    }
  } else {
    html += `<form id="payment-form" class="card" style="max-width:640px;margin-bottom:16px">
      <h3>💳 Record Payment / Khata Entry</h3>
      <div class="form-grid">
        <div class="field">
          <label>Party Type *</label>
          <select id="pay-party-type" onchange="updatePayParties()">
            <option value="customer">Customer (they pay me)</option>
            <option value="supplier">Supplier (I pay them)</option>
          </select>
        </div>
        <div class="field">
          <label>Party *</label>
          <select id="pay-party" onchange="updatePayOutstanding()"></select>
        </div>
        <div class="field">
          <label>Against Invoice (optional)</label>
          <select id="pay-invoice"></select>
          <p class="hint">Pick a bill to mark it paid</p>
        </div>
        <div class="field">
          <label>Amount ₹ *</label>
          <input id="pay-amount" type="number" min="0.01" step="0.01" value="0" required inputmode="decimal">
          <p class="hint" id="pay-outstanding"></p>
        </div>
        <div class="field">
          <label>Payment Method</label>
          <select id="pay-method"><option value="Cash">Cash</option><option value="UPI">UPI</option><option value="Card">Card</option><option value="Credit">Credit / Udhaar</option></select>
        </div>
        <div class="field">
          <label>Note (optional)</label>
          <input id="pay-note" type="text" placeholder="e.g. Half payment for INV-0003">
        </div>
      </div>
      <button type="submit" class="btn btn-primary btn-lg">💳 Save Payment</button>
    </form>
    <div class="card table-wrap"><table class="data"><thead><tr><th>Date</th><th>Party</th><th>Invoice</th><th>Amount</th><th>Method</th><th>Note</th></tr></thead><tbody>`;
    if (state.payments.length === 0) html += `<tr><td colspan="6"><div class="empty">No payments recorded yet.</div></td></tr>`;
    state.payments.forEach(p => {
      const party = state.parties.find(x => x.id === p.partyId);
      const inv = state.invoices.find(x => x.id === p.invoiceId);
      html += `<tr><td style="white-space:nowrap">${fmtDate(p.date)}</td><td>${esc(party ? party.name : p.partyId)}</td><td class="mono">${esc(inv ? inv.invoiceNo : '—')}</td><td><span class="strong">${fmtMoney(p.amount)}</span></td><td>${esc(p.method)}</td><td>${esc(p.note || '—')}</td></tr>`;
    });
    html += `</tbody></table></div>`;
  }
  document.getElementById('page').innerHTML = html;
  setTopbarActions('');
  if (tab === 'payments') { renderPaymentForm(); }
  return html;
}

function renderPaymentForm() {
  updatePayParties();
  const invSel = document.getElementById('pay-invoice');
  invSel.innerHTML = '<option value="">— No invoice —</option>' + state.invoices.filter(i => i.status !== 'cancelled').map(i => `<option value="${i.id}">${esc(i.invoiceNo)} · ${esc(i.customerName)}</option>`).join('');
}

function updatePayParties() {
  const sel = document.getElementById('pay-party');
  if (!sel) return;
  const type = document.getElementById('pay-party-type').value;
  const list = state.parties.filter(p => p.type === type);
  sel.innerHTML = `<option value="">— Select ${type} —</option>` + list.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  updatePayOutstanding();
}

function updatePayOutstanding() {
  const host = document.getElementById('pay-outstanding');
  if (!host) return;
  const id = document.getElementById('pay-party').value;
  const party = state.parties.find(x => x.id === id);
  if (!party) { host.textContent = 'Pick a party to see their balance'; return; }
  const type = party.type;
  const outstanding = partyOutstanding(type, party.id);
  host.textContent = type === 'customer'
    ? (outstanding > 0.005 ? `Current khata: ${party.name} owes you ${fmtMoney(outstanding)}` : `${party.name} has no dues`)
    : (outstanding > 0.005 ? `Current khata: you owe ${party.name} ${fmtMoney(outstanding)}` : `No dues to ${party.name}`);
}

function handlePaymentSave(e) {
  e.preventDefault();
  const payment = { id: uid(), partyType: document.getElementById('pay-party-type').value, partyId: document.getElementById('pay-party').value, invoiceId: document.getElementById('pay-invoice').value || null, amount: num(document.getElementById('pay-amount').value), method: document.getElementById('pay-method').value, date: new Date().toISOString(), note: document.getElementById('pay-note').value.trim() };
  if (!payment.partyId || !(payment.amount > 0)) { toast('Select a party and enter a valid amount', 'error'); return; }
  state.payments.unshift(payment);
  if (payment.invoiceId) { const inv = state.invoices.find(i => i.id === payment.invoiceId); if (inv) inv.status = 'paid'; }
  saveState(); render(); toast(`✅ Payment of ${fmtMoney(payment.amount)} recorded via ${payment.method}.`);
}

/* ---------------- product modal ---------------- */
function openProductModal(product) {
  editingProductId = product ? product.id : null;
  document.getElementById('product-modal-title').textContent = product ? '✏️ Edit Product' : '✚ New Product';
  document.getElementById('pm-name').value = product ? product.name : '';
  document.getElementById('pm-sku').value = product ? product.sku : '';
  document.getElementById('pm-category').value = product ? product.category : '';
  document.getElementById('pm-price').value = product ? product.unitPrice : '';
  document.getElementById('pm-threshold').value = product ? (product.lowStockThreshold ?? 5) : 5;
  document.getElementById('pm-qty').value = product ? product.quantity : 0;
  document.getElementById('pm-qty-wrap').classList.toggle('hidden', !!product);
  const setOptional = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
  setOptional('pm-part', product ? product.partNumber : '');
  setOptional('pm-brand', product ? product.brand : '');
  setOptional('pm-vehicle', product ? product.vehicleCompatibility : '');
  document.getElementById('modal-product').removeAttribute('hidden');
  setTimeout(function () { document.getElementById('pm-name').focus(); }, 50);
}

function closeProductModal() { document.getElementById('modal-product').setAttribute('hidden', ''); editingProductId = null; }

function deleteProduct(id) {
  const p = state.products.find(x => x.id === id);
  if (!p) return;
  if (!confirm(`Delete product "${p.name}" and its stock?`)) return;
  state.products = state.products.filter(x => x.id !== id);
  state.serials = state.serials.filter(s => s.productId !== id);
  saveState(); render();
  toast('Product deleted');
}

function handleProductSave(e) {
  e.preventDefault();
  const name = document.getElementById('pm-name').value.trim();
  if (!name) { toast('Product name is required', 'error'); document.getElementById('pm-name').focus(); return; }
  const sku = document.getElementById('pm-sku').value.trim();
  const category = document.getElementById('pm-category').value.trim();
  const unitPrice = num(document.getElementById('pm-price').value);
  const threshold = Math.max(0, num(document.getElementById('pm-threshold').value));
  const qty = num(document.getElementById('pm-qty').value);
  const part = (document.getElementById('pm-part') || {}).value ? document.getElementById('pm-part').value.trim() : '';
  const brand = (document.getElementById('pm-brand') || {}).value ? document.getElementById('pm-brand').value.trim() : '';
  const vehicle = (document.getElementById('pm-vehicle') || {}).value ? document.getElementById('pm-vehicle').value.trim() : '';
  if (editingProductId) {
    const p = state.products.find(x => x.id === editingProductId);
    if (p) { p.name = name; p.sku = sku; p.category = category; p.unitPrice = unitPrice; p.lowStockThreshold = threshold; p.quantity = qty; p.partNumber = part; p.brand = brand; p.vehicleCompatibility = vehicle; }
    saveState(); render(); closeProductModal(); toast('✅ Product updated');
  } else {
    addStockEntry({ productId: null, name, sku, category, unitPrice, quantity: qty, source: 'manual', note: 'Product created', partNumber: part, brand: brand, vehicleCompatibility: vehicle });
    closeProductModal(); toast('✅ Product added — view it in 📦 Stock');
  }
}

/* ---------------- party modal ---------------- */
let editingPartyId = null;

function openPartyModal(party, type) {
  editingPartyId = party ? party.id : null;
  document.getElementById('party-modal-title').textContent = party ? '✏️ Edit ' + (party.type === 'customer' ? 'Customer' : 'Supplier') : '✚ Add ' + (type === 'supplier' ? 'Supplier' : 'Customer');
  document.getElementById('party-type').value = party ? party.type : (type || 'customer');
  document.getElementById('party-name').value = party ? party.name : '';
  document.getElementById('party-phone').value = party ? (party.phone || '') : '';
  document.getElementById('party-gst').value = party ? (party.gst || '') : '';
  document.getElementById('party-vehreg').value = party ? (party.vehicleReg || '') : '';
  document.getElementById('party-vehmodel').value = party ? (party.vehicleModel || '') : '';
  document.getElementById('party-address').value = party ? (party.address || '') : '';
  document.getElementById('modal-party').removeAttribute('hidden');
  setTimeout(function () { document.getElementById('party-name').focus(); }, 50);
}

function closePartyModal() { document.getElementById('modal-party').setAttribute('hidden', ''); editingPartyId = null; }

function handlePartySave(e) {
  e.preventDefault();
  const name = document.getElementById('party-name').value.trim();
  if (!name) { toast('Enter the party name', 'error'); return; }
  const data = {
    type: document.getElementById('party-type').value,
    name: name,
    phone: document.getElementById('party-phone').value.trim(),
    gst: document.getElementById('party-gst').value.trim().toUpperCase(),
    vehicleReg: document.getElementById('party-vehreg').value.trim().toUpperCase(),
    vehicleModel: document.getElementById('party-vehmodel').value.trim(),
    address: document.getElementById('party-address').value.trim(),
  };
  if (editingPartyId) {
    const p = state.parties.find(x => x.id === editingPartyId);
    if (p) Object.assign(p, data);
    toast('✅ ' + name + ' updated');
  } else {
    state.parties.push(Object.assign({ id: uid() }, data));
    toast('✅ ' + name + ' added to ' + (data.type === 'customer' ? 'customers' : 'suppliers'));
  }
  saveState(); closePartyModal(); render();
}

function deleteParty(id) {
  const p = state.parties.find(x => x.id === id);
  if (!p) return;
  if (!confirm(`Delete "${p.name}"? Their bills & payments stay, but the party record goes.`)) return;
  state.parties = state.parties.filter(x => x.id !== id);
  saveState(); render(); toast('Party deleted');
}

function openPaymentFor(partyId) {
  const party = state.parties.find(x => x.id === partyId);
  if (!party) return;
  partyTab = 'payments';
  setPage('parties');
  setTimeout(function () {
    const typeSel = document.getElementById('pay-party-type');
    if (!typeSel) return;
    typeSel.value = party.type;
    updatePayParties();
    document.getElementById('pay-party').value = party.id;
    updatePayOutstanding();
    const amt = document.getElementById('pay-amount');
    amt.value = Math.max(0, partyOutstanding(party.type, party.id)).toFixed(2);
    amt.focus();
    toast(party.type === 'customer' ? `Receiving from ${party.name}` : `Paying ${party.name}`);
  }, 60);
}

/* ---------------- event handlers ---------------- */
function handleAction(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  if (el.classList && el.classList.contains('qa-tile')) closeQuickSheet();
  const action = el.dataset.action;
  switch (action) {
    case 'nav-dashboard': setPage('dashboard'); return;
    case 'nav-stock': setPage('stock'); return;
    case 'nav-add': setPage('add'); return;
    case 'nav-deduct': setPage('deduct'); return;
    case 'nav-purchases': setPage('purchases'); return;
    case 'nav-billing': setPage('billing'); return;
    case 'nav-parties': setPage('parties'); return;
    case 'nav-serials': setPage('serials'); return;
    case 'nav-transactions': setPage('transactions'); return;
    case 'nav-sync': setPage('sync'); return;
    case 'nav-more': setPage('more'); return;
    case 'open-quick': openQuickSheet(); return;
    case 'close-quick': closeQuickSheet(); return;
    case 'pay-quick': partyTab = 'payments'; setPage('parties'); return;
    case 'login-google': loginGoogle(); return;
    case 'gate-verify': gateVerify(); return;
    case 'nav-cancel': closeBillModal(); closeProductModal(); closeInvoiceModal(); closePurchaseModal(); closePartyModal(); return;
    case 'party-tab': partyTab = el.dataset.tab; renderParties(); return;
    case 'party-add': openPartyModal(null, el.dataset.type); return;
    case 'party-edit': openPartyModal(state.parties.find(p => p.id === el.dataset.id) || null); return;
    case 'party-delete': deleteParty(el.dataset.id); return;
    case 'party-invoices': billingPartyFilter = el.dataset.id; setPage('billing'); return;
    case 'billing-clear-filter': billingPartyFilter = ''; renderBilling(); return;
    case 'pay-for': openPaymentFor(el.dataset.id); return;
    case 'product-new': openProductModal(null); return;
    case 'goto-add': setPage('add'); return;
    case 'goto-deduct': if (el.dataset.id) deductProductId = el.dataset.id; setPage('deduct'); return;
    case 'goto-invoice': openInvoiceModal(null); return;
    case 'goto-purchase': openPurchaseModal(); return;
    case 'goto-serials': if (el.dataset.id) serialProductId = el.dataset.id; setPage('serials'); return;
    case 'goto-stock': setPage('stock'); return;
    case 'product-edit': openProductModal(state.products.find(p => p.id === el.dataset.id) || null); return;
    case 'product-delete': deleteProduct(el.dataset.id); return;
    case 'invoice-view': openInvoiceModal(state.invoices.find(i => i.id === el.dataset.id) || null); return;
    case 'invoice-print': printInvoice(el.dataset.id); return;
    case 'invoice-add-line': addInvoiceLine(); computeInvoiceTotals(); return;
    case 'invoice-line-remove': { const row = el.closest('.invoice-line-row'); if (row) { const idx = parseInt(row.dataset.line); if (!isNaN(idx)) invoiceLines.splice(idx, 1); if (invoiceLines.length === 0) invoiceLines.push({ productId: '', qty: 1, unitPrice: 0, gstRate: 18, discount: 0 }); renderInvoiceLines(); computeInvoiceTotals(); } return; }
    case 'purchase-add-line': purchaseLines.push({ productId: '', qty: 1, unitCost: 0 }); renderPurchaseLines(); computePurchaseTotals(); return;
    case 'cloud-sync-now': doCloudPull().then(function () { renderSync(); }); return;
    case 'cloud-edit-email': cloudAuthStage = 'email'; renderSync(); return;
    case 'cloud-signout': {
      confirmDialog('Log out of cloud sync on this device? This device will stop syncing until you log in again (local data stays).', function () {
        CloudSync.signOut().then(function () { cloudSessionEmail = null; renderSync(); updateCloudBadge({ ok: false, reason: 'signed-out' }); toast('🚪 Logged out (local data kept)'); });
      });
      return;
    }
    case 'purchase-line-remove': { const row = el.closest('.purchase-line-row'); if (row) { const idx = parseInt(row.dataset.line); if (!isNaN(idx)) purchaseLines.splice(idx, 1); if (purchaseLines.length === 0) purchaseLines.push({ productId: '', qty: 1, unitCost: 0 }); renderPurchaseLines(); computePurchaseTotals(); } return; }
    case 'add-tab': addTab = el.dataset.tab; renderAddStock(); return;
    case 'bill-dropzone': document.getElementById('bill-file').click(); return;
    case 'bill-add': confirmBillAdd(); return;
    case 'manual-add-submit': document.getElementById('manual-add-form').requestSubmit(); return;
    case 'deduct-submit': document.getElementById('deduct-form').requestSubmit(); return;
    case 'serial-add': addSerialFromForm(el); return;
  }
}

function handleChange(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  switch (el.dataset.action) {
    case 'deduct-product': deductProductId = el.value; render(); return;
    case 'serial-product': serialProductId = el.value; renderSerialList(); return;
    case 'manual-product': manualProductId = el.value; return;  }
}

function handleSubmit(e) {
  const form = e.target;
  if (form.id === 'gate-email-form') { e.preventDefault(); gateEmailSubmit(e); return; }
  if (form.id === 'product-form') { e.preventDefault(); handleProductSave(e); return; }
  if (form.id === 'invoice-form') { e.preventDefault(); handleInvoiceSave(e); return; }
  if (form.id === 'purchase-form') { e.preventDefault(); handlePurchaseSave(e); return; }
  if (form.id === 'cloud-email-form') { e.preventDefault(); handleCloudEmailSubmit(e); return; }
  if (form.id === 'cloud-code-form') { e.preventDefault(); handleCloudCodeSubmit(e); return; }
  if (form.id === 'payment-form') { e.preventDefault(); handlePaymentSave(e); return; }
  if (form.id === 'party-form') { e.preventDefault(); handlePartySave(e); return; }
  if (form.id === 'manual-add-form') { e.preventDefault(); handleManualAdd(e); return; }
  if (form.id === 'deduct-form') { e.preventDefault(); handleDeduct(e); return; }
}

function handleManualAdd(e) {
  e.preventDefault();
  const productId = manualProductId;
  if (!productId) { toast('👇 First pick a product — or choose "Create a brand-new product"', 'error'); return; }
  let qty = num(document.getElementById('manual-qty').value);
  let name = '', sku = '', category = '', unitPrice = 0;
  if (productId === 'new') {
    name = document.getElementById('manual-new-name').value.trim();
    sku = document.getElementById('manual-new-sku').value.trim();
    category = document.getElementById('manual-new-category').value.trim();
    unitPrice = num(document.getElementById('manual-new-price').value);
    qty = num(document.getElementById('manual-qty').value);
    if (!name) { toast('Enter the new product name', 'error'); document.getElementById('manual-new-name').focus(); return; }
  }
  const existing = productId && productId !== 'new' ? state.products.find(p => p.id === productId) : null;
  if (!existing && productId !== 'new') { toast('Pick a product first', 'error'); return; }
  if (qty <= 0) { toast('Enter how many units arrived (e.g. 10)', 'error'); document.getElementById('manual-qty').focus(); return; }
  const res = addStockEntry({ productId: existing ? existing.id : null, name: existing ? existing.name : name, sku: existing ? existing.sku : sku, category: existing ? existing.category : category, unitPrice: existing ? existing.unitPrice : unitPrice, quantity: qty, source: 'manual', note: document.getElementById('manual-note').value.trim() || 'Manual entry' });
  if (res.ok) {
    document.getElementById('manual-qty').value = 1;
    document.getElementById('manual-note').value = '';
    manualProductId = '';
    document.getElementById('manual-product').value = '';
    document.getElementById('manual-new-fields').classList.add('hidden');
    toast(`✅ Added ${qty} units${existing ? ' to ' + existing.name : ''}.`);
  }
}

function handleDeduct(e) {
  e.preventDefault();
  const product = state.products.find(p => p.id === deductProductId);
  if (!product) { toast('Select a product to deduct from', 'error'); return; }
  let qty = num(document.getElementById('deduct-qty').value);
  let serialNumbers = [];
  document.querySelectorAll('#deduct-form input.serial-check:checked').forEach(cb => serialNumbers.push(cb.dataset.serial));
  if (serialNumbers.length > 0) { qty = serialNumbers.length; }
  const reason = document.getElementById('deduct-reason').value;
  if (qty <= 0) { toast('Enter a valid quantity', 'error'); return; }
  const res = deductStockEntry({ productId: product.id, quantity: qty, serialNumbers, reason });
  if (res.ok) {
    document.getElementById('deduct-qty').value = 1;
    document.getElementById('deduct-note').value = '';
    toast(`✅ Deducted ${qty} from ${product.name}.`);
  }
}

/* ---------------- cloud sync ---------------- */

function updateCloudBadge(chk) {
  const el = document.getElementById('cloud-badge');
  if (el) { el.hidden = false; }
  if (!chk) return;
  if (chk.ok) {
    const t = (cloudLastSync || new Date().toISOString());
    el.textContent = '☁ Synced · ' + new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    el.className = 'cloud-badge cloud-ok';
  } else {
    const off = chk.reason === 'signed-out' || !cloudSessionEmail;
    el.textContent = off ? '☁ Sign in for cloud save' : '☁ Sync error';
    el.className = off ? 'cloud-badge cloud-off' : 'cloud-badge cloud-err';
  }
}

function setCloudBadgeCls(mode) {
  const el = document.getElementById('cloud-badge');
  if (!el) return;
  el.hidden = false;
  if (mode === 'ok') {
    el.textContent = '☁ Synced · ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    el.className = 'cloud-badge cloud-ok';
  } else if (mode === 'error') {
    el.textContent = '☁ Sync paused — retrying on next change';
    el.className = 'cloud-badge cloud-err';
  }
}

async function doCloudPush(silent) {
  if (!(window.CloudSync && cloudSessionEmail)) return null;
  const res = await CloudSync.pushState(state);
  if (res && !res.error) {
    cloudLastSync = res.updatedAt;
    try { localStorage.setItem('stockflow_cloud_lastpush', res.updatedAt); } catch (err) {}
    if (!silent) toast('☁️ Saved to your account');
    setCloudBadgeCls('ok');
  } else if (res && res.error) {
    if (!silent) toast('Cloud save failed: ' + res.error, 'error');
    setCloudBadgeCls('error');
  }
  return res;
}

async function doCloudPull(silent) {
  if (!(window.CloudSync && cloudSessionEmail)) return null;
  const res = await CloudSync.pullLatest();
  if (res && res.data) {
    try {
      const localRaw = localStorage.getItem(DB_KEY);
      if (localRaw) localStorage.setItem(DB_KEY + '_backup_lastcloud', localRaw);
      localStorage.setItem(DB_KEY, JSON.stringify(res.data));
    } catch (err) {}
    loadState();
    render();
    cloudLastSync = res.updatedAt || new Date().toISOString();
    if (!silent) toast('☁️ Loaded latest from your account');
    setCloudBadgeCls('ok');
  } else if (res && res.empty && !silent) {
    toast('Your account has no saved data yet');
  } else if (res && res.error) {
    if (!silent) toast('Cloud pull failed: ' + res.error, 'error');
    setCloudBadgeCls('error');
  }
  return res;
}

function onCloudUpdate(ts, data) {
  if (!data) return;
  try {
    const localRaw = localStorage.getItem(DB_KEY);
    if (localRaw) localStorage.setItem(DB_KEY + '_backup_lastcloud', localRaw);
    localStorage.setItem(DB_KEY, JSON.stringify(data));
  } catch (e) {}
  loadState();
  render();
  cloudLastSync = ts || new Date().toISOString();
  setCloudBadgeCls('ok');
  toast('☁️ Updated from another device');
}

/* ---------------- login gate ---------------- */
function loginGateHtml() {
  return `<div style="min-height:100vh;background:linear-gradient(160deg,#0f172a 0%,#1e1b4b 100%);display:flex;align-items:center;justify-content:center;padding:20px">
    <div class="card" style="max-width:420px;width:100%;text-align:center;padding:34px 26px">
      <div style="font-size:40px;line-height:1">📦</div>
      <h2 style="margin:10px 0 4px;font-size:22px">StockFlow</h2>
      <p class="muted" style="margin:0 0 22px">Your shop's inventory, bills & khata — saved to your cloud account.</p>
      <button class="btn g-btn" data-action="login-google" style="width:100%;padding:12px;font-size:15px">Continue with Google</button>
      <div class="g-divider">or sign in with an email code</div>
      <form id="gate-email-form" autocomplete="email" style="display:flex;gap:8px">
        <input id="gate-email" type="email" placeholder="your@gmail.com" required style="flex:1;padding:10px">
        <button type="submit" class="btn">Send code</button>
      </form>
      <div id="gate-status" style="margin-top:14px;font-size:13px;color:var(--muted);min-height:18px"></div>
    </div>
  </div>`;
}

function showLoginGate() {
  let gate = document.getElementById('login-gate');
  if (!gate) {
    gate = document.createElement('div');
    gate.id = 'login-gate';
    document.body.appendChild(gate);
  }
  gate.style.cssText = 'position:fixed;inset:0;z-index:90;background:#0f172a;overflow:auto;display:flex;align-items:center;justify-content:center';
  gate.innerHTML = loginGateHtml();
  const mainNode = document.querySelector('.main');
  const sidebarNode = document.querySelector('.sidebar');
  if (mainNode) mainNode.style.visibility = 'hidden';
  if (sidebarNode) sidebarNode.style.visibility = 'hidden';
}

function hideLoginGate() {
  const gate = document.getElementById('login-gate');
  if (gate) gate.remove();
  const mainNode = document.querySelector('.main');
  const sidebarNode = document.querySelector('.sidebar');
  if (mainNode) mainNode.style.visibility = '';
  if (sidebarNode) sidebarNode.style.visibility = '';
}

async function loginGoogle() {
  const status = document.getElementById('gate-status');
  if (status) status.textContent = 'Opening Google sign-in…';
  CloudSync.loginWithGoogle().then(function (res) {
    if (status) status.textContent = res && res.error ? '❌ ' + res.error : 'Redirecting to Google…';
  });
}

async function gateEmailSubmit(e) {
  e.preventDefault();
  const email = document.getElementById('gate-email').value.trim();
  const status = document.getElementById('gate-status');
  if (!email || email.indexOf('@') < 1) { status.textContent = 'Enter a valid email'; return; }
  status.textContent = 'Sending code…';
  const res = await CloudSync.sendLoginCode(email);
  if (res && res.error) { status.textContent = '❌ ' + res.error; return; }
  cloudAuthEmail = email;
  cloudSessionEmail = null;
  status.innerHTML = '📧 A 6-digit code was sent to <strong>' + esc(email) + '</strong> (also check spam). Enter it below:<br>' +
    '<div style="display:flex;gap:8px;margin-top:10px"><input id="gate-code" inputmode="numeric" maxlength="10" placeholder="123456" style="flex:1;padding:10px;letter-spacing:3px;text-align:center"><button type="button" class="btn btn-primary" data-action="gate-verify">Verify</button></div>';
}

async function gateVerify() {
  const codeEl = document.getElementById('gate-code');
  const status = document.getElementById('gate-status');
  if (!codeEl) return;
  const token = codeEl.value.trim();
  if (!token) { status.textContent = 'Enter the code from your email'; return; }
  status.textContent = 'Verifying…';
  const res = await CloudSync.verifyLoginCode(cloudAuthEmail || (document.getElementById('gate-email') || {}).value || '', token);
  if (res && res.error) { status.textContent = '❌ ' + res.error; return; }
  await afterCloudLogin(false);
  setPage('dashboard');
}

/* ---------------- sync page ---------------- */

function renderSync() {
  let html = '';

  if (cloudSessionEmail) {
    let last = cloudLastSync;
    if (!last) { try { last = localStorage.getItem('stockflow_cloud_lastpush'); } catch (e) {} }
    const when = last ? new Date(last).toLocaleString() : 'just now';
    html += `<div class="card" style="max-width:640px">
      <h3>☁️ Auto-saved to your account</h3>
      <p>Signed in as <strong class="mono">${esc(cloudSessionEmail)}</strong></p>
      <p class="muted">Everything you change — stock, bills, invoices, purchases, payments — is saved to this account automatically. Open StockFlow on any other device, sign in with the same email, and everything appears (live, in seconds).</p>
      <div class="row-actions" style="margin-top:12px">
        <button class="btn btn-primary" data-action="cloud-sync-now">🔄 Sync now</button>
        <button class="btn" data-action="cloud-signout">🚪 Log out on this device</button>
      </div>
      <p class="muted" style="margin-top:10px;font-size:13px">Last activity: ${esc(when)}</p>
    </div>`;
  } else if (cloudAuthStage === 'email') {
    html += `<div class="card" style="max-width:520px">
      <h3>🔑 Save & sync with your account</h3>
      <p class="muted">Your shop data is saved under your own account. Each device signs in once — then everything syncs automatically.</p>
      <button class="btn g-btn" data-action="login-google" style="width:100%;padding:12px;font-size:15px;margin-bottom:6px">Continue with Google</button>
      <div class="g-divider">or with an email code</div>
      <form id="cloud-email-form" autocomplete="email">
        <div class="field">
          <label>Your email (Gmail works great)</label>
          <input id="cl-email" type="email" placeholder="you@gmail.com" required style="font-size:16px;padding:10px">
        </div>
        <button type="submit" class="btn btn-primary">📧 Send me a login code</button>
      </form>
      <div id="cloud-auth-status" class="muted" style="margin-top:10px"></div>
    </div>`;
  } else {
    html += `<div class="card" style="max-width:520px">
      <h3>✉️ Check your email</h3>
      <p class="muted">We sent a 6-digit login code to <strong class="mono">${esc(cloudAuthEmail)}</strong>. Enter it below (also check spam).</p>
      <form id="cloud-code-form" autocomplete="one-time-code">
        <div class="field">
          <label>6-digit code</label>
          <input id="cl-code" type="text" inputmode="numeric" maxlength="10" placeholder="123456" required style="font-size:18px;letter-spacing:4px;padding:10px;text-align:center">
        </div>
        <button type="submit" class="btn btn-primary">✅ Verify & sign in</button>
        <button type="button" class="btn" data-action="cloud-edit-email">✏️ Change email</button>
      </form>
      <div id="cloud-auth-status" class="muted" style="margin-top:10px"></div>
    </div>`;
  }

  document.getElementById('page').innerHTML = html;
  setTopbarActions('');
  return html;
}

async function handleCloudEmailSubmit(e) {
  e.preventDefault();
  const email = document.getElementById('cl-email').value.trim();
  if (!email || email.indexOf('@') < 1) { toast('Enter a valid email', 'error'); return; }
  const status = document.getElementById('cloud-auth-status');
  status.textContent = 'Sending code…';
  const res = await CloudSync.sendLoginCode(email);
  if (res && res.error) {
    status.textContent = '❌ ' + res.error;
    return;
  }
  cloudAuthEmail = email;
  cloudAuthStage = 'code';
  renderSync();
  toast('📧 Code sent to ' + email + ' — check your inbox');
}

async function handleCloudCodeSubmit(e) {
  e.preventDefault();
  const token = document.getElementById('cl-code').value.trim();
  if (!token) { toast('Enter the 6-digit code from your email', 'error'); return; }
  const status = document.getElementById('cloud-auth-status');
  status.textContent = 'Verifying…';
  const res = await CloudSync.verifyLoginCode(cloudAuthEmail, token);
  if (res && res.error) {
    status.textContent = '❌ ' + res.error;
    return;
  }
  cloudAuthStage = 'email';
  await afterCloudLogin(false);
  renderSync();
}

function afterCloudLogin(silent) {
  return CloudSync.getSession().then(function (s) {
    if (!s || !s.user) { updateCloudBadge({ ok: false, reason: 'signed-out' }); return null; }
    cloudSessionEmail = (s.user.email || 'signed in');
    return CloudSync.pullLatest().then(function (res) {
      if (res && res.data) {
        try {
          const localRaw = localStorage.getItem(DB_KEY);
          if (localRaw) localStorage.setItem(DB_KEY + '_backup_lastcloud', localRaw);
          localStorage.setItem(DB_KEY, JSON.stringify(res.data));
        } catch (e) {}
        loadState();
        render();
        cloudLastSync = res.updatedAt || new Date().toISOString();
        if (!silent) toast('☁️ Signed in — your saved shop data loaded');
      } else if (res && res.empty) {
        return doCloudPush(true).then(function () {
          if (!silent) toast("☁️ Signed in — this device's data now saved to your account");
        });
      }
      return true;
    }).then(function () {
      updateCloudBadge({ ok: true });
      CloudSync.subscribe(onCloudUpdate);
      if (currentPage === 'sync') renderSync();
    });
  });
}

function bootApp() {
  if (!(window.CloudSync && CloudSync.isAvailable())) {
    updateCloudBadge({ ok: false, reason: 'signed-out' });
    return;
  }
  showLoginGate();
  CloudSync.getSession().then(function (s) {
    if (s && s.user) {
      afterCloudLogin(true).then(function () { hideLoginGate(); });
    } else {
      cloudSessionEmail = null;
      updateCloudBadge({ ok: false, reason: 'signed-out' });
    }
  });
  CloudSync.onAuth(function () {
    CloudSync.getSession().then(function (s) {
      if (s && s.user) {
        afterCloudLogin(true).then(function () { hideLoginGate(); setPage('dashboard'); });
      } else {
        cloudSessionEmail = null;
        setPage('dashboard');
        updateCloudBadge({ ok: false, reason: 'signed-out' });
        showLoginGate();
      }
    });
  });
}

/* ---------------- init ---------------- */
let addTab = 'manual';

document.addEventListener('click', handleAction);
document.addEventListener('change', handleChange);
document.addEventListener('submit', handleSubmit);
document.addEventListener('input', e => { if (e.target && e.target.id === 'stock-search') { stockQuery = e.target.value; render(); } });

// close quick-create sheet by tapping outside the sheet
document.getElementById('quick-sheet').addEventListener('click', function (e) {
  if (e.target === this) closeQuickSheet();
});

let stockQuery = '';

setPage('dashboard');
bootApp();
