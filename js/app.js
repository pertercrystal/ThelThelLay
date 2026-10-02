// js/app.js
(() => {
  'use strict';

  const KEY = 'moneyflow-v3';
  const $ = id => document.getElementById(id);
  const q = sel => document.querySelector(sel);
  const today = new Date().toISOString().slice(0,10);

  const money = n => `${Math.round(Number(n) || 0).toLocaleString()} MMK`;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function safeParse(s, fallback = {}) {
    try { return JSON.parse(s); } catch (e) { return fallback; }
  }

  function defaultCategories() { return []; }

  function fallback() {
    return {
      transactions: [],
      categories: defaultCategories(),
      budgets: [],
      goals: [],
      loans: [],
      settings: { theme: 'light', syncUrl: '', carryOverEnabled: true, carryOverConfirm: false, txPageSize: 50 },
      reportMonth: today.slice(0,7),
      currentType: 'expense',
      syncStatus: null
    };
  }

  function readState() {
    try {
      return Object.assign({}, fallback(), safeParse(localStorage.getItem(KEY) || 'null', {}));
    } catch (e) {
      return fallback();
    }
  }

  function writeState(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
  }

  let state = readState();

  function toast(msg) {
    const t = $('toast'); if (!t) return;
    t.textContent = msg; t.classList.add('on'); t.style.display = 'block';
    clearTimeout(t._t); t._t = setTimeout(() => { t.classList.remove('on'); t.style.display = 'none'; }, 2200);
  }

  function uid(prefix='id') { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`; }

  function saveState() { writeState(state); }

  function repairTransactionIds() {
    let changed = false; (state.transactions || []).forEach(tx => {
      if (!tx.id) { tx.id = uid('tx'); changed = true; }
      if (!tx.createdAt) { tx.createdAt = Date.now(); changed = true; }
      if (!tx.date) { tx.date = today; changed = true; }
    });
    if (changed) { saveState(); scheduleSync(); }
  }

  function currentMonth() { return state.reportMonth || today.slice(0,7); }

  const TX_PAGE_SIZE = 50;
  let txCurrentPage = 1;
  let txTotalPages = 1;
  let txInfiniteScrollBound = false;

  if (!window.__moneyflow_tx_page_size) window.__moneyflow_tx_page_size = Number(state.settings?.txPageSize) || TX_PAGE_SIZE;

  function getAllTxSortedDesc() {
    return (state.transactions || []).slice().sort((a,b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    });
  }

  function ensureTxPaginationControls() {
    const txPanel = $('txRows') ? $('txRows').closest('.panel') || $('txRows').parentElement : null;
    if (!txPanel) return;
    let container = txPanel.querySelector('#txPagination');
    if (!container) {
      container = document.createElement('div');
      container.id = 'txPagination';
      container.className = 'head';
      container.style.display = 'flex';
      container.style.gap = '8px';
      container.style.alignItems = 'center';
      container.style.marginTop = '8px';
      container.style.justifyContent = 'center';
      txPanel.appendChild(container);
    }
    const pageSize = Number(window.__moneyflow_tx_page_size || TX_PAGE_SIZE) || TX_PAGE_SIZE;
    container.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px">
        <button id="txPrev" class="small">Prev</button>
        <div id="txPageInfo" class="muted">Page 1 / 1</div>
        <button id="txNext" class="small">Next</button>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-left:12px">
        <label class="small muted" for="txPageSize">Rows</label>
        <select id="txPageSize" style="min-width:64px">
          <option value="20"${pageSize===20?' selected':''}>20</option>
          <option value="50"${pageSize===50?' selected':''}>50</option>
          <option value="100"${pageSize===100?' selected':''}>100</option>
        </select>
      </div>
    `;
    container.querySelector('#txPrev')?.addEventListener('click', () => {
      if (txCurrentPage > 1) { txCurrentPage--; renderTransactions(); scrollTxPanelToTop(); }
    });
    container.querySelector('#txNext')?.addEventListener('click', () => {
      if (txCurrentPage < txTotalPages) { txCurrentPage++; renderTransactions(); scrollTxPanelToTop(); }
    });
    container.querySelector('#txPageSize')?.addEventListener('change', (e) => {
      const v = Number(e.target.value) || TX_PAGE_SIZE;
      txCurrentPage = 1;
      window.__moneyflow_tx_page_size = v;
      state.settings = state.settings || {};
      state.settings.txPageSize = v;
      saveState();
      renderTransactions();
    });
  }

  function scrollTxPanelToTop() {
    const txPanel = $('txRows') ? $('txRows').closest('.panel') || $('txRows').parentElement : null;
    if (txPanel) txPanel.scrollTop = 0;
  }

  function attachTxInfiniteScroll() {
    if (txInfiniteScrollBound) return;
    const txPanel = $('txRows') ? $('txRows').closest('.panel') || $('txRows').parentElement : null;
    if (!txPanel) return;
    txPanel.addEventListener('scroll', () => {
      const atBottom = txPanel.scrollHeight - txPanel.scrollTop - txPanel.clientHeight < 60;
      if (atBottom && txCurrentPage < txTotalPages) {
        txCurrentPage++;
        renderTransactions();
      }
    });
    txInfiniteScrollBound = true;
  }

  // Categories
  function renderCategoriesList() {
    const holder = $('categoriesList');
    if (!holder) return;
    const cats = (state.categories || []);
    holder.style.maxHeight = '320px';
    holder.style.overflowY = 'auto';
    holder.style.overflowX = 'hidden';

    if (!cats.length) {
      holder.innerHTML = `<div class="muted">No categories</div>`;
      fillCategorySelects();
      return;
    }
    holder.innerHTML = cats.map((c, idx) => {
      return `<div class="row" data-idx="${idx}">
        <div class="meta"><strong>${esc(c.name)}</strong><div class="small-muted">${esc(c.type)}</div></div>
        <div>
          <button class="small edit" data-idx="${idx}">Edit</button>
          <button class="small delete" data-idx="${idx}">Delete</button>
        </div>
      </div>`;
    }).join('');

    holder.querySelectorAll('button.edit').forEach(btn => btn.addEventListener('click', e => {
      const idx = +btn.dataset.idx;
      const c = state.categories[idx];
      const newName = prompt('Edit category name', c.name);
      if (!newName) return;
      const newType = prompt('Type (expense|income|loan|credit)', c.type) || c.type;
      const normalized = newName.trim().toLowerCase();
      const dup = state.categories.some((x,i) => i!==idx && x.name.trim().toLowerCase() === normalized);
      if (dup) { toast('Category with this name already exists'); return; }
      state.categories[idx].name = newName.trim();
      state.categories[idx].type = newType;
      saveState();
      renderCategoriesList();
      populateCategories();
      fillCategorySelects();
      scheduleSync();
      toast('Category updated');
    }));

    holder.querySelectorAll('button.delete').forEach(btn => btn.addEventListener('click', e => {
      const idx = +btn.dataset.idx;
      const c = state.categories[idx];
      if (!confirm(`Delete category "${c.name}" (${c.type})? This will not delete existing transactions.`)) return;
      state.categories.splice(idx,1);
      saveState();
      renderCategoriesList();
      populateCategories();
      fillCategorySelects();
      scheduleSync();
      toast('Category deleted');
    }));
    fillCategorySelects();
  }

  function addCategoryFromUI() {
    const name = ($('newCategoryName')?.value || '').trim();
    const type = ($('newCategoryType')?.value || 'expense');
    if (!name) { toast('Category name required'); return; }
    const normalized = name.trim().toLowerCase();
    if (state.categories.some(c => c.name.trim().toLowerCase() === normalized)) { toast('Category exists'); return; }
    state.categories.push({ name, type, createdAt: new Date().toISOString() });
    saveState();
    scheduleSync();
    $('newCategoryName').value = '';
    renderCategoriesList();
    populateCategories();
    fillCategorySelects();
    toast('Category added');
  }

  function resetDefaultCategories() {
    if (!confirm('Reset categories to defaults? This will replace your categories list.')) return;
    state.categories = defaultCategories();
    saveState();
    scheduleSync();
    renderCategoriesList();
    populateCategories();
    fillCategorySelects();
    toast('Categories reset to defaults');
  }

  function fillCategorySelects() {
    const categorySelect = $('category');
    if (categorySelect) {
      const list = (state.categories || []);
      categorySelect.innerHTML = list.map(c => `<option>${esc(c.name)}</option>`).join('') || `<option>General</option>`;
      categorySelect.style.maxHeight = '220px';
    }
    const budgetCategorySelect = $('budgetCategorySelect');
    if (budgetCategorySelect) {
      const entries = state.categories || [];
      const seen = new Map();
      entries.forEach(c => { seen.set(c.name, c); });
      const unique = Array.from(seen.values());
      budgetCategorySelect.innerHTML = unique.map(c => `<option value="${esc(c.name)}">${esc(c.name)} • ${esc(c.type)}</option>`).join('') || `<option value="General">General • expense</option>`;
      budgetCategorySelect.style.maxHeight = '220px';
    }
  }

  // Budgets
  function renderBudgetsList() {
    const holder = $('budgetsList');
    if (!holder) return;
    holder.style.maxHeight = '320px';
    holder.style.overflowY = 'auto';
    holder.style.overflowX = 'hidden';

    const bs = state.budgets || [];
    if (!bs.length) { holder.innerHTML = `<div class="muted">No budgets set</div>`; return; }
    holder.innerHTML = bs.map((b, idx) => {
      return `<div class="row" data-idx="${idx}">
        <div class="meta"><strong>${esc(b.category)}</strong><div class="small-muted">${money(b.amount)}</div></div>
        <div>
          <button class="small edit-budget" data-idx="${idx}">Edit</button>
          <button class="small delete-budget" data-idx="${idx}">Delete</button>
        </div>
      </div>`;
    }).join('');

    holder.querySelectorAll('button.edit-budget').forEach(btn => btn.addEventListener('click', () => {
      const idx = +btn.dataset.idx;
      const b = state.budgets[idx];
      const newAmount = prompt('Budget amount (MMK)', String(b.amount || 0));
      if (newAmount === null) return;
      const n = Number(newAmount || 0);
      if (isNaN(n) || n < 0) { toast('Invalid amount'); return; }
      state.budgets[idx].amount = n;
      saveState();
      scheduleSync();
      renderBudgetsList();
      toast('Budget updated');
    }));

    holder.querySelectorAll('button.delete-budget').forEach(btn => btn.addEventListener('click', () => {
      const idx = +btn.dataset.idx;
      const b = state.budgets[idx];
      if (!confirm(`Delete budget for ${b.category}?`)) return;
      state.budgets.splice(idx,1);
      saveState();
      scheduleSync();
      renderBudgetsList();
      toast('Budget deleted');
    }));
  }

  function addBudgetFromUI() {
    const category = ($('budgetCategorySelect')?.value || '').trim();
    const amount = Number(($('newBudgetAmount')?.value || 0));
    if (!category) { toast('Choose a category'); return; }
    if (!amount || amount <= 0) { toast('Enter budget amount greater than 0'); return; }
    state.budgets = state.budgets || [];
    const existing = state.budgets.find(b => b.category === category);
    if (existing) {
      existing.amount = amount;
    } else {
      state.budgets.push({ id: uid('bud'), category, amount, createdAt: new Date().toISOString() });
    }
    saveState();
    scheduleSync();
    $('newBudgetAmount').value = '';
    renderBudgetsList();
    toast('Budget saved');
  }

  function clearBudgets() {
    if (!confirm('Clear all budgets?')) return;
    state.budgets = [];
    saveState();
    scheduleSync();
    renderBudgetsList();
    toast('All budgets cleared');
  }

  // core app logic
  function totals(xs) {
    return xs.reduce((r,t) => {
      const n = Number(t.amount) || 0;
      if (t.type === 'income') r.income += n;
      else if (t.type === 'expense') r.expense += n;
      else if (t.type === 'loan') r.loan += n;
      else if (t.type === 'credit') r.credit += n;
      return r;
    }, { income:0, expense:0, loan:0, credit:0 });
  }

  function updateLoanRepaymentField() {
    const holder = $('loanSelectHolder');
    if (!holder) return;
    const loans = (state.loans || []).filter(l => Number(l.remaining) > 0);
    if (!loans.length) { holder.style.display = 'none'; holder.innerHTML = ''; return; }
    holder.style.display = '';
    if (!holder.querySelector('select')) {
      const label = document.createElement('label'); label.textContent = 'Select loan to repay';
      const select = document.createElement('select'); select.id = 'loanRepaySelect'; select.name = 'loanRepaySelect';
      holder.appendChild(label); holder.appendChild(select);
    }
    const select = holder.querySelector('select');
    select.innerHTML = `<option value="">-- choose loan --</option>` + loans.map(l => `<option value="${esc(String(l.id))}">${esc(l.name || 'Loan')} — ${money(l.remaining)}</option>`).join('');
  }

  function populateCategories() {
    const s = $('category');
    if (!s) return;
    const list = (state.categories || []);
    s.innerHTML = list.map(c => `<option>${esc(c.name)}</option>`).join('') || `<option>General</option>`;
  }

  function repairLoanRecords() {
    state.loans = Array.isArray(state.loans) ? state.loans : [];
    let changed = false;
    (state.transactions || []).forEach(tx => {
      const cat = String(tx.category || '').toLowerCase();
      const isLoanReceipt = cat.includes('loan') || tx.loanType === 'loan' || tx.type === 'loan';
      const isPayback = (cat.includes('repay') || cat.includes('payback') || tx.loanType === 'payback');
      if (isLoanReceipt && tx.type !== 'income') { tx.type = 'income'; changed = true; }
      if (isPayback && tx.type !== 'expense') { tx.type = 'expense'; changed = true; }
      if (isLoanReceipt && !tx.loanId) { tx.loanId = `loan-${tx.id || tx.createdAt || Date.now()}`; changed = true; }
    });
    (state.transactions || []).filter(tx => tx.type === 'income' && tx.loanId).forEach(tx => {
      const found = state.loans.find(l => String(l.id) === String(tx.loanId));
      if (!found) {
        state.loans.push({
          id: tx.loanId,
          name: tx.note || 'Loan',
          principal: Number(tx.amount) || 0,
          remaining: Number(tx.amount) || 0,
          date: tx.date,
          note: tx.note || '',
          createdAt: tx.createdAt || Date.now()
        });
        changed = true;
      }
    });
    if (changed) { saveState(); scheduleSync(); }
  }

  function applyRepayments() {
    state.loans = Array.isArray(state.loans) ? state.loans : [];
    let changed = false;
    const loansById = {};
    state.loans.forEach(l => { loansById[String(l.id)] = l; });
    const txs = (state.transactions || []).slice().sort((a,b) => (a.createdAt||0) - (b.createdAt||0));
    txs.forEach(tx => {
      if (tx.type === 'expense' && tx.loanId && !tx._loanApplied) {
        const loan = loansById[String(tx.loanId)];
        if (loan) {
          const amt = Number(tx.amount) || 0;
          loan.remaining = Math.max(0, (Number(loan.remaining) || 0) - amt);
          tx._loanApplied = true;
          changed = true;
        }
      }
    });
    if (changed) { saveState(); scheduleSync(); }
  }

  function prevMonthKey(monthKey) {
    const [y, m] = monthKey.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, 1));
    date.setUTCMonth(date.getUTCMonth() - 1);
    const py = date.getUTCFullYear();
    const pm = String(date.getUTCMonth() + 1).padStart(2, '0');
    return `${py}-${pm}`;
  }

  function carryOverIfMissingForMonth(monthKey) {
    if (!monthKey) return;
    if (!state.settings?.carryOverEnabled) return;
    const prevKey = prevMonthKey(monthKey);
    const prevTxs = (state.transactions || []).filter(tx => String(tx.date || '').slice(0,7) === prevKey);
    if (!prevTxs.length) return;
    const t = totals(prevTxs);
    const remainingMoney = (t.income || 0) - (t.expense || 0) - (t.loan || 0) - (t.credit || 0);
    if (!(remainingMoney > 0)) return;
    const exists = (state.transactions || []).some(tx => {
      return String(tx.date || '').slice(0,7) === monthKey && String((tx.category||'').trim().toLowerCase()) === 'carry over';
    });
    if (exists) return;

    if (state.settings?.carryOverConfirm) {
      const ok = confirm(`Previous month (${prevKey}) remaining: ${money(remainingMoney)}. Add "Carry Over" to ${monthKey}?`);
      if (!ok) return;
    }

    const newTx = {
      id: uid('tx'),
      type: 'income',
      amount: remainingMoney,
      category: 'Carry Over',
      note: `Carry over from ${prevKey}`,
      date: `${monthKey}-01`,
      createdAt: new Date().toISOString()
    };
    state.transactions = state.transactions || [];
    state.transactions.push(newTx);
    saveState();
    scheduleSync();
    toast(`Carry Over added: ${money(remainingMoney)}`);
  }

  function renderLoanSummary() {
    repairLoanRecords();
    applyRepayments();
    const host = $('loanBI');
    if (!host) return;
    const monthKey = currentMonth();
    const rows = (state.transactions || []).filter(tx => String(tx.date || '').slice(0,7) === monthKey);
    const payback = rows.filter(tx => tx.type === 'expense' && tx.loanId).reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const received = rows.filter(tx => tx.type === 'income' && tx.loanId).reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const outstanding = (state.loans || []).reduce((s, l) => s + (Number(l.remaining) || 0), 0);
    const loanRows = (state.loans || []).map(loan => {
      return `<div class="loan-bi-row"><span>${esc(loan.name||'Loan')}<small>Principal: ${money(loan.principal)}</small></span><b>${money(loan.remaining)}</b></div>`;
    }).join('') || `<div class="empty muted">No loan records yet</div>`;
    host.innerHTML = `
      <div class="loan-bi-grid">
        <div class="loan-bi-stat"><small>Loan received</small><strong>${money(received)}</strong></div>
        <div class="loan-bi-stat"><small>Loan payback</small><strong>${money(payback)}</strong></div>
        <div class="loan-bi-stat"><small>Outstanding liability</small><strong>${money(outstanding)}</strong></div>
      </div>
      <div class="loan-bi-list">${loanRows}</div>
    `;
  }

  function renderBudgetReportSummary() {
    const host = $('budgetReport');
    if (!host) return;
    const bs = state.budgets || [];
    if (!bs.length) { host.innerHTML = `<div class="muted">No budgets set</div>`; return; }

    const monthKey = currentMonth();
    const rows = bs.map(b => {
      const spent = (state.transactions || []).filter(tx => String(tx.date || '').slice(0,7) === monthKey && tx.type === 'expense' && tx.category === b.category)
        .reduce((s,t) => s + (Number(t.amount) || 0), 0);
      const remaining = Math.max(0, (Number(b.amount) || 0) - spent);
      return { category: b.category, budget: Number(b.amount) || 0, spent, remaining };
    });

    host.innerHTML = rows.map(r => {
      return `<div class="row" style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px dashed var(--line)">
        <div><strong>${esc(r.category)}</strong><small class="muted">Budget</small></div>
        <div style="text-align:right">
          <div><small class="muted">Spent</small><div><b>${money(r.spent)}</b></div></div>
          <div style="margin-top:4px"><small class="muted">Remaining</small><div><b>${money(r.remaining)}</b></div></div>
        </div>
      </div>`;
    }).join('');
  }

  function renderGoalsList() {
    const host = $('goalsList');
    if (!host) return;
    const gs = state.goals || [];
    if (!gs.length) { host.innerHTML = `<div class="muted">No goals yet</div>`; return; }
    host.innerHTML = gs.map(g => {
      const progress = Number(g.progress) || 0;
      const target = Number(g.target) || 0;
      const pct = target > 0 ? Math.round((progress / target) * 100) : 0;
      return `<div class="row" style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px dashed var(--line)">
        <div><strong>${esc(g.title || g.name || 'Goal')}</strong><small class="muted">${esc(g.note || '')}</small></div>
        <div style="text-align:right"><small class="muted">${pct}%</small><div><b>${money(progress)}</b></div></div>
      </div>`;
    }).join('');
  }

  function normalizeDailyBudgets() {
    const elems = [];
    const byId = document.querySelectorAll('#dailyBudgets');
    byId.forEach(e => elems.push(e));
    document.querySelectorAll('.panel').forEach(p => {
      const h4 = p.querySelector('h4, h3, h2');
      if (h4 && h4.textContent && h4.textContent.trim().toLowerCase().includes('daily budgets')) {
        if (!elems.includes(p)) elems.push(p);
      }
    });
    if (elems.length <= 1) return;
    for (let i = 1; i < elems.length; i++) {
      const el = elems[i];
      if (el && el.parentElement) el.parentElement.removeChild(el);
    }
  }

  function renderDashboardStats() {
    const monthKey = currentMonth();
    const rows = (state.transactions || []).filter(tx => String(tx.date || '').slice(0,7) === monthKey);
    const t = totals(rows);
    const cashflow = (t.income || 0) - (t.expense || 0) - (t.loan || 0) - (t.credit || 0);
    const cfEl = $('cashflow');
    if (cfEl) cfEl.textContent = money(cashflow);

    const expenseRows = rows.filter(tx => tx.type === 'expense');
    const spendByCat = {};
    expenseRows.forEach(tx => {
      const cat = tx.category || tx.note || 'Other';
      spendByCat[cat] = (spendByCat[cat] || 0) + (Number(tx.amount) || 0);
    });
    let topCat = '—', topAmt = 0;
    for (const k in spendByCat) {
      if (spendByCat[k] > topAmt) { topAmt = spendByCat[k]; topCat = k; }
    }
    const topSpendEl = $('topSpend');
    if (topSpendEl) topSpendEl.textContent = topCat || '—';
    const topAmtEl = $('topAmt');
    if (topAmtEl) topAmtEl.textContent = money(topAmt);

    let largestLabel = '—', largestAmt = 0;
    if (rows.length) {
      const sorted = rows.slice().sort((a,b) => Math.abs(Number(b.amount)||0) - Math.abs(Number(a.amount)||0));
      const l = sorted[0];
      largestLabel = l.category || l.note || l.type || '—';
      largestAmt = Number(l.amount) || 0;
    }
    const largestEl = $('largest');
    if (largestEl) largestEl.textContent = largestLabel;
    const largestAmtEl = $('largestAmt');
    if (largestAmtEl) largestAmtEl.textContent = money(largestAmt);

    const rhythmEl = $('rhythm');
    if (rhythmEl) rhythmEl.textContent = String(rows.length || 0);
  }

  function getLastNMonthKeys(n = 12, endISO = today) {
    const [eyear, emonth] = (endISO || today).slice(0,7).split('-').map(Number);
    const months = [];
    let y = eyear, m = emonth - 1;
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(y, m - i, 1));
      const ky = d.getUTCFullYear();
      const km = String(d.getUTCMonth() + 1).padStart(2, '0');
      months.push(`${ky}-${km}`);
    }
    return months;
  }

  function computeMonthlyNetFlow(monthKeys) {
    const map = {};
    (state.transactions || []).forEach(tx => {
      const key = String(tx.date || '').slice(0,7);
      if (!key) return;
      if (!map[key]) map[key] = 0;
      const amt = Number(tx.amount) || 0;
      if (tx.type === 'income') map[key] += amt;
      else if (tx.type === 'expense') map[key] -= amt;
      else if (tx.type === 'loan') map[key] -= amt;
      else if (tx.type === 'credit') map[key] -= amt;
    });
    return monthKeys.map(k => Number(map[k] || 0));
  }

  function renderTrendChart() {
    const canvas = $('chart');
    if (!canvas) return;
    const parentWidth = canvas.parentElement ? canvas.parentElement.clientWidth : canvas.clientWidth || 600;
    const height = 220;
    canvas.width = Math.max(300, parentWidth * devicePixelRatio);
    canvas.height = Math.max(120, height * devicePixelRatio);
    canvas.style.width = parentWidth + 'px';
    canvas.style.height = height + 'px';
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0,0,canvas.width, canvas.height);
    ctx.save();
    ctx.scale(devicePixelRatio, devicePixelRatio);

    const months = getLastNMonthKeys(12);
    const values = computeMonthlyNetFlow(months).map(v => Math.round(v));
    const padLeft = 40, padRight = 12, padTop = 12, padBottom = 30;
    const w = (canvas.width / devicePixelRatio) - padLeft - padRight;
    const h = (canvas.height / devicePixelRatio) - padTop - padBottom;

    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === Infinity || max === -Infinity) { min = 0; max = 0; }
    const range = Math.max(1, max - min);
    max = Math.ceil(max + range * 0.1);
    min = Math.floor(min - range * 0.1);

    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    ctx.lineWidth = 1;
    ctx.font = '12px system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial';
    ctx.fillStyle = 'var(--muted, #999)';

    for (let i = 0; i <= 4; i++) {
      const y = padTop + (h * i / 4);
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(padLeft + w, y);
      ctx.stroke();
      const val = Math.round(max - (i * (max - min) / 4));
      ctx.fillText(`${val.toLocaleString()}`, 6, y + 4);
    }

    ctx.textAlign = 'center';
    months.forEach((m, i) => {
      const x = padLeft + (w * (i / (months.length - 1 || 1)));
      const lab = m.slice(5);
      ctx.fillText(lab, x, padTop + h + 18);
    });

    ctx.beginPath();
    const points = values.map((v, i) => {
      const x = padLeft + (w * (i / (values.length - 1 || 1)));
      const y = padTop + ( (max - v) / (max - min || 1) * h );
      return { x, y };
    });

    if (points.length) {
      ctx.moveTo(points[0].x, points[0].y);
      for (let p of points) ctx.lineTo(p.x, p.y);
      ctx.lineTo(padLeft + w, padTop + h);
      ctx.lineTo(padLeft, padTop + h);
      ctx.closePath();
      ctx.fillStyle = 'rgba(62,149,205,0.08)';
      ctx.fill();
    }

    ctx.beginPath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(62,149,205,1)';
    if (points.length) {
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.stroke();
    }

    points.forEach((p, i) => {
      ctx.beginPath();
      ctx.fillStyle = 'white';
      ctx.strokeStyle = 'rgba(62,149,205,1)';
      ctx.lineWidth = 1.5;
      ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    if (values.length) {
      const latest = values[values.length - 1];
      const txt = `${Math.round(latest).toLocaleString()} MMK`;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      const tw = ctx.measureText(txt).width + 14;
      const bx = padLeft + w - tw;
      const by = padTop + 6;
      ctx.fillRect(bx, by, tw, 22);
      ctx.fillStyle = 'white';
      ctx.fillText(txt, bx + tw / 2, by + 15);
    }

    ctx.restore();
  }

  // sync UI helpers
  function formatTime(ts) {
    if (!ts) return '—';
    try {
      const d = new Date(Number(ts));
      return d.toLocaleString();
    } catch (e) { return String(ts); }
  }

  function setSyncStatus({ ok = false, message = '', at = Date.now(), synced = null, localCounts = null, serverCounts = null } = {}) {
    state.syncStatus = {
      ok: !!ok,
      message: String(message || ''),
      at: at ? Number(at) : Date.now(),
      synced: synced === null ? null : !!synced,
      localCounts: localCounts || null,
      serverCounts: serverCounts || null
    };
    saveState();
    updateSyncStatusUI();
  }

  function updateSyncStatusUI() {
    ensureSyncStatusPanel();
    const holder = $('syncStatusPanel');
    if (!holder) return;
    const s = state.syncStatus;
    const timeEl = holder.querySelector('#syncLastAt');
    const statusEl = holder.querySelector('#syncStatusText');
    const syncedEl = holder.querySelector('#syncSyncedText');
    const msgEl = holder.querySelector('#syncMessage');
    const countsEl = holder.querySelector('#syncCounts');

    if (timeEl) timeEl.textContent = s && s.at ? formatTime(s.at) : 'Never';
    if (statusEl) {
      if (!s) statusEl.textContent = 'Idle';
      else statusEl.textContent = s.ok ? 'Success' : 'Failed';
      statusEl.style.color = s ? (s.ok ? 'var(--success, green)' : 'var(--danger, #c00)') : '';
    }
    if (syncedEl) {
      if (!s || s.synced === null) syncedEl.textContent = 'Unknown';
      else syncedEl.textContent = s.synced ? 'Yes' : 'No';
    }
    if (msgEl) msgEl.textContent = s && s.message ? s.message : '';
    if (countsEl) {
      if (s && (s.localCounts || s.serverCounts)) {
        const local = s.localCounts || {};
        const server = s.serverCounts || {};
        countsEl.innerHTML = `<div class="small-muted">Local: tx=${local.transactions||0} cats=${local.categories||0} buds=${local.budgets||0} goals=${local.goals||0} loans=${local.loans||0}</div>
          <div class="small-muted">Server: tx=${server.transactions||0} cats=${server.categories||0} buds=${server.budgets||0} goals=${server.goals||0} loans=${server.loans||0}</div>`;
      } else countsEl.innerHTML = '';
    }
  }

  function ensureSyncStatusPanel() {
    const settings = $('settings');
    if (!settings) return;
    if (settings.querySelector('#syncStatusPanel')) return;

    const holder = document.createElement('div');
    holder.id = 'syncStatusPanel';
    holder.className = 'panel';
    holder.style.marginTop = '12px';
    holder.innerHTML = `
      <h3>Sync status</h3>
      <div style="display:flex;gap:12px;align-items:center;">
        <div><small class="muted">Last sync</small><div id="syncLastAt">Never</div></div>
        <div><small class="muted">Status</small><div id="syncStatusText">Idle</div></div>
        <div><small class="muted">On sheet</small><div id="syncSyncedText">Unknown</div></div>
      </div>
      <div style="margin-top:8px">
        <div id="syncMessage" class="muted small"></div>
        <div id="syncCounts" style="margin-top:6px"></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button id="syncNow" class="primary">Sync now</button>
        <button id="syncRefresh" class="">Refresh status</button>
      </div>
    `;
    const carry = settings.querySelector('#carryOverSettings');
    if (carry && carry.parentElement) carry.parentElement.insertBefore(holder, carry.nextSibling);
    else settings.appendChild(holder);

    holder.querySelector('#syncNow')?.addEventListener('click', async () => {
      try {
        setSyncStatus({ ok: null, message: 'Syncing...', at: Date.now(), synced: null });
        await queueSync();
      } catch (e) {}
    });

    holder.querySelector('#syncRefresh')?.addEventListener('click', async () => {
      try {
        const url = state.settings?.syncUrl;
        if (!url) { toast('Enter Apps Script URL first'); return; }
        const ping = await api('ping', {});
        if (ping && (ping.ok || ping.message)) {
          const res = await api('getAll', {});
          if (res && res.data) {
            const server = {
              transactions: (res.data.transactions || []).length,
              categories: (res.data.categories || []).length,
              budgets: (res.data.budgets || []).length,
              goals: (res.data.goals || []).length,
              loans: (res.data.loans || []).length
            };
            const local = {
              transactions: (state.transactions || []).length,
              categories: (state.categories || []).length,
              budgets: (state.budgets || []).length,
              goals: (state.goals || []).length,
              loans: (state.loans || []).length
            };
            const synced = server.transactions === local.transactions &&
              server.categories === local.categories &&
              server.budgets === local.budgets &&
              server.goals === local.goals &&
              server.loans === local.loans;
            setSyncStatus({ ok: true, message: 'Refreshed', at: Date.now(), synced, localCounts: local, serverCounts: server });
            toast('Status refreshed');
          } else {
            setSyncStatus({ ok: true, message: 'No data returned', at: Date.now(), synced: false });
            toast('No data from sheet');
          }
        } else {
          setSyncStatus({ ok: false, message: 'Ping did not return expected response', at: Date.now(), synced: false });
          toast('Ping did not return expected response');
        }
      } catch (e) {
        setSyncStatus({ ok: false, message: e && e.message ? e.message : String(e), at: Date.now(), synced: false });
        toast('Refresh failed: ' + (e && e.message ? e.message : String(e)));
      }
    });

    updateSyncStatusUI();
  }

  // Network helpers (normalize URL & JSONP chunked fallback)
  function normalizeScriptUrl(u) {
    if (!u) return u;
    try {
      const url = new URL(u.trim());
      url.pathname = url.pathname.replace(/\/dev$/, '/exec');
      if (!url.pathname.includes('/exec')) url.pathname = url.pathname.replace(/\/+$/, '') + '/exec';
      return url.toString();
    } catch (e) {
      let s = u.trim();
      if (s.indexOf('/dev') !== -1) s = s.replace('/dev', '/exec');
      if (s.indexOf('/exec') === -1) {
        if (s.endsWith('/')) s = s + 'exec'; else s = s + '/exec';
      }
      return s;
    }
  }

  function jsonpCall(url, action, payload = {}, timeout = 15000) {
    return new Promise((resolve, reject) => {
      try {
        const cbName = '__mf_jsonp_cb_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
        let script = null;
        let to = null;
        const cleanup = () => {
          try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
          if (script && script.parentNode) script.parentNode.removeChild(script);
          if (to) clearTimeout(to);
        };
        window[cbName] = (res) => { cleanup(); resolve(res); };

        script = document.createElement('script');
        const params = new URLSearchParams();
        params.set('action', action);
        if (payload && typeof payload === 'object') params.set('payload', JSON.stringify(payload));
        params.set('callback', cbName);
        const sep = url.includes('?') ? '&' : '?';
        script.src = url + sep + params.toString();
        script.onerror = () => { cleanup(); reject(new Error('JSONP load error')); };
        to = setTimeout(() => { cleanup(); reject(new Error('JSONP timeout')); }, timeout);
        document.head.appendChild(script);
      } catch (e) { reject(e); }
    });
  }

  // Chunked upload fallback - split string into chunks of N chars
  function splitIntoChunks(str, chunkSize) {
    const out = [];
    for (let i = 0; i < str.length; i += chunkSize) out.push(str.slice(i, i + chunkSize));
    return out;
  }

  // api() tries POST; on failure uses JSONP or chunked JSONP
  async function api(action, payload = {}) {
    if (!state.settings || !state.settings.syncUrl) throw new Error('Add the Apps Script URL first.');
    const rawUrl = state.settings.syncUrl;
    const url = normalizeScriptUrl(rawUrl);

    // Try POST first
    try {
      const params = new URLSearchParams();
      params.append('action', action);
      params.append('payload', JSON.stringify(payload));

      const r = await fetch(url, {
        method: 'POST',
        mode: 'cors',
        cache: 'no-store',
        redirect: 'follow',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'Accept': 'application/json, text/plain, */*'
        },
        body: params.toString()
      });

      const text = await r.text().catch(() => null);
      let parsed = null;
      if (text) {
        try { parsed = JSON.parse(text); } catch (e) { parsed = null; }
      }

      if (!r.ok) {
        const bodyMsg = parsed ? JSON.stringify(parsed) : text || ('status ' + r.status);
        throw new Error('Sync failed: ' + bodyMsg);
      }

      if (parsed) return parsed;
      return { ok: true, data: text ? safeParse(text, {}) : {} };
    } catch (postErr) {
      // Fallback: if action is getAll/ping we can call JSONP straightforwardly
      if (action === 'getAll' || action === 'ping') {
        try {
          const resp = await jsonpCall(url, action, {});
          return resp;
        } catch (je) {
          throw new Error('Network error when contacting sync endpoint: ' + (postErr && postErr.message ? postErr.message : String(postErr)));
        }
      }

      // For replaceAll (big payload), use chunked JSONP fallback
      if (action === 'replaceAll') {
        try {
          const payloadStr = JSON.stringify(payload || {});
          // chunk size conservative to avoid URL length issues (1.5k chars)
          const CHUNK_SIZE = 1500;
          const chunks = splitIntoChunks(payloadStr, CHUNK_SIZE);
          const uploadId = 'u_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 10000);
          // send chunks sequentially
          for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            // use action=appendChunk with params uploadId,index,chunk
            await jsonpCall(url, 'appendChunk', { uploadId, index: i, chunk });
          }
          // finishUpload with total
          const finishRes = await jsonpCall(url, 'finishUpload', { uploadId, total: chunks.length });
          return finishRes;
        } catch (je) {
          let hint = '';
          if (location && location.protocol === 'https:' && rawUrl && rawUrl.startsWith('http:')) {
            hint = 'Possible mixed-content (HTTPS page calling HTTP URL). Use HTTPS for Apps Script URL.';
          }
          throw new Error('Network error when contacting sync endpoint: ' + (postErr && postErr.message ? postErr.message : String(postErr)) + (hint ? ' ' + hint : ''));
        }
      }

      // otherwise rethrow
      throw new Error('Network error when contacting sync endpoint: ' + (postErr && postErr.message ? postErr.message : String(postErr)));
    }
  }

  // queueSync (calls api('replaceAll')) and manages sync status
  async function queueSync() {
    if (!state.settings || !state.settings.syncUrl) {
      setSyncStatus({ ok: false, message: 'No sync URL', at: Date.now(), synced: false });
      return;
    }
    try {
      const payload = {
        transactions: state.transactions || [],
        categories: state.categories || [],
        budgets: state.budgets || [],
        goals: state.goals || [],
        loans: state.loans || []
      };
      const localCounts = {
        transactions: (payload.transactions || []).length,
        categories: (payload.categories || []).length,
        budgets: (payload.budgets || []).length,
        goals: (payload.goals || []).length,
        loans: (payload.loans || []).length
      };

      setSyncStatus({ ok: null, message: 'Syncing...', at: Date.now(), synced: null, localCounts });

      const res = await api('replaceAll', payload);

      if (res && res.data) {
        const serverCounts = {
          transactions: (res.data.transactions || payload.transactions || []).length,
          categories: (res.data.categories || payload.categories || []).length,
          budgets: (res.data.budgets || payload.budgets || []).length,
          goals: (res.data.goals || payload.goals || []).length,
          loans: (res.data.loans || payload.loans || []).length
        };

        state.transactions = res.data.transactions || state.transactions || [];
        state.loans = res.data.loans || state.loans || [];
        state.categories = res.data.categories || state.categories || [];
        state.budgets = res.data.budgets || state.budgets || [];
        state.goals = res.data.goals || state.goals || [];

        saveState();
        renderAll();

        const synced = serverCounts.transactions === localCounts.transactions &&
                       serverCounts.categories === localCounts.categories &&
                       serverCounts.budgets === localCounts.budgets &&
                       serverCounts.goals === localCounts.goals &&
                       serverCounts.loans === localCounts.loans;

        setSyncStatus({ ok: true, message: 'Sync succeeded', at: Date.now(), synced, localCounts, serverCounts });
        return res;
      }

      setSyncStatus({ ok: true, message: 'Sync finished (no data returned)', at: Date.now(), synced: null, localCounts });
      return res;
    } catch (e) {
      console.warn('sync failed', e);
      setSyncStatus({ ok: false, message: e && e.message ? e.message : String(e), at: Date.now(), synced: false });
      throw e;
    }
  }

  let _syncTimer = null;
  function scheduleSync(delay = 900) {
    if (_syncTimer) clearTimeout(_syncTimer);
    setSyncStatus({ ok: null, message: 'Scheduled', at: Date.now(), synced: null });
    _syncTimer = setTimeout(async () => {
      _syncTimer = null;
      try { await queueSync(); } catch (e) { console.warn('Scheduled sync failed:', e); }
    }, delay);
  }

  // UI & form handlers (same logic as before)
  async function saveTransactionForm(e) {
    e.preventDefault();
    const amountInput = $('amount'), dateInput = $('date'), noteInput = $('note'), categorySelect = $('category');
    const activeTab = document.querySelector('.tabs button.active');
    const type = activeTab?.dataset?.type || state.currentType || 'expense';
    const amount = Number(amountInput?.value || 0);
    if (!amount || amount <= 0) { toast('Enter an amount greater than 0'); return; }
    const date = dateInput?.value || today;
    const note = noteInput?.value || '';
    const category = categorySelect?.value || '';
    let tx;
    if (type === 'loan') {
      const loanId = uid('loan');
      tx = { id: uid('tx'), type: 'income', amount, category: category || 'Loan', note, date, loanId, loanType: 'loan', createdAt: new Date().toISOString() };
      state.transactions.push(tx);
      state.loans = state.loans || [];
      state.loans.push({ id: loanId, name: note || 'Loan', principal: Number(amount), remaining: Number(amount), date, note, createdAt: tx.createdAt });
    } else if (type === 'credit') {
      const loanSelect = $('loanRepaySelect');
      const loanId = loanSelect && loanSelect.value;
      if (!loanId) { toast('Choose a loan to repay'); return; }
      tx = { id: uid('tx'), type: 'expense', amount, category: category || 'Loan Repayment', note, date, loanId, loanType: 'payback', createdAt: new Date().toISOString() };
      state.transactions.push(tx);
      const loan = (state.loans || []).find(l => String(l.id) === String(loanId));
      if (loan) loan.remaining = Math.max(0, (Number(loan.remaining)||0) - Number(amount));
    } else {
      tx = { id: uid('tx'), type: type === 'income' ? 'income' : 'expense', amount, category, note, date, createdAt: new Date().toISOString() };
      state.transactions.push(tx);
    }
    saveState();
    txCurrentPage = 1;
    updateLoanRepaymentField(); renderAll(); toast('Saved');
    try { scheduleSync(); } catch (_) {}
    showPage('home'); const form = $('form'); if (form) form.reset(); if ($('date')) $('date').value = today;
  }

  function wireTabs() {
    const tabs = document.querySelectorAll('.tabs [data-type]');
    if (!tabs || !tabs.length) return;
    tabs.forEach(btn => btn.addEventListener('click', () => {
      const t = btn.dataset.type;
      document.querySelectorAll('.tabs [data-type]').forEach(b => b.classList.toggle('active', b.dataset.type === t));
      state.currentType = t;
      populateCategories();
      if (t === 'credit') updateLoanRepaymentField();
      else { const h = $('loanSelectHolder'); if (h) { h.style.display = 'none'; h.innerHTML = ''; } }
      const title = $('formTitle'); if (title) {
        const titles = { expense: 'Add Expense', income: 'Add Income', loan: 'Record Loan', credit: 'Loan Repayment' };
        title.textContent = titles[t] || 'Add Transaction';
      }
    }));
    if (state.currentType) document.querySelectorAll('.tabs [data-type]').forEach(b => b.classList.toggle('active', b.dataset.type === state.currentType));
  }

  function updateNavDisplay(activePage) {
    const hideOnPages = ['add'];
    const bottomNav = q('nav.bottom-nav');
    const topNav = q('nav.top-nav') || q('.top-nav');
    if (hideOnPages.includes(activePage)) { if (bottomNav) bottomNav.classList.add('hidden'); if (topNav) topNav.classList.add('hidden'); return; }
    const wide = window.matchMedia && window.matchMedia('(min-width:900px)').matches;
    if (bottomNav) bottomNav.classList.toggle('hidden', wide);
    if (topNav) topNav.classList.toggle('hidden', !wide);
  }

  function showPage(id) {
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === id));
    document.querySelectorAll('[data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === id));
    updateNavDisplay(id);
    if (id === 'home') renderAll();
    if (id === 'settings') { const inp = $('syncUrlInput'); if (inp) inp.value = state.settings?.syncUrl || ''; updateSyncStatusUI(); }
  }

  function handleGlobalClicks(e) {
    const page = e.target.closest && e.target.closest('[data-page]');
    if (page) { showPage(page.dataset.page); return; }
    const add = e.target.closest && e.target.closest('[data-add]');
    if (add) {
      const type = add.dataset.add;
      const tab = document.querySelector(`.tabs [data-type="${type}"]`);
      if (tab) tab.click(); else { state.currentType = type; populateCategories(); }
      showPage('add'); return;
    }
    const rem = e.target.closest && e.target.closest('[data-remove]');
    if (rem) {
      const id = rem.dataset.remove;
      if (id) {
        state.transactions = (state.transactions || []).filter(t => String(t.id) !== String(id));
        saveState(); renderAll();
        scheduleSync();
      }
      return;
    }
  }

  function applyTheme() {
    document.body.classList.toggle('dark', state.settings?.theme === 'dark');
    document.querySelectorAll('.theme-toggle').forEach(btn => btn.textContent = state.settings?.theme === 'dark' ? '☾' : '☼');
    const cur = $('currentTheme'); if (cur) cur.textContent = state.settings?.theme || 'light';
    saveState();
  }

  function ensureDashboardMonthControl() {
    const dashboard = $('dashboard');
    if (!dashboard) return;
    const target = dashboard.querySelector('.bi') || dashboard.querySelector('h1');
    if (!target) return;
    if (dashboard.querySelector('#dashboardMonthHolder')) return;

    const holder = document.createElement('div');
    holder.id = 'dashboardMonthHolder';
    holder.style.display = 'flex';
    holder.style.gap = '8px';
    holder.style.alignItems = 'center';
    holder.style.marginLeft = 'auto';
    holder.style.marginTop = '6px';
    holder.innerHTML = `<label for="dashboardMonth" class="small muted" style="margin-right:6px">Month</label><input id="dashboardMonth" type="month" />`;
    target.parentElement.insertBefore(holder, target.nextSibling);

    const inp = holder.querySelector('#dashboardMonth');
    if (inp) {
      inp.value = state.reportMonth || today.slice(0,7);
      inp.addEventListener('change', (e) => {
        const v = e.target.value;
        if (!v) return;
        state.reportMonth = v;
        saveState();
        carryOverIfMissingForMonth(v);
        renderAll();
      });
    }
    const inp2 = $('#dashboardMonth');
    if (inp2) inp2.value = state.reportMonth || today.slice(0,7);
  }

  function ensureCarryOverSettingsControl() {
    const settings = $('settings');
    if (!settings) return;
    if (settings.querySelector('#carryOverSettings')) return;

    const holder = document.createElement('div');
    holder.id = 'carryOverSettings';
    holder.style.marginTop = '12px';
    holder.className = 'panel';
    holder.innerHTML = `
      <h3>Carry Over</h3>
      <div style="display:flex;gap:8px;align-items:center;">
        <label class="small muted" for="carryOverEnable">Enable carry over</label>
        <input id="carryOverEnable" type="checkbox" />
        <label class="small muted" for="carryOverConfirm" style="margin-left:12px">Ask before adding</label>
        <input id="carryOverConfirm" type="checkbox" />
      </div>
      <small class="muted">When enabled, positive remaining from previous month is added as a "Carry Over" income on the 1st of the report month.</small>
    `;
    const themePanel = Array.from(settings.querySelectorAll('.panel')).find(p => p.textContent && p.textContent.includes('Theme'));
    if (themePanel && themePanel.parentElement) themePanel.parentElement.insertBefore(holder, themePanel.nextSibling);
    else settings.appendChild(holder);

    const enable = holder.querySelector('#carryOverEnable');
    const confirmCb = holder.querySelector('#carryOverConfirm');
    if (enable) {
      enable.checked = state.settings?.carryOverEnabled !== false;
      enable.addEventListener('change', (e) => {
        state.settings = state.settings || {};
        state.settings.carryOverEnabled = !!e.target.checked;
        saveState();
        toast('Carry Over ' + (e.target.checked ? 'enabled' : 'disabled'));
      });
    }
    if (confirmCb) {
      confirmCb.checked = !!state.settings?.carryOverConfirm;
      confirmCb.addEventListener('change', (e) => {
        state.settings = state.settings || {};
        state.settings.carryOverConfirm = !!e.target.checked;
        saveState();
        toast('Carry Over confirmation ' + (e.target.checked ? 'on' : 'off'));
      });
    }
  }

  function renderAll() {
    ensureDashboardMonthControl();
    ensureCarryOverSettingsControl();
    ensureSyncStatusPanel();

    greeting(); populateCategories(); renderHeaderStats(); renderTransactions(); renderLoanSummary(); updateLoanRepaymentField();
    renderCategoriesList(); renderBudgetsList(); fillCategorySelects();
    renderBudgetReportSummary(); renderGoalsList(); renderTrendChart();
    renderDashboardStats();
    if ($('month')) $('month').value = currentMonth();
    if ($('txCount')) $('txCount').textContent = `Activity (${(state.transactions||[]).length})`;
    if ($('txCountList')) $('txCountList').textContent = `Transactions (${(state.transactions||[]).length})`;
    const dbm = $('#dashboardMonth'); if (dbm) dbm.value = state.reportMonth || today.slice(0,7);
    carryOverIfMissingForMonth(state.reportMonth);
    updateSyncStatusUI();
  }

  function greeting() {
    const h = new Date().getHours(); const part = h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : h < 21 ? 'Evening' : 'Night';
    if ($('greet')) $('greet').textContent = `GOOD ${part.toUpperCase()}`;
  }

  function wireEvents() {
    document.addEventListener('click', handleGlobalClicks);
    document.getElementById('form')?.addEventListener('submit', saveTransactionForm);
    document.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => showPage(b.dataset.page)));
    document.querySelectorAll('.theme-toggle').forEach(btn => btn.addEventListener('click', () => {
      state.settings = state.settings || {}; state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark'; saveState(); applyTheme();
    }));

    $('addCategory')?.addEventListener('click', addCategoryFromUI);
    $('resetDefaultCategories')?.addEventListener('click', resetDefaultCategories);
    $('addBudget')?.addEventListener('click', addBudgetFromUI);
    $('clearBudgets')?.addEventListener('click', clearBudgets);

    $('saveSyncUrl')?.addEventListener('click', () => {
      const url = ($('syncUrlInput')?.value || '').trim(); state.settings = state.settings || {}; state.settings.syncUrl = url; saveState(); toast(url ? 'Sync URL saved' : 'Sync URL cleared');
    });

    $('testSync')?.addEventListener('click', async () => {
      const url = ($('syncUrlInput')?.value || '').trim(); if (!url) { toast('Enter Apps Script URL first'); return; }
      state.settings = state.settings || {}; state.settings.syncUrl = url; saveState();
      try {
        const ping = await api('ping', {});
        if (ping && (ping.ok || ping.message)) {
          try {
            await queueSync();
            toast('Test sync done');
          } catch (e) {
            toast('Test sync (push) failed: ' + (e && e.message ? e.message : String(e)));
          }
        } else {
          toast('Ping did not return expected response');
        }
      } catch (e) {
        console.warn('ping failed', e);
        setSyncStatus({ ok: false, message: e && e.message ? e.message : String(e), at: Date.now(), synced: false });
        toast('Ping failed: ' + (e && e.message ? e.message : String(e)));
      }
    });

    $('pullFromSheets')?.addEventListener('click', async () => {
      const url = ($('syncUrlInput')?.value || '').trim(); if (!url) { toast('Enter Apps Script URL first'); return; }
      state.settings = state.settings || {}; state.settings.syncUrl = url; saveState();
      try {
        const res = await api('getAll', {});
        if (res && res.data) {
          state.transactions = res.data.transactions || state.transactions || [];
          state.loans = res.data.loans || state.loans || [];
          state.categories = res.data.categories || state.categories || [];
          state.budgets = res.data.budgets || state.budgets || [];
          state.goals = res.data.goals || state.goals || [];
          saveState(); renderAll();
          const serverCounts = {
            transactions: (res.data.transactions || []).length,
            categories: (res.data.categories || []).length,
            budgets: (res.data.budgets || []).length,
            goals: (res.data.goals || []).length,
            loans: (res.data.loans || []).length
          };
          const localCounts = {
            transactions: (state.transactions || []).length,
            categories: (state.categories || []).length,
            budgets: (state.budgets || []).length,
            goals: (state.goals || []).length,
            loans: (state.loans || []).length
          };
          const synced = serverCounts.transactions === localCounts.transactions &&
                         serverCounts.categories === localCounts.categories &&
                         serverCounts.budgets === localCounts.budgets &&
                         serverCounts.goals === localCounts.goals &&
                         serverCounts.loans === localCounts.loans;
          setSyncStatus({ ok: true, message: 'Pulled from sheet', at: Date.now(), synced, localCounts, serverCounts });
          toast('Pulled from sheet');
        } else {
          setSyncStatus({ ok: true, message: 'No data from sheet', at: Date.now(), synced: false });
          toast('No data from sheet');
        }
      } catch (e) {
        console.warn('pull failed', e);
        setSyncStatus({ ok: false, message: e &&*

